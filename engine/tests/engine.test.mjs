import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { remediatePage } from "../src/engine/index.mjs";
import { createRegressionReport } from "../src/engine/report.mjs";
import { getSiteConfig } from "../src/config/sites.mjs";
import {
  applyCandidates,
  rollbackSingleRecord,
} from "../src/engine/apply-patch.mjs";
import { createElementFingerprint } from "../src/shared/selector.mjs";
import {
  CONTEXT_OPTIONS,
  DEFAULT_TIMEOUTS,
  auditPage,
  buildHostResolverRules,
  dismissOverlays,
  settlePage,
  withBrowser,
  closeSharedBrowser,
  getPoolStats,
  resolveLaunchArgs,
} from "../src/runner/index.mjs";
import { withPooledBrowser } from "../src/runner/browser-pool.mjs";
import {
  withExponentialBackoff,
  isTransientNetworkError,
} from "../src/shared/retry.mjs";
import {
  splitCamelCaseUnicode,
  tokenizeUnicode,
} from "../src/shared/text.mjs";
import { extractTargets } from "../src/engine/extract-targets.mjs";
import { decideRequest } from "../src/guard/index.mjs";

const fixture = (name) =>
  fs.readFileSync(path.resolve("tests/fixtures", name), "utf8");

async function withPage(html, callback) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await callback(page);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function axe(page) {
  return new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
}

test("fixes a recognized social link and skips an unknown link", async () => {
  await withPage(fixture("unnamed-links.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["link-name"],
      config: { siteLabel: "Sulselprov" },
    });

    assert.equal(
      await page.locator(".instagram").getAttribute("aria-label"),
      "Buka Instagram Sulselprov",
    );
    assert.equal(await page.locator(".unknown").getAttribute("aria-label"), null);
    assert.equal(result.fixed.length, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.metrics.rules["link-name"].before, 2);
    assert.equal(result.metrics.rules["link-name"].after, 1);
  });
});

test("fixes carousel controls and reviews an ambiguous corner button", async () => {
  await withPage(fixture("unnamed-buttons.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["button-name"],
    });

    assert.equal(
      await page.locator(".left-2").getAttribute("aria-label"),
      "Media sebelumnya",
    );
    assert.equal(
      await page.locator(".right-2").getAttribute("aria-label"),
      "Media berikutnya",
    );
    assert.equal(await page.locator(".right-1").getAttribute("aria-label"), null);
    assert.equal(result.fixed.length, 2);
    assert.equal(result.review.length, 1);

    // Bukti posisi utility class saja tidak layak 0.95.
    for (const record of result.fixed) {
      assert.equal(record.confidence, 0.85);
      assert.equal(record.source, "carousel-position");
    }
    assert.equal(result.review[0].confidence, 0.75);
  });
});

test("names buttons from data attribute names and icon font classes", async () => {
  await withPage(fixture("data-attribute-buttons.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["button-name"],
    });

    assert.equal(
      await page.locator("[data-macro-prev]").getAttribute("aria-label"),
      "Konten sebelumnya",
    );
    assert.equal(
      await page.locator("[data-macro-next]").getAttribute("aria-label"),
      "Konten berikutnya",
    );
    assert.equal(
      await page.locator("#closeServiceModal").getAttribute("aria-label"),
      "Tutup",
    );

    assert.equal(result.fixed.length, 3);
    assert.equal(result.review.length, 0);
    assert.equal(result.metrics.rules["button-name"].after, 0);

    // Dua sinyal independen sepakat, jadi confidence naik ke 0.95.
    for (const record of result.fixed) {
      assert.equal(record.confidence, 0.95);
      assert.equal(record.source, "agreeing-signals");
      assert.ok(record.signals.length >= 2);
    }
  });
});

test("makes a reported scrollable region keyboard focusable", async () => {
  await withPage(fixture("scrollable-region.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["scrollable-region-focusable"],
    });

    const region = page.locator(".scrollable");
    assert.equal(await region.getAttribute("tabindex"), "0");
    assert.equal(await region.getAttribute("role"), "region");
    assert.equal(await region.getAttribute("aria-label"), "Area gulir Pengumuman");
    assert.equal(result.metrics.rules["scrollable-region-focusable"].after, 0);
    assert.equal(result.fixed[0].source, "preceding-heading");
  });
});

test("does not use an item heading inside the scroll area as the region name", async () => {
  await withPage(
    fixture("scrollable-region-nested-heading.html"),
    async (page) => {
      const before = await axe(page);
      const result = await remediatePage({
        page,
        axeResult: before,
        rules: ["scrollable-region-focusable"],
      });

      const region = page.locator(".scrollable");
      const label = await region.getAttribute("aria-label");

      assert.equal(await region.getAttribute("tabindex"), "0");
      assert.equal(label, "Daftar konten yang dapat digulir");
      assert.ok(!label.includes("49 Ruas Jalan"));
      assert.equal(result.fixed[0].source, "generic-scroll-region");
      assert.equal(result.fixed[0].confidence, 0.8);
      assert.equal(result.metrics.rules["scrollable-region-focusable"].after, 0);
    },
  );
});

test("a human verified label overrides the heuristic result", async () => {
  await withPage(fixture("unnamed-buttons.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["button-name"],
      config: {
        verifiedLabels: {
          ".right-1": {
            label: "Cari",
            note: "Tombol submit pencarian, dicek manual",
            verifiedOn: "2026-08-08",
          },
        },
      },
    });

    // Tombol yang tadinya masuk review sekarang punya nama yang dijamin manusia.
    assert.equal(await page.locator(".right-1").getAttribute("aria-label"), "Cari");
    assert.equal(result.fixed.length, 3);
    assert.equal(result.review.length, 0);
    assert.equal(result.metrics.rules["button-name"].after, 0);

    const override = result.fixed.find((record) => record.selector === ".right-1");
    assert.equal(override.confidence, 1);
    assert.equal(override.source, "verified-override");
    assert.equal(override.verifiedOn, "2026-08-08");

    // Jejak audit lama tidak boleh hilang.
    assert.equal(override.supersededSource, "corner-button-position");
    assert.equal(override.supersededConfidence, 0.75);

    // Confidence 1.0 hanya boleh lahir dari override manusia.
    for (const record of result.fixed) {
      if (record.source !== "verified-override") {
        assert.ok(record.confidence < 1);
      }
    }

    assert.deepEqual(result.staleOverrides, []);
  });
});

test("reports override selectors that no longer exist on the page", async () => {
  await withPage(fixture("unnamed-buttons.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["button-name"],
      config: {
        verifiedLabels: { ".tombol-yang-sudah-hilang": "Nama lama" },
      },
    });

    assert.deepEqual(result.staleOverrides, [".tombol-yang-sudah-hilang"]);
  });
});

test("warns when two patched elements end up with the same name", async () => {
  await withPage(fixture("unnamed-buttons.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["button-name"],
      config: {
        verifiedLabels: { ".left-2": "Geser", ".right-2": "Geser" },
      },
    });

    assert.equal(result.duplicateLabels.length, 1);
    assert.equal(result.duplicateLabels[0].label, "Geser");
    assert.equal(result.duplicateLabels[0].count, 2);

    // Nama kembar itu peringatan, bukan kegagalan. Patch tetap diterapkan.
    assert.equal(result.rolledBack, false);
    assert.equal(result.fixed.length, 2);

    // Tombol pojok tidak ikut di-override, jadi tetap masuk review dan
    // tetap terhitung sebagai pelanggaran yang belum selesai.
    assert.equal(result.review.length, 1);
    assert.equal(result.metrics.rules["button-name"].after, 1);
  });
});

test("regression report covers every rule, not only the target rules", () => {
  const before = {
    violations: [
      { id: "button-name", nodes: [{}, {}, {}] },
      { id: "color-contrast", nodes: [{}, {}] },
    ],
  };
  const after = {
    violations: [
      { id: "color-contrast", nodes: [{}, {}] },
      { id: "aria-allowed-attr", nodes: [{}] },
    ],
  };

  const report = createRegressionReport(before, after);

  assert.equal(report.rules["button-name"].delta, -3);
  assert.equal(report.rules["color-contrast"].delta, 0);
  assert.equal(report.rules["aria-allowed-attr"].delta, 1);

  // Rule baru yang muncul setelah patch harus ketahuan.
  assert.equal(report.clean, false);
  assert.deepEqual(report.newViolationRules, ["aria-allowed-attr"]);

  const cleanReport = createRegressionReport(before, {
    violations: [{ id: "color-contrast", nodes: [{}, {}] }],
  });
  assert.equal(cleanReport.clean, true);
  assert.deepEqual(cleanReport.worsened, []);
});

test("keeps site specific labels out of the core engine", () => {
  const sulsel = getSiteConfig("https://sulselprov.go.id/berita");
  const kepri = getSiteConfig("https://www.kepriprov.go.id");
  const unknown = getSiteConfig("https://contoh-situs-belum-terdaftar.go.id");

  assert.equal(sulsel.siteLabel, "Sulselprov");
  assert.equal(sulsel.configured, true);
  assert.equal(kepri.siteLabel, "Kepriprov");
  assert.equal(kepri.matchedHost, "kepriprov.go.id");

  // Situs yang belum terdaftar tetap boleh diproses, hanya tanpa label khusus.
  assert.equal(unknown.configured, false);
  assert.equal(unknown.siteLabel, "");
  assert.deepEqual(unknown.knownLinkLabels, {});
  assert.deepEqual(unknown.verifiedLabels, {});

  // Setiap override wajib punya catatan alasan dan tanggal pemeriksaan.
  for (const [selector, entry] of Object.entries(sulsel.verifiedLabels)) {
    assert.ok(entry.label, `${selector} harus punya label`);
    assert.ok(entry.note, `${selector} harus punya note`);
    assert.ok(entry.verifiedOn, `${selector} harus punya verifiedOn`);
  }

  const coreFiles = [
    "src/rules/button-name.mjs",
    "src/rules/link-name.mjs",
    "src/rules/scrollable-region.mjs",
    "src/rules/image-alt.mjs",
    "src/rules/form-label.mjs",
    "src/rules/html-lang.mjs",
    "src/rules/document-title.mjs",
    "src/rules/landmarks.mjs",
    "src/engine/index.mjs",
    "src/engine/disambiguate.mjs",
    "src/engine/verified-labels.mjs",
    "src/shared/text.mjs",
    "src/shared/retry.mjs",
    "src/runner/browser-pool.mjs",
  ];

  for (const file of coreFiles) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.ok(!/sulselprov/i.test(source), `${file} menyebut nama situs`);
    assert.ok(!/kepriprov/i.test(source), `${file} menyebut nama situs`);
  }
});

test("resolves image-alt without inventing visual descriptions", async () => {
  await withPage(fixture("unnamed-images.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["image-alt"],
      config: {
        knownImageAlts: { ".site-logo": "Logo Pemerintah Daerah" },
      },
    });

    // 1. Gambar dekoratif dalam tautan berteks
    assert.equal(await page.locator(".link-thumb").getAttribute("alt"), "");

    // 2. Gambar dekoratif mini
    assert.equal(await page.locator(".spacer-icon").getAttribute("alt"), "");

    // 3. Gambar dengan figcaption
    assert.equal(
      await page.locator(".figure-photo").getAttribute("alt"),
      "Gubernur melantik pejabat daerah",
    );

    // 4. Gambar dengan data-caption
    assert.equal(
      await page.locator(".chart-photo").getAttribute("alt"),
      "Grafik Pertumbuhan Ekonomi",
    );

    // 5. Gambar mandiri tanpa teks DOM di-skip (tidak dikarang)
    assert.equal(await page.locator(".unknown-photo").getAttribute("alt"), null);

    // 6. Logo dari site config
    assert.equal(
      await page.locator(".site-logo").getAttribute("alt"),
      "Logo Pemerintah Daerah",
    );

    assert.ok(result.fixed.length >= 4);
    assert.ok(result.skipped.length >= 1);
    assert.ok(result.metrics.rules["image-alt"].reduction > 0);
  });
});

test("labels form inputs from companion buttons, placeholders, and labels", async () => {
  await withPage(fixture("unlabeled-forms.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["label"],
      config: {
        knownFormLabels: { ".portal-query": "Pencarian Portal" },
      },
    });

    // 1. Companion button
    assert.equal(
      await page.locator(".search-input").getAttribute("aria-label"),
      "Cari informasi",
    );

    // 2. Sibling label
    assert.equal(
      await page.locator(".sibling-input").getAttribute("aria-label"),
      "Nama Pemohon",
    );

    // 3. Identifier camelCase
    assert.equal(
      await page.locator(".ident-input").getAttribute("aria-label"),
      "User Phone Number",
    );

    // 4. Input tanpa sinyal teks di-skip
    assert.equal(await page.locator(".unknown-input").getAttribute("aria-label"), null);

    // 5. Configured form label
    assert.equal(
      await page.locator(".portal-query").getAttribute("aria-label"),
      "Pencarian Portal",
    );

    assert.ok(result.fixed.length >= 4);
    assert.ok(result.skipped.length >= 1);
    assert.ok(result.metrics.rules["label"].reduction > 0);
  });
});

test("declares document language and populates document title from h1", async () => {
  await withPage(fixture("missing-lang-title.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["html-has-lang", "document-title"],
      config: { siteLabel: "Sulselprov", defaultLang: "id" },
    });

    assert.equal(await page.locator("html").getAttribute("lang"), "id");
    const titleText = await page.title();
    assert.ok(titleText.includes("Pengumuman Resmi Seleksi"));
    assert.ok(titleText.includes("Sulselprov"));

    assert.equal(result.metrics.rules["html-has-lang"].after, 0);
    assert.equal(result.metrics.rules["document-title"].after, 0);
  });
});

test("designates primary content container as main landmark", async () => {
  await withPage(fixture("missing-landmarks.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["landmark-one-main"],
    });

    assert.equal(await page.locator("#main-content").getAttribute("role"), "main");
    assert.equal(result.metrics.rules["landmark-one-main"].after, 0);
  });
});

test("disambiguates identical button names using contextual parent heading", async () => {
  await withPage(fixture("phase-2-quality.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["button-name"],
    });

    const galleryBtn = await page
      .locator(".btn-gallery-prev")
      .getAttribute("aria-label");
    const newsBtn = await page
      .locator(".btn-news-prev")
      .getAttribute("aria-label");

    assert.equal(galleryBtn, "Media sebelumnya (Galeri Foto)");
    assert.equal(newsBtn, "Media sebelumnya (Berita Terkini)");
    assert.equal(result.fixed.length, 2);
    assert.equal(result.duplicateLabels.length, 0);
  });
});

test("calibrates link heuristics using inline svg, tooltips, and informative slugs", async () => {
  await withPage(fixture("phase-2-quality.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["link-name"],
    });

    // 1. Inline SVG title
    assert.equal(
      await page.locator(".link-svg-title").getAttribute("aria-label"),
      "Portal Pengaduan Warga",
    );

    // 2. Tooltip data-original-title
    assert.equal(
      await page.locator(".link-tooltip").getAttribute("aria-label"),
      "Unduh Dokumen Publik",
    );

    // 3. Informative slug
    assert.equal(
      await page.locator(".link-info-slug").getAttribute("aria-label"),
      "Buka Layanan Publik",
    );

    // 4. Technical slug tidak diterapkan otomatis
    assert.equal(
      await page.locator(".link-tech-slug").getAttribute("aria-label"),
      null,
    );

    const techCandidate = result.skipped.find(
      (c) =>
        c.selector === ".link-tech-slug" || c.source === "technical-url-slug",
    );
    assert.ok(techCandidate, "Technical slug must be skipped or placed in review");
    assert.equal(techCandidate.confidence, 0.5);
  });
});

test("creates element fingerprint and handles target resolution", () => {
  const dummyEl = {
    tagName: "BUTTON",
    getAttribute: (attr) =>
      attr === "role" ? "button" : attr === "class" ? "btn prev-btn" : null,
    parentElement: {
      tagName: "SECTION",
      getAttribute: (attr) => (attr === "class" ? "carousel-area" : null),
    },
    textContent: "Prev",
  };
  const fp = createElementFingerprint(dummyEl);
  assert.equal(fp.tag, "button");
  assert.equal(fp.role, "button");
  assert.deepEqual(fp.classes, ["btn", "prev-btn"]);
  assert.equal(fp.parentTag, "section");
  assert.equal(fp.parentClass, "carousel-area");
});

test("captures pre-patch snapshot and verifies rollbackSingleRecord integrity", async () => {
  await withPage(fixture("phase-2-quality.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["button-name"],
    });

    const fixedRecord = result.fixed[0];
    assert.ok(fixedRecord.prePatchSnapshot, "Must record prePatchSnapshot");
    assert.equal(fixedRecord.prePatchSnapshot.tagName, "button");
    assert.ok(fixedRecord.appliedPatches[0].patchId.includes("button-name"));

    // Lakukan rollback pada single record
    await rollbackSingleRecord(page, fixedRecord);

    const revertedLabel = await page
      .locator(fixedRecord.selector)
      .getAttribute("aria-label");
    const revertedFlag = await page
      .locator(fixedRecord.selector)
      .getAttribute("data-project-a-fixed");

    assert.equal(revertedLabel, null);
    assert.equal(revertedFlag, null);
  });
});

test("executes partial rollback metadata and handles selective candidate revert", async () => {
  await withPage(fixture("phase-2-quality.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["button-name", "link-name"],
    });

    assert.ok(result.fixed.length >= 3);
    assert.equal(result.rolledBack, false);
    assert.equal(typeof result.partiallyRolledBack, "boolean");
    assert.ok(Array.isArray(result.rolledBackRecords));
  });
});

test("tokenizes identifiers with unicode property escapes preserving regional scripts", () => {
  // 1. Pemecahan camelCase standar
  assert.equal(
    splitCamelCaseUnicode("layananDaerahSulawesi"),
    "layanan Daerah Sulawesi",
  );
  assert.equal(
    splitCamelCaseUnicode("tombolPengumumanCASN"),
    "tombol Pengumuman CASN",
  );

  // 2. Aksara Nusantara (Lontara: ᨒᨚᨈᨑ, Jawa: ꦲꦤꦕꦫꦏ) tidak rusak/terpotong
  const lontaraText = "ᨒᨚᨈᨑSulawesi";
  const tokensLontara = tokenizeUnicode(lontaraText);
  assert.ok(tokensLontara.some((t) => t.includes("ᨒᨚᨈᨑ")));

  const javaneseText = "ꦲꦤꦕꦫꦏDaerah";
  const tokensJawa = tokenizeUnicode(javaneseText);
  assert.ok(tokensJawa.some((t) => t.includes("ꦲꦤꦕꦫꦏ")));

  // 3. Karakter aksen Latin
  assert.deepEqual(tokenizeUnicode("informasiPublikRenovasi"), [
    "informasi",
    "publik",
    "renovasi",
  ]);
});

test("dismisses modal popup overlays and cookie consent banners", async () => {
  await withPage(fixture("phase-3-coverage.html"), async (page) => {
    assert.ok(await page.locator("#announcement-modal").isVisible());
    assert.ok(await page.locator("#cookie-banner").isVisible());

    await dismissOverlays(page);

    const backdropDisplay = await page.evaluate(
      () => document.querySelector(".modal-backdrop")?.style.display,
    );
    assert.equal(backdropDisplay, "none");
  });
});

test("performs adaptive scroll and handles scroll height stabilization", async () => {
  await withPage(fixture("phase-3-coverage.html"), async (page) => {
    await settlePage(page);

    const scrollY = await page.evaluate(() => window.scrollY);
    assert.equal(scrollY, 0, "Harus kembali ke posisi puncak setelah stabil");
  });
});

test("extracts and structures nested target chains for iframe and shadow DOM", () => {
  const mockAxe = {
    violations: [
      {
        id: "button-name",
        impact: "critical",
        nodes: [
          { target: ["#main-content button"] },
          { target: ["iframe#portal-map", "button.leaflet-control-zoom-in"] },
        ],
      },
    ],
  };

  const targets = extractTargets(mockAxe);
  const buttonTargets = targets["button-name"];

  assert.equal(buttonTargets.selectors.length, 1);
  assert.equal(buttonTargets.selectors[0], "#main-content button");
  assert.equal(buttonTargets.nestedTargets.length, 1);
  assert.deepEqual(buttonTargets.nestedTargets[0].chain, [
    "iframe#portal-map",
    "button.leaflet-control-zoom-in",
  ]);
  assert.equal(
    buttonTargets.nestedTargets[0].compoundSelector,
    "iframe#portal-map >>> button.leaflet-control-zoom-in",
  );
  assert.equal(buttonTargets.unsupportedTargets, 0);
});

test("enforces two-stage hydration window network policy", () => {
  const target = "https://sulselprov.go.id/";

  // 1. Pada mode standar (isHydrating: false), script selalu ditolak
  const standardVerdict = decideRequest({
    resourceType: "script",
    url: "https://sulselprov.go.id/bundle.js",
    allowedDocumentUrl: target,
    isHydrating: false,
  });
  assert.equal(standardVerdict.allow, false);
  assert.equal(standardVerdict.reason, "blocked-type-script");

  // 2. Pada jendela hidrasi (isHydrating: true), first-party script diizinkan
  const hydrationFirstParty = decideRequest({
    resourceType: "script",
    url: "https://sulselprov.go.id/_next/static/main.js",
    allowedDocumentUrl: target,
    isHydrating: true,
  });
  assert.equal(hydrationFirstParty.allow, true);
  assert.equal(
    hydrationFirstParty.reason,
    "hydration-first-party-script-allowed",
  );

  // 3. Pada jendela hidrasi, pelacak pihak ketiga diblokir dan CDN publik diizinkan
  const hydrationTracker = decideRequest({
    resourceType: "script",
    url: "https://www.google-analytics.com/analytics.js",
    allowedDocumentUrl: target,
    isHydrating: true,
  });
  assert.equal(hydrationTracker.allow, false);
  assert.equal(hydrationTracker.reason, "hydration-tracker-blocked");

  const hydrationPublicCdn = decideRequest({
    resourceType: "script",
    url: "https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js",
    allowedDocumentUrl: target,
    isHydrating: true,
  });
  assert.equal(hydrationPublicCdn.allow, true);
  assert.equal(hydrationPublicCdn.reason, "hydration-public-script-allowed");
});

test("reuses browser instance across multiple tasks while isolating contexts", async () => {
  await closeSharedBrowser();
  let browser1, browser2;

  await withBrowser(async ({ context, browser }) => {
    browser1 = browser;
    await context.addCookies([
      {
        name: "test_session",
        value: "secret_123",
        domain: "example.org",
        path: "/",
      },
    ]);
    const cookies = await context.cookies();
    assert.equal(cookies.length, 1);
  });

  await withBrowser(async ({ context, browser }) => {
    browser2 = browser;
    const cookies = await context.cookies();
    // Context baru harus steril dan tidak membawa cookie dari context sebelumnya
    assert.equal(cookies.length, 0);
  });

  assert.equal(browser1, browser2, "Browser instance harus dipakai ulang antar tugas");
  const stats = getPoolStats();
  assert.equal(stats.activeContexts, 0, "Semua context harus ditutup bersih");
  assert.ok(stats.usageCount >= 2, "Usage count pool bertambah");
  await closeSharedBrowser();
});

test("recycles browser instance after reaching max uses", async () => {
  await closeSharedBrowser();
  let b1, b2, b3;

  await withPooledBrowser(
    async ({ browser }) => {
      b1 = browser;
    },
    { maxUses: 2 },
  );

  await withPooledBrowser(
    async ({ browser }) => {
      b2 = browser;
    },
    { maxUses: 2 },
  );

  assert.equal(b1, b2, "Tugas 1 dan 2 menggunakan browser yang sama");

  // Karena maxUses adalah 2, setelah tugas kedua selesai browser didaur ulang
  await withPooledBrowser(
    async ({ browser }) => {
      b3 = browser;
    },
    { maxUses: 2 },
  );

  assert.notEqual(b1, b3, "Tugas 3 harus menggunakan instance browser yang baru");
  await closeSharedBrowser();
});

test("retries transient DNS lookup errors with exponential backoff", async () => {
  let attempts = 0;
  const sleeps = [];

  const result = await withExponentialBackoff(
    async (attempt) => {
      attempts++;
      if (attempt < 2) {
        const err = new Error("getaddrinfo EAI_AGAIN domain.test");
        err.code = "EAI_AGAIN";
        throw err;
      }
      return ["93.184.216.34"];
    },
    {
      maxRetries: 2,
      initialDelayMs: 20,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    },
  );

  assert.equal(attempts, 3);
  assert.deepEqual(result, ["93.184.216.34"]);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 20);
  assert.ok(sleeps[1] >= 40);
});

test("refuses non-retryable errors immediately without retry delay", async () => {
  let attempts = 0;
  const sleeps = [];

  await assert.rejects(
    async () => {
      await withExponentialBackoff(
        async () => {
          attempts++;
          const err = new Error("Redirect robots.txt tidak aman: blocked-address");
          err.code = "BLOCKED_ADDRESS";
          throw err;
        },
        {
          maxRetries: 2,
          initialDelayMs: 20,
          sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
          },
        },
      );
    },
    (err) => {
      assert.match(err.message, /blocked-address/);
      return true;
    },
  );

  assert.equal(attempts, 1, "Error non-transien tidak boleh di-retry");
  assert.equal(sleeps.length, 0, "Tidak ada sleep untuk error deterministik");
});

test("resolves container launch args when low resource mode is enabled", () => {
  const prevEnv = process.env.CHROMIUM_LOW_RESOURCE_MODE;
  try {
    process.env.CHROMIUM_LOW_RESOURCE_MODE = "1";
    const args = resolveLaunchArgs();
    assert.ok(args.includes("--no-sandbox"));
    assert.ok(args.includes("--disable-dev-shm-usage"));
    assert.ok(args.includes("--renderer-process-limit=1"));
    assert.ok(args.includes("--js-flags=--max-old-space-size=160"));
  } finally {
    if (prevEnv === undefined) {
      delete process.env.CHROMIUM_LOW_RESOURCE_MODE;
    } else {
      process.env.CHROMIUM_LOW_RESOURCE_MODE = prevEnv;
    }
  }
});

test("auditPage throws immediately if navigation times out and no DOM was received", async () => {
  const mockPage = {
    on: () => {},
    off: () => {},
    goto: async () => {
      const err = new Error("Navigation timeout of 25000ms exceeded");
      err.name = "TimeoutError";
      throw err;
    },
    evaluate: async () => false,
  };

  await assert.rejects(
    async () => {
      await auditPage({
        page: mockPage,
        url: "https://contoh-instansi.go.id/",
        siteConfig: { host: "contoh-instansi.go.id", configured: false },
        captureScreenshot: false,
      });
    },
    (err) => {
      assert.match(err.message, /timeout/i);
      return true;
    },
  );
});

test("builds host resolver rules for DNS rebinding protection", () => {
  const rules = buildHostResolverRules({
    hostname: "contoh-instansi.go.id",
    addresses: ["103.10.0.1", "103.10.0.2"],
  });

  assert.equal(rules.length, 1);
  assert.equal(
    rules[0],
    "--host-resolver-rules=MAP contoh-instansi.go.id 103.10.0.1",
  );

  // Dual-stack: prefer IPv4 over IPv6 when IPv6 appears first
  assert.deepEqual(
    buildHostResolverRules({
      hostname: "ukmcoding.site",
      addresses: ["2606:4700:3034::6815:1001", "104.21.16.1"],
    }),
    ["--host-resolver-rules=MAP ukmcoding.site 104.21.16.1"],
  );

  // IPv6-only: wrap in square brackets for Chromium host resolver rules
  assert.deepEqual(
    buildHostResolverRules({
      hostname: "ipv6-only.example.test",
      addresses: ["2606:4700:3034::6815:1001"],
    }),
    ["--host-resolver-rules=MAP ipv6-only.example.test [2606:4700:3034::6815:1001]"],
  );

  assert.deepEqual(buildHostResolverRules({ hostname: "", addresses: [] }), []);
  assert.deepEqual(
    buildHostResolverRules({
      hostname: "contoh-instansi.go.id",
      addresses: ["not-an-ip", ""],
    }),
    [],
  );
  assert.deepEqual(buildHostResolverRules(), []);
});

test("synchronizes wide axe scan and regression contract in remediatePage", async () => {
  await withPage(fixture("unnamed-buttons.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["button-name"],
    });

    assert.ok(result.wideAfterAxe, "wideAfterAxe must not be undefined or null");
    assert.ok(Array.isArray(result.wideAfterAxe.violations));
    assert.ok(result.wideRegression, "wideRegression must not be undefined or null");
    assert.equal(typeof result.wideRegression.clean, "boolean");
    assert.ok(Array.isArray(result.wideRegression.worsened));
    assert.ok(Array.isArray(result.rolledBackRecords));
    assert.equal(result.fixed.length, 2);
    assert.ok(result.fixed[0].snippet);
    assert.ok(result.fixed[0].snippet.before.includes("<button"));
    assert.ok(result.fixed[0].snippet.after.includes('aria-label="Media sebelumnya"'));
  });
});

test("remediates complex real-world edge cases with multi-class icon fonts and forms", async () => {
  await withPage(fixture("real-world-complex.html"), async (page) => {
    const before = await axe(page);
    const result = await remediatePage({
      page,
      axeResult: before,
      rules: ["button-name", "label"],
    });

    const prevBtn = page.locator(".fa-chevron-left");
    const nextBtn = page.locator(".bi-chevron-right");
    const searchBtn = page.locator(".ri-search-line");

    assert.ok(
      await prevBtn.getAttribute("aria-label"),
      "Tombol fa-chevron-left harus dinamai",
    );
    assert.ok(
      await nextBtn.getAttribute("aria-label"),
      "Tombol bi-chevron-right harus dinamai",
    );
    assert.ok(
      await searchBtn.getAttribute("aria-label"),
      "Tombol ri-search-line harus dinamai",
    );

    const searchInput = page.locator('input[type="text"]');
    assert.ok(
      await searchInput.getAttribute("aria-label"),
      "Input pencarian harus dinamai",
    );

    assert.ok(result.fixed.length >= 3);
  });
});

test("html-lang detects English vs Indonesian without hardcoding id and sends ambiguous pages to review", async () => {
  await withPage(
    `<!doctype html><html><head><title>News</title></head><body><main><h1>Welcome</h1><p>This is the official public information and services page for citizens and visitors.</p></main></body></html>`,
    async (page) => {
      const before = await axe(page);
      const result = await remediatePage({
        page,
        axeResult: before,
        rules: ["html-has-lang"],
        config: { configured: false, defaultLang: "id" },
      });
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.equal(result.fixed[0].patches[0].value, "en");
    },
  );

  await withPage(
    `<!doctype html><html><head><title>Portal</title></head><body><main><h1>Halo</h1></main></body></html>`,
    async (page) => {
      const before = await axe(page);
      const result = await remediatePage({
        page,
        axeResult: before,
        rules: ["html-has-lang"],
        config: { configured: false, defaultLang: "id" },
      });
      assert.equal(await page.locator("html").getAttribute("lang"), null);
      assert.equal(result.review.length, 1);
      assert.ok(result.review[0].confidence < 0.8);
    },
  );
});

test("document-title does not mutate head before apply and cleans up on rollback", async () => {
  const { resolveDocumentTitleCandidates } = await import("../src/rules/document-title.mjs");
  await withPage(
    `<!doctype html><html><head></head><body><main><h1>Profil Layanan Publik</h1></main></body></html>`,
    async (page) => {
      const candidates = await resolveDocumentTitleCandidates(page, ["html"], {});
      assert.equal(candidates[0].selector, "head > title");
      assert.equal(await page.locator("head > title").count(), 0);

      const applied = await applyCandidates(page, candidates, {
        applyThreshold: 0.8,
        reviewThreshold: 0.6,
      });
      assert.equal(applied.fixed.length, 1);
      assert.equal(await page.title(), "Profil Layanan Publik");

      await rollbackSingleRecord(page, applied.fixed[0]);
      assert.equal(await page.locator("head > title").count(), 0);
    },
  );
});

test("serializer strips javascript: and vbscript: URLs, formaction, and unsafe inline styles", async () => {
  const { serializePage } = await import("../src/serializer/index.mjs");
  await withPage(
    `<!doctype html><html lang="id"><head><title>Uji</title></head><body>
      <main>
        <a id="bad-js" href="javascript:alert(1)">Bad JS</a>
        <a id="bad-vbs" href="vbscript:msgbox(1)">Bad VBS</a>
        <img id="bad-img" src="javascript:alert(2)" alt="x">
        <button id="bad-btn" formaction="https://evil.test" style="width:expression(alert(1))">Kirim</button>
      </main>
    </body></html>`,
    async (page) => {
      const { patchedPage } = await serializePage({
        page,
        sourceUrl: "https://contoh.go.id/",
        disclaimer: "Disclaimer test",
      });
      assert.equal(/javascript:/i.test(patchedPage), false);
      assert.equal(/vbscript:/i.test(patchedPage), false);
      assert.equal(/formaction=/i.test(patchedPage), false);
      assert.equal(/expression\s*\(/i.test(patchedPage), false);
    },
  );
});

test("auditPage captures early before.png, bounding boxes, tabStops with 2.4.7 & 2.4.11, and readiness", async () => {
  await withPage(
    `<!doctype html><html><head><title>Uji Probes</title>
      <style>
        header.sticky { position: fixed; top: 0; left: 0; right: 0; height: 60px; background: #fff; z-index: 99; }
        .no-focus:focus { outline: none; box-shadow: none; }
        main { padding-top: 20px; }
      </style>
    </head><body>
      <header class="sticky">Sticky Banner</header>
      <main>
        <a class="obscured-link" href="#a" style="position:fixed;top:10px;left:20px;z-index:1;">Tertutup</a>
        <button class="no-focus" style="margin-top:80px;"></button>
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

      const progressEvents = [];
      const audited = await auditPage({
        page,
        url: "https://contoh.go.id/",
        siteConfig: { host: "contoh.go.id", configured: false, siteLabel: "" },
        onProgress: (ev) => progressEvents.push(ev),
      });
      page.goto = originalGoto;

      const earlyEvent = progressEvents.find((e) => e.progress === 46);
      assert.ok(earlyEvent, "Must emit progress 46 for early before.png");
      assert.ok(Buffer.isBuffer(earlyEvent.earlyBeforeScreenshot));
      assert.equal(earlyEvent.telemetry.earlyPreviewReady, true);

      assert.ok(Buffer.isBuffer(audited.artifacts.beforeScreenshot));
      assert.ok(audited.report.readiness);
      assert.equal(audited.report.readiness.partialLoad, false);
      assert.ok(audited.report.readiness.domElements > 0);
      assert.ok(audited.report.tabStops.length >= 2);
      assert.equal(audited.report.tabStops[0].obscured, true);
      assert.equal(audited.report.tabStops[1].hasVisibleFocus, false);
      assert.ok(Object.keys(audited.report.issueBoundingBoxes).length >= 1);
    },
  );
});

test("configures reducedMotion and expanded settleTimeoutMs defaults for hydration readiness", () => {
  assert.equal(CONTEXT_OPTIONS.reducedMotion, "reduce");
  assert.ok(
    DEFAULT_TIMEOUTS.settleTimeoutMs >= 15_000,
    `Expected settleTimeoutMs >= 15000, got ${DEFAULT_TIMEOUTS.settleTimeoutMs}`,
  );
});

test("settlePage scrolls full constant-height page beyond 3 viewports, promotes lazy images, and resets to (0, 0)", async () => {
  const pixelPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await withPage(
    `<!doctype html><html lang="id"><head><title>Tall Page</title>
      <style>
        html { scroll-behavior: smooth; }
        body { margin: 0; height: 3400px; position: relative; }
        #bottom-sentinel { position: absolute; top: 3250px; left: 0; height: 50px; width: 100px; }
        #lazy-below { position: absolute; top: 2900px; left: 0; width: 40px; height: 40px; }
      </style>
    </head><body>
      <main>
        <h1>Halaman Panjang</h1>
        <img id="lazy-below" loading="lazy" src="${pixelPng}" alt="Lazy">
        <div id="bottom-sentinel" data-observed="false">Bottom</div>
      </main>
      <script>
        window.__maxScrollY = 0;
        window.addEventListener("scroll", () => {
          if (window.scrollY > window.__maxScrollY) {
            window.__maxScrollY = window.scrollY;
          }
        });
        const io = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.setAttribute("data-observed", "true");
            }
          }
        });
        io.observe(document.getElementById("bottom-sentinel"));
      </script>
    </body></html>`,
    async (page) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      const readiness = await settlePage(page, {
        domQuietMs: 100,
        settleDelayMs: 50,
      });

      const state = await page.evaluate(() => {
        const img = document.getElementById("lazy-below");
        const sentinel = document.getElementById("bottom-sentinel");
        return {
          scrollY: window.scrollY,
          maxScrollY: window.__maxScrollY,
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
          imgLoadingProp: img.loading,
          imgLoadingAttr: img.getAttribute("loading"),
          imgComplete: img.complete,
          bottomObserved: sentinel.getAttribute("data-observed"),
        };
      });

      assert.equal(state.imgLoadingProp, "eager");
      assert.equal(state.imgLoadingAttr, "eager");
      assert.equal(state.imgComplete, true);
      assert.equal(state.bottomObserved, "true", "Full-page scroll must reach bottom sentinel");
      assert.ok(
        state.maxScrollY + state.viewportHeight >= state.scrollHeight - 4,
        `Expected maxScrollY (${state.maxScrollY}) + vh (${state.viewportHeight}) >= scrollHeight - 4 (${state.scrollHeight - 4})`,
      );
      assert.equal(state.scrollY, 0, "Scroll must reset to (0, 0)");
      assert.ok(readiness.pageHeight >= 3400);
    },
  );
});

test("auditPage invokes onHydrationSettled immediately after settlePage and before screenshot and axe-core", async () => {
  await withPage(
    `<!doctype html><html lang="id"><head><title>Hydration Hook</title></head><body>
      <main><h1>Judul</h1><button>Aksi</button></main>
    </body></html>`,
    async (page) => {
      const originalGoto = page.goto.bind(page);
      const originalScreenshot = page.screenshot.bind(page);
      const events = [];

      page.goto = async () => ({
        ok: () => true,
        status: () => 200,
        headers: () => ({ "content-type": "text/html" }),
      });
      page.url = () => "https://contoh.go.id/";
      page.screenshot = async (opts) => {
        events.push("screenshot");
        return originalScreenshot(opts);
      };

      await auditPage({
        page,
        url: "https://contoh.go.id/",
        siteConfig: { host: "contoh.go.id", configured: false, siteLabel: "" },
        onProgress: (ev) => {
          events.push(`progress:${ev.progress}`);
        },
        onHydrationSettled: async () => {
          events.push("hydrationSettled");
        },
      });

      page.goto = originalGoto;
      page.screenshot = originalScreenshot;

      const settledIdx = events.indexOf("hydrationSettled");
      const progress43Idx = events.indexOf("progress:43");
      const firstScreenshotIdx = events.indexOf("screenshot");
      const progress46Idx = events.indexOf("progress:46");
      const progress53Idx = events.indexOf("progress:53");

      assert.ok(settledIdx > progress43Idx, "Must run after settlePage starts (progress 43)");
      assert.ok(firstScreenshotIdx > settledIdx, "Must run before before.png screenshot");
      assert.ok(progress46Idx > settledIdx, "Must run before progress 46");
      assert.ok(progress53Idx > settledIdx, "Must run before axe-core audit (progress 53)");
      assert.equal(
        events.filter((e) => e === "hydrationSettled").length,
        1,
        "onHydrationSettled must be called once",
      );
    },
  );
});

test("settlePage locks once:false scroll-reveal elements that become visible during scroll without exposing display:none or unrevealed elements", async () => {
  await withPage(
    `<!doctype html><html lang="id"><head><title>Reversible Scroll Reveal</title>
      <style>
        body { margin: 0; height: 3400px; position: relative; }
        .reveal-card { position: absolute; top: 1900px; left: 20px; width: 300px; height: 150px; }
        #hidden-modal { display: none; opacity: 0; }
        #never-revealed { position: absolute; top: 200px; left: 20px; opacity: 0; }
      </style>
    </head><body>
      <main>
        <h1>Beranda</h1>
        <div id="reveal-card" class="reveal-card" style="opacity: 0; transform: translateY(20px);">Kartu Visual</div>
        <div id="hidden-modal">Modal Tersembunyi</div>
        <div id="never-revealed">Tooltip Tertutup</div>
      </main>
      <script>
        const card = document.getElementById("reveal-card");
        const io = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              card.style.opacity = "1";
              card.style.transform = "none";
            } else {
              // Simulate Framer Motion useInView(ref, { once: false }) reverting when scrolled out
              card.style.opacity = "0";
              card.style.transform = "translateY(20px)";
            }
          }
        });
        io.observe(card);
      </script>
    </body></html>`,
    async (page) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await settlePage(page, { domQuietMs: 100, settleDelayMs: 100 });

      const result = await page.evaluate(() => {
        const card = document.getElementById("reveal-card");
        const modal = document.getElementById("hidden-modal");
        const tooltip = document.getElementById("never-revealed");
        const cardStyle = window.getComputedStyle(card);
        const modalStyle = window.getComputedStyle(modal);
        const tooltipStyle = window.getComputedStyle(tooltip);
        return {
          scrollY: window.scrollY,
          cardOpacity: cardStyle.opacity,
          cardTransform: cardStyle.transform,
          modalDisplay: modalStyle.display,
          modalRevealedAttr: modal.getAttribute("data-aksaranetra-revealed"),
          tooltipOpacity: tooltipStyle.opacity,
          tooltipRevealedAttr: tooltip.getAttribute("data-aksaranetra-revealed"),
        };
      });

      assert.equal(result.scrollY, 0);
      assert.equal(result.cardOpacity, "1");
      assert.equal(result.cardTransform, "none");
      assert.equal(result.modalDisplay, "none");
      assert.equal(result.modalRevealedAttr, null);
      assert.equal(result.tooltipOpacity, "0");
      assert.equal(result.tooltipRevealedAttr, null);
    },
  );
});





