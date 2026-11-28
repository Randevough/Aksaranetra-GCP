/**
 * Pencegat permintaan jaringan di dalam browser.
 *
 * Alasan modul ini ada: memeriksa alamat halaman utama saja tidak cukup.
 * Setelah halaman terbuka, halaman itu bebas meminta gambar, CSS, dan font
 * dari alamat mana pun, termasuk alamat di dalam jaringan kita sendiri.
 * Tanpa pencegat, seluruh kerja src/fetcher bisa dilewati hanya dengan satu
 * tag gambar yang mengarah ke 127.0.0.1.
 *
 * Keputusannya dipisah ke decideRequest supaya bisa diuji tanpa browser.
 * attachGuard hanya pembungkus tipis di atasnya.
 *
 * MITIGASI DNS REBINDING (Poin 5.1):
 * Alamat IP hasil resolusi awal diikat langsung ke opsi browser Chromium
 * lewat aturan host-resolver-rules (MAP hostname IP), sehingga Chromium tidak
 * melakukan query DNS ulang yang rentan manipulasi Time-To-Live.
 *
 * PENGALIHAN SATU HOP PADA HOST YANG SAMA (Poin 5.2):
 * Tipe document mengizinkan maksimal 1 hop pengalihan selama host tujuan
 * sama persis dengan host yang diminta (misal upgrade http ke https atau / ke /home).
 * Pengalihan lintas host dan pengalihan berantai (>1 hop) ditolak mutlak.
 */

import dns from "node:dns/promises";
import { checkResolvedAddresses, checkUrl } from "../fetcher/url-policy.mjs";

/**
 * Jenis permintaan yang selalu ditolak.
 *
 * Script diblokir bukan karena kelalaian, melainkan karena dua alasan.
 * Pertama, halaman hasil kita disajikan dari domain kita sendiri, jadi script
 * milik situs lain akan berjalan seolah milik kita. Kedua, tanpa script
 * carousel berhenti berputar, dan hasil audit jadi jauh lebih stabil dari
 * satu jalan ke jalan berikutnya.
 */
export const ALWAYS_BLOCKED = Object.freeze([
  "script",
  "xhr",
  "fetch",
  "websocket",
  "media",
  "eventsource",
  "manifest",
]);

/** Jenis permintaan yang boleh lewat asalkan alamatnya lulus pemeriksaan. */
export const CHECKED_TYPES = Object.freeze(["image", "stylesheet", "font"]);

function block(reason, message) {
  return { allow: false, reason, message: message || null };
}

function pass(reason) {
  return { allow: true, reason, message: null };
}

const HYDRATION_ALLOWED_TYPES = Object.freeze(["script", "xhr", "fetch"]);

/**
 * Common third-party analytics, ad-tech, and tracking hosts blocked even during
 * the bounded hydration window.
 */
export const TRACKER_HOSTS = Object.freeze([
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "connect.facebook.net",
  "pixel.facebook.com",
  "analytics.tiktok.com",
  "hotjar.com",
  "clarity.ms",
  "mc.yandex.ru",
  "segment.com",
  "segment.io",
  "amplitude.com",
  "snap.licdn.com",
  "bat.bing.com",
]);

/**
 * Returns true when hostname matches a known tracker host or one of its subdomains.
 */
export function isBlockedTrackerHost(hostname = "") {
  const host = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
  if (!host) return false;
  return TRACKER_HOSTS.some(
    (tracker) => host === tracker || host.endsWith(`.${tracker}`),
  );
}

/**
 * Strips only a leading "www." prefix so example.com <-> www.example.com
 * match without allowing arbitrary subdomains.
 */
export function stripWww(hostname = "") {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

export function isSameHostOrWww(hostA, hostB) {
  const a = stripWww(hostA);
  const b = stripWww(hostB);
  return Boolean(a && b && a === b);
}

/**
 * Menentukan satu permintaan boleh lewat atau tidak.
 *
 * Sikap dasarnya menolak. Jenis permintaan yang tidak dikenal ikut ditolak,
 * karena daftar jenis milik Chromium bisa bertambah di versi berikutnya dan
 * kita tidak mau jenis baru otomatis mendapat izin.
 */
export function decideRequest({
  resourceType,
  url,
  allowedDocumentUrl,
  isHydrating = false,
  redirectCount = 0,
} = {}) {
  const type = String(resourceType ?? "").trim().toLowerCase();

  if (!type) {
    return block("missing-resource-type", "Permintaan tanpa jenis ditolak.");
  }

  // Poin 3.1: Jendela hidrasi terkendali untuk framework SPA (React, Next.js, Vue)
  if (isHydrating && HYDRATION_ALLOWED_TYPES.includes(type)) {
    const target = checkUrl(allowedDocumentUrl);
    if (!target.ok) {
      return block(
        "document-target-invalid",
        "Alamat target tidak sah, jadi permintaan hidrasi ditolak.",
      );
    }

    const asked = checkUrl(url);
    if (!asked.ok) {
      return block(`asset-${asked.code || "invalid"}`, asked.message);
    }

    if (isBlockedTrackerHost(asked.hostname)) {
      return block(
        "hydration-tracker-blocked",
        "Permintaan pelacak atau analitik pihak ketiga diblokir selama jendela hidrasi.",
      );
    }

    if (isSameHostOrWww(asked.hostname, target.hostname)) {
      return pass(`hydration-first-party-${type}-allowed`);
    }

    return pass(`hydration-public-${type}-allowed`);
  }

  if (ALWAYS_BLOCKED.includes(type)) {
    return block(
      `blocked-type-${type}`,
      `Jenis permintaan ${type} tidak pernah diizinkan.`,
    );
  }

  if (type === "document") {
    const target = checkUrl(allowedDocumentUrl);
    if (!target.ok) {
      return block(
        "document-target-invalid",
        "Alamat target tidak sah, jadi tidak ada yang bisa dibandingkan.",
      );
    }

    const asked = checkUrl(url);
    if (!asked.ok) {
      return block(`document-${asked.code}`, asked.message);
    }

    if (asked.url === target.url) {
      return pass("document-is-the-target");
    }

    // Poin 5.2: Izin satu hop pengalihan (redirect) pada host yang sama atau www <-> apex
    if (redirectCount > 0) {
      if (!isSameHostOrWww(asked.hostname, target.hostname)) {
        return block(
          "document-redirect-cross-host-blocked",
          "Pengalihan ke host yang berbeda ditolak demi keamanan.",
        );
      }

      if (redirectCount > 1) {
        return block(
          "document-redirect-limit-exceeded",
          "Pengalihan dokumen melebihi batas 1 hop.",
        );
      }

      return pass("document-same-host-redirect-allowed");
    }

    return block(
      "document-not-the-target",
      "Hanya halaman yang diminta pengguna yang boleh dibuka.",
    );
  }

  if (CHECKED_TYPES.includes(type)) {
    const asked = checkUrl(url);
    if (!asked.ok) {
      return block(`asset-${asked.code}`, asked.message);
    }

    return pass(`asset-${type}-allowed`);
  }

  return block(
    "resource-type-not-recognised",
    `Jenis permintaan ${type} belum dikenal, jadi ditolak.`,
  );
}

/**
 * Bentuk awal statistik. Dipisah supaya bisa dipakai saat guard tidak dipasang.
 */
export function createGuardStats() {
  return { allowed: 0, blocked: 0, byType: {}, blockedHosts: [] };
}

async function defaultResolveHost(hostname) {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

/**
 * Verifies non-main-host subresources via cached async DNS public-IP lookup.
 */
export function createHostDnsVerifier({
  mainHostname = "",
  resolveHost = defaultResolveHost,
} = {}) {
  const normalizedMain = String(mainHostname || "").trim().toLowerCase();
  const cache = new Map();

  if (normalizedMain) {
    cache.set(normalizedMain, Promise.resolve(true));
  }

  return async function isPublicHost(hostname) {
    const host = String(hostname || "").trim().toLowerCase();
    if (!host) return false;
    if (cache.has(host)) return cache.get(host);

    const checkPromise = (async () => {
      try {
        const addresses = await resolveHost(host);
        return checkResolvedAddresses(addresses).ok;
      } catch {
        return false;
      }
    })();

    cache.set(host, checkPromise);
    return checkPromise;
  };
}

/**
 * Memasang pencegat pada sebuah halaman.
 *
 * @returns objek statistik yang terus diperbarui selama halaman dimuat.
 */
export async function attachGuard({
  page,
  allowedDocumentUrl,
  allowHydration = false,
  hydrationTimeoutMs = 15_000,
  resolveHost = defaultResolveHost,
}) {
  const stats = createGuardStats();
  const hosts = new Set();
  let isHydrating = Boolean(allowHydration);
  let documentCount = 0;

  const targetParsed = checkUrl(allowedDocumentUrl);
  const mainHostname = targetParsed.ok ? targetParsed.hostname : "";
  const isPublicHost = createHostDnsVerifier({ mainHostname, resolveHost });

  let timer = null;
  if (isHydrating && hydrationTimeoutMs > 0) {
    timer = setTimeout(() => {
      isHydrating = false;
      timer = null;
    }, hydrationTimeoutMs);
    timer.unref?.();
  }

  Object.defineProperty(stats, "finishHydration", {
    value: () => {
      isHydrating = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    enumerable: false,
    configurable: true,
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const type = request.resourceType();
    const url = request.url();

    let redirectCount = 0;
    if (type === "document") {
      documentCount++;
      if (documentCount > 1 || request.redirectedFrom?.()) {
        redirectCount = Math.max(1, documentCount - 1);
      }
    }

    let decision = decideRequest({
      resourceType: type,
      url,
      allowedDocumentUrl,
      isHydrating,
      redirectCount,
    });

    if (decision.allow) {
      let askedHost = "";
      try {
        askedHost = new URL(url).hostname.toLowerCase();
      } catch {
        askedHost = "";
      }

      if (
        askedHost &&
        askedHost !== mainHostname &&
        (CHECKED_TYPES.includes(type) || type === "document" || isHydrating)
      ) {
        const dnsAllowed = await isPublicHost(askedHost);
        if (!dnsAllowed) {
          decision = block(
            "asset-dns-blocked",
            `Host sub-sumber ${askedHost} mengarah ke alamat non-publik atau gagal diverifikasi.`,
          );
        }
      }
    }

    if (!stats.byType[type]) stats.byType[type] = { allowed: 0, blocked: 0 };

    if (decision.allow) {
      stats.allowed += 1;
      stats.byType[type].allowed += 1;
      await route.continue();
      return;
    }

    stats.blocked += 1;
    stats.byType[type].blocked += 1;

    try {
      hosts.add(new URL(url).host);
    } catch {
      // Alamat yang tidak bisa dibaca tetap diblokir, hanya tidak dicatat
      // hostnya. Tidak ada gunanya menebak.
    }
    stats.blockedHosts = [...hosts].sort();

    await route.abort("blockedbyclient");
  });

  return stats;
}
