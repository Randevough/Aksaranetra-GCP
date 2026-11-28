import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {
  parseCssColor,
  rgbToHex,
  relativeLuminance,
  contrastRatio,
  srgbToOklch,
  oklchToSrgb,
  findConsistentContrastColor,
  resolveColorContrastCandidates,
} from "../src/rules/color-contrast.mjs";
import {
  remediatePage,
  rollbackSingleRecord,
  SUPPORTED_RULES,
} from "../src/engine/index.mjs";

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

test("SUPPORTED_RULES includes color-contrast", () => {
  assert.ok(SUPPORTED_RULES.includes("color-contrast"));
});

test("parseCssColor and rgbToHex handle #rgb, #rrggbb, #rrggbbaa, rgb(), and rgba()", () => {
  assert.deepEqual(parseCssColor("#abc"), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseCssColor("#60A5FA"), { r: 96, g: 165, b: 250, a: 1 });
  const hexAlpha = parseCssColor("#11223380");
  assert.equal(hexAlpha.r, 17);
  assert.equal(hexAlpha.g, 34);
  assert.equal(hexAlpha.b, 51);
  assert.ok(Math.abs(hexAlpha.a - 128 / 255) < 1e-4);

  assert.deepEqual(parseCssColor("rgb(15, 23, 42)"), {
    r: 15,
    g: 23,
    b: 42,
    a: 1,
  });
  assert.deepEqual(parseCssColor("rgba(255, 128, 0, 0.5)"), {
    r: 255,
    g: 128,
    b: 0,
    a: 0.5,
  });
  assert.deepEqual(parseCssColor("rgb(100 150 200 / 75%)"), {
    r: 100,
    g: 150,
    b: 200,
    a: 0.75,
  });
  assert.equal(parseCssColor("not-a-color"), null);

  assert.equal(rgbToHex({ r: 96, g: 165, b: 250 }), "#60a5fa");
});

test("relativeLuminance and contrastRatio match WCAG 2.x specification", () => {
  const white = parseCssColor("#ffffff");
  const black = parseCssColor("#000000");
  const gray76 = parseCssColor("#767676");
  const gray59 = parseCssColor("#595959");

  assert.equal(relativeLuminance(black), 0);
  assert.ok(Math.abs(relativeLuminance(white) - 1) < 1e-6);
  assert.ok(Math.abs(contrastRatio(white, black) - 21) < 1e-6);
  assert.ok(Math.abs(contrastRatio(gray76, white) - 4.54) < 0.02);
  assert.ok(Math.abs(contrastRatio(gray59, white) - 7.0) < 0.05);
});

test("srgbToOklch and oklchToSrgb round-trip accurately and clamp out-of-gamut chroma safely", () => {
  const samples = [
    "#000000",
    "#ffffff",
    "#60a5fa",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#64748b",
  ];

  for (const hex of samples) {
    const rgb = parseCssColor(hex);
    const oklch = srgbToOklch(rgb);
    const roundTripped = oklchToSrgb(oklch);
    assert.ok(
      Math.abs(roundTripped.r - rgb.r) <= 1 &&
        Math.abs(roundTripped.g - rgb.g) <= 1 &&
        Math.abs(roundTripped.b - rgb.b) <= 1,
      `Round-trip mismatch for ${hex}: got ${rgbToHex(roundTripped)}`,
    );
  }

  // Out-of-gamut chroma must clamp cleanly to [0..255] without shifting lightness/hue wildly
  const clamped = oklchToSrgb({ l: 0.55, c: 0.45, h: 255 });
  assert.ok(clamped.r >= 0 && clamped.r <= 255);
  assert.ok(clamped.g >= 0 && clamped.g <= 255);
  assert.ok(clamped.b >= 0 && clamped.b <= 255);
  const clampedOklch = srgbToOklch(clamped);
  assert.ok(Math.abs(clampedOklch.h - 255) < 5);
});

test("findConsistentContrastColor preserves hue, satisfies all cluster backgrounds, and returns null when impossible", () => {
  // Light surfaces: #60a5fa on #ffffff and #f1f5f9 -> darker blue >= 4.6 on both
  const lightSolved = findConsistentContrastColor(
    "#60a5fa",
    ["#ffffff", "#f1f5f9"],
    4.6,
  );
  assert.ok(lightSolved);
  assert.ok(lightSolved.minRatio >= 4.6);
  assert.ok(lightSolved.deltaL < 0);
  const lightOklch = srgbToOklch(parseCssColor(lightSolved.hex));
  const origBlueOklch = srgbToOklch(parseCssColor("#60a5fa"));
  assert.ok(Math.abs(lightOklch.h - origBlueOklch.h) < 3);
  assert.ok(
    contrastRatio(parseCssColor(lightSolved.hex), parseCssColor("#ffffff")) >=
      4.6,
  );
  assert.ok(
    contrastRatio(parseCssColor(lightSolved.hex), parseCssColor("#f1f5f9")) >=
      4.6,
  );

  // Dark surfaces: #3b82f6 on #0f172a and #1e293b -> lighter blue >= 4.6 on both
  const darkSolved = findConsistentContrastColor(
    "#1d4ed8",
    ["#0f172a", "#1e293b"],
    4.6,
  );
  assert.ok(darkSolved);
  assert.ok(darkSolved.minRatio >= 4.6);
  assert.ok(darkSolved.deltaL > 0);
  assert.ok(
    contrastRatio(parseCssColor(darkSolved.hex), parseCssColor("#0f172a")) >=
      4.6,
  );
  assert.ok(
    contrastRatio(parseCssColor(darkSolved.hex), parseCssColor("#1e293b")) >=
      4.6,
  );

  // Mid-gray background where both #000000 (~4.62) and #ffffff (~4.54) fail 4.8:1
  const impossible = findConsistentContrastColor("#9ca3af", ["#767676"], 4.8);
  assert.equal(impossible, null);
});

test("page-wide clustering gives identical #60a5fa text on #ffffff and #f1f5f9 the exact same darkened blue hex", async () => {
  await withPage(
    `<!doctype html><html lang="id"><head><title>Uji Klaster Kontras</title>
      <style>
        body { margin: 0; background: #ffffff; font-family: sans-serif; }
        .card-white { background: #ffffff; padding: 16px; }
        .card-slate { background: #f1f5f9; padding: 16px; }
        .blue-link { color: #60a5fa; font-size: 16px; }
      </style>
    </head><body>
      <main>
        <h1>Daftar Layanan</h1>
        <div class="card-white">
          <p id="p-white" class="blue-link">Teks biru di atas putih</p>
        </div>
        <div class="card-slate">
          <p id="p-slate" class="blue-link">Teks biru di atas slate</p>
        </div>
      </main>
    </body></html>`,
    async (page) => {
      const before = await axe(page);
      const result = await remediatePage({
        page,
        axeResult: before,
        rules: ["color-contrast"],
      });

      assert.equal(result.metrics.rules["color-contrast"].before, 2);
      assert.equal(result.metrics.rules["color-contrast"].after, 0);
      assert.equal(result.fixed.length, 2);

      const patchWhite = result.fixed.find((r) => r.selector === "#p-white");
      const patchSlate = result.fixed.find((r) => r.selector === "#p-slate");
      assert.ok(patchWhite && patchSlate);
      assert.equal(patchWhite.source, "oklch-contrast-cluster");
      assert.equal(patchWhite.confidence, 0.9);

      const hexWhite = patchWhite.patches[0].value;
      const hexSlate = patchSlate.patches[0].value;
      assert.equal(
        hexWhite,
        hexSlate,
        "Identical fgHex on light surfaces must receive the exact same target hex",
      );

      // Verify hue stays blue and both backgrounds meet >= 4.6:1
      const fixedOklch = srgbToOklch(parseCssColor(hexWhite));
      assert.ok(fixedOklch.h >= 220 && fixedOklch.h <= 280);
      assert.ok(
        contrastRatio(parseCssColor(hexWhite), parseCssColor("#ffffff")) >= 4.6,
      );
      assert.ok(
        contrastRatio(parseCssColor(hexWhite), parseCssColor("#f1f5f9")) >= 4.6,
      );

      // Check computed styles in DOM match the target hex
      const computedColors = await page.evaluate(() => ({
        white: window.getComputedStyle(document.getElementById("p-white")).color,
        slate: window.getComputedStyle(document.getElementById("p-slate")).color,
      }));
      assert.equal(rgbToHex(parseCssColor(computedColors.white)), hexWhite);
      assert.equal(rgbToHex(parseCssColor(computedColors.slate)), hexWhite);
    },
  );
});

test("guardrails send gradient/svg elements to review while solid bg auto-fixes, preserves inline styles, handles !important, and rolls back cleanly", async () => {
  // 1. Direct guardrail check on linear-gradient & svg
  await withPage(
    `<!doctype html><html lang="id"><head><title>Uji Guardrail</title>
      <style>
        .grad-box { background-image: linear-gradient(90deg, #ffffff, #e2e8f0); padding: 12px; }
        .grad-text { color: #94a3b8; }
      </style>
    </head><body>
      <main>
        <div class="grad-box"><p id="grad-p" class="grad-text">Teks atas gradien</p></div>
        <svg width="120" height="40"><text id="svg-txt" x="0" y="20" fill="#cbd5e1">SVG</text></svg>
      </main>
    </body></html>`,
    async (page) => {
      const syntheticAxe = {
        violations: [
          {
            id: "color-contrast",
            impact: "serious",
            nodes: [
              {
                target: ["#grad-p"],
                any: [
                  {
                    id: "color-contrast",
                    data: {
                      fgColor: "#94a3b8",
                      bgColor: "#ffffff",
                      contrastRatio: 2.5,
                      expectedContrastRatio: "4.5:1",
                    },
                  },
                ],
              },
              {
                target: ["#svg-txt"],
                any: [
                  {
                    id: "color-contrast",
                    data: {
                      fgColor: "#cbd5e1",
                      bgColor: "#ffffff",
                      contrastRatio: 1.5,
                      expectedContrastRatio: "4.5:1",
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const candidates = await resolveColorContrastCandidates(
        page,
        ["#grad-p", "#svg-txt"],
        {},
        syntheticAxe,
      );

      assert.equal(candidates.length, 2);
      for (const c of candidates) {
        assert.equal(c.status, "review");
        assert.equal(c.confidence, 0.55);
        assert.deepEqual(c.patches, []);
      }
      assert.equal(candidates[0].source, "non-solid-background");
      assert.equal(candidates[1].source, "graphics-element");
    },
  );

  // 1b. Direct guardrail check on opacity < 0.99 (self and ancestor) + 4.75 safety margin
  await withPage(
    `<!doctype html><html lang="id"><head><title>Uji Opacity Guardrail</title>
      <style>
        body { background: #f0eee9; }
        .fade-wrap { opacity: 0.85; background: #f0eee9; }
        .self-fade { opacity: 0.82; color: #9b5d39; }
        .solid-margin { color: #8c8e90; }
      </style>
    </head><body>
      <main>
        <div class="fade-wrap"><p id="ancestor-fade" style="color: #8c8e90;">Ancestor fade</p></div>
        <a id="self-fade" class="self-fade" href="#u">Self fade</a>
        <p id="solid-margin" class="solid-margin">Solid margin</p>
      </main>
    </body></html>`,
    async (page) => {
      const syntheticAxe = {
        violations: [
          {
            id: "color-contrast",
            impact: "serious",
            nodes: [
              {
                target: ["#ancestor-fade"],
                any: [
                  {
                    id: "color-contrast",
                    data: {
                      fgColor: "#8c8e90",
                      bgColor: "#f3f1ed",
                      contrastRatio: 3.1,
                      expectedContrastRatio: "4.5:1",
                    },
                  },
                ],
              },
              {
                target: ["#self-fade"],
                any: [
                  {
                    id: "color-contrast",
                    data: {
                      fgColor: "#ab5c2f",
                      bgColor: "#f0eee9",
                      contrastRatio: 4.2,
                      expectedContrastRatio: "4.5:1",
                    },
                  },
                ],
              },
              {
                target: ["#solid-margin"],
                any: [
                  {
                    id: "color-contrast",
                    data: {
                      fgColor: "#8c8e90",
                      bgColor: "#f3f1ed",
                      contrastRatio: 3.1,
                      expectedContrastRatio: "4.5:1",
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const candidates = await resolveColorContrastCandidates(
        page,
        ["#ancestor-fade", "#self-fade", "#solid-margin"],
        {},
        syntheticAxe,
      );

      assert.equal(candidates[0].status, "review");
      assert.equal(candidates[0].confidence, 0.55);
      assert.equal(candidates[0].source, "translucent-opacity");

      assert.equal(candidates[1].status, "review");
      assert.equal(candidates[1].confidence, 0.55);
      assert.equal(candidates[1].source, "translucent-opacity");

      assert.equal(candidates[2].source, "oklch-contrast-cluster");
      const solvedHex = candidates[2].patches[0].value;
      assert.ok(
        contrastRatio(parseCssColor(solvedHex), parseCssColor("#f0eee9")) >=
          4.75,
        `Expected >= 4.75 on live #f0eee9, got ${contrastRatio(parseCssColor(solvedHex), parseCssColor("#f0eee9"))}`,
      );
    },
  );

  // 2. End-to-end remediatePage: gradient stays untouched, solid with inline style + !important fixes & rolls back cleanly
  await withPage(
    `<!doctype html><html lang="id"><head><title>Uji Remediate & Rollback</title>
      <style>
        body { background: #ffffff; font-family: sans-serif; }
        .grad-card { background-image: linear-gradient(135deg, #ffffff, #f8fafc); padding: 12px; }
        .solid-normal { color: #94a3b8; }
        .solid-important { color: #94a3b8 !important; }
      </style>
    </head><body>
      <main>
        <h1>Halaman Uji</h1>
        <div class="grad-card"><p id="grad-only" style="color: #94a3b8;">Gradien</p></div>
        <p id="inline-keep" class="solid-normal" style="font-size: 15px;">Dengan inline style</p>
        <p id="no-inline" class="solid-important">Dengan important CSS</p>
      </main>
    </body></html>`,
    async (page) => {
      const before = await axe(page);
      const result = await remediatePage({
        page,
        axeResult: before,
        rules: ["color-contrast"],
      });

      // Both solid elements must be fixed; gradient element must not have data-project-a-fixed
      const gradFixed = await page
        .locator("#grad-only")
        .getAttribute("data-project-a-fixed");
      assert.equal(gradFixed, null);

      const recInline = result.fixed.find((r) => r.selector === "#inline-keep");
      const recImportant = result.fixed.find((r) => r.selector === "#no-inline");
      assert.ok(recInline, "#inline-keep must be auto-fixed");
      assert.ok(recImportant, "#no-inline must be auto-fixed");

      // Inline style font-size must be preserved and priority not !important when unnecessary
      const inlineState = await page.evaluate(() => {
        const el1 = document.getElementById("inline-keep");
        const el2 = document.getElementById("no-inline");
        return {
          el1FontSize: el1.style.fontSize,
          el1Priority: el1.style.getPropertyPriority("color"),
          el2Priority: el2.style.getPropertyPriority("color"),
          el1Computed: window.getComputedStyle(el1).color,
          el2Computed: window.getComputedStyle(el2).color,
        };
      });
      assert.equal(inlineState.el1FontSize, "15px");
      assert.equal(inlineState.el1Priority, "");
      assert.equal(inlineState.el2Priority, "important");
      assert.equal(
        rgbToHex(parseCssColor(inlineState.el1Computed)),
        recInline.patches[0].value,
      );
      assert.equal(
        rgbToHex(parseCssColor(inlineState.el2Computed)),
        recImportant.patches[0].value,
      );

      // Rollback must restore original style attribute and remove style when none existed
      await rollbackSingleRecord(page, recInline);
      await rollbackSingleRecord(page, recImportant);

      const rolledBack = await page.evaluate(() => ({
        el1Style: document.getElementById("inline-keep").getAttribute("style"),
        el2Style: document.getElementById("no-inline").getAttribute("style"),
      }));
      assert.equal(rolledBack.el1Style, "font-size: 15px;");
      assert.equal(rolledBack.el2Style, null);
    },
  );
});
