/**
 * Orkestrasi browser.
 *
 * Satu-satunya tempat yang tahu soal Playwright. Tidak menyentuh berkas sama
 * sekali, supaya bagian ini bisa dipakai ulang oleh server tanpa ikut menulis
 * ke disk. Penulisan hasil adalah urusan modul snapshot.
 */

import { isIPv4, isIPv6 } from "node:net";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

import { remediatePage } from "../engine/index.mjs";
import {
  collectIssueBoundingBoxes,
  collectTabStops,
  resetFocusAndScroll,
} from "../engine/probes.mjs";
import { checkResponse, MAX_RESPONSE_BYTES } from "../fetcher/url-policy.mjs";
import { getSiteConfig } from "../config/sites.mjs";
import { createTelemetryTracker } from "../shared/telemetry.mjs";
import {
  withPooledBrowser,
  closeSharedBrowser,
  getPoolStats,
} from "./browser-pool.mjs";
import {
  WCAG_22_TAGS,
  analyzeWcagWithAxe,
  runWave2Analyzers,
} from "../analyzers/index.mjs";

export { closeSharedBrowser, getPoolStats };

export const WCAG_TAGS = WCAG_22_TAGS;

export const USER_AGENT = "ProjectA-Accessibility-Research/0.2";

export const CONTEXT_OPTIONS = Object.freeze({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 1000 },
  userAgent: USER_AGENT,
  reducedMotion: "reduce",
});

export const DEFAULT_TIMEOUTS = Object.freeze({
  navigationTimeoutMs: 25_000,
  domTimeoutMs: 15_000,
  settleTimeoutMs: 15_000,
});

/**
 * Menjalankan sebuah tugas dengan browser yang dijamin ditutup kembali.
 *
 * Menggunakan pool browser Chromium bersama (browser-pool) secara default
 * untuk efisiensi CPU/memori dan kecepatan startup antar tugas, sambil
 * menjamin isolasi context per tugas secara steril.
 */
const CONTAINER_LAUNCH_ARGS = [
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-software-rasterizer",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-domain-reliability",
  "--disable-sync",
  "--disable-translate",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-first-run",
  "--renderer-process-limit=1",
  "--js-flags=--max-old-space-size=160",
];

export function resolveLaunchArgs(extraArgs = []) {
  // Aktif bila CHROMIUM_LOW_RESOURCE_MODE=1 atau di lingkungan production container
  const isLowResource =
    process.env.CHROMIUM_LOW_RESOURCE_MODE === "1" ||
    process.env.NODE_ENV === "production";

  const baseArgs = isLowResource ? CONTAINER_LAUNCH_ARGS : [];
  return [...baseArgs, ...(Array.isArray(extraArgs) ? extraArgs : [])];
}

/**
 * Membangun aturan resolver host Chromium (--host-resolver-rules).
 *
 * Mengunci resolusi nama domain target ke alamat IP publik yang telah diverifikasi
 * aman oleh AksaraNetra, mencegah serangan DNS rebinding di sisi browser.
 */
export function buildHostResolverRules({ hostname, addresses = [] } = {}) {
  if (!hostname || !Array.isArray(addresses) || addresses.length === 0) {
    return [];
  }
  const normalized = addresses
    .filter((ip) => ip !== null && ip !== undefined)
    .map((ip) => String(ip).trim())
    .filter(Boolean);
  const ipv4 = normalized.find((ip) => isIPv4(ip));
  if (ipv4) {
    return [`--host-resolver-rules=MAP ${hostname} ${ipv4}`];
  }
  const ipv6 = normalized.find((ip) => isIPv6(ip));
  if (ipv6) {
    return [`--host-resolver-rules=MAP ${hostname} [${ipv6}]`];
  }
  return [];
}

export async function withBrowser(
  task,
  {
    headless = true,
    signal = null,
    pool = true,
    hostResolverRules = [],
    ...options
  } = {},
) {
  const customArgs = [...(options.launchArgs || []), ...hostResolverRules];
  const launchArgs = resolveLaunchArgs(customArgs);

  // Jika ada hostResolverRules khusus untuk sebuah domain target, jalankan
  // browser mandiri dengan aturan tersebut agar tidak memengaruhi domain lain di pool
  const shouldUsePool = pool !== false && hostResolverRules.length === 0;

  if (shouldUsePool) {
    return withPooledBrowser(task, {
      headless,
      signal,
      launchArgs,
      contextOptions: CONTEXT_OPTIONS,
      ...options,
    });
  }

  signal?.throwIfAborted();
  const browser = await chromium.launch({ headless, args: launchArgs });
  const context = await browser.newContext(CONTEXT_OPTIONS);
  const page = await context.newPage();
  const abort = () => context.close().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });

  try {
    signal?.throwIfAborted();
    return await task({ page, context, browser });
  } finally {
    signal?.removeEventListener("abort", abort);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Mendeteksi dan menutup overlay popup pengumuman, cookie consent banner, atau
 * modal interaktif sebelum audit dijalankan agar tidak menjebak fokus keyboard.
 */
export async function dismissOverlays(page) {
  if (!page) return;

  try {
    if (typeof page.keyboard?.press === "function") {
      await page.keyboard.press("Escape").catch(() => {});
    }

    if (typeof page.evaluate === "function") {
      await page.evaluate(() => {
        const DISMISS_SELECTORS = [
          "button[aria-label*='tutup' i]",
          "button[aria-label*='close' i]",
          "[aria-label*='tutup pengumuman' i]",
          "[aria-label*='close modal' i]",
          ".modal-close",
          ".btn-close",
          ".close-modal",
          ".popup-close",
          "button[data-dismiss='modal']",
          "button[data-bs-dismiss='modal']",
          ".cookie-consent-accept",
          ".cookie-agree",
          "button.cookie-btn",
          "[id*='cookie'] button",
          "[class*='cookie'] button",
        ];

        for (const sel of DISMISS_SELECTORS) {
          try {
            const elements = document.querySelectorAll(sel);
            for (const el of elements) {
              if (el.offsetParent !== null || el.getClientRects().length > 0) {
                el.click();
              }
            }
          } catch {
            // Lanjut jika selektor gagal dievaluasi
          }
        }

        const backdrops = document.querySelectorAll(
          ".modal-backdrop, .popup-backdrop, .overlay-backdrop",
        );
        for (const bd of backdrops) {
          bd.style.display = "none";
        }
      });
    }

    if (typeof page.waitForTimeout === "function") {
      await page.waitForTimeout(200).catch(() => {});
    }
  } catch {
    // Dismiss overlay bersifat best-effort
  }
}

/**
 * Smart page-readiness gate: waits for bounded load, first-party network settle,
 * DOM MutationObserver quiet window, overlay dismissal, preloader disappearance,
 * web fonts, visible images, and adaptive lazy-load scrolling back to (0, 0).
 */
export async function settlePage(page, options = {}) {
  const settleTimeoutMs = Math.max(
    500,
    options.settleTimeoutMs ?? DEFAULT_TIMEOUTS.settleTimeoutMs,
  );
  const startMs = Date.now();
  const deadline = startMs + settleTimeoutMs;
  const remaining = (capMs) => Math.max(0, Math.min(capMs, deadline - Date.now()));

  const waitMs = async (ms) => {
    if (ms <= 0) return;
    if (typeof page?.waitForTimeout === "function") {
      await page.waitForTimeout(ms).catch(() => {});
    } else {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  };

  if (typeof page?.waitForLoadState === "function") {
    const domTimeout = remaining(options.domTimeoutMs || DEFAULT_TIMEOUTS.domTimeoutMs);
    if (domTimeout > 0) {
      await page.waitForLoadState("domcontentloaded", { timeout: domTimeout }).catch(() => {});
    }

    const loadTimeout = remaining(options.loadTimeoutMs ?? 5000);
    if (loadTimeout > 0) {
      await page.waitForLoadState("load", { timeout: loadTimeout }).catch(() => {});
    }

    const networkTimeout = remaining(options.networkSettleMs ?? 3000);
    if (networkTimeout > 0) {
      await page.waitForLoadState("networkidle", { timeout: networkTimeout }).catch(() => {});
    }
  }

  // DOM MutationObserver stability window (500ms quiet, capped at 2500ms)
  const mutationCap = remaining(options.domQuietCapMs ?? 2500);
  if (typeof page?.evaluate === "function" && mutationCap > 0) {
    await page
      .evaluate(
        ({ quietMs, capMs }) =>
          new Promise((resolve) => {
            const root = document.body || document.documentElement;
            if (!root || typeof MutationObserver !== "function") {
              resolve();
              return;
            }
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              clearTimeout(quietTimer);
              clearTimeout(capTimer);
              observer.disconnect();
              resolve();
            };
            let quietTimer = setTimeout(finish, quietMs);
            const capTimer = setTimeout(finish, capMs);
            const observer = new MutationObserver(() => {
              clearTimeout(quietTimer);
              quietTimer = setTimeout(finish, quietMs);
            });
            observer.observe(root, {
              childList: true,
              subtree: true,
              attributes: true,
            });
          }),
        { quietMs: options.domQuietMs ?? 500, capMs: mutationCap },
      )
      .catch(() => {});
  }

  if (options.dismissOverlays !== false) {
    await dismissOverlays(page);
  }

  // Promote lazy images to eager before scrolling so browsers start fetching immediately
  if (typeof page?.evaluate === "function") {
    await page
      .evaluate(() => {
        for (const img of document.querySelectorAll('img[loading]')) {
          if ((img.getAttribute("loading") || "").trim().toLowerCase() === "lazy") {
            img.loading = "eager";
            img.setAttribute("loading", "eager");
          }
        }
      })
      .catch(() => {});
  }

  // Full-page stepped scroll to trigger IntersectionObservers & lazy content, then reset to (0, 0)
  if (typeof page?.evaluate === "function") {
    const scrollCap = Math.max(500, remaining(options.scrollCapMs ?? 5500));
    const maxScrollSteps = options.maxScrollSteps ?? 14;
    await page
      .evaluate(
        ({ capMs, maxSteps }) =>
          new Promise((resolve) => {
            const getViewportHeight = () => window.innerHeight || 800;
            const getMaxHeight = () =>
              Math.max(
                document.documentElement?.scrollHeight || 0,
                document.body?.scrollHeight || 0,
              );
            const isAtBottom = () =>
              window.scrollY + getViewportHeight() >= getMaxHeight() - 4;

            if (isAtBottom()) {
              window.scrollTo({ top: 0, left: 0, behavior: "instant" });
              resolve();
              return;
            }

            let step = 0;
            const started = Date.now();
            let finished = false;
            const root = document.body || document.documentElement;
            const hiddenCandidates = new Set();
            const revealed = new Map();

            if (root) {
              for (const el of root.querySelectorAll("*")) {
                const cs = window.getComputedStyle(el);
                if (
                  cs.display !== "none" &&
                  cs.visibility !== "hidden" &&
                  cs.position !== "fixed" &&
                  Number.parseFloat(cs.opacity || "1") < 0.05 &&
                  el.getClientRects().length > 0
                ) {
                  hiddenCandidates.add(el);
                }
              }
            }

            const collectRevealed = () => {
              for (const el of hiddenCandidates) {
                const cs = window.getComputedStyle(el);
                if (
                  cs.display !== "none" &&
                  cs.visibility !== "hidden" &&
                  Number.parseFloat(cs.opacity || "1") >= 0.5
                ) {
                  revealed.set(el, {
                    flatTransform: cs.transform === "none",
                  });
                  hiddenCandidates.delete(el);
                }
              }
            };

            const lockRevealed = () => {
              if (revealed.size === 0) return;
              const styleId = "aksaranetra-reveal-lock";
              if (!document.getElementById(styleId)) {
                const styleEl = document.createElement("style");
                styleEl.id = styleId;
                styleEl.textContent =
                  '[data-aksaranetra-revealed="true"]{opacity:1 !important;}' +
                  '[data-aksaranetra-revealed-flat="true"]{transform:none !important;}';
                (document.head || document.documentElement)?.appendChild(styleEl);
              }
              for (const [el, info] of revealed) {
                el.setAttribute("data-aksaranetra-revealed", "true");
                if (info.flatTransform) {
                  el.setAttribute("data-aksaranetra-revealed-flat", "true");
                }
              }
            };

            const finish = () => {
              if (finished) return;
              finished = true;
              clearInterval(timer);
              setTimeout(() => {
                collectRevealed();
                lockRevealed();
                window.scrollTo({ top: 0, left: 0, behavior: "instant" });
                resolve();
              }, 250);
            };

            const timer = setInterval(() => {
              collectRevealed();
              const stepPx = Math.max(400, Math.round(getViewportHeight() * 0.85));
              window.scrollBy({ top: stepPx, left: 0, behavior: "instant" });
              step += 1;

              if (
                isAtBottom() ||
                step >= maxSteps ||
                Date.now() - started >= capMs
              ) {
                finish();
              }
            }, 250);
          }),
        { capMs: scrollCap, maxSteps: maxScrollSteps },
      )
      .catch(() => {});
  }

  // Post-scroll preloader / spinner disappearance wait (capped 2500ms)
  const preloaderCap = remaining(options.preloaderCapMs ?? 2500);
  if (typeof page?.evaluate === "function" && preloaderCap > 0) {
    await page
      .evaluate(
        (capMs) =>
          new Promise((resolve) => {
            const SELECTORS =
              ".preloader, #preloader, .page-loader, .loading-screen, .spinner-overlay, [data-preloader], [aria-busy='true'][class*='load' i], .v-progress-circular, .el-loading-mask, .ant-spin-spinning, .spinner-border, [role='progressbar'][aria-busy='true']";
            const hasVisibleLoader = () => {
              for (const el of document.querySelectorAll(SELECTORS)) {
                const cs = window.getComputedStyle(el);
                if (
                  cs.display !== "none" &&
                  cs.visibility !== "hidden" &&
                  Number.parseFloat(cs.opacity || "1") > 0 &&
                  (el.offsetParent !== null || el.getClientRects().length > 0)
                ) {
                  return true;
                }
              }
              return false;
            };

            if (!hasVisibleLoader()) {
              resolve();
              return;
            }

            const started = Date.now();
            const timer = setInterval(() => {
              if (!hasVisibleLoader() || Date.now() - started >= capMs) {
                clearInterval(timer);
                resolve();
              }
            }, 100);
          }),
        preloaderCap,
      )
      .catch(() => {});
  }

  // Post-scroll bounded networkidle (capped 2000ms)
  const postScrollNetworkTimeout = remaining(options.postScrollNetworkMs ?? 2000);
  if (typeof page?.waitForLoadState === "function" && postScrollNetworkTimeout > 0) {
    await page
      .waitForLoadState("networkidle", { timeout: postScrollNetworkTimeout })
      .catch(() => {});
  }

  // Web fonts readiness (capped 1500ms)
  const fontsCap = remaining(options.fontsCapMs ?? 1500);
  if (typeof page?.evaluate === "function" && fontsCap > 0) {
    await page
      .evaluate(
        (capMs) =>
          Promise.race([
            document.fonts?.ready || Promise.resolve(),
            new Promise((resolve) => setTimeout(resolve, capMs)),
          ]),
        fontsCap,
      )
      .catch(() => {});
  }

  // Wait ALL non-hidden in-document <img> with src or currentSrc to settle (capped 2500ms)
  const imagesCap = remaining(options.imagesCapMs ?? 2500);
  if (typeof page?.evaluate === "function" && imagesCap > 0) {
    await page
      .evaluate(
        async (capMs) => {
          const targets = Array.from(document.querySelectorAll("img")).filter(
            (img) => {
              const hasSource = Boolean(
                img.currentSrc || img.getAttribute("src")?.trim(),
              );
              if (!hasSource) return false;
              const cs = window.getComputedStyle(img);
              return cs.display !== "none" && cs.visibility !== "hidden";
            },
          );
          if (targets.length === 0) return;

          const waitImage = (img) => {
            const tryDecode = () =>
              img.naturalWidth > 0 && typeof img.decode === "function"
                ? img.decode().catch(() => {})
                : Promise.resolve();

            if (img.complete) {
              return tryDecode();
            }

            return new Promise((resolve) => {
              const done = () => {
                img.removeEventListener("load", done);
                img.removeEventListener("error", done);
                tryDecode().finally(resolve);
              };
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
            });
          };

          let capTimer;
          await Promise.race([
            Promise.all(targets.map(waitImage)),
            new Promise((resolve) => {
              capTimer = setTimeout(resolve, capMs);
            }),
          ]);
          clearTimeout(capTimer);
        },
        imagesCap,
      )
      .catch(() => {});
  }

  await waitMs(remaining(options.settleDelayMs ?? 250));

  let domMetrics = {
    domElements: 0,
    possibleEmptyShell: false,
    viewport: { ...CONTEXT_OPTIONS.viewport },
    pageHeight: 0,
  };

  if (typeof page?.evaluate === "function") {
    const evaluated = await page
      .evaluate(() => {
        const domElements = document.querySelectorAll("*").length;
        const viewport = {
          width: window.innerWidth || 1440,
          height: window.innerHeight || 1000,
        };
        const pageHeight =
          document.documentElement?.scrollHeight ||
          document.body?.scrollHeight ||
          0;
        const textLen = (
          document.body?.innerText ||
          document.body?.textContent ||
          ""
        ).trim().length;
        const contentNodes = document.querySelectorAll(
          "p, h1, h2, h3, h4, h5, h6, a, button, img, input, article, main, section, li",
        ).length;
        const hasEmptyMount = Boolean(
          document.querySelector("#root:empty, #app:empty, #__next:empty"),
        );
        const possibleEmptyShell =
          hasEmptyMount || (textLen < 30 && contentNodes <= 2 && domElements < 30);

        return { domElements, possibleEmptyShell, viewport, pageHeight };
      })
      .catch(() => null);

    if (evaluated && typeof evaluated === "object") {
      domMetrics = evaluated;
    }
  }

  return {
    waitStrategy: "smart-readiness-gate",
    hydrationAllowed: Boolean(options.hydrationAllowed ?? false),
    loadTimeMs: Number(options.loadTimeMs ?? 0),
    settledAfterMs: Math.max(0, Date.now() - startMs),
    domElements: domMetrics.domElements ?? 0,
    partialLoad: Boolean(options.partialRecovery ?? false),
    possibleEmptyShell: Boolean(domMetrics.possibleEmptyShell),
    viewport: domMetrics.viewport || { ...CONTEXT_OPTIONS.viewport },
    pageHeight: domMetrics.pageHeight ?? 0,
  };
}

/**
 * Membuka satu halaman, mengaudit, menambal, lalu mengaudit ulang.
 *
 * @returns laporan engine beserta bahan mentahnya. Tidak ada berkas ditulis.
 */
export async function auditPage({
  page,
  url,
  siteConfig,
  captureScreenshot = true,
  signal = null,
  onProgress = null,
  onHydrationSettled = null,
  timeouts = {},
  telemetry = null,
  guardStats = null,
  hydrationAllowed = true,
}) {
  const effectiveTimeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
  const config = siteConfig || getSiteConfig(url);
  const tracker = telemetry || createTelemetryTracker({ guardStats });
  const progress = async (value, stage, extra = {}) => {
    signal?.throwIfAborted();
    await onProgress?.({
      progress: value,
      stage,
      telemetry: tracker.snapshot(),
      ...extra,
    });
  };

  tracker.setStep("hydration", "running", "Membuka halaman target");
  await progress(35, "Membuka halaman target");

  let mainResponse = null;
  const onResponse = (res) => {
    try {
      if (!mainResponse || res.url() === url) {
        mainResponse = res;
      }
    } catch {}
  };
  page.on?.("response", onResponse);

  let response = null;
  let partialRecovery = false;
  const navStart = Date.now();

  try {
    response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: effectiveTimeouts.navigationTimeoutMs,
    });
  } catch (error) {
    const isTimeout = /timeout/i.test(error.message || "");
    if (isTimeout) {
      const hasDom = await page
        .evaluate?.(() => {
          return (
            document &&
            document.body &&
            (document.body.children.length > 0 || (document.body.textContent || "").trim().length > 0)
          );
        })
        ?.catch(() => false);

      if (hasDom && mainResponse && mainResponse.ok()) {
        response = mainResponse;
        partialRecovery = true;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  } finally {
    page.off?.("response", onResponse);
  }

  const loadTimeMs = Math.max(0, Date.now() - navStart);

  if (!response || !response.ok()) {
    throw new Error(`HTTP ${response?.status() ?? "tidak diketahui"}`);
  }

  const responseVerdict = checkResponse({
    status: response.status(),
    contentType: response.headers()["content-type"],
    contentLength: response.headers()["content-length"],
  });
  if (!responseVerdict.ok) {
    throw new Error(`${responseVerdict.code}: ${responseVerdict.message}`);
  }

  await progress(43, "Menunggu konten halaman selesai dimuat");
  const readiness = await settlePage(page, {
    domTimeoutMs: effectiveTimeouts.domTimeoutMs,
    settleTimeoutMs: effectiveTimeouts.settleTimeoutMs,
    hydrationAllowed,
    partialRecovery,
    loadTimeMs,
  });
  await onHydrationSettled?.();

  tracker.updateStats({
    domElements: readiness.domElements,
    hydrationMs: readiness.settledAfterMs,
  });
  tracker.setStep(
    "hydration",
    readiness.partialLoad || readiness.possibleEmptyShell ? "warning" : "done",
    readiness.possibleEmptyShell
      ? "Halaman tampak kosong setelah hidrasi"
      : `${readiness.domElements} elemen DOM siap`,
    readiness.settledAfterMs,
  );

  const renderedBytes =
    typeof page.evaluate === "function"
      ? await page.evaluate(() =>
          new TextEncoder().encode(document.documentElement.outerHTML).byteLength,
        )
      : 0;
  if (typeof renderedBytes === "number" && renderedBytes > MAX_RESPONSE_BYTES) {
    throw new Error(
      `response-too-large: DOM hasil render melebihi ${MAX_RESPONSE_BYTES} byte`,
    );
  }

  // Capture early before.png immediately after settlePage and emit progress 46
  tracker.setStep("capture_before", "running");
  let beforeScreenshot = null;
  if (captureScreenshot) {
    beforeScreenshot = await captureBoundedScreenshot(page).catch(() => null);
  }
  tracker.setEarlyPreviewReady(Boolean(beforeScreenshot));
  tracker.setStep(
    "capture_before",
    beforeScreenshot || !captureScreenshot ? "done" : "warning",
  );
  await progress(46, "Mengambil tangkapan layar awal", {
    earlyBeforeScreenshot: beforeScreenshot,
  });

  // Pemindaian luas sebelum patch. Dipakai sebagai konteks halaman dan
  // pembanding regression, bukan sebagai baseline metrik engine.
  tracker.setStep("audit_wcag", "running");
  await progress(53, "Mengaudit aksesibilitas awal");
  const wcagBefore = await analyzeWcagWithAxe(page, AxeBuilder, WCAG_TAGS);
  const beforeIssueCount = (wcagBefore?.violations ?? []).reduce(
    (sum, item) => sum + (item.nodes?.length ?? 0),
    0,
  );
  tracker.updateStats({ issuesFound: beforeIssueCount });
  tracker.setStep("audit_wcag", "done", `${beforeIssueCount} temuan awal`);

  // Collect issue bounding boxes and run bounded keyboard Tab walk before remediation
  tracker.setStep("tab_walk", "running");
  await progress(58, "Memeriksa alur fokus keyboard dan posisi elemen");
  const issueBoundingBoxes = await collectIssueBoundingBoxes(page, wcagBefore, 120);
  const tabStops = await collectTabStops(page, 40);
  await resetFocusAndScroll(page);
  tracker.updateStats({ tabStopsCount: tabStops.length });
  tracker.setStep("tab_walk", "done", `${tabStops.length} tab stop terdeteksi`);

  const rawPageUrl = typeof page.url === "function" ? page.url() : "";
  const effectiveUrl = rawPageUrl && rawPageUrl !== "about:blank" ? rawPageUrl : url;
  const wave2 = await runWave2Analyzers(page, {
    baseUrl: effectiveUrl,
    desktopViewport: CONTEXT_OPTIONS.viewport,
  });

  tracker.setStep("remediate", "running");
  await progress(63, "Menerapkan dan memverifikasi patch");
  const result = await remediatePage({ page, axeResult: wcagBefore, config });
  tracker.setStep(
    "remediate",
    result.rolledBack ? "warning" : "done",
    `${result.fixed?.length ?? 0} diperbaiki`,
  );

  // remediatePage sudah menjalankan pemindaian luas dan rollback individual.
  // Pakai hasil final itu agar laporan dan artefak mengukur DOM yang sama.
  const wcagAfter = result.wideAfterAxe || result.afterAxe;

  await progress(75, "Mengumpulkan bukti audit");
  const ariaSnapshot =
    typeof page.locator === "function"
      ? await page.locator("body")?.ariaSnapshot?.().catch(() => null)
      : null;
  const afterScreenshot = captureScreenshot
    ? await captureBoundedScreenshot(page).catch(() => null)
    : null;

  const report = {
    engineVersion: result.engineVersion,
    page: {
      requestedUrl: url,
      finalUrl: typeof page.url === "function" ? page.url() : url,
      status: response.status(),
      title: typeof page.title === "function" ? await page.title() : "",
      testedAt: new Date().toISOString(),
    },
    siteConfig: {
      host: config.host,
      matchedHost: config.matchedHost,
      configured: config.configured,
      siteLabel: config.siteLabel,
      verifiedLabelCount: Object.keys(config.verifiedLabels || {}).length,
    },
    targets: result.targets,
    fixed: result.fixed,
    review: result.review,
    skipped: result.skipped,
    rolledBack: result.rolledBack,
    metrics: result.metrics,
    wcagRegression: result.wideRegression || { clean: true, worsened: [], newViolationRules: [] },
    duplicateLabels: result.duplicateLabels,
    staleOverrides: result.staleOverrides,
    rolledBackRecords: result.rolledBackRecords || [],
    partialRecovery,
    readiness,
    tabStops,
    issueBoundingBoxes,
    enginesUsed: wave2.enginesUsed,
    mobileAudit: wave2.mobileAudit,
    detectors: wave2.detectors,
    discoveredPdfUrls: wave2.discoveredPdfUrls,
    discoveredInternalUrls: wave2.discoveredInternalUrls,
    aceViolations: wave2.aceViolations,
    warnings: {
      ...(partialRecovery
        ? {
            partialLoad:
              "Halaman mengalami batas waktu pada pemuatan sub-aset, audit dilanjutkan pada pohon DOM yang tersedia.",
          }
        : {}),
      ...(readiness.possibleEmptyShell
        ? { possibleEmptyShell: true }
        : {}),
    },
  };

  return {
    report,
    siteConfig: config,
    artifacts: {
      beforeAxe: result.beforeAxe,
      afterAxe: result.afterAxe,
      wcagBefore,
      wcagAfter,
      ariaSnapshot,
      beforeScreenshot,
      screenshot: afterScreenshot,
    },
  };
}

// Batas tinggi tangkapan layar saat CHROMIUM_LOW_RESOURCE_MODE aktif.
//
// fullPage:true tanpa batas berarti Chromium harus merender SELURUH tinggi
// halaman jadi satu bitmap sebelum di-encode -- untuk halaman pemerintah
// yang panjang (beberapa ribu piksel), ini sendirian bisa jadi lonjakan RAM
// terbesar dalam satu audit, lebih besar dari axe-core atau DOM-nya sendiri.
// Nilai ini dibiarkan longgar (halaman umum tetap tertangkap penuh) tapi
// mencegah kasus ekstrem (halaman arsip/listing yang sangat panjang) dari
// membuat container OOM hanya demi satu gambar pratinjau.
const MAX_SCREENSHOT_HEIGHT_PX = 2400;

async function captureBoundedScreenshot(page) {
  if (!page || typeof page.screenshot !== "function") {
    return null;
  }

  if (process.env.CHROMIUM_LOW_RESOURCE_MODE !== "1") {
    // Perilaku asli di luar container terbatas: PNG, tinggi penuh, tanpa
    // kompromi kualitas. Tidak diubah supaya tangkapan layar lokal / CI
    // tetap seperti sebelumnya.
    return page.screenshot({ fullPage: true });
  }

  const pageHeight =
    typeof page.evaluate === "function"
      ? await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0)
      : 0;

  const clip =
    pageHeight > MAX_SCREENSHOT_HEIGHT_PX
      ? { x: 0, y: 0, width: CONTEXT_OPTIONS.viewport.width, height: MAX_SCREENSHOT_HEIGHT_PX }
      : undefined;

  // Tetap PNG dengan sengaja. FILE_NAMES.screenshot di src/snapshot/index.mjs
  // sudah dikunci sebagai "after.png" dan disebut eksplisit sebagai kontrak
  // dengan frontend -- mengganti ke JPEG di sini tanpa mengubah nama berkas
  // dan penyajian Content-Type di sisi frontend bisa menyebabkan gambar
  // salah dikenali sebagai PNG padahal isinya JPEG. Kalau nanti mau beralih
  // ke JPEG demi RAM lebih hemat lagi, itu perubahan kontrak dua sisi
  // (nama berkas + siapa pun yang menyajikannya), sengaja tidak dilakukan
  // sepihak di sini.
  return page.screenshot({ fullPage: clip ? false : true, clip });
}

export async function renderPdf({ html, outputPath, signal = null }) {
  return withBrowser(async ({ page }) => {
    signal?.throwIfAborted();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    return outputPath;
  }, { signal });
}
