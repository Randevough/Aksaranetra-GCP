/**
 * Satu pintu masuk untuk mengaudit sebuah halaman.
 *
 * Modul ini tidak punya logika aksesibilitas sendiri. Tugasnya hanya merangkai
 * modul lain dalam urutan yang benar, lalu menerjemahkan setiap kegagalan
 * menjadi kalimat yang bisa dibaca orang biasa.
 *
 * Urutan langkah tidak boleh diacak. Semua pemeriksaan alamat harus selesai
 * sebelum browser dibuka, karena membuka browser lebih dulu berarti permintaan
 * jaringan sudah terlanjur dikirim ke alamat yang belum diperiksa.
 *
 * Semua bagian yang menyentuh dunia luar disuntikkan lewat parameter deps.
 * Itu bukan hiasan arsitektur. Tanpa itu urutan langkah tidak bisa diuji tanpa
 * jaringan dan tanpa browser.
 */

import dns from "node:dns/promises";

import {
  checkResolvedAddresses,
  checkUrl,
  MAX_REDIRECTS,
} from "../fetcher/url-policy.mjs";
import { ROBOTS_USER_AGENT, checkRobots } from "../fetcher/robots.mjs";
import { attachGuard, createGuardStats } from "../guard/index.mjs";
import { serializePage } from "../serializer/index.mjs";
import { guaranteesForSnapshot } from "../serializer/guarantees.mjs";
import { summarizeDecisions } from "../decisions/index.mjs";
import {
  DISCLAIMER,
  createSnapshot,
  validateSnapshot,
  writeSnapshot,
} from "../snapshot/index.mjs";
import {
  withExponentialBackoff,
  isTransientNetworkError,
} from "../shared/retry.mjs";
import { createTelemetryTracker } from "../shared/telemetry.mjs";
import { buildComplianceReport } from "../compliance/index.mjs";
import { auditDiscoveredPdfs } from "../pdf/index.mjs";
import {
  buildIssueClusters,
  buildMultiPageSummary,
  crawlSecondaryPages,
  discoverPageLinks,
  normalizeCrawlOptions,
} from "./crawl.mjs";

/**
 * Nomor langkah. Dipakai supaya laporan kegagalan menyebut posisi yang tepat,
 * bukan sekadar berkata gagal.
 */
export const STAGES = Object.freeze({
  checkAddress: 1,
  resolveDns: 2,
  robots: 3,
  rateLimit: 4,
  openBrowser: 5,
  attachGuard: 6,
  audit: 7,
  serialize: 8,
  buildSnapshot: 9,
  validate: 10,
  writeFiles: 11,
});

export const STAGE_NAMES = Object.freeze({
  1: "memeriksa bentuk alamat",
  2: "memeriksa hasil DNS",
  3: "membaca robots.txt",
  4: "menerapkan batas laju",
  5: "membuka browser",
  6: "memasang guard",
  7: "menjalankan audit",
  8: "membuat patched.html dan reader.html",
  9: "membuat snapshot",
  10: "memvalidasi snapshot",
  11: "menulis berkas hasil",
});

/**
 * Jeda minimal antar permintaan ke host yang sama.
 *
 * Lima detik bukan angka ajaib. Ini cukup longgar supaya situs pemerintah yang
 * servernya lambat tidak terbebani, dan cukup pendek supaya audit empat situs
 * tetap selesai dalam satu menit.
 */
export const MIN_HOST_INTERVAL_MS = 5000;

/**
 * Catatan kunjungan per host. Sengaja hanya di memori.
 *
 * Menyimpannya ke berkas akan membuat proses batch dan proses manual saling
 * mengunci, dan tidak ada yang bisa menjelaskan kenapa alat menolak berjalan.
 */
const defaultHistory = new Map();

/**
 * Pesan untuk setiap kode kegagalan.
 *
 * Kode dipakai oleh program, pesan dipakai oleh manusia. Keduanya dipisah
 * supaya pesan bisa diperbaiki tanpa merusak kode yang sudah dipakai frontend.
 */
export const FAILURE_MESSAGES = Object.freeze({
  "empty-url": "Alamat halaman masih kosong. Isi dulu alamatnya.",
  "url-too-long": "Alamat halaman terlalu panjang untuk diperiksa dengan aman.",
  "unparseable-url":
    "Alamat halaman tidak bisa dibaca. Periksa ejaannya, dan pastikan diawali http atau https.",
  "protocol-not-allowed":
    "Hanya alamat http dan https yang bisa diaudit. Alamat jenis lain ditolak.",
  "credentials-in-url":
    "Alamat mengandung nama pengguna atau kata sandi. Alat ini hanya untuk halaman publik.",
  "port-not-allowed":
    "Alamat memakai port yang tidak biasa. Hanya port web standar yang diizinkan.",
  "ip-literal-not-allowed":
    "Alamat berupa nomor IP langsung. Masukkan nama domainnya, bukan nomornya.",
  "empty-host": "Alamat tidak menyebutkan nama domain.",
  "local-host-name":
    "Alamat menunjuk ke komputer ini sendiri, bukan ke situs di internet.",
  "hostname-not-allowed":
    "Bentuk nama domain tidak wajar, jadi alamat ini tidak diproses.",
  "dns-empty":
    "Nama domain tidak menghasilkan satu pun alamat IP. Mungkin domainnya salah tulis atau sudah mati.",
  "dns-lookup-failed":
    "Nama domain tidak bisa dicari. Periksa koneksi internet, lalu coba lagi.",
  "blocked-address":
    "Domain ini mengarah ke alamat di dalam jaringan tertutup, jadi seluruh domain ditolak.",
  "robots-unavailable":
    "Berkas robots.txt situs itu tidak bisa dibaca, jadi audit dihentikan. Kalau aturannya tidak jelas, lebih baik berhenti.",
  "robots-disallowed":
    "Situs itu melarang alat otomatis membuka halaman ini lewat robots.txt. Permintaan tidak dilanjutkan.",
  "robots-fetch-failed":
    "Gagal menghubungi situs untuk mengambil robots.txt. Periksa koneksi internet, lalu coba lagi.",
  "browser-failed":
    "Browser gagal dijalankan. Biasanya karena Chromium belum dipasang. Jalankan npx playwright install chromium.",
  "guard-failed":
    "Penyaring permintaan gagal dipasang, jadi audit dibatalkan supaya tidak ada permintaan yang lolos tanpa diperiksa.",
  "status-not-ok":
    "Halaman tidak membalas dengan status berhasil, jadi ini bukan audit yang sah. Isi halaman error tidak dihitung.",
  "audit-failed":
    "Audit halaman gagal di tengah jalan. Halaman mungkin terlalu lambat atau berubah saat sedang diperiksa.",
  "serialize-failed":
    "Gagal menyusun tampilan hasil dari halaman itu. Snapshot tidak dibuat karena isinya akan setengah jadi.",
  "snapshot-failed": "Gagal menyusun data hasil akhir.",
  "snapshot-incomplete":
    "Data hasil belum lengkap, jadi tidak layak ditampilkan sebagai hasil audit.",
  "write-failed":
    "Hasil audit gagal ditulis ke folder tujuan. Periksa apakah foldernya bisa ditulisi.",
});

const FALLBACK_MESSAGE =
  "Audit gagal karena alasan yang belum punya penjelasan sendiri. Laporkan kode ini apa adanya.";

/**
 * Menerjemahkan kode menjadi kalimat.
 *
 * Kode yang belum terdaftar tetap mendapat kalimat, bukan undefined. Pesan
 * kosong di layar lebih membingungkan daripada pesan umum yang jujur.
 */
export function messageForCode(code, detail = "") {
  const base = FAILURE_MESSAGES[code] || FALLBACK_MESSAGE;
  return detail ? `${base} Keterangan teknis: ${detail}` : base;
}

/**
 * Berapa lama lagi kita harus menunggu sebelum menyentuh host ini.
 *
 * Fungsi murni, jadi bisa diuji tanpa benar benar menunggu lima detik.
 */
export function nextAllowedDelay({
  host,
  now,
  history,
  interval = MIN_HOST_INTERVAL_MS,
} = {}) {
  const last = history?.get(host);
  if (typeof last !== "number") return 0;

  const elapsed = now - last;
  if (elapsed >= interval) return 0;

  // Waktu sistem bisa bergerak ke belakang. Kalau itu terjadi, tunggu penuh
  // satu selang daripada menghitung jeda negatif.
  if (elapsed < 0) return interval;

  return interval - elapsed;
}

/**
 * Mencatat bahwa host ini baru saja dikunjungi.
 */
export function recordRequest({ host, now, history } = {}) {
  history?.set(host, now);
  return history;
}

function failure(stage, code, detail = "", extra = {}) {
  return {
    ok: false,
    code,
    message: messageForCode(code, detail),
    stage,
    stageName: STAGE_NAMES[stage],
    ...extra,
  };
}

function errorDetail(error) {
  if (!error) return "";
  return typeof error === "string" ? error : error.message || String(error);
}

/**
 * Mencari semua alamat IP untuk sebuah nama domain.
 *
 * Satu domain bisa punya banyak alamat. Memeriksa hanya yang pertama berarti
 * alamat kedua bisa mengarah ke mana saja.
 */
async function resolveHost(hostname, { sleep } = {}) {
  return withExponentialBackoff(
    async () => {
      const records = await dns.lookup(hostname, { all: true });
      return records.map((record) => record.address);
    },
    { sleep, isRetryable: isTransientNetworkError },
  );
}

async function fetchRobots({ origin, signal = null }, { sleep } = {}) {
  const initial = new URL("/robots.txt", origin);
  let current = initial;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const address = checkUrl(current.toString());
    if (!address.ok) {
      throw new Error(`Redirect robots.txt ditolak: ${address.code}`);
    }
    // Redirect ke host lain diizinkan (misal www.example.com → example.com),
    // selama host tujuan tetap lolos validasi checkResolvedAddresses di bawah.

    const addresses = await resolveHost(address.hostname, { sleep });
    const resolved = checkResolvedAddresses(addresses);
    if (!resolved.ok) {
      throw new Error(`Redirect robots.txt tidak aman: ${resolved.code}`);
    }

    const response = await withExponentialBackoff(
      () =>
        fetch(address.url, {
          headers: { "user-agent": ROBOTS_USER_AGENT },
          redirect: "manual",
          signal,
        }),
      { sleep, isRetryable: isTransientNetworkError },
    );

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { status: response.status, text: "" };
      if (hop === MAX_REDIRECTS) {
        throw new Error(`robots.txt melewati ${MAX_REDIRECTS} redirect`);
      }
      current = new URL(location, address.url);
      continue;
    }

    const text = response.ok ? await response.text() : "";
    return { status: response.status, text, finalUrl: address.url };
  }

  throw new Error("Redirect robots.txt tidak selesai");
}

/**
 * Playwright sengaja dimuat belakangan.
 *
 * Kalau diimpor di baris atas, setiap test murni ikut menarik seluruh browser
 * driver hanya untuk memanggil satu fungsi hitung hitungan.
 */
async function openBrowser(task, options = {}) {
  const runner = await import("../runner/index.mjs");
  return runner.withBrowser(task, options);
}

async function runAudit(args) {
  const runner = await import("../runner/index.mjs");
  return runner.auditPage(args);
}

const DEFAULT_DEPS = Object.freeze({
  resolveHost,
  fetchRobots,
  withBrowser: openBrowser,
  attachGuard,
  auditPage: runAudit,
  serializePage,
  writeSnapshot,
  discoverLinks: discoverPageLinks,
  auditDiscoveredPdfs,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

/**
 * Mengaudit satu halaman dari awal sampai berkas hasil.
 *
 * Fungsi ini tidak pernah melempar error. Pemanggilnya, baik CLI maupun script
 * batch, hanya perlu memeriksa field ok.
 *
 * @param args.url alamat halaman publik yang ingin diaudit
 * @param args.origin dari mana permintaan datang, catalog atau manual
 * @param args.outputDir folder tujuan. null berarti tidak menulis berkas
 * @param args.id nama folder dan nama hasil. Default diambil dari domain
 * @param args.deps pengganti fungsi luar, hanya untuk keperluan test
 * @returns { ok: true, snapshot, files } atau { ok: false, code, message, stage }
 */
export async function auditUrl({
  url,
  origin = "manual",
  outputDir = null,
  id = null,
  mode = "single",
  maxPages = 1,
  deps = {},
  history = defaultHistory,
  signal = null,
  onProgress = null,
} = {}) {
  const crawlConfig = normalizeCrawlOptions({ mode, maxPages });
  const use = { ...DEFAULT_DEPS, ...deps };
  const telemetry = createTelemetryTracker();
  const progress = async (value, stage, extra = {}) => {
    signal?.throwIfAborted();
    await onProgress?.({
      progress: value,
      stage,
      telemetry: telemetry.snapshot(),
      ...extra,
    });
  };

  // Langkah 1. Bentuk alamat.
  telemetry.setStep("validate", "running");
  await progress(2, "Memvalidasi alamat halaman");
  const address = checkUrl(url);
  if (!address.ok) {
    telemetry.setStep("validate", "warning", address.code);
    return failure(STAGES.checkAddress, address.code, address.message);
  }
  telemetry.setStep("validate", "done");

  const target = address.url;
  const hostname = address.hostname;

  // Langkah 2. DNS. Satu alamat privat cukup untuk menolak seluruh domain.
  telemetry.setStep("dns_robots", "running");
  let addresses = [];
  try {
    addresses = await withExponentialBackoff(
      () => use.resolveHost(hostname),
      { sleep: use.sleep, isRetryable: isTransientNetworkError },
    );
  } catch (error) {
    telemetry.setStep("dns_robots", "warning", "dns-lookup-failed");
    return failure(STAGES.resolveDns, "dns-lookup-failed", errorDetail(error));
  }

  const resolved = checkResolvedAddresses(addresses);
  if (!resolved.ok) {
    telemetry.setStep("dns_robots", "warning", resolved.code);
    return failure(STAGES.resolveDns, resolved.code, resolved.message);
  }
  await progress(10, "Alamat DNS terverifikasi aman");

  // Langkah 3. robots.txt. Tidak terbaca berarti berhenti, tidak ada berarti lanjut.
  let robotsResponse;
  try {
    robotsResponse = await withExponentialBackoff(
      () => use.fetchRobots({ origin: target, hostname, signal }),
      { sleep: use.sleep, isRetryable: isTransientNetworkError },
    );
  } catch (error) {
    telemetry.setStep("dns_robots", "warning", "robots-fetch-failed");
    return failure(STAGES.robots, "robots-fetch-failed", errorDetail(error));
  }

  const robots = checkRobots({
    text: robotsResponse?.text ?? "",
    status: robotsResponse?.status ?? 200,
    url: target,
  });
  if (!robots.ok) {
    telemetry.setStep("dns_robots", "warning", robots.code);
    return failure(STAGES.robots, robots.code, robots.message);
  }
  telemetry.setStep("dns_robots", "done");
  await progress(16, "Aturan robots.txt mengizinkan audit");

  // Langkah 4. Batas laju. Menunggu, bukan menolak. Menolak hanya akan membuat
  // pemakai menekan tombol berulang kali.
  const delay = nextAllowedDelay({ host: hostname, now: use.now(), history });
  if (delay > 0) await use.sleep(delay);
  recordRequest({ host: hostname, now: use.now(), history });
  telemetry.setStep("browser_ready", "running");
  await progress(22, "Menyiapkan browser audit");

  const siteId = id || hostname.replace(/[^a-z0-9]+/g, "-");

  // Langkah 5 sampai 10 berjalan di dalam browser.
  //
  // withBrowser sudah menutup context dan browser di blok finally miliknya,
  // termasuk saat isi task gagal. Karena itu kegagalan di dalam dikembalikan
  // sebagai nilai, bukan dilempar, supaya penutupan tetap berjalan rapi.
  const runner = await import("../runner/index.mjs");
  const hostResolverRules =
    runner.buildHostResolverRules?.({ hostname, addresses }) || [];

  let outcome;
  try {
    outcome = await use.withBrowser(async ({ page }) => {
      // Langkah 6. Guard dipasang sebelum halaman dibuka. Setelah dibuka sudah
      // terlambat, permintaan pertama sudah lewat.
      let guard = createGuardStats();
      try {
        guard = await use.attachGuard({
          page,
          allowedDocumentUrl: target,
          allowHydration: true,
          hydrationTimeoutMs: 15_000,
        });
        telemetry.setGuardStats(guard);
      } catch (error) {
        telemetry.setStep("browser_ready", "warning", "guard-failed");
        return failure(STAGES.attachGuard, "guard-failed", errorDetail(error));
      }
      telemetry.setStep("browser_ready", "done");
      await progress(30, "Guard jaringan aktif");

      // Langkah 7. Audit.
      let audited;
      try {
        audited = await use.auditPage({
          page,
          url: target,
          signal,
          onProgress,
          telemetry,
          guardStats: guard,
          hydrationAllowed: true,
          onHydrationSettled: () => guard?.finishHydration?.(),
        });
      } catch (error) {
        const detail = errorDetail(error);
        const code = /^HTTP /.test(detail) ? "status-not-ok" : "audit-failed";
        return failure(STAGES.audit, code, detail);
      } finally {
        guard?.finishHydration?.();
      }

      // Langkah 8. Dua tampilan hasil.
      let views;
      try {
        telemetry.setStep("serialize", "running");
        await progress(80, "Membuat reader view dan halaman hasil");
        views = await use.serializePage({
          page,
          sourceUrl: target,
          siteLabel: audited.siteConfig?.siteLabel || null,
          disclaimer: DISCLAIMER,
        });
        telemetry.setStep("serialize", "done");
      } catch (error) {
        telemetry.setStep("serialize", "warning", "serialize-failed");
        return failure(STAGES.serialize, "serialize-failed", errorDetail(error));
      }

      const discovered = await use.discoverLinks(page, target).catch(() => ({
        internalUrls: [],
        pdfUrls: [],
      }));
      const discoveredPdfUrls = [
        ...new Set([
          ...(audited.discoveredPdfUrls || []),
          ...(audited.report?.discoveredPdfUrls || []),
          ...(discovered?.pdfUrls || []),
        ]),
      ];

      let snapshot;
      try {
        telemetry.setStep("report", "running");
        const compliance = buildComplianceReport({
          report: audited.report,
          wcagBefore: audited.artifacts?.wcagBefore,
          wcagAfter: audited.artifacts?.wcagAfter,
          issueBoundingBoxes: audited.report?.issueBoundingBoxes,
        });

        const primaryPageUrl = audited.report?.page?.finalUrl || target;
        const crawledPages = [
          {
            url: primaryPageUrl,
            title: audited.report?.page?.title || "",
            beforeScore: compliance.score.beforeScore,
            afterScore: compliance.score.afterScore,
            issuesCount: compliance.issues.length,
            status: "completed",
            error: null,
          },
        ];
        const completedAudits = [
          { url: primaryPageUrl, issues: compliance.issues },
        ];

        if (crawlConfig.mode === "multi" && crawlConfig.requestedMaxPages > 1) {
          const secondary = await crawlSecondaryPages({
            page,
            primaryHostname: hostname,
            candidateUrls: discovered?.internalUrls || [],
            maxSecondary: crawlConfig.requestedMaxPages - 1,
            robotsResponse,
            use,
            signal,
            history,
            nextAllowedDelay,
            recordRequest,
            onProgress,
            telemetry,
          });
          crawledPages.push(...secondary.pages);
          completedAudits.push(...secondary.completedAudits);
          for (const pdf of secondary.collectedPdfUrls || []) {
            if (pdf && !discoveredPdfUrls.includes(pdf)) {
              discoveredPdfUrls.push(pdf);
            }
          }
        }

        const multiPage = buildMultiPageSummary({
          mode: crawlConfig.mode,
          requestedMaxPages: crawlConfig.requestedMaxPages,
          pages: crawledPages,
        });
        const clusters = buildIssueClusters(completedAudits);

        await progress(86, "Menyusun laporan audit");

        const enginesUsed =
          audited.report?.enginesUsed ?? audited.enginesUsed ?? compliance.enginesUsed;
        const mobileAudit = audited.report?.mobileAudit ?? audited.mobileAudit;
        const detectors = audited.report?.detectors ?? audited.detectors;

        snapshot = {
          ...createSnapshot({
            id: siteId,
            report: audited.report,
            patchedPage: views.patchedPage,
            readerView: views.readerView,
            origin,
            enginesUsed,
            mobileAudit,
            detectors,
            multiPage,
            clusters,
          }),
          guard,
          readerGuarantees: guaranteesForSnapshot(),
          decisions: summarizeDecisions(audited.report),
          score: compliance.score,
          severity: compliance.severity,
          regulations: compliance.regulations,
          issues: compliance.issues,
        };
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        telemetry.setStep("report", "warning", "snapshot-failed");
        return failure(STAGES.buildSnapshot, "snapshot-failed", errorDetail(error));
      }

      // Langkah 10. Validasi, dengan menyebut bagian mana yang belum ada.
      const validation = validateSnapshot(snapshot);
      if (!validation.ok) {
        telemetry.setStep("report", "warning", "snapshot-incomplete");
        return failure(
          STAGES.validate,
          "snapshot-incomplete",
          `bagian yang belum ada: ${validation.missing.join(", ")}`,
          { missing: validation.missing },
        );
      }

      return {
        ok: true,
        snapshot,
        report: audited.report,
        artifacts: audited.artifacts,
        views,
        discoveredPdfUrls,
      };
    }, { signal, hostResolverRules });
  } catch (error) {
    if (error?.name === "AbortError") {
      return failure(STAGES.openBrowser, "audit-failed", errorDetail(error));
    }
    return failure(STAGES.openBrowser, "browser-failed", errorDetail(error));
  }

  if (!outcome?.ok) return outcome;

  if (outcome.discoveredPdfUrls?.length > 0) {
    await progress(89, "Mengaudit dokumen PDF tertaut");
    try {
      const pdfAudit = await use.auditDiscoveredPdfs({
        pdfUrls: outcome.discoveredPdfUrls,
        baseUrl: target,
        signal,
        deps: {
          resolveHost: use.resolveHost,
          ...(deps.fetchPdf ? { fetchPdf: deps.fetchPdf } : {}),
          ...(deps.getDocument ? { getDocument: deps.getDocument } : {}),
        },
      });
      outcome.snapshot.pdfAudit = pdfAudit;
    } catch (error) {
      if (error?.name === "AbortError") {
        return failure(STAGES.buildSnapshot, "audit-failed", errorDetail(error));
      }
      outcome.snapshot.pdfAudit = {
        discoveredCount: outcome.discoveredPdfUrls.length,
        auditedCount: 0,
        scannedImageCount: 0,
        untaggedCount: 0,
        items: [],
      };
    }
  }

  // Langkah 11. Menulis berkas, setelah browser ditutup.
  let files = null;
  if (outputDir) {
    try {
      await progress(91, "Menyimpan artefak audit");
      use.writeSnapshot({
        dir: outputDir,
        snapshot: outcome.snapshot,
        report: outcome.report,
        artifacts: outcome.artifacts,
        patchedPage: outcome.views.patchedPage,
        readerView: outcome.views.readerView,
      });
      files = { dir: outputDir, names: { ...outcome.snapshot.files } };
    } catch (error) {
      return failure(STAGES.writeFiles, "write-failed", errorDetail(error));
    }
  }

  telemetry.setStep("report", "done");
  await progress(94, "Artefak utama selesai dibuat");
  return { ok: true, snapshot: outcome.snapshot, files };
}
