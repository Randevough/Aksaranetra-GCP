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
const globalsCss = read("src/app/globals.css");
const robotsFile = read("src/app/robots.ts");
const sitemapFile = read("src/app/sitemap.ts");
const resultLayoutFile = read("src/app/result/layout.tsx");
const katalogLayoutFile = read("src/app/katalog/layout.tsx");
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
const wave2Diagnostics = read("src/components/result/Wave2Diagnostics.tsx");
const guidedFastPass = read("src/components/result/GuidedFastPass.tsx");
const statementModal = read("src/components/result/StatementModal.tsx");
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
    assert.ok(Array.isArray(parsed.result?.snapshot?.enginesUsed) && parsed.result.snapshot.enginesUsed.length > 0, `${slug} missing enginesUsed`);
    assert.ok(parsed.result?.snapshot?.mobileAudit, `${slug} missing mobileAudit`);
    assert.ok(parsed.result?.snapshot?.pdfAudit, `${slug} missing pdfAudit`);
    assert.ok(parsed.result?.snapshot?.detectors, `${slug} missing detectors`);
    assert.ok(parsed.result?.snapshot?.multiPage, `${slug} missing multiPage`);
    assert.ok(Array.isArray(parsed.result?.snapshot?.clusters) && parsed.result.snapshot.clusters.length > 0, `${slug} missing clusters`);

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

test("Wave 2 performance, SEO, code splitting, and diagnostic UI contracts hold", () => {
  // Self-hosted font via next/font/google; no blocking Google Fonts CSS @import
  assert.match(layoutFile, /from\s+["']next\/font\/google["']/);
  assert.match(layoutFile, /Plus_Jakarta_Sans/);
  assert.doesNotMatch(globalsCss, /fonts\.googleapis\.com/i);

  // SEO robots, sitemap, and noindex guards for private/ephemeral routes
  assert.match(robotsFile, /allow:\s*\["\/",\s*"\/periksa"\]/);
  assert.match(robotsFile, /disallow:\s*\["\/result",\s*"\/katalog"\]/);
  assert.match(robotsFile, /sitemap:/);
  assert.match(sitemapFile, /MetadataRoute\.Sitemap/);
  assert.match(sitemapFile, /\/periksa/);
  assert.match(resultLayoutFile, /index:\s*false/);
  assert.match(katalogLayoutFile, /index:\s*false/);

  // Code splitting via next/dynamic in ResultWorkspace
  assert.match(resultWorkspace, /import\s+dynamic\s+from\s+["']next\/dynamic["']/);
  assert.match(resultWorkspace, /VisualInspector\s*=\s*dynamic\(/);
  assert.match(resultWorkspace, /IssueExplorer\s*=\s*dynamic\(/);
  assert.match(resultWorkspace, /WebReaderPanel\s*=\s*dynamic\(/);
  assert.match(resultWorkspace, /GuidedFastPass\s*=\s*dynamic\(/);
  assert.match(resultWorkspace, /StatementModal\s*=\s*dynamic\(/);
  assert.match(resultWorkspace, /ssr:\s*false/);

  // Wave 2 contract symbols in audit-api.ts
  for (const symbol of [
    "AuditMode",
    "MobileAudit",
    "PdfAuditReport",
    "DetectorFlags",
    "IssueCluster",
    "MultiPageSummary",
    "enginesUsed",
    "badgeUrl",
  ]) {
    assert.ok(apiClient.includes(symbol), `Missing Wave 2 contract symbol ${symbol} in audit-api.ts`);
  }

  // /periksa mode selector
  assert.match(periksaPage, /id="mode-single"/);
  assert.match(periksaPage, /id="mode-multi"/);
  assert.match(periksaPage, /name="audit-mode"/);
  assert.match(periksaPage, /mode=multi&pages=3/);

  // Wave 2 components: Wave2Diagnostics, GuidedFastPass, StatementModal
  assert.match(resultWorkspace, /<Wave2Diagnostics/);
  assert.match(resultWorkspace, /<GuidedFastPass/);
  assert.match(resultWorkspace, /<StatementModal/);

  assert.match(wave2Diagnostics, /Tampilan HP \(320px\)/);
  assert.match(wave2Diagnostics, /Dokumen PDF/);
  assert.match(wave2Diagnostics, /Overlay &amp; CAPTCHA/);
  assert.match(wave2Diagnostics, /Lintas Halaman/);
  assert.match(wave2Diagnostics, /aria-expanded/);
  assert.match(wave2Diagnostics, /aria-controls/);

  assert.match(guidedFastPass, /role="progressbar"/);
  assert.match(guidedFastPass, /aria-pressed/);
  assert.match(guidedFastPass, /Cek Manual Cepat/);

  assert.match(statementModal, /showModal/);
  assert.match(statementModal, /badgeUrl/);
  assert.match(statementModal, /AksaraNetra \(Skor Otomatis\)/);
  assert.match(statementModal, /Pernyataan Aksesibilitas/);
});

test("Neutral-First Precision design tokens exist in globals.css", () => {
  for (const token of [
    "--surface-card",
    "--border-hairline",
    "--radius-chip",
    "--dot-critical",
    "--ink-success",
  ]) {
    assert.ok(globalsCss.includes(token), `Missing precision token ${token} in src/app/globals.css`);
  }
});

test("custom Select primitive replaces native selects and preserves ARIA listbox contract", () => {
  const selectComponent = read("src/components/ui/Select.tsx");
  const selectCss = read("src/components/ui/Select.module.css");

  assert.match(selectComponent, /export interface SelectOption/);
  assert.match(selectComponent, /export interface SelectProps/);
  assert.match(selectComponent, /export default function Select/);
  assert.match(selectComponent, /role="combobox"/);
  assert.match(selectComponent, /aria-haspopup="listbox"/);
  assert.match(selectComponent, /role="listbox"/);
  assert.match(selectComponent, /role="option"/);
  assert.match(selectComponent, /aria-selected=/);
  assert.match(selectComponent, /pointerdown/);
  assert.doesNotMatch(selectComponent, /<select\b/);
  assert.doesNotMatch(selectCss, /border-left|border-inline-start/i);

  assert.match(issueExplorer, /from\s+["']@\/components\/ui\/Select["']/);
  assert.doesNotMatch(issueExplorer, /<select\b/);
  assert.match(webReaderPanel, /from\s+["']@\/components\/ui\/Select["']/);
  assert.doesNotMatch(webReaderPanel, /<select\b/);
});

test("result polish, score breakdown, 5-phase telemetry, and anti-slop craft contracts hold", () => {
  // Score breakdown disclosure in ScoreOverview
  assert.match(scoreOverview, /Cara hitung skor/);
  assert.match(scoreOverview, /aria-expanded=\{formulaOpen\}/);
  assert.match(scoreOverview, /aria-controls=\{formulaPanelId\}/);
  assert.match(scoreOverview, /100 × e\^\(-penalti \/ skala\)/);
  assert.match(scoreOverview, /skala = maks\(85, 65 \+ 2,5 × aturan lolos\)/);
  assert.match(scoreOverview, /Kritis \(-10\)/);
  assert.match(scoreOverview, /Serius \(-6\)/);
  assert.match(scoreOverview, /Sedang \(-3\)/);
  assert.match(scoreOverview, /Rendah \(-1\)/);
  assert.match(scoreOverview, /1 \+ 0,15 × log₂\(jumlah\)/);

  // Clean engine version formatting and zero "wave2" in demo JSON fixtures
  assert.match(resultWorkspace, /function formatEngineVersion/);
  for (const slug of ["pemprov-sulsel-demo", "portal-akademik-demo"]) {
    const raw = read(`public/data/demo/${slug}.json`);
    assert.doesNotMatch(raw, /wave2/i, `Found internal "wave2" tag in demo fixture ${slug}`);
  }

  // Global WCAG 2.2 focus on dashboard (no regulation block/filter in ScoreOverview/IssueExplorer, no enginesUsed chips in Wave2Diagnostics)
  assert.doesNotMatch(scoreOverview, /snapshot\.regulations/);
  assert.doesNotMatch(issueExplorer, /filter-regulation|regulationFilter/);
  assert.doesNotMatch(wave2Diagnostics, /enginesUsed/);

  // Unified split-pane diff frame in IssueExplorer
  assert.match(issueExplorer, /diffFrame/);
  const issueExplorerCss = read("src/components/result/IssueExplorer.module.css");
  assert.match(issueExplorerCss, /\.diffFrame\s*\{/);

  // LiveTelemetryPanel 5-phase stepper, <=3-item ticker, conditional network counters
  assert.match(telemetryPanel, /PHASE_DEFINITIONS/);
  assert.match(telemetryPanel, /selectTickerItems/);
  assert.match(telemetryPanel, /allowedCount > 0 \|\| blockedCount > 0/);

  // No colored border-left / border-inline-start in refactored CSS modules
  for (const cssPath of [
    "src/components/result/ScoreOverview.module.css",
    "src/components/result/IssueExplorer.module.css",
    "src/components/result/Wave2Diagnostics.module.css",
    "src/components/result/VisualInspector.module.css",
    "src/components/result/WebReaderPanel.module.css",
    "src/components/result/LiveTelemetryPanel.module.css",
    "src/app/result/page.module.css",
    "src/app/periksa/page.module.css",
    "src/components/ui/Select.module.css",
  ]) {
    const css = read(cssPath);
    assert.doesNotMatch(
      css,
      /border-left|border-inline-start/i,
      `Found prohibited left-accent border in ${cssPath}`,
    );
  }

  // No middle-dot metadata separators in refactored /result components
  for (const tsxPath of [
    "src/components/result/ResultWorkspace.tsx",
    "src/components/result/ScoreOverview.tsx",
    "src/components/result/IssueExplorer.tsx",
    "src/components/result/Wave2Diagnostics.tsx",
    "src/components/result/VisualInspector.tsx",
    "src/components/result/WebReaderPanel.tsx",
    "src/components/result/LiveTelemetryPanel.tsx",
  ]) {
    const tsx = read(tsxPath);
    assert.doesNotMatch(
      tsx,
      /\u00b7|&middot;/,
      `Found middle-dot metadata separator in ${tsxPath}`,
    );
  }

  // /periksa widened form panel
  const periksaCss = read("src/app/periksa/page.module.css");
  assert.match(periksaCss, /max-width:\s*6(?:40|50|60|70|80)px/);
});
