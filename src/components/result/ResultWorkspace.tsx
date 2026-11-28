"use client";

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  BookOpen,
  ClipboardCheck,
  Download,
  ExternalLink,
  Eye,
  FileText,
  ListChecks,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import type { AuditResult, ImpactLevel, Snapshot } from "@/lib/audit-api";
import { artifactUrl } from "@/lib/audit-api";
import { DEMO_AUDITS } from "@/lib/demo-audits";
import ScoreOverview from "./ScoreOverview";
import Wave2Diagnostics from "./Wave2Diagnostics";
import {
  FASTPASS_TOTAL_ITEMS,
  readFastPassSummary,
  type FastPassSummary,
} from "./wave2-types";
import styles from "@/app/result/page.module.css";
import skeletonStyles from "./WorkspaceSkeleton.module.css";

function PanelSkeleton({
  label,
  heightClass,
}: {
  label: string;
  heightClass: string;
}) {
  return (
    <div
      className={`${skeletonStyles.skeletonPanel} ${heightClass}`}
      role="status"
      aria-live="polite"
    >
      <span>{label}</span>
    </div>
  );
}

const VisualInspector = dynamic(() => import("./VisualInspector"), {
  loading: () => (
    <PanelSkeleton
      label="Memuat inspeksi visual..."
      heightClass={skeletonStyles.skeletonVisual}
    />
  ),
});

const IssueExplorer = dynamic(() => import("./IssueExplorer"), {
  loading: () => (
    <PanelSkeleton
      label="Memuat daftar temuan..."
      heightClass={skeletonStyles.skeletonIssues}
    />
  ),
});

const WebReaderPanel = dynamic(() => import("./WebReaderPanel"), {
  loading: () => (
    <PanelSkeleton
      label="Memuat Web Reader..."
      heightClass={skeletonStyles.skeletonReader}
    />
  ),
});

const GuidedFastPass = dynamic(() => import("./GuidedFastPass"), {
  loading: () => (
    <PanelSkeleton
      label="Memuat daftar cek manual..."
      heightClass={skeletonStyles.skeletonManual}
    />
  ),
});

const StatementModal = dynamic(() => import("./StatementModal"), {
  ssr: false,
});

type WorkspaceTab = "visual" | "issues" | "reader" | "manual";

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
  const [visitedTabs, setVisitedTabs] = useState<Record<WorkspaceTab, boolean>>({
    visual: true,
    issues: false,
    reader: false,
    manual: false,
  });
  const [severityFilter, setSeverityFilter] = useState<ImpactLevel | "all">("all");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    snapshot.issues?.[0]?.id ?? null,
  );
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementMounted, setStatementMounted] = useState(false);
  const [fastPassSummary, setFastPassSummary] = useState<FastPassSummary>({
    total: FASTPASS_TOTAL_ITEMS,
    checked: 0,
    passed: 0,
    failed: 0,
  });

  const localHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const resolvedHeadingRef = headingRef ?? localHeadingRef;

  const tabRefs = useRef<Record<WorkspaceTab, HTMLButtonElement | null>>({
    visual: null,
    issues: null,
    reader: null,
    manual: null,
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
    setVisitedTabs((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
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
      switchToTab("issues");
      requestAnimationFrame(() => {
        const el = document.getElementById("workspace-tabs");
        if (el) {
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        }
      });
    },
    [activeTab, switchToTab],
  );

  const handleJumpToIssue = useCallback(
    (issueId: string) => {
      setSeverityFilter("all");
      setSelectedIssueId(issueId);
      switchToTab("issues");
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
    },
    [switchToTab],
  );

  const tabOrder: WorkspaceTab[] = ["visual", "issues", "reader", "manual"];
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

  const openStatementModal = () => {
    setFastPassSummary(readFastPassSummary(data.job.jobId));
    setStatementMounted(true);
    setStatementOpen(true);
  };

  const recheckHref = `/result?url=${encodeURIComponent(snapshot.source.finalUrl || snapshot.source.requestedUrl)}`;

  return (
    <main className={styles.resultContainer}>
      {isDemo && (
        <div className={styles.demoSwitcher} aria-label="Pilihan data demo">
          <span>Demo:</span>
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
            <span className={styles.statusPill}>Selesai</span>
            <span className={styles.timestamp}>
              {waktu(snapshot.capturedAt)} · v{snapshot.engineVersion}
            </span>
          </div>

          <h1 ref={resolvedHeadingRef} tabIndex={-1}>
            {snapshot.source.title || "Hasil Pemeriksaan"}
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
              ? "Simulasi demo. Situs asli tidak diubah."
              : "Pratinjau pemeriksaan. Situs asli tidak diubah."}
          </p>
        </div>

        <div className={styles.actionBar}>
          <div className={styles.actionPrimaryGroup}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleOpenWebReader}
            >
              <BookOpen size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>Buka Web Reader</span>
              <span className="sr-only"> (versi ramah akses)</span>
            </button>

            <a
              className="btn btn-secondary"
              href={patchedHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>Lihat Halaman Diperbaiki</span>
              <span className="sr-only"> (buka di tab baru)</span>
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <FileText size={15} strokeWidth={1.75} aria-hidden="true" />
                  <span>PDF</span>
                </span>
                <span className="sr-only"> (buka di tab baru)</span>
              </a>

              {reportJsonHref ? (
                <a
                  className={styles.compactActionBtn}
                  href={reportJsonHref}
                  download={`aksaranetra-${data.job.jobId}.json`}
                  aria-label="Unduh JSON"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <Download size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span>JSON</span>
                  </span>
                </a>
              ) : (
                <button
                  type="button"
                  className={styles.compactActionBtn}
                  aria-label="Unduh JSON"
                  onClick={() =>
                    triggerClientDownload(
                      `aksaranetra-${data.job.jobId}.json`,
                      JSON.stringify(data, null, 2),
                      "application/json",
                    )
                  }
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <Download size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span>JSON</span>
                  </span>
                </button>
              )}

              {reportCsvHref ? (
                <a
                  className={styles.compactActionBtn}
                  href={reportCsvHref}
                  download={`aksaranetra-${data.job.jobId}.csv`}
                  aria-label="Unduh CSV"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <Download size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span>CSV</span>
                  </span>
                </a>
              ) : (
                <button
                  type="button"
                  className={styles.compactActionBtn}
                  aria-label="Unduh CSV"
                  onClick={() =>
                    triggerClientDownload(
                      `aksaranetra-${data.job.jobId}.csv`,
                      buildFallbackCsv(snapshot),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <Download size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span>CSV</span>
                  </span>
                </button>
              )}

              <button
                type="button"
                className={styles.compactActionBtn}
                onClick={openStatementModal}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <ShieldCheck size={15} strokeWidth={1.75} aria-hidden="true" />
                  <span>Pernyataan &amp; Badge</span>
                </span>
              </button>
            </div>

            <div className={styles.navActions}>
              <Link href={recheckHref} className={styles.compactActionBtn}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <RotateCw size={15} strokeWidth={1.75} aria-hidden="true" />
                  <span>Periksa ulang</span>
                </span>
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

      <Wave2Diagnostics snapshot={snapshot} />

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
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
              <Eye size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>Inspeksi Visual</span>
            </span>
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
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
              <ListChecks size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>Daftar Temuan ({issuesCount})</span>
            </span>
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
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
              <BookOpen size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>Web Reader</span>
            </span>
          </button>

          <button
            ref={(el) => {
              tabRefs.current.manual = el;
            }}
            id="workspace-tab-manual"
            type="button"
            role="tab"
            aria-selected={activeTab === "manual"}
            tabIndex={activeTab === "manual" ? 0 : -1}
            className={styles.workspaceTabBtn}
            onClick={() => switchToTab("manual")}
            onKeyDown={(e) => handleWorkspaceTabKeyDown(e, "manual")}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
              <ClipboardCheck size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>Cek Manual</span>
            </span>
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
            {(activeTab === "issues" || visitedTabs.issues) && (
              <IssueExplorer
                issues={snapshot.issues}
                regulations={snapshot.regulations}
                severityFilter={severityFilter}
                onSeverityFilterChange={setSeverityFilter}
                selectedIssueId={selectedIssueId}
              />
            )}
          </div>
        </div>

        <div
          role="tabpanel"
          aria-labelledby="workspace-tab-reader"
          hidden={activeTab !== "reader"}
        >
          <div className={styles.workspacePanel}>
            {(activeTab === "reader" || visitedTabs.reader) && (
              <WebReaderPanel
                key={readerHref}
                readerHref={readerHref}
                sourceUrl={snapshot.source.finalUrl}
                title={snapshot.source.title || "Tampilan Web Reader"}
                active={activeTab === "reader"}
              />
            )}
          </div>
        </div>

        <div
          role="tabpanel"
          aria-labelledby="workspace-tab-manual"
          hidden={activeTab !== "manual"}
        >
          <div className={styles.workspacePanel}>
            {(activeTab === "manual" || visitedTabs.manual) && (
              <GuidedFastPass key={data.job.jobId} jobId={data.job.jobId} />
            )}
          </div>
        </div>
      </section>

      {statementMounted && (
        <StatementModal
          open={statementOpen}
          onClose={() => setStatementOpen(false)}
          snapshot={snapshot}
          fastPass={fastPassSummary}
          isDemo={isDemo}
        />
      )}
    </main>
  );
}
