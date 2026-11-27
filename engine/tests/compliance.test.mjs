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
