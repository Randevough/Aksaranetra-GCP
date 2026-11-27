import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DISCLAIMER,
  FILE_NAMES,
  SNAPSHOT_FORMAT_VERSION,
  createSnapshot,
  readSnapshot,
  validateSnapshot,
  writeSnapshot,
} from "../src/snapshot/index.mjs";

function fakeReport(overrides = {}) {
  return {
    engineVersion: "0.1.4",
    page: {
      requestedUrl: "https://sulselprov.go.id",
      finalUrl: "https://sulselprov.go.id/",
      status: 200,
      title: "Beranda",
      testedAt: "2026-08-08T14:06:23.308Z",
    },
    siteConfig: { siteLabel: "Sulawesi Selatan", verifiedLabelCount: 2 },
    metrics: {
      rules: { "link-name": { before: 9, after: 2 } },
      beforeTotal: 20,
      afterTotal: 2,
      reduction: 18,
      reductionPercent: 90,
      strictImprovement: true,
      noRegression: true,
    },
    fixed: [{ source: "verified-override" }, { source: "recognized-icon" }],
    review: [],
    skipped: [{}, {}],
    rolledBack: false,
    wcagRegression: { clean: true, worsened: [] },
    duplicateLabels: [],
    staleOverrides: [],
    ...overrides,
  };
}

test("carries the four things the result screen has to show", () => {
  const snapshot = createSnapshot({
    id: "sulselprov",
    report: fakeReport(),
    patchedPage: "<html></html>",
    readerView: "<html></html>",
  });

  // 1 and 2: both views present. 3: link back to the real page.
  assert.equal(snapshot.views.patchedPage, "patched.html");
  assert.equal(snapshot.views.readerView, "reader.html");
  assert.equal(snapshot.source.requestedUrl, "https://sulselprov.go.id");

  // 4: the before and after numbers.
  assert.equal(snapshot.summary.beforeTotal, 20);
  assert.equal(snapshot.summary.afterTotal, 2);
  assert.equal(snapshot.summary.reductionPercent, 90);

  assert.equal(validateSnapshot(snapshot).ok, true);
});

test("keeps the disclaimer in the data, not in the frontend", () => {
  const snapshot = createSnapshot({ id: "x", report: fakeReport() });

  // If a page ever forgets to render it, that is a bug we can catch here
  // rather than something a judge notices first.
  assert.equal(snapshot.disclaimer, DISCLAIMER);
  assert.match(snapshot.disclaimer, /tidak mengubah situs asli/);
});

test("refuses to look ready when a view has not been built yet", () => {
  const snapshot = createSnapshot({ id: "x", report: fakeReport() });

  // Missing views must be null so the frontend hides the button instead of
  // showing a broken link.
  assert.equal(snapshot.views.patchedPage, null);
  assert.equal(snapshot.views.readerView, null);

  const verdict = validateSnapshot(snapshot);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.missing, ["views.patchedPage", "views.readerView"]);
});

test("counts human verified labels apart from the rest", () => {
  const snapshot = createSnapshot({ id: "x", report: fakeReport() });

  assert.equal(snapshot.counts.fixed, 2);
  assert.equal(snapshot.counts.verifiedOverrides, 1);
  assert.equal(snapshot.counts.skipped, 2);
});

test("passes on every warning instead of quietly dropping it", () => {
  const snapshot = createSnapshot({
    id: "x",
    report: fakeReport({
      rolledBack: true,
      wcagRegression: {
        clean: false,
        worsened: [{ ruleId: "aria-allowed-attr", before: 0, after: 3, delta: 3 }],
      },
      duplicateLabels: [{ label: "Konten berikutnya", count: 2 }],
      staleOverrides: [".hilang"],
    }),
  });

  assert.equal(snapshot.warnings.rolledBack, true);
  assert.equal(snapshot.warnings.wcagRegressionClean, false);
  assert.equal(snapshot.warnings.worsenedRules.length, 1);
  assert.equal(snapshot.warnings.duplicateLabels.length, 1);
  assert.deepEqual(snapshot.warnings.staleOverrides, [".hilang"]);
});

test("rejects a report with no page address", () => {
  assert.throws(() => createSnapshot({ id: "x", report: {} }), /requestedUrl/);
});

test("writes a folder that can be read back unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aksara-"));
  const report = fakeReport();
  const snapshot = createSnapshot({
    id: "sulselprov",
    report,
    patchedPage: "<html>patched</html>",
    readerView: "<html>reader</html>",
  });

  writeSnapshot({
    dir,
    snapshot,
    report,
    patchedPage: "<html>patched</html>",
    readerView: "<html>reader</html>",
    artifacts: { wcagBefore: { violations: [] }, ariaSnapshot: "- banner" },
  });

  const loaded = readSnapshot(dir);
  assert.deepEqual(loaded, snapshot);
  assert.equal(loaded.formatVersion, SNAPSHOT_FORMAT_VERSION);

  assert.equal(fs.existsSync(path.join(dir, "engine-result.json")), true);
  assert.equal(fs.existsSync(path.join(dir, "patched.html")), true);
  assert.equal(fs.existsSync(path.join(dir, "reader.html")), true);
  assert.equal(fs.existsSync(path.join(dir, "aria-after.yml")), true);

  // Nothing was captured, so nothing should be invented on disk.
  assert.equal(fs.existsSync(path.join(dir, "after.png")), false);

  assert.equal(readSnapshot(path.join(dir, "kosong")), null);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("includes extended contract fields, readiness, tabStops, and before.png output", () => {
  assert.equal(FILE_NAMES.beforeScreenshot, "before.png");
  assert.equal(FILE_NAMES.reportJson, "report.json");
  assert.equal(FILE_NAMES.reportCsv, "report.csv");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aksara-ext-"));
  const report = fakeReport({
    rolledBack: true,
    rolledBackRecords: [{ rule: "button-name", selector: ".x", htmlAfter: "<script>" }],
    readiness: {
      waitStrategy: "smart-readiness-gate",
      hydrationAllowed: true,
      loadTimeMs: 420,
      settledAfterMs: 900,
      domElements: 42,
      partialLoad: false,
      possibleEmptyShell: true,
      viewport: { width: 1440, height: 1000 },
      pageHeight: 1800,
    },
    tabStops: [
      {
        index: 1,
        selector: "a.skip",
        tag: "a",
        role: "link",
        label: "Lewati",
        rect: { x: 10, y: 10, width: 100, height: 30 },
        obscured: false,
        hasVisibleFocus: true,
      },
    ],
    warnings: { partialLoad: "Partial timeout" },
  });

  const snapshot = createSnapshot({
    id: "ext",
    report,
    patchedPage: "<html></html>",
    readerView: "<html></html>",
  });

  assert.equal(snapshot.counts.rolledBack, 1);
  assert.equal(snapshot.warnings.rolledBackRecords.length, 1);
  assert.equal("htmlAfter" in snapshot.warnings.rolledBackRecords[0], false);
  assert.equal(snapshot.warnings.partialLoad, "Partial timeout");
  assert.equal(snapshot.warnings.possibleEmptyShell, true);
  assert.equal(snapshot.readiness.domElements, 42);
  assert.equal(snapshot.tabStops.length, 1);
  assert.equal(snapshot.files.beforeScreenshot, "before.png");
  assert.equal(snapshot.files.reportJson, "report.json");
  assert.equal(snapshot.files.reportCsv, "report.csv");

  writeSnapshot({
    dir,
    snapshot,
    report,
    patchedPage: "<html></html>",
    readerView: "<html></html>",
    artifacts: { beforeScreenshot: Buffer.from("png-before") },
  });

  assert.equal(fs.existsSync(path.join(dir, "before.png")), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
