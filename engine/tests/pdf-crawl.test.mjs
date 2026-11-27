import { test } from "node:test";
import assert from "node:assert/strict";

import { auditDiscoveredPdfs } from "../src/pdf/index.mjs";
import {
  extractReadableBlocksFromHtml,
  wrapPatchedPage,
} from "../src/serializer/index.mjs";
import { READER_STYLES, renderReaderDocument } from "../src/serializer/reader.mjs";
import { DISCLAIMER } from "../src/snapshot/index.mjs";
import {
  buildIssueClusters,
  normalizeCrawlOptions,
  normalizeSelectorSignature,
} from "../src/api/crawl.mjs";
import { auditUrl } from "../src/api/index.mjs";

function buildMinimalValidPdfBytes(text = "Dokumen Publik Aksara Netra") {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${26 + text.length} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += obj;
  }

  const xrefStart = Buffer.byteLength(body, "utf8");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body + xref + trailer, "utf8"));
}

test("rejects private, local, cross-origin, and private-DNS PDF URLs before fetching", async () => {
  const fetchedUrls = [];

  const report = await auditDiscoveredPdfs({
    baseUrl: "https://contoh.go.id/layanan",
    pdfUrls: [
      "http://127.0.0.1/internal.pdf",
      "http://localhost/admin.pdf",
      "http://169.254.169.254/latest/meta-data/secret.pdf",
      "https://evil.example.org/phish.pdf",
      "https://rebind.contoh.go.id/doc.pdf",
      "https://contoh.go.id/private-dns.pdf",
    ],
    deps: {
      resolveHost: async (hostname) => {
        if (hostname === "contoh.go.id") return ["93.184.216.34", "10.0.0.5"];
        return ["93.184.216.34"];
      },
      fetchPdf: async ({ url }) => {
        fetchedUrls.push(url);
        return new Uint8Array([1, 2, 3]);
      },
    },
  });

  assert.deepEqual(fetchedUrls, []);
  assert.equal(report.discoveredCount, 6);
  assert.equal(report.auditedCount, 0);
  assert.equal(report.items.length, 5); // default maxPdfs = 5
  assert.ok(report.items.every((item) => item.status === "error"));
  assert.ok(report.items.every((item) => typeof item.error === "string" && item.error.length > 0));
});

test("classifies scanned-image-only, untagged, and accessible-basics PDFs and always calls destroy()", async () => {
  const destroyed = [];

  const makeMockDoc = (id, { pages = 7, marked = false, hasStruct = false, text = "", title = "", lang = "", throwOnPage = false }) => ({
    numPages: pages,
    getMarkInfo: async () => (marked ? { Marked: true } : null),
    getMetadata: async () => ({
      info: { Title: title, Language: lang },
      metadata: null,
    }),
    getPage: async (pageNum) => {
      if (throwOnPage && pageNum === 2) {
        throw new Error("corrupt page stream");
      }
      return {
        getStructTree: async () => (hasStruct ? { role: "Root", children: [{ role: "P" }] } : null),
        getTextContent: async () => ({
          items: text ? [{ str: text }] : [],
        }),
        cleanup: () => {},
      };
    },
    destroy: async () => {
      destroyed.push(id);
    },
  });

  const report = await auditDiscoveredPdfs({
    baseUrl: "https://contoh.go.id/",
    pdfUrls: [
      "https://contoh.go.id/scanned.pdf",
      "https://contoh.go.id/untagged.pdf",
      "https://contoh.go.id/tagged.pdf",
      "https://contoh.go.id/broken.pdf",
    ],
    deps: {
      resolveHost: async () => ["93.184.216.34"],
      fetchPdf: async ({ url }) => new Uint8Array(Buffer.from(url)),
      getDocument: ({ data }) => {
        const key = Buffer.from(data).toString("utf8");
        if (key.endsWith("scanned.pdf")) {
          return { promise: Promise.resolve(makeMockDoc("scanned", { pages: 8, marked: false, text: "" })) };
        }
        if (key.endsWith("untagged.pdf")) {
          return { promise: Promise.resolve(makeMockDoc("untagged", { pages: 2, marked: false, text: "Pengumuman Resmi" })) };
        }
        if (key.endsWith("tagged.pdf")) {
          return {
            promise: Promise.resolve(
              makeMockDoc("tagged", {
                pages: 2,
                marked: true,
                hasStruct: true,
                text: "Laporan Tahunan",
                title: "Laporan Tahunan 2026",
                lang: "id",
              }),
            ),
          };
        }
        return {
          promise: Promise.resolve(
            makeMockDoc("broken", { pages: 3, text: "Halaman 1", throwOnPage: true }),
          ),
        };
      },
    },
  });

  assert.equal(report.discoveredCount, 4);
  assert.equal(report.auditedCount, 3);
  assert.equal(report.scannedImageCount, 1);
  assert.equal(report.untaggedCount, 2); // scanned + untagged both lack tags

  const [scanned, untagged, tagged, broken] = report.items;
  assert.equal(scanned.status, "scanned-image-only");
  assert.equal(scanned.hasTextLayer, false);
  assert.equal(scanned.isTagged, false);

  assert.equal(untagged.status, "untagged");
  assert.equal(untagged.hasTextLayer, true);
  assert.equal(untagged.isTagged, false);

  assert.equal(tagged.status, "accessible-basics");
  assert.equal(tagged.hasTextLayer, true);
  assert.equal(tagged.isTagged, true);
  assert.equal(tagged.hasTitle, true);
  assert.equal(tagged.hasLang, true);

  assert.equal(broken.status, "error");
  assert.match(broken.error, /corrupt page stream/);

  // Every opened PDF document must be destroyed in finally, including errors.
  assert.deepEqual(destroyed, ["scanned", "untagged", "tagged", "broken"]);
});

test("runs real pdfjs-dist parser end-to-end on valid PDF bytes and cleans up worker", async () => {
  const pdfBytes = buildMinimalValidPdfBytes("Aksara Netra PDF Audit");

  const report = await auditDiscoveredPdfs({
    baseUrl: "https://contoh.go.id/",
    pdfUrls: ["https://contoh.go.id/files/pengumuman.pdf"],
    deps: {
      resolveHost: async () => ["93.184.216.34"],
      fetchPdf: async () => pdfBytes,
    },
  });

  assert.equal(report.discoveredCount, 1);
  assert.equal(report.auditedCount, 1);
  assert.equal(report.items[0].filename, "pengumuman.pdf");
  assert.equal(report.items[0].pageCount, 1);
  assert.equal(report.items[0].hasTextLayer, true);
  assert.equal(report.items[0].isTagged, false);
  assert.equal(report.items[0].status, "untagged");
});

test("Readability isolates article content and preserves table, blockquote, pre, and figcaption safely", () => {
  const noisyHtml = `<!DOCTYPE html>
  <html lang="id">
    <head><title>Portal Berita Daerah</title></head>
    <body>
      <header>
        <nav><a href="/beranda">Beranda</a><a href="/profil">Profil</a></nav>
      </header>
      <aside class="sidebar">
        <p>Banner Iklan Samping</p>
        <script>alert("xss")</script>
      </aside>
      <main>
        <article>
          <h1>Jadwal Layanan Kependudukan</h1>
          <p>Dinas Kependudukan dan Pencatatan Sipil membuka layanan terpadu bagi seluruh warga untuk mengurus dokumen kependudukan secara cepat, transparan, dan tanpa pungutan biaya tambahan.</p>
          <p>Pemohon disarankan membawa berkas asli beserta salinan dokumen pendukung sesuai tabel jadwal dan ketentuan resmi yang tercantum pada pengumuman ini agar proses verifikasi berjalan lancar.</p>
          <table>
            <caption>Jadwal Loket</caption>
            <thead><tr><th>Hari</th><th>Jam</th></tr></thead>
            <tbody><tr><td>Senin</td><td>08.00 - 15.00</td></tr></tbody>
          </table>
          <blockquote cite="https://contoh.go.id/perda">Pelayanan publik harus inklusif bagi penyandang disabilitas.<cite>Kepala Dinas</cite></blockquote>
          <pre><code>curl -s https://contoh.go.id/api/status &amp;&amp; echo "<script>bad()</script>"</code></pre>
          <figure>
            <img src="/foto/loket.jpg" alt="Loket layanan terpadu">
            <figcaption>Suasana ruang tunggu ramah disabilitas.</figcaption>
          </figure>
          <p><a href="javascript:alert(1)">Tautan Berbahaya</a></p>
        </article>
      </main>
    </body>
  </html>`;

  const extracted = extractReadableBlocksFromHtml(noisyHtml, "https://contoh.go.id/berita/jadwal");
  const types = extracted.blocks.map((b) => b.type);

  assert.ok(types.includes("table"), "must preserve table block");
  assert.ok(types.includes("blockquote"), "must preserve blockquote block");
  assert.ok(types.includes("code"), "must preserve pre/code block");

  const imgBlock = extracted.blocks.find((b) => b.type === "image");
  const hasCaption =
    Boolean(imgBlock?.caption?.includes("Suasana ruang tunggu")) ||
    extracted.blocks.some((b) => b.type === "figcaption" && b.text.includes("Suasana ruang tunggu"));
  assert.equal(hasCaption, true, "must preserve figcaption");

  const html = renderReaderDocument({
    title: extracted.title || "Jadwal Layanan",
    lang: "id",
    sourceUrl: "https://contoh.go.id/berita/jadwal",
    disclaimer: DISCLAIMER,
    blocks: extracted.blocks,
  });

  assert.match(html, /<div class="table-wrap" tabindex="0" role="region" aria-label="Jadwal Loket"><table>/);
  assert.match(html, /<th scope="col">Hari<\/th>/);
  assert.match(html, /<blockquote><p>Pelayanan publik harus inklusif/);
  assert.match(html, /<pre><code>/);
  assert.match(html, /<figcaption>Suasana ruang tunggu ramah disabilitas\.<\/figcaption>/);

  // Strict sanitization & WCAG 1.4.10 / 1.4.12 guarantees
  assert.equal(/<script/i.test(html), false);
  assert.equal(/javascript:/i.test(html), false);
  assert.equal(/\son[a-z]+\s*=/i.test(html), false);
  assert.equal(/height:\s*\d+px/.test(READER_STYLES), false);
  assert.equal(/max-width:\s*\d+px/.test(READER_STYLES), false);

  const patched = wrapPatchedPage({
    html: "<html><body><h1>Ok</h1></body></html>",
    disclaimer: DISCLAIMER,
    sourceUrl: "https://contoh.go.id/",
  });
  assert.match(patched, /Content-Security-Policy/);
});

test("clamps crawl options and groups recurring issues into clusters with blastRadiusPercent", () => {
  assert.deepEqual(normalizeCrawlOptions({ mode: "single", maxPages: 5 }), {
    mode: "single",
    requestedMaxPages: 1,
  });
  assert.deepEqual(normalizeCrawlOptions({ mode: "multi" }), {
    mode: "multi",
    requestedMaxPages: 3,
  });
  assert.deepEqual(normalizeCrawlOptions({ mode: "multi", maxPages: 12 }), {
    mode: "multi",
    requestedMaxPages: 5,
  });

  assert.equal(
    normalizeSelectorSignature("nav > ul > li:nth-child(3) > a#menu-12"),
    "nav > ul > li:nth-child(*) > a#menu-*",
  );

  const clusters = buildIssueClusters([
    {
      url: "https://contoh.go.id/",
      issues: [
        { ruleId: "link-name", impact: "serious", selector: "nav > li:nth-child(1) > a", titleId: "Tautan kosong" },
        { ruleId: "image-alt", impact: "critical", selector: "#hero-1 > img", titleId: "Gambar tanpa alt" },
      ],
    },
    {
      url: "https://contoh.go.id/profil",
      issues: [
        { ruleId: "link-name", impact: "serious", selector: "nav > li:nth-child(4) > a", titleId: "Tautan kosong" },
      ],
    },
  ]);

  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].ruleId, "link-name");
  assert.equal(clusters[0].occurrences, 2);
  assert.deepEqual(clusters[0].affectedPages, [
    "https://contoh.go.id/",
    "https://contoh.go.id/profil",
  ]);
  assert.equal(clusters[0].blastRadiusPercent, 100);

  assert.equal(clusters[1].ruleId, "image-alt");
  assert.equal(clusters[1].blastRadiusPercent, 50);
});

test("auditUrl runs multi-page crawl in same browser session and audits PDFs after browser closes", async () => {
  const timeline = [];
  const screenshotFlags = [];
  const guardTargets = [];
  const updates = [];

  const makePageReport = (pageUrl, title, beforeIssues, afterIssues) => ({
    report: {
      engineVersion: "0.3.0",
      enginesUsed: ["axe-core", "ibm-ace"],
      page: {
        requestedUrl: pageUrl,
        finalUrl: pageUrl,
        status: 200,
        title,
        testedAt: "2026-11-28T00:00:00.000Z",
      },
      siteConfig: { host: "contoh.go.id", matchedHost: null, configured: false, siteLabel: "Contoh" },
      metrics: {
        beforeTotal: beforeIssues.length,
        afterTotal: afterIssues.length,
        reduction: Math.max(0, beforeIssues.length - afterIssues.length),
        reductionPercent: 50,
        strictImprovement: true,
        noRegression: true,
        rules: {},
      },
      fixed: [],
      review: [],
      skipped: [],
    },
    siteConfig: { siteLabel: "Contoh" },
    artifacts: {
      wcagBefore: {
        violations: beforeIssues.map((item) => ({
          id: item.ruleId,
          impact: item.impact,
          nodes: [{ target: [item.selector], html: "<a></a>" }],
        })),
      },
      wcagAfter: {
        violations: afterIssues.map((item) => ({
          id: item.ruleId,
          impact: item.impact,
          nodes: [{ target: [item.selector], html: "<a></a>" }],
        })),
      },
    },
  });

  const result = await auditUrl({
    url: "https://contoh.go.id/",
    mode: "multi",
    maxPages: 3,
    history: new Map(),
    onProgress: (update) => updates.push(update),
    deps: {
      resolveHost: async () => ["93.184.216.34"],
      fetchRobots: async () => ({
        status: 200,
        text: "User-agent: *\nDisallow: /rahasia\n",
      }),
      withBrowser: async (task) => {
        timeline.push("openBrowser");
        try {
          return await task({
            page: {
              unrouteAll: async () => {
                timeline.push("unrouteAll");
              },
            },
          });
        } finally {
          timeline.push("closeBrowser");
        }
      },
      attachGuard: async ({ allowedDocumentUrl }) => {
        guardTargets.push(allowedDocumentUrl);
        timeline.push(`attachGuard:${allowedDocumentUrl}`);
        return { allowed: 5, blocked: 1, byType: {}, blockedHosts: [] };
      },
      discoverLinks: async (_page, currentUrl) => {
        if (currentUrl === "https://contoh.go.id/") {
          return {
            internalUrls: [
              "https://contoh.go.id/rahasia",
              "https://contoh.go.id/layanan",
              "https://contoh.go.id/berita",
            ],
            pdfUrls: ["https://contoh.go.id/dokumen/perda.pdf"],
          };
        }
        return { internalUrls: [], pdfUrls: [] };
      },
      auditPage: async ({ url, captureScreenshot = true }) => {
        timeline.push(`auditPage:${url}`);
        screenshotFlags.push({ url, captureScreenshot });
        if (url === "https://contoh.go.id/") {
          return makePageReport(
            url,
            "Beranda",
            [
              { ruleId: "link-name", impact: "serious", selector: "header > a.logo" },
              { ruleId: "image-alt", impact: "critical", selector: "main > img.banner" },
            ],
            [{ ruleId: "link-name", impact: "serious", selector: "header > a.logo" }],
          );
        }
        return makePageReport(
          url,
          url.endsWith("layanan") ? "Layanan" : "Berita",
          [{ ruleId: "link-name", impact: "serious", selector: "header > a.logo" }],
          [{ ruleId: "link-name", impact: "serious", selector: "header > a.logo" }],
        );
      },
      serializePage: async () => ({
        patchedPage: "<html><body>patched</body></html>",
        readerView: "<html><body>reader</body></html>",
        blockCount: 3,
      }),
      auditDiscoveredPdfs: async ({ pdfUrls }) => {
        timeline.push("auditDiscoveredPdfs");
        return {
          discoveredCount: pdfUrls.length,
          auditedCount: pdfUrls.length,
          scannedImageCount: 0,
          untaggedCount: 1,
          items: [
            {
              url: pdfUrls[0],
              filename: "perda.pdf",
              sizeBytes: 2048,
              pageCount: 2,
              isTagged: false,
              hasTextLayer: true,
              hasTitle: false,
              hasLang: false,
              status: "untagged",
              error: null,
            },
          ],
        };
      },
      sleep: async () => {},
    },
  });

  assert.equal(result.ok, true, result.message);

  // Single browser session; PDF audit runs strictly AFTER browser closes.
  assert.equal(timeline.filter((x) => x === "openBrowser").length, 1);
  assert.equal(timeline.filter((x) => x === "closeBrowser").length, 1);
  assert.ok(timeline.indexOf("auditDiscoveredPdfs") > timeline.indexOf("closeBrowser"));

  // Primary screenshot=true, secondary pages captureScreenshot=false
  assert.deepEqual(screenshotFlags, [
    { url: "https://contoh.go.id/", captureScreenshot: true },
    { url: "https://contoh.go.id/layanan", captureScreenshot: false },
    { url: "https://contoh.go.id/berita", captureScreenshot: false },
  ]);

  assert.deepEqual(guardTargets, [
    "https://contoh.go.id/",
    "https://contoh.go.id/layanan",
    "https://contoh.go.id/berita",
  ]);

  assert.equal(result.snapshot.multiPage.mode, "multi");
  assert.equal(result.snapshot.multiPage.requestedMaxPages, 3);
  assert.equal(result.snapshot.multiPage.crawledCount, 3);
  assert.equal(result.snapshot.multiPage.pages.length, 4); // 1 primary + 1 skipped + 2 completed
  assert.equal(result.snapshot.multiPage.pages[1].status, "skipped");

  assert.deepEqual(result.snapshot.enginesUsed, ["axe-core", "ibm-ace"]);
  assert.equal(result.snapshot.pdfAudit.auditedCount, 1);

  const linkCluster = result.snapshot.clusters.find((c) => c.ruleId === "link-name");
  assert.ok(linkCluster);
  assert.equal(linkCluster.blastRadiusPercent, 100);
  assert.equal(linkCluster.occurrences, 3);

  // Progress milestones remain monotonic
  assert.deepEqual(
    updates.map((u) => u.progress),
    [...updates.map((u) => u.progress)].sort((a, b) => a - b),
  );
});
