import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTOMATED_COVERAGE_NOTE,
  MAX_ISSUES,
  VERIFIED_REGULATIONS,
  buildComplianceReport,
  sanitizeHtmlSnippet,
} from "../src/compliance/index.mjs";

test("never references revoked Permen Kominfo 8/2021 and exposes only verified regulations", () => {
  const expectedCodes = [
    "UU-8-2016",
    "PP-42-2020",
    "PERMENPANRB-11-2024",
    "SPBE-2018",
    "UU-KIP-2008",
    "SNI-ISO-40500",
  ];
  assert.deepEqual(
    VERIFIED_REGULATIONS.map((r) => r.code),
    expectedCodes,
  );
  const serialized = JSON.stringify(VERIFIED_REGULATIONS);
  assert.equal(/kominfo/i.test(serialized), false);
  assert.equal(/8\/2021|8 tahun 2021/i.test(serialized), false);
});

test("builds score, severity, regulations, and prioritized Indonesian issues", () => {
  const wcagBefore = {
    violations: [
      {
        id: "color-contrast",
        impact: "serious",
        tags: ["wcag2aa", "wcag143"],
        nodes: [
          { target: [".low-contrast"], html: '<p class="low-contrast" onclick="evil()">Teks</p>' },
        ],
      },
      {
        id: "button-name",
        impact: "critical",
        tags: ["wcag2a", "wcag412"],
        nodes: [
          { target: [".btn-icon"], html: '<button class="btn-icon"><svg></svg></button>' },
        ],
      },
      {
        id: "heading-order",
        impact: "moderate",
        tags: ["best-practice"],
        nodes: [{ target: ["h4"], html: "<h4>Judul</h4>" }],
      },
    ],
  };

  const wcagAfter = {
    violations: [
      {
        id: "color-contrast",
        impact: "serious",
        tags: ["wcag2aa", "wcag143"],
        nodes: [{ target: [".low-contrast"], html: '<p class="low-contrast">Teks</p>' }],
      },
    ],
  };

  const report = {
    fixed: [
      {
        rule: "button-name",
        selector: ".btn-icon",
        confidence: 0.9,
        source: "icon-class",
        snippet: {
          before: '<button class="btn-icon">...</button>',
          after: '<button aria-label="Tutup" class="btn-icon">...</button>',
        },
      },
    ],
    review: [],
    skipped: [],
    rolledBackRecords: [],
    issueBoundingBoxes: {
      ".btn-icon": { x: 10, y: 20, width: 40, height: 40 },
    },
  };

  const compliance = buildComplianceReport({ report, wcagBefore, wcagAfter });

  assert.equal(compliance.severity.before.critical, 1);
  assert.equal(compliance.severity.before.serious, 1);
  assert.equal(compliance.severity.before.moderate, 1);
  assert.equal(compliance.severity.before.total, 3);
  assert.equal(compliance.severity.after.total, 1);

  assert.ok(compliance.score.afterScore > compliance.score.beforeScore);
  assert.equal(compliance.score.overall, compliance.score.afterScore);
  assert.equal(compliance.score.methodology, "automated-wcag-2.1-aa-impact-weighted");
  assert.equal(compliance.score.automatedCoverageNote, AUTOMATED_COVERAGE_NOTE);
  assert.ok(["A", "B", "C", "D", "F"].includes(compliance.score.grade));
  assert.equal(compliance.score.pour.robust, 100);
  assert.ok(compliance.score.pour.perceivable < 100);

  // Prioritized critical -> serious -> moderate
  assert.deepEqual(
    compliance.issues.map((i) => i.impact),
    ["critical", "serious", "moderate"],
  );
  assert.equal(compliance.issues[0].status, "fixed");
  assert.deepEqual(compliance.issues[0].boundingBox, { x: 10, y: 20, width: 40, height: 40 });
  assert.equal(compliance.issues[0].htmlAfter, '<button aria-label="Tutup" class="btn-icon">...</button>');
  assert.equal(compliance.issues[1].status, "open");
  assert.equal(compliance.issues[1].htmlBefore.includes("onclick"), false);
  assert.ok(compliance.issues[1].titleId.length > 5);
  assert.ok(compliance.issues[1].helpId.length > 5);

  assert.equal(compliance.regulations.length, 6);
  assert.ok(compliance.regulations.some((r) => r.code === "UU-8-2016" && r.matchedIssues > 0));
});

test("caps normalized issues at 150 and sanitizes dangerous HTML", () => {
  const nodes = Array.from({ length: 180 }, (_, idx) => ({
    target: [`.item-${idx}`],
    html: `<a href="javascript:alert(1)" onerror="steal()">Link ${idx}</a>`,
  }));
  const wcagBefore = {
    violations: [{ id: "link-name", impact: "minor", tags: ["wcag244"], nodes }],
  };
  const compliance = buildComplianceReport({ report: {}, wcagBefore, wcagAfter: wcagBefore });

  assert.equal(compliance.issues.length, MAX_ISSUES);
  assert.equal(compliance.issues[0].htmlBefore.includes("javascript:"), false);
  assert.equal(compliance.issues[0].htmlBefore.includes("onerror"), false);
  assert.equal(sanitizeHtmlSnippet("<script>alert(1)</script>"), null);
});

function makePasses(count, { idPrefix = "rule-pass", tags = ["wcag2aa", "wcag143"] } = {}) {
  return Array.from({ length: count }, (_, idx) => ({
    id: `${idPrefix}-${idx}`,
    tags,
    nodes: [{ target: [`.pass-${idx}`] }],
  }));
}

test("calibrated scoring avoids crushing repeated template violations when passes are healthy", () => {
  const nodes20 = Array.from({ length: 20 }, (_, idx) => ({
    target: [`.card-${idx} .title`],
    html: `<span class="title">Card ${idx}</span>`,
  }));
  const wcag20 = {
    violations: [
      {
        id: "color-contrast",
        impact: "serious",
        tags: ["wcag2aa", "wcag143"],
        nodes: nodes20,
      },
    ],
    passes: makePasses(25),
  };

  const report20 = buildComplianceReport({ report: {}, wcagBefore: wcag20, wcagAfter: wcag20 });
  assert.ok(
    report20.score.overall >= 75,
    `Expected score >= 75 for 1 repeated serious rule + 25 passes, got ${report20.score.overall}`,
  );
  assert.ok(report20.score.pour.perceivable < 100);
  assert.equal(report20.score.pour.operable, 100);

  // Fixing partial nodes (20 -> 5) strictly increases score
  const wcag5 = {
    ...wcag20,
    violations: [
      {
        ...wcag20.violations[0],
        nodes: nodes20.slice(0, 5),
      },
    ],
  };
  const report5 = buildComplianceReport({ report: {}, wcagBefore: wcag20, wcagAfter: wcag5 });
  assert.ok(
    report5.score.afterScore > report20.score.beforeScore,
    `Expected partial fix (20 -> 5) to raise score (${report20.score.beforeScore} -> ${report5.score.afterScore})`,
  );
});

test("genuinely broken page with widespread critical and serious violations still scores F", () => {
  const makeNodes = (prefix, count) =>
    Array.from({ length: count }, (_, idx) => ({
      target: [`.${prefix}-${idx}`],
      html: `<div class="${prefix}-${idx}">broken</div>`,
    }));

  const brokenAxe = {
    violations: [
      { id: "button-name", impact: "critical", tags: ["wcag412"], nodes: makeNodes("btn", 4) },
      { id: "image-alt", impact: "critical", tags: ["wcag111"], nodes: makeNodes("img", 5) },
      { id: "label", impact: "critical", tags: ["wcag332"], nodes: makeNodes("lbl", 3) },
      { id: "frame-title", impact: "critical", tags: ["wcag412"], nodes: makeNodes("frm", 2) },
      { id: "nested-interactive", impact: "critical", tags: ["wcag412"], nodes: makeNodes("nst", 2) },
      { id: "color-contrast", impact: "serious", tags: ["wcag143"], nodes: makeNodes("clr", 8) },
      { id: "link-name", impact: "serious", tags: ["wcag244"], nodes: makeNodes("lnk", 4) },
      { id: "html-has-lang", impact: "serious", tags: ["wcag311"], nodes: makeNodes("lng", 1) },
      { id: "document-title", impact: "serious", tags: ["wcag242"], nodes: makeNodes("ttl", 1) },
    ],
    passes: makePasses(3),
  };

  const brokenReport = buildComplianceReport({
    report: {},
    wcagBefore: brokenAxe,
    wcagAfter: brokenAxe,
  });

  assert.ok(
    brokenReport.score.overall < 50,
    `Expected broken page score < 50, got ${brokenReport.score.overall}`,
  );
  assert.equal(brokenReport.score.grade, "F");
});

test("compliance.issues includes clean htmlAfter and status fixed for fixed color-contrast records", () => {
  const wcagBefore = {
    violations: [
      {
        id: "color-contrast",
        impact: "serious",
        tags: ["wcag2aa", "wcag143"],
        nodes: [
          {
            target: [".hero-subtitle"],
            html: '<p class="hero-subtitle" onclick="bad()">Subjudul</p>',
          },
        ],
      },
    ],
    passes: makePasses(10),
  };
  const wcagAfter = {
    violations: [],
    passes: makePasses(11),
  };
  const report = {
    fixed: [
      {
        rule: "color-contrast",
        selector: ".hero-subtitle",
        confidence: 0.92,
        source: "color-contrast-darken",
        patches: [{ attribute: "style", value: "color: #1e293b !important;" }],
        htmlAfter: '<p class="hero-subtitle" style="color: #1e293b !important;" onload="evil()">Subjudul</p>',
      },
    ],
  };

  const compliance = buildComplianceReport({ report, wcagBefore, wcagAfter });
  assert.equal(compliance.issues.length, 1);
  assert.equal(compliance.issues[0].ruleId, "color-contrast");
  assert.equal(compliance.issues[0].status, "fixed");
  assert.equal(compliance.issues[0].htmlBefore.includes("onclick"), false);
  assert.ok(compliance.issues[0].htmlAfter?.includes("#1e293b"));
  assert.equal(compliance.issues[0].htmlAfter.includes("onload"), false);
});
