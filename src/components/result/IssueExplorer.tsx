"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AuditIssue,
  ImpactLevel,
  PourPrinciple,
  RegulationReference,
} from "@/lib/audit-api";
import styles from "./IssueExplorer.module.css";

const DEFAULT_VISIBLE_COUNT = 8;

const IMPACT_LABEL: Record<ImpactLevel, string> = {
  critical: "Kritis",
  serious: "Serius",
  moderate: "Sedang",
  minor: "Rendah",
};

const STATUS_LABEL: Record<AuditIssue["status"], string> = {
  fixed: "Diperbaiki",
  review: "Perlu Tinjauan",
  open: "Terbuka",
  skipped: "Dilewati",
  "rolled-back": "Dibatalkan",
};

const POUR_LABEL: Record<PourPrinciple, string> = {
  perceivable: "Mudah Dilihat",
  operable: "Mudah Dinavigasi",
  understandable: "Mudah Dipahami",
  robust: "Kompatibel Alat Bantu",
};

export default function IssueExplorer({
  issues = [],
  regulations = [],
  severityFilter,
  onSeverityFilterChange,
  selectedIssueId,
}: {
  issues?: AuditIssue[];
  regulations?: RegulationReference[];
  severityFilter: ImpactLevel | "all";
  onSeverityFilterChange: (value: ImpactLevel | "all") => void;
  selectedIssueId?: string | null;
}) {
  const [statusFilter, setStatusFilter] = useState<AuditIssue["status"] | "all">("all");
  const [pourFilter, setPourFilter] = useState<PourPrinciple | "all">("all");
  const [regFilter, setRegFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>(() =>
    selectedIssueId ? { [selectedIssueId]: true } : {},
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues.filter((issue) => {
      if (severityFilter !== "all" && issue.impact !== severityFilter)
        return false;
      if (statusFilter !== "all" && issue.status !== statusFilter) return false;
      if (pourFilter !== "all" && issue.pour !== pourFilter) return false;
      if (regFilter !== "all" && !issue.regulations.includes(regFilter))
        return false;
      if (q) {
        const haystack = [
          issue.titleId,
          issue.descriptionId,
          issue.helpId,
          issue.selector,
          issue.ruleId,
          ...issue.wcagSc,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [issues, pourFilter, query, regFilter, severityFilter, statusFilter]);

  useEffect(() => {
    if (!selectedIssueId) return;
    queueMicrotask(() => {
      setExpandedIds((prev) =>
        prev[selectedIssueId] ? prev : { ...prev, [selectedIssueId]: true },
      );
      const idx = filtered.findIndex((item) => item.id === selectedIssueId);
      if (idx >= DEFAULT_VISIBLE_COUNT) {
        setShowAll(true);
      }
    });
  }, [filtered, selectedIssueId]);

  const hasActiveFilter =
    severityFilter !== "all" ||
    statusFilter !== "all" ||
    pourFilter !== "all" ||
    regFilter !== "all" ||
    query.trim().length > 0;

  const resetFilters = () => {
    onSeverityFilterChange("all");
    setStatusFilter("all");
    setPourFilter("all");
    setRegFilter("all");
    setQuery("");
  };

  const toggleIssue = (issueId: string) => {
    setExpandedIds((prev) => ({ ...prev, [issueId]: !prev[issueId] }));
  };

  const handleCopy = async (issue: AuditIssue) => {
    const payload = issue.htmlAfter
      ? issue.htmlAfter
      : `${issue.selector}\n/* ${issue.helpId} */`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedId(issue.id);
      setCopyAnnouncement(`Kode perbaikan untuk ${issue.ruleId} disalin.`);
      setTimeout(() => {
        setCopiedId((curr) => (curr === issue.id ? null : curr));
      }, 2500);
    } catch {
      setCopyAnnouncement(
        "Gagal menyalin otomatis. Salin kode secara manual.",
      );
    }
  };

  if (issues.length === 0) {
    return (
      <div className={styles.emptyFilter}>
        <p>Tidak ada temuan pada pemeriksaan ini.</p>
      </div>
    );
  }

  const visibleIssues = showAll
    ? filtered
    : filtered.slice(0, DEFAULT_VISIBLE_COUNT);

  return (
    <section
      id="issue-explorer"
      className={styles.section}
      aria-label="Daftar temuan per elemen"
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {copyAnnouncement}
      </p>

      <search className={styles.filterBox}>
        <div className={styles.filterGrid}>
          <div className={styles.filterField}>
            <label htmlFor="issue-search">Cari temuan</label>
            <input
              id="issue-search"
              type="search"
              className="input"
              placeholder="Contoh: kontras, tombol, 1.4.3"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className={styles.filterField}>
            <label htmlFor="filter-severity">Keparahan</label>
            <select
              id="filter-severity"
              className="input"
              value={severityFilter}
              onChange={(e) =>
                onSeverityFilterChange(e.target.value as ImpactLevel | "all")
              }
            >
              <option value="all">Semua tingkat</option>
              <option value="critical">Kritis</option>
              <option value="serious">Serius</option>
              <option value="moderate">Sedang</option>
              <option value="minor">Rendah</option>
            </select>
          </div>

          <div className={styles.filterField}>
            <label htmlFor="filter-status">Status</label>
            <select
              id="filter-status"
              className="input"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as AuditIssue["status"] | "all")
              }
            >
              <option value="all">Semua status</option>
              <option value="fixed">Diperbaiki</option>
              <option value="review">Perlu Tinjauan</option>
              <option value="open">Terbuka</option>
              <option value="skipped">Dilewati</option>
              <option value="rolled-back">Dibatalkan</option>
            </select>
          </div>

          <div className={styles.filterField}>
            <label htmlFor="filter-pour">Aspek</label>
            <select
              id="filter-pour"
              className="input"
              value={pourFilter}
              onChange={(e) =>
                setPourFilter(e.target.value as PourPrinciple | "all")
              }
            >
              <option value="all">Semua aspek</option>
              <option value="perceivable">Mudah Dilihat</option>
              <option value="operable">Mudah Dinavigasi</option>
              <option value="understandable">Mudah Dipahami</option>
              <option value="robust">Kompatibel Alat Bantu</option>
            </select>
          </div>

          <div className={styles.filterField}>
            <label htmlFor="filter-reg">Regulasi</label>
            <select
              id="filter-reg"
              className="input"
              value={regFilter}
              onChange={(e) => setRegFilter(e.target.value)}
            >
              <option value="all">Semua regulasi</option>
              {regulations.map((reg) => (
                <option key={reg.code} value={reg.code}>
                  {reg.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.filterBarFooter}>
          <p className={styles.resultCount} aria-live="polite">
            Menampilkan <strong>{visibleIssues.length}</strong> dari{" "}
            <strong>{filtered.length}</strong> temuan
            {filtered.length !== issues.length ? ` (total ${issues.length})` : ""}
          </p>

          {hasActiveFilter && (
            <button
              type="button"
              className={styles.resetButton}
              onClick={resetFilters}
            >
              Atur ulang
            </button>
          )}
        </div>
      </search>

      {filtered.length === 0 ? (
        <div className={styles.emptyFilter}>
          <p>Tidak ada temuan yang cocok dengan filter.</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={resetFilters}
          >
            Tampilkan semua
          </button>
        </div>
      ) : (
        <>
          <ul className={styles.accordionList}>
            {visibleIssues.map((issue) => {
              const isSelected = selectedIssueId === issue.id;
              const isExpanded = Boolean(expandedIds[issue.id]);
              const panelId = `issue-panel-${issue.id}`;

              return (
                <li
                  key={issue.id}
                  id={`issue-card-${issue.id}`}
                  className={`${styles.accordionItem} ${
                    isSelected ? styles.issueSelected : ""
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    className={styles.accordionTrigger}
                    onClick={() => toggleIssue(issue.id)}
                  >
                    <span
                      className={`${styles.impactBadge} ${
                        styles[`impact_${issue.impact}`]
                      }`}
                    >
                      {IMPACT_LABEL[issue.impact]}
                    </span>
                    <span className={styles.rowTitle}>{issue.titleId}</span>
                    <code className={styles.rowSelector}>{issue.selector}</code>
                    <span
                      className={`${styles.statusBadge} ${
                        styles[`status_${issue.status}`]
                      }`}
                    >
                      {STATUS_LABEL[issue.status]}
                    </span>
                    <span
                      className={`${styles.chevron} ${
                        isExpanded ? styles.chevronOpen : ""
                      }`}
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </button>

                  {isExpanded && (
                    <div id={panelId} className={styles.accordionBody}>
                      <div className={styles.metaTags}>
                        <span className={styles.pourBadge}>
                          {POUR_LABEL[issue.pour]}
                        </span>
                        <code className={styles.ruleCode}>{issue.ruleId}</code>
                        {issue.wcagSc.map((sc) => (
                          <span key={sc} className={styles.scChip}>
                            WCAG {sc}
                          </span>
                        ))}
                        {issue.regulations.map((reg) => (
                          <span key={reg} className={styles.regChip}>
                            {reg}
                          </span>
                        ))}
                        {issue.engines?.map((eng) => (
                          <span key={eng} className={styles.engineChip}>
                            {eng === "ibm-ace" ? "IBM ACE" : eng}
                          </span>
                        ))}
                      </div>

                      <p className={styles.issueDesc}>{issue.descriptionId}</p>
                      <p className={styles.issueHelp}>
                        <strong>Saran perbaikan:</strong> {issue.helpId}
                      </p>

                      {(issue.htmlBefore || issue.htmlAfter) && (
                        <div className={styles.diffGrid}>
                          {issue.htmlBefore && (
                            <div className={styles.codeBlock}>
                              <span className={styles.codeLabelBefore}>
                                Sebelum
                              </span>
                              <pre>
                                <code>{issue.htmlBefore}</code>
                              </pre>
                            </div>
                          )}
                          <div className={styles.codeBlock}>
                            <span className={styles.codeLabelAfter}>
                              {issue.htmlAfter
                                ? "Sesudah"
                                : "Perlu Tinjauan"}
                            </span>
                            <pre>
                              <code>
                                {issue.htmlAfter ??
                                  "Tidak diubah otomatis agar tidak keliru."}
                              </code>
                            </pre>
                          </div>
                        </div>
                      )}

                      <div className={styles.cardFooter}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => void handleCopy(issue)}
                        >
                          {copiedId === issue.id
                            ? "Tersalin"
                            : issue.htmlAfter
                              ? "Salin Perbaikan"
                              : "Salin Panduan"}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {filtered.length > DEFAULT_VISIBLE_COUNT && (
            <div className={styles.showAllRow}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAll((prev) => !prev)}
              >
                {showAll
                  ? `Tampilkan ${DEFAULT_VISIBLE_COUNT} temuan`
                  : `Tampilkan semua (${filtered.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
