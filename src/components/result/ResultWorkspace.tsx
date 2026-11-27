"use client";

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import type { AuditResult, ImpactLevel, Snapshot } from "@/lib/audit-api";
import { artifactUrl } from "@/lib/audit-api";
import { DEMO_AUDITS } from "@/lib/demo-audits";
import ScoreOverview from "./ScoreOverview";
import VisualInspector from "./VisualInspector";
import IssueExplorer from "./IssueExplorer";
import WebReaderPanel from "./WebReaderPanel";
import styles from "@/app/result/page.module.css";

type WorkspaceTab = "visual" | "issues" | "reader";

const BULAN = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function waktu(iso?: string | null) {
  if (!iso) return "Belum tercatat";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Belum tercatat";
  return `${date.getDate()} ${BULAN[date.getMonth()]} ${date.getFullYear()}, ${String(date.getHours()).padStart(2, "0")}.${String(date.getMinutes()).padStart(2, "0")}`;
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function triggerClientDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

function buildFallbackCsv(snapshot: Snapshot) {
  const rows = [
    ["Rule_ID", "Severity", "Status", "POUR", "WCAG_SC", "Regulations", "Selector", "Title_ID"],
  ];
  if (snapshot.issues && snapshot.issues.length > 0) {
    for (const item of snapshot.issues) {
      rows.push([
        item.ruleId,
        item.impact,
        item.status,
        item.pour,
        item.wcagSc.join(";"),
        item.regulations.join(";"),
        item.selector,
        item.titleId,
      ]);
    }
  } else {
    for (const [rule, val] of Object.entries(snapshot.rules)) {
      rows.push([
        rule,
        "",
        `before:${count(val.before)};after:${count(val.after)}`,
        "",
        "",
        "",
        "",
        rule,
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export default function ResultWorkspace({
  data,
  isDemo = false,
  headingRef,
}: {
  data: AuditResult;
  isDemo?: boolean;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
}) {
  const snapshot = data.result.snapshot;
  const issuesCount = snapshot.issues?.length ?? count(snapshot.summary.beforeTotal);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("visual");
  const [severityFilter, setSeverityFilter] = useState<ImpactLevel | "all">("all");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    snapshot.issues?.[0]?.id ?? null,
  );

  const localHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const resolvedHeadingRef = headingRef ?? localHeadingRef;

  const tabRefs = useRef<Record<WorkspaceTab, HTMLButtonElement | null>>({
    visual: null,
    issues: null,
    reader: null,
  });

  const readerHref = artifactUrl(data.links.reader);
  const patchedHref = artifactUrl(data.links.patched);
  const reportPdfHref = artifactUrl(data.links.reportPdf);
  const afterScreenshotHref = artifactUrl(data.links.screenshot);
  const beforeScreenshotHref = data.links.beforeScreenshot
    ? artifactUrl(data.links.beforeScreenshot)
    : data.job.previewUrl
      ? artifactUrl(data.job.previewUrl)
      : null;
  const reportJsonHref = data.links.reportJson
    ? artifactUrl(data.links.reportJson)
    : null;
  const reportCsvHref = data.links.reportCsv
    ? artifactUrl(data.links.reportCsv)
    : null;

  const switchToTab = useCallback((tab: WorkspaceTab, focusTab = false) => {
    setActiveTab(tab);
    if (focusTab) {
      requestAnimationFrame(() => {
        const el = tabRefs.current[tab];
        el?.focus();
        el?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    }
  }, []);

  const handleOpenWebReader = useCallback(() => {
    switchToTab("reader");
    requestAnimationFrame(() => {
      const el = document.getElementById("workspace-tabs");
      if (el) {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      }
    });
  }, [switchToTab]);

  const handleSelectSeverity = useCallback(
    (severity: ImpactLevel) => {
      setSeverityFilter((curr) =>
        curr === severity && activeTab === "issues" ? "all" : severity,
      );
      setActiveTab("issues");
      requestAnimationFrame(() => {
        const el = document.getElementById("workspace-tabs");
        if (el) {
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        }
      });
    },
    [activeTab],
  );

  const handleJumpToIssue = useCallback((issueId: string) => {
    setSeverityFilter("all");
    setSelectedIssueId(issueId);
    setActiveTab("issues");
    setTimeout(() => {
      const card = document.getElementById(`issue-card-${issueId}`);
      if (card) {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        card.scrollIntoView({
          behavior: reduced ? "auto" : "smooth",
          block: "center",
        });
      }
    }, 60);
  }, []);

  const tabOrder: WorkspaceTab[] = ["visual", "issues", "reader"];
  const handleWorkspaceTabKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    current: WorkspaceTab,
  ) => {
    const idx = tabOrder.indexOf(current);
    let nextIdx = -1;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabOrder.length;
    else if (e.key === "ArrowLeft")
      nextIdx = (idx - 1 + tabOrder.length) % tabOrder.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = tabOrder.length - 1;

    if (nextIdx !== -1) {
      e.preventDefault();
      switchToTab(tabOrder[nextIdx], true);
    }
  };

  const recheckHref = `/result?url=${encodeURIComponent(snapshot.source.finalUrl || snapshot.source.requestedUrl)}`;

  return (
    <main className={styles.resultContainer}>
      {isDemo && (
        <div className={styles.demoSwitcher} aria-label="Pilihan data demo">
          <span>Mode Demo:</span>
          <div className={styles.demoPills}>
            {DEMO_AUDITS.map((preset) => (
              <Link
                key={preset.slug}
                href={`/result?demo=${encodeURIComponent(preset.slug)}`}
                className={styles.demoPillLink}
              >
                {preset.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <header className={styles.compactHeader}>
        <div className={styles.headerMain}>
          <div className={styles.headerMetaRow}>
            <span className={styles.statusPill}>Pemeriksaan selesai</span>
            <span className={styles.timestamp}>
              {waktu(snapshot.capturedAt)} · v{snapshot.engineVersion}
            </span>
          </div>

          <h1 ref={resolvedHeadingRef} tabIndex={-1}>
            {snapshot.source.title || "Hasil pemeriksaan halaman"}
          </h1>

          <p className={styles.source}>
            <a
              href={snapshot.source.finalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {snapshot.source.finalUrl}
              <span className="sr-only"> (buka di tab baru)</span>
            </a>
          </p>

          <p className={styles.disclaimerFootnote}>
            {isDemo
              ? "Simulasi statis AksaraNetra. Situs asli tidak diubah."
              : "Tampilan pemeriksaan AksaraNetra. Situs asli tidak diubah."}
          </p>
        </div>

        <div className={styles.actionBar}>
          <div className={styles.actionPrimaryGroup}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleOpenWebReader}
            >
              Buka Web Reader
              <span className="sr-only"> (Buka versi ramah akses)</span>
            </button>

            <a
              className="btn btn-secondary"
              href={patchedHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              Lihat Halaman Diperbaiki
              <span className="sr-only"> (Lihat halaman setelah perbaikan, buka di tab baru)</span>
            </a>
          </div>

          <div className={styles.actionSecondaryGroup}>
            <div className={styles.exportGroup} role="group" aria-label="Ekspor laporan">
              <span className={styles.exportLabel}>Ekspor:</span>
              <a
                className={styles.compactActionBtn}
                href={reportPdfHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Unduh laporan PDF (buka di tab baru)"
              >
                PDF
                <span className="sr-only"> (buka di tab baru)</span>
              </a>

              {reportJsonHref ? (
                <a
                  className={styles.compactActionBtn}
                  href={reportJsonHref}
                  download={`aksaranetra-${data.job.jobId}.json`}
                  aria-label="Export JSON"
                >
                  JSON
                </a>
              ) : (
                <button
                  type="button"
                  className={styles.compactActionBtn}
                  aria-label="Export JSON"
                  onClick={() =>
                    triggerClientDownload(
                      `aksaranetra-${data.job.jobId}.json`,
                      JSON.stringify(data, null, 2),
                      "application/json",
                    )
                  }
                >
                  JSON
                </button>
              )}

              {reportCsvHref ? (
                <a
                  className={styles.compactActionBtn}
                  href={reportCsvHref}
                  download={`aksaranetra-${data.job.jobId}.csv`}
                  aria-label="Export CSV"
                >
                  CSV
                </a>
              ) : (
                <button
                  type="button"
                  className={styles.compactActionBtn}
                  aria-label="Export CSV"
                  onClick={() =>
                    triggerClientDownload(
                      `aksaranetra-${data.job.jobId}.csv`,
                      buildFallbackCsv(snapshot),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  CSV
                </button>
              )}
            </div>

            <div className={styles.navActions}>
              <Link href={recheckHref} className={styles.compactActionBtn}>
                Periksa ulang
              </Link>
              <Link href="/periksa" className={styles.compactActionBtn}>
                Periksa halaman lain
              </Link>
            </div>
          </div>
        </div>
      </header>

      <ScoreOverview
        snapshot={snapshot}
        activeSeverity={activeTab === "issues" ? severityFilter : "all"}
        onSelectSeverity={handleSelectSeverity}
      />

      <section
        id="workspace-tabs"
        className={styles.workspaceSection}
        aria-label="Ruang kerja hasil pemeriksaan"
      >
        <div
          role="tablist"
          aria-label="Tampilan detail hasil pemeriksaan"
          className={styles.workspaceTabList}
        >
          <button
            ref={(el) => {
              tabRefs.current.visual = el;
            }}
            id="workspace-tab-visual"
            type="button"
            role="tab"
            aria-selected={activeTab === "visual"}
            tabIndex={activeTab === "visual" ? 0 : -1}
            className={styles.workspaceTabBtn}
            onClick={() => switchToTab("visual")}
            onKeyDown={(e) => handleWorkspaceTabKeyDown(e, "visual")}
          >
            Inspeksi Visual
          </button>

          <button
            ref={(el) => {
              tabRefs.current.issues = el;
            }}
            id="workspace-tab-issues"
            type="button"
            role="tab"
            aria-selected={activeTab === "issues"}
            tabIndex={activeTab === "issues" ? 0 : -1}
            className={styles.workspaceTabBtn}
            onClick={() => switchToTab("issues")}
            onKeyDown={(e) => handleWorkspaceTabKeyDown(e, "issues")}
          >
            Daftar Temuan ({issuesCount})
          </button>

          <button
            ref={(el) => {
              tabRefs.current.reader = el;
            }}
            id="workspace-tab-reader"
            type="button"
            role="tab"
            aria-selected={activeTab === "reader"}
            tabIndex={activeTab === "reader" ? 0 : -1}
            className={styles.workspaceTabBtn}
            onClick={() => switchToTab("reader")}
            onKeyDown={(e) => handleWorkspaceTabKeyDown(e, "reader")}
          >
            Web Reader
          </button>
        </div>

        <div
          role="tabpanel"
          aria-labelledby="workspace-tab-visual"
          hidden={activeTab !== "visual"}
        >
          <div className={styles.workspacePanel}>
            <VisualInspector
              beforeUrl={beforeScreenshotHref}
              afterUrl={afterScreenshotHref}
              issues={snapshot.issues}
              tabStops={snapshot.tabStops}
              readiness={snapshot.readiness}
              selectedIssueId={selectedIssueId}
              onSelectIssue={setSelectedIssueId}
              onJumpToIssue={handleJumpToIssue}
            />
          </div>
        </div>

        <div
          role="tabpanel"
          aria-labelledby="workspace-tab-issues"
          hidden={activeTab !== "issues"}
        >
          <div className={styles.workspacePanel}>
            <IssueExplorer
              issues={snapshot.issues}
              regulations={snapshot.regulations}
              severityFilter={severityFilter}
              onSeverityFilterChange={setSeverityFilter}
              selectedIssueId={selectedIssueId}
            />
          </div>
        </div>

        <div
          role="tabpanel"
          aria-labelledby="workspace-tab-reader"
          hidden={activeTab !== "reader"}
        >
          <div className={styles.workspacePanel}>
            <WebReaderPanel
              key={readerHref}
              readerHref={readerHref}
              sourceUrl={snapshot.source.finalUrl}
              title={snapshot.source.title || "Tampilan Web Reader"}
              active={activeTab === "reader"}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
