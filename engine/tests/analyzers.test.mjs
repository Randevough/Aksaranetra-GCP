import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

import {
  WCAG_22_TAGS,
  analyzeWcagWithAxe,
  runIbmAce,
  runMobileProbes,
  runDetectorsAndDiscovery,
} from "../src/analyzers/index.mjs";
import { WCAG_TAGS, auditPage } from "../src/runner/index.mjs";
import { buildComplianceReport } from "../src/compliance/index.mjs";

async function withPage(html, callback, viewport = { width: 1440, height: 1000 }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await callback(page);
  } finally {
    await context.close();
    await browser.close();
  }
}

test("exposes WCAG 2.2 tags and falls back gracefully if AxeBuilder rejects options()", async () => {
  assert.deepEqual(WCAG_22_TAGS, [
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "wcag22a",
    "wcag22aa",
  ]);
  assert.deepEqual(WCAG_TAGS, WCAG_22_TAGS);

  class LegacyMockAxeBuilder {
    constructor() {
      this.tags = null;
    }
    options() {
      throw new Error("options() unsupported in mock");
    }
    withTags(tags) {
      this.tags = tags;
      return this;
    }
    async analyze() {
      return { violations: [], passes: [], tags: this.tags };
    }
  }

  const res = await analyzeWcagWithAxe({}, LegacyMockAxeBuilder, WCAG_22_TAGS);
  assert.deepEqual(res.tags, WCAG_22_TAGS);
});

test("runIbmAce returns available:false on mock pages and detects violations on real pages", async () => {
  const mockResult = await runIbmAce({ evaluate: async () => null });
  assert.deepEqual(mockResult, { available: false, violations: [] });

  await withPage(
    `<!doctype html><html><head></head><body>
      <img id="hero" src="banner.png">
      <button id="empty-btn"></button>
    </body></html>`,
    async (page) => {
      const aceRes = await runIbmAce(page);
      assert.equal(aceRes.available, true);
      assert.ok(Array.isArray(aceRes.violations));
      assert.ok(aceRes.violations.length >= 2);

      const imgViolation = aceRes.violations.find((v) => v.selector === "#hero");
      assert.ok(imgViolation, "Expected IBM ACE violation for #hero missing alt");
      assert.equal(imgViolation.source, "ibm-ace");
      assert.ok(imgViolation.wcagSc.includes("1.1.1"));
      assert.ok(["critical", "serious", "moderate", "minor"].includes(imgViolation.impact));
      assert.ok(typeof imgViolation.help === "string" && imgViolation.help.length > 0);
    },
  );
});

test("runMobileProbes measures 320px overflow, pinch-zoom, small targets, text spacing, OS media, and restores viewport", async () => {
  const mockMobile = await runMobileProbes({});
  assert.equal(mockMobile.reflowOk, true);
  assert.deepEqual(mockMobile.viewport, { width: 320, height: 640 });

  await withPage(
    `<!doctype html><html lang="id"><head>
      <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
      <style>
        .wide-box { width: 480px; height: 20px; }
        .small-btn { width: 16px; height: 16px; padding: 0; border: 0; display: inline-block; }
        .clipped-text { width: 55px; height: 18px; overflow: hidden; white-space: nowrap; font-size: 14px; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spinner { width: 20px; height: 20px; animation: spin 1s linear infinite; }
      </style>
    </head><body>
      <div class="wide-box">Lebar berlebih</div>
      <button class="small-btn">x</button>
      <div class="clipped-text">Teks panjang terpotong oleh overflow hidden</div>
      <div class="spinner"></div>
    </body></html>`,
    async (page) => {
      const mobile = await runMobileProbes(page, {
        desktopViewport: { width: 1440, height: 1000 },
      });

      assert.deepEqual(mobile.viewport, { width: 320, height: 640 });
      assert.equal(mobile.reflowOk, false);
      assert.ok(mobile.horizontalOverflowPx >= 150);
      assert.equal(mobile.pinchZoomBlocked, true);
      assert.ok(mobile.smallTargetsCount >= 1);
      assert.equal(mobile.textSpacingOk, false);
      assert.ok(mobile.clippedElementsCount >= 1);
      assert.equal(mobile.osPreferences.reducedMotionChecked, true);
      assert.ok(mobile.osPreferences.reducedMotionUnboundedAnimations >= 1);
      assert.equal(mobile.osPreferences.forcedColorsChecked, true);

      const styleLeftover = await page.evaluate(() =>
        Boolean(document.getElementById("__aksara_text_spacing")),
      );
      assert.equal(styleLeftover, false);

      const restoredViewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      assert.deepEqual(restoredViewport, { width: 1440, height: 1000 });
    },
  );
});

test("runDetectorsAndDiscovery flags overlay theater, visual CAPTCHA, paste blocks, and discovers bounded same-origin links", async () => {
  const pdfLinks = Array.from(
    { length: 14 },
    (_, i) => `<a href="/docs/doc-${i}.pdf">PDF ${i}</a>`,
  ).join("");
  const internalLinks = Array.from(
    { length: 25 },
    (_, i) => `<a href="/layanan/page-${i}">Page ${i}</a>`,
  ).join("");

  await withPage(
    `<!doctype html><html lang="id"><body>
      <div id="userwayAccessibilityIcon">Widget</div>
      <div class="accessibe-widget">Toolbar</div>
      <form action="/masuk">
        <img src="/captcha.png" alt="Kode Captcha">
        <div class="g-recaptcha"></div>
        <input type="password" onpaste="return false">
      </form>
      <a href="#top">Top</a>
      <a href="mailto:info@contoh.go.id">Email</a>
      <a href="tel:123">Tel</a>
      <a href="/login">Login</a>
      <a href="/logout">Logout</a>
      <a href="/archive.zip">Archive</a>
      <a href="https://external.example.org/out.pdf">External PDF</a>
      <a href="https://external.example.org/page">External Page</a>
      <a href="/docs/doc-0.pdf#page=2">Duplicate PDF</a>
      ${pdfLinks}
      ${internalLinks}
    </body></html>`,
    async (page) => {
      const result = await runDetectorsAndDiscovery(page, "https://contoh.go.id/");

      assert.equal(result.detectors.overlay.detected, true);
      assert.ok(result.detectors.overlay.vendors.includes("UserWay"));
      assert.ok(result.detectors.overlay.vendors.includes("accessiBe"));
      assert.ok(result.detectors.overlay.summaryId.length > 10);

      assert.equal(result.detectors.captcha.detected, true);
      assert.ok(result.detectors.captcha.types.includes("image-captcha"));
      assert.ok(result.detectors.captcha.types.includes("recaptcha-v2"));
      assert.ok(result.detectors.captcha.types.includes("paste-blocked-auth"));
      assert.ok(result.detectors.captcha.inaccessibleCount >= 3);
      assert.ok(result.detectors.captcha.summaryId.length > 10);

      assert.equal(result.discoveredPdfUrls.length, 10);
      assert.ok(
        result.discoveredPdfUrls.every((u) =>
          u.startsWith("https://contoh.go.id/docs/") && u.endsWith(".pdf"),
        ),
      );

      assert.equal(result.discoveredInternalUrls.length, 20);
      assert.ok(
        result.discoveredInternalUrls.every(
          (u) =>
            u.startsWith("https://contoh.go.id/layanan/") &&
            !u.includes("/login") &&
            !u.includes("/logout"),
        ),
      );
    },
  );
});

test("buildComplianceReport merges axe-core and ibm-ace violations with dual-engine deduplication", () => {
  const wcagBefore = {
    violations: [
      {
        id: "image-alt",
        impact: "critical",
        tags: ["wcag2a", "wcag111"],
        nodes: [{ target: ["#hero"], html: '<img id="hero" src="x.png">' }],
      },
      {
        id: "color-contrast",
        impact: "serious",
        tags: ["wcag2aa", "wcag143"],
        nodes: [{ target: [".muted"], html: '<p class="muted">Teks</p>' }],
      },
    ],
  };

  const aceViolations = [
    {
      ruleId: "img_alt_valid",
      impact: "serious",
      wcagSc: ["1.1.1"],
      selector: "  #hero ",
      html: '<img id="hero" src="x.png">',
      help: "Image missing alt",
      source: "ibm-ace",
    },
    {
      ruleId: "skip_main_exists",
      impact: "moderate",
      wcagSc: ["2.4.1"],
      selector: "body",
      html: "<body>",
      help: "Missing main landmark or skip link",
      source: "ibm-ace",
    },
  ];

  const compliance = buildComplianceReport({
    report: { aceViolations },
    wcagBefore,
    wcagAfter: wcagBefore,
  });

  assert.equal(compliance.issues.length, 3);

  const heroIssue = compliance.issues.find((i) => i.selector === "#hero");
  assert.deepEqual(heroIssue.engines, ["axe-core", "ibm-ace"]);

  const contrastIssue = compliance.issues.find((i) => i.selector === ".muted");
  assert.deepEqual(contrastIssue.engines, ["axe-core"]);

  const aceOnly = compliance.issues.find((i) => i.ruleId === "skip_main_exists");
  assert.deepEqual(aceOnly.engines, ["ibm-ace"]);
  assert.equal(aceOnly.source, "ibm-ace");
  assert.equal(aceOnly.status, "open");
});

test("auditPage attaches Wave 2 enginesUsed, mobileAudit, detectors, discovery, and aceViolations", async () => {
  await withPage(
    `<!doctype html><html lang="id"><head><title>Audit Wave 2</title></head><body>
      <main>
        <img id="missing-alt" src="foto.png">
        <a href="/berkas/laporan.pdf">Unduh Laporan</a>
        <a href="/profil">Profil</a>
      </main>
    </body></html>`,
    async (page) => {
      const originalGoto = page.goto.bind(page);
      page.goto = async () => ({
        ok: () => true,
        status: () => 200,
        headers: () => ({ "content-type": "text/html" }),
      });
      page.url = () => "https://contoh.go.id/";

      const audited = await auditPage({
        page,
        url: "https://contoh.go.id/",
        siteConfig: { host: "contoh.go.id", configured: false, siteLabel: "" },
        captureScreenshot: false,
      });
      page.goto = originalGoto;

      assert.deepEqual(audited.report.enginesUsed, ["axe-core", "ibm-ace"]);
      assert.ok(audited.report.mobileAudit);
      assert.equal(audited.report.mobileAudit.reflowOk, true);
      assert.ok(audited.report.detectors);
      assert.equal(audited.report.detectors.overlay.detected, false);
      assert.equal(audited.report.detectors.captcha.detected, false);
      assert.deepEqual(audited.report.discoveredPdfUrls, [
        "https://contoh.go.id/berkas/laporan.pdf",
      ]);
      assert.deepEqual(audited.report.discoveredInternalUrls, [
        "https://contoh.go.id/profil",
      ]);
      assert.ok(Array.isArray(audited.report.aceViolations));
      assert.ok(audited.report.aceViolations.length >= 1);

      const viewportAfter = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      assert.deepEqual(viewportAfter, { width: 1440, height: 1000 });
    },
  );
});
