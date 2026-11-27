import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (file) => fs.readFileSync(path.join(rootDir, file), "utf8");

function collectFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const homePage = read("src/app/page.tsx");
const periksaPage = read("src/app/periksa/page.tsx");
const katalogPage = read("src/app/katalog/page.tsx");
const resultPage = read("src/app/result/page.tsx");
const layoutFile = read("src/app/layout.tsx");
const motionProvider = read("src/components/MotionProvider.tsx");
const viewportBlur = read("src/components/ViewportBlur.tsx");
const apiClient = read("src/lib/audit-api.ts");
const demoAuditsFile = read("src/lib/demo-audits.ts");
const useAuditJobFile = read("src/hooks/useAuditJob.ts");
const telemetryPanel = read("src/components/result/LiveTelemetryPanel.tsx");
const scoreOverview = read("src/components/result/ScoreOverview.tsx");
const visualInspector = read("src/components/result/VisualInspector.tsx");
const issueExplorer = read("src/components/result/IssueExplorer.tsx");
const webReaderPanel = read("src/components/result/WebReaderPanel.tsx");
const resultWorkspace = read("src/components/result/ResultWorkspace.tsx");
const packageJson = JSON.parse(read("package.json"));

test("legacy fast engine and endpoint are gone", () => {
  assert.equal(fs.existsSync(path.join(rootDir, "src/app/api/process")), false);
  assert.equal(fs.existsSync(path.join(rootDir, "lib")), false);
  assert.equal(packageJson.dependencies.cheerio, undefined);
  assert.equal(packageJson.dependencies["sanitize-html"], undefined);
  assert.doesNotMatch(homePage, /mode cepat|api\/process/i);
});

test("frontend uses the four secured job endpoints and Wave 1 contracts", () => {
  assert.match(apiClient, /['"]\/audits['"]/);
  assert.match(apiClient, /\/audits\/cache\?url=/);
  assert.match(apiClient, /getAuditResult/);
  assert.match(apiClient, /method:\s*['"]DELETE['"]/);
  assert.match(apiClient, /authorization:\s*`Bearer/);

  for (const symbol of [
    "TelemetryStep",
    "AuditTelemetry",
    "AuditScore",
    "SeverityCounts",
    "RegulationReference",
    "AuditIssue",
    "TabStop",
    "PageReadiness",
    "previewUrl",
    "beforeScreenshot",
    "reportJson",
    "reportCsv",
  ]) {
    assert.ok(apiClient.includes(symbol), `Missing contract symbol ${symbol} in audit-api.ts`);
  }
  assert.match(apiClient, /path\.startsWith\(['"]\/data\/['"]\)/);
});

test("refresh resume keeps the secret out of the URL", () => {
  assert.match(useAuditJobFile, /saveJobToken/);
  assert.match(useAuditJobFile, /readJobToken/);
  assert.match(useAuditJobFile, /router\.replace\(`\/result\?job=/);
  assert.doesNotMatch(useAuditJobFile, /result\?job=.*accessToken/);
  assert.doesNotMatch(resultPage, /result\?job=.*accessToken/);
});

test("live telemetry is polled, cancellable, and renders progressbar + early preview", () => {
  assert.match(useAuditJobFile, /setTimeout\(poll,\s*800\)/);
  assert.match(useAuditJobFile, /loadResult/);
  assert.match(resultPage, /aria-live="polite"/);
  assert.match(resultPage, /Gunakan hasil tersimpan/);
  assert.match(resultPage, /Periksa ulang/);
  assert.match(telemetryPanel, /Batalkan pemeriksaan/);
  assert.match(telemetryPanel, /role="progressbar"/);
  assert.match(telemetryPanel, /aria-valuenow/);
  assert.match(telemetryPanel, /job\.previewUrl/);
  assert.match(telemetryPanel, /headingRef/);
});

test("source HTML is never injected and Wave 1 exports + inspector/reader tabs are present", () => {
  const srcFiles = collectFiles(path.join(rootDir, "src"), [".ts", ".tsx"]);
  for (const file of srcFiles) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /dangerouslySetInnerHTML/, `Found dangerouslySetInnerHTML in ${file}`);
  }

  assert.match(resultWorkspace, /Buka Web Reader/);
  assert.match(resultWorkspace, /Lihat Halaman Diperbaiki/);
  assert.match(resultWorkspace, /Unduh laporan PDF/);
  assert.match(resultWorkspace, /Unduh JSON/);
  assert.match(resultWorkspace, /Unduh CSV/);
  assert.match(resultWorkspace, /\(buka di tab baru\)/);
  assert.match(resultWorkspace, /role="tablist"/);

  assert.match(scoreOverview, /Skor/);
  assert.match(scoreOverview, /Mudah Dilihat/);
  assert.match(visualInspector, /role="tablist"/);
  assert.match(visualInspector, /Pin Temuan/);
  assert.match(visualInspector, /Alur Fokus Keyboard/);
  assert.match(visualInspector, /WCAG 2\.4\.7/);
  assert.match(visualInspector, /WCAG 2\.4\.11/);
  assert.match(issueExplorer, /DEFAULT_VISIBLE_COUNT\s*=\s*8/);
  assert.match(issueExplorer, /Salin Perbaikan/);
  assert.match(issueExplorer, /aria-live="polite"/);
  assert.match(webReaderPanel, /DOMParser/);
  assert.match(webReaderPanel, /speechSynthesis/);
  assert.match(webReaderPanel, /id-ID/);
  assert.match(webReaderPanel, /en-US/);
  assert.match(webReaderPanel, /showModal/);
});

test("instant demo route and static demo fixtures align with AuditResult contract", () => {
  assert.match(useAuditJobFile, /params\.get\("demo"\)/);
  assert.match(useAuditJobFile, /getDemoAudit/);
  assert.match(homePage, /\/result\?demo=/);
  assert.match(periksaPage, /\/result\?demo=/);
  assert.match(demoAuditsFile, /pemprov-sulsel-demo/);
  assert.match(demoAuditsFile, /portal-akademik-demo/);

  for (const slug of ["pemprov-sulsel-demo", "portal-akademik-demo"]) {
    const raw = read(`public/data/demo/${slug}.json`);
    const parsed = JSON.parse(raw);

    assert.equal(parsed.job?.status, "completed");
    assert.ok(parsed.result?.snapshot?.score, `${slug} missing score`);
    assert.ok(parsed.result?.snapshot?.severity?.before, `${slug} missing severity.before`);
    assert.ok(parsed.result?.snapshot?.severity?.after, `${slug} missing severity.after`);
    assert.ok(Array.isArray(parsed.result?.snapshot?.regulations), `${slug} missing regulations`);
    assert.ok(Array.isArray(parsed.result?.snapshot?.issues) && parsed.result.snapshot.issues.length > 0, `${slug} missing issues`);
    assert.ok(Array.isArray(parsed.result?.snapshot?.tabStops) && parsed.result.snapshot.tabStops.length > 0, `${slug} missing tabStops`);
    assert.ok(parsed.result?.snapshot?.readiness, `${slug} missing readiness`);

    for (const key of ["reader", "patched", "reportPdf", "screenshot", "beforeScreenshot", "reportJson", "reportCsv"]) {
      const link = parsed.links?.[key];
      assert.ok(typeof link === "string" && link.startsWith("/data/demo/"), `${slug} missing demo link ${key}`);
      const diskPath = path.join(rootDir, "public", link.replace(/^\//, ""));
      assert.equal(fs.existsSync(diskPath), true, `Referenced demo asset missing: ${diskPath}`);
    }
  }
});

test("dogfooding accessibility and legal compliance guardrails hold", () => {
  assert.match(layoutFile, /<MotionProvider>/);
  assert.match(motionProvider, /MotionConfig\s+reducedMotion="user"/);

  // HeroCarousel respects prefers-reduced-motion, marks clones aria-hidden, and has NO stop/pause button
  assert.match(homePage, /prefers-reduced-motion:\s*reduce/);
  assert.match(homePage, /aria-hidden=\{isClone \? "true" : undefined\}/);
  assert.doesNotMatch(homePage, /Jeda|Pause|Hentikan carousel/i);

  // ViewportBlur avoids obscuring focused keyboard elements
  assert.match(viewportBlur, /:focus-visible/);
  assert.match(viewportBlur, /pausedForFocus/);

  // /periksa, /katalog, /result accessibility contracts
  assert.match(periksaPage, /<h1 id="audit-title">/);
  assert.match(periksaPage, /aria-describedby/);
  assert.match(periksaPage, /aria-invalid/);
  assert.match(periksaPage, /role="alert"/);

  assert.match(katalogPage, /role="alertdialog"/);
  assert.match(katalogPage, /cancelButtonRef\.current\?\.focus/);
  assert.match(resultPage, /role="alert"/);
  assert.match(resultPage, /phaseHeadingRef/);

  // Dead duplicate route folders removed
  assert.equal(fs.existsSync(path.join(rootDir, "src/app/about")), false);
  assert.equal(fs.existsSync(path.join(rootDir, "src/app/cara-kerja")), false);

  // Revoked Permen Kominfo No. 8/2021 never referenced in source or docs
  const scanRoots = [
    ...collectFiles(path.join(rootDir, "src"), [".ts", ".tsx", ".css"]),
    ...collectFiles(path.join(rootDir, "engine/src"), [".mjs", ".js"]),
    ...collectFiles(path.join(rootDir, "php-backend/app"), [".php"]),
    ...collectFiles(path.join(rootDir, "public/data/demo"), [".json", ".csv", ".html"]),
    path.join(rootDir, "README.md"),
    path.join(rootDir, "ROADMAP.md"),
  ];
  for (const file of scanRoots) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /permen\s*kominfo\s*no\.?\s*8|permenkominfo\s*no\.?\s*8/i, `Revoked regulation reference in ${file}`);
  }
});
