import { checkResolvedAddresses, checkUrl } from "../fetcher/url-policy.mjs";
import { checkRobots } from "../fetcher/robots.mjs";
import { isSameHostOrWww } from "../guard/index.mjs";
import { buildComplianceReport } from "../compliance/index.mjs";

const IMPACT_PRIORITY = Object.freeze({
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
});

const IGNORED_ASSET_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|svg|ico|css|mjs|js|json|xml|zip|rar|7z|tar|gz|docx?|xlsx?|pptx?|mp3|mp4|wav|avi|mov|woff2?|ttf|eot)(\?|$)/i;

const MAX_CLUSTERS = 50;

/**
 * Clamps crawl mode ("single" | "multi") and maxPages (1..5; 1 for single, default 3 for multi).
 */
export function normalizeCrawlOptions({ mode = "single", maxPages } = {}) {
  const normalizedMode = mode === "multi" ? "multi" : "single";
  if (normalizedMode === "single") {
    return { mode: "single", requestedMaxPages: 1 };
  }

  const parsed = Number(maxPages);
  const effective = Number.isFinite(parsed) ? Math.trunc(parsed) : 3;
  return {
    mode: "multi",
    requestedMaxPages: Math.max(1, Math.min(5, effective)),
  };
}

/**
 * Normalizes dynamic indices and numeric IDs from a CSS selector so recurring
 * template issues across multiple pages group together cleanly.
 */
export function normalizeSelectorSignature(selector = "") {
  const raw = String(selector ?? "").trim();
  if (!raw) return "(document)";

  return raw
    .replace(/:nth-(?:last-)?(?:child|of-type)\(\s*[^)]+\s*\)/gi, ":nth-child(*)")
    .replace(/#([a-zA-Z_-]+?)[-_]?\d+\b/g, "#$1-*")
    .replace(/#\d+\b/g, "#*")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Groups recurring (ruleId, normalizedSelectorSignature) issues across audited pages
 * and calculates blastRadiusPercent.
 */
export function buildIssueClusters(pageAudits = []) {
  const validPages = (Array.isArray(pageAudits) ? pageAudits : []).filter(
    (entry) => entry && entry.url,
  );
  const totalPages = Math.max(1, validPages.length);
  const groups = new Map();

  for (const pageAudit of validPages) {
    const pageUrl = String(pageAudit.url);
    for (const issue of Array.isArray(pageAudit.issues) ? pageAudit.issues : []) {
      const ruleId = String(issue?.ruleId || "unknown-rule");
      const selectorPattern = normalizeSelectorSignature(issue?.selector);
      const key = `${ruleId}::${selectorPattern}`;
      const impact = IMPACT_PRIORITY[issue?.impact] !== undefined ? issue.impact : "moderate";

      let group = groups.get(key);
      if (!group) {
        group = {
          ruleId,
          impact,
          selectorPattern,
          titleId: String(issue?.titleId || ruleId),
          affectedPagesSet: new Set(),
          occurrences: 0,
        };
        groups.set(key, group);
      }

      if (IMPACT_PRIORITY[impact] < IMPACT_PRIORITY[group.impact]) {
        group.impact = impact;
      }
      group.affectedPagesSet.add(pageUrl);
      group.occurrences += 1;
    }
  }

  const clusters = [...groups.values()].map((group) => {
    const affectedPages = [...group.affectedPagesSet];
    return {
      ruleId: group.ruleId,
      impact: group.impact,
      selectorPattern: group.selectorPattern,
      titleId: group.titleId,
      affectedPages,
      occurrences: group.occurrences,
      blastRadiusPercent: Math.round((affectedPages.length / totalPages) * 100),
    };
  });

  clusters.sort((a, b) => {
    if (b.affectedPages.length !== a.affectedPages.length) {
      return b.affectedPages.length - a.affectedPages.length;
    }
    if (b.occurrences !== a.occurrences) {
      return b.occurrences - a.occurrences;
    }
    const impactDiff = (IMPACT_PRIORITY[a.impact] ?? 2) - (IMPACT_PRIORITY[b.impact] ?? 2);
    if (impactDiff !== 0) return impactDiff;
    return a.ruleId.localeCompare(b.ruleId);
  });

  return clusters.slice(0, MAX_CLUSTERS).map((cluster, idx) => ({
    id: `cluster-${idx + 1}-${cluster.ruleId}`,
    ...cluster,
  }));
}

/**
 * Discovers same-origin internal page URLs and PDF URLs from the active browser page.
 */
export async function discoverPageLinks(page, baseUrl) {
  if (!page || typeof page.evaluate !== "function") {
    return { internalUrls: [], pdfUrls: [] };
  }

  const baseCheck = checkUrl(baseUrl);
  if (!baseCheck.ok) {
    return { internalUrls: [], pdfUrls: [] };
  }

  let rawLinks = [];
  try {
    rawLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      return anchors.map((anchor) => ({
        href: anchor.getAttribute("href") || "",
        type: anchor.getAttribute("type") || "",
        baseUri: document.baseURI || window.location.href,
      }));
    });
  } catch {
    return { internalUrls: [], pdfUrls: [] };
  }

  const internalUrls = [];
  const pdfUrls = [];
  const seenInternal = new Set([baseCheck.url]);
  const seenPdf = new Set();

  for (const entry of Array.isArray(rawLinks) ? rawLinks : []) {
    const rawHref = String(entry?.href ?? "").trim();
    if (!rawHref || rawHref.startsWith("#")) continue;

    let resolved;
    try {
      const parsed = new URL(rawHref, entry?.baseUri || baseCheck.url);
      parsed.hash = "";
      resolved = parsed.toString();
    } catch {
      continue;
    }

    const verdict = checkUrl(resolved);
    if (!verdict.ok) continue;
    if (!isSameHostOrWww(verdict.hostname, baseCheck.hostname)) continue;

    const pathname = new URL(verdict.url).pathname;
    const isPdf =
      /\.pdf$/i.test(pathname) ||
      String(entry?.type || "").toLowerCase().includes("application/pdf");

    if (isPdf) {
      if (!seenPdf.has(verdict.url)) {
        seenPdf.add(verdict.url);
        pdfUrls.push(verdict.url);
      }
      continue;
    }

    if (IGNORED_ASSET_EXTENSIONS.test(pathname)) continue;
    if (!seenInternal.has(verdict.url)) {
      seenInternal.add(verdict.url);
      internalUrls.push(verdict.url);
    }
  }

  return {
    internalUrls: internalUrls.slice(0, 20),
    pdfUrls: pdfUrls.slice(0, 20),
  };
}

export function buildMultiPageSummary({ mode, requestedMaxPages, pages = [] }) {
  const completed = pages.filter((item) => item?.status === "completed");
  const crawledCount = completed.length;
  const averageAfterScore =
    crawledCount > 0
      ? Math.round(completed.reduce((sum, item) => sum + (Number(item.afterScore) || 0), 0) / crawledCount)
      : 0;

  return {
    mode,
    requestedMaxPages,
    crawledCount,
    averageAfterScore,
    pages,
  };
}

/**
 * Sequentially audits up to maxSecondary same-origin internal URLs inside the
 * existing browser session, reusing attachGuard and enforcing robots.txt & SSRF checks.
 */
export async function crawlSecondaryPages({
  page,
  primaryHostname,
  candidateUrls = [],
  maxSecondary = 0,
  robotsResponse = { status: 404, text: "" },
  use,
  signal = null,
  history = null,
  nextAllowedDelay,
  recordRequest,
  onProgress = null,
  telemetry = null,
}) {
  const pages = [];
  const completedAudits = [];
  const collectedPdfUrls = [];

  if (maxSecondary <= 0 || !Array.isArray(candidateUrls) || candidateUrls.length === 0) {
    return { pages, completedAudits, collectedPdfUrls };
  }

  let attempted = 0;
  const totalSlots = Math.min(maxSecondary, candidateUrls.length);

  for (const rawCandidate of candidateUrls) {
    if (completedAudits.length >= maxSecondary) break;
    signal?.throwIfAborted();

    const check = checkUrl(rawCandidate);
    if (!check.ok || !isSameHostOrWww(check.hostname, primaryHostname)) {
      continue;
    }

    if (check.hostname !== primaryHostname) {
      try {
        const addresses = await use.resolveHost(check.hostname);
        const resolved = checkResolvedAddresses(addresses);
        if (!resolved.ok) {
          pages.push({
            url: check.url,
            title: "",
            beforeScore: 0,
            afterScore: 0,
            issuesCount: 0,
            status: "skipped",
            error: resolved.message,
          });
          continue;
        }
      } catch (error) {
        pages.push({
          url: check.url,
          title: "",
          beforeScore: 0,
          afterScore: 0,
          issuesCount: 0,
          status: "skipped",
          error: error?.message || String(error),
        });
        continue;
      }
    }

    const robotsVerdict = checkRobots({
      text: robotsResponse?.text ?? "",
      status: robotsResponse?.status ?? 200,
      url: check.url,
    });
    if (!robotsVerdict.ok) {
      pages.push({
        url: check.url,
        title: "",
        beforeScore: 0,
        afterScore: 0,
        issuesCount: 0,
        status: "skipped",
        error: robotsVerdict.message || robotsVerdict.code,
      });
      continue;
    }

    attempted += 1;
    const progressPct = Math.min(85, 81 + Math.floor((attempted / Math.max(1, totalSlots)) * 4));
    await onProgress?.({
      progress: progressPct,
      stage: `Mengaudit halaman tambahan (${attempted}/${totalSlots})`,
      telemetry: telemetry?.snapshot?.(),
    });

    const delay = nextAllowedDelay?.({ host: check.hostname, now: use.now(), history }) ?? 0;
    if (delay > 0) await use.sleep(delay);
    recordRequest?.({ host: check.hostname, now: use.now(), history });

    try {
      if (typeof page?.unrouteAll === "function") {
        await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      } else if (typeof page?.unroute === "function") {
        await page.unroute("**/*").catch(() => {});
      }

      const pageGuard = await use.attachGuard({
        page,
        allowedDocumentUrl: check.url,
        allowHydration: true,
        hydrationTimeoutMs: 15_000,
      });

      let audited;
      try {
        audited = await use.auditPage({
          page,
          url: check.url,
          captureScreenshot: false,
          signal,
          onProgress: null,
          telemetry: null,
          guardStats: pageGuard,
          hydrationAllowed: true,
          onHydrationSettled: () => pageGuard?.finishHydration?.(),
        });
      } finally {
        pageGuard?.finishHydration?.();
      }

      const compliance = buildComplianceReport({
        report: audited.report,
        wcagBefore: audited.artifacts?.wcagBefore,
        wcagAfter: audited.artifacts?.wcagAfter,
        issueBoundingBoxes: audited.report?.issueBoundingBoxes,
      });

      const finalUrl = audited.report?.page?.finalUrl || check.url;
      pages.push({
        url: finalUrl,
        title: audited.report?.page?.title || "",
        beforeScore: compliance.score.beforeScore,
        afterScore: compliance.score.afterScore,
        issuesCount: compliance.issues.length,
        status: "completed",
        error: null,
      });
      completedAudits.push({ url: finalUrl, issues: compliance.issues });

      const discovered = await use.discoverLinks(page, finalUrl);
      for (const pdf of [
        ...(audited.discoveredPdfUrls || []),
        ...(audited.report?.discoveredPdfUrls || []),
        ...(discovered?.pdfUrls || []),
      ]) {
        if (pdf && !collectedPdfUrls.includes(pdf)) collectedPdfUrls.push(pdf);
      }
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      pages.push({
        url: check.url,
        title: "",
        beforeScore: 0,
        afterScore: 0,
        issuesCount: 0,
        status: "failed",
        error: error?.message || String(error),
      });
    }
  }

  return { pages, completedAudits, collectedPdfUrls };
}
