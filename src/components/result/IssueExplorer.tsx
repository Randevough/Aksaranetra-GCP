"use client";

import { useMemo, useState } from "react";
import type {
  AuditIssue,
  ImpactLevel,
  PourPrinciple,
  RegulationReference,
} from "@/lib/audit-api";
import styles from "./IssueExplorer.module.css";

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
  perceivable: "Perceivable",
  operable: "Operable",
  understandable: "Understandable",
  robust: "Robust",
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

  const handleCopy = async (issue: AuditIssue) => {
    const payload = issue.htmlAfter
      ? issue.htmlAfter
      : `${issue.selector}\n/* ${issue.helpId} */`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedId(issue.id);
      setCopyAnnouncement(`Kode perbaikan untuk ${issue.ruleId} disalin ke papan klip.`);
      setTimeout(() => {
        setCopiedId((curr) => (curr === issue.id ? null : curr));
      }, 2500);
    } catch {
      setCopyAnnouncement(
        "Gagal menyalin otomatis. Pilih dan salin teks kode secara manual.",
      );
    }
  };

  if (issues.length === 0) {
    return null;
  }

  return (
    <section
      id="issue-explorer"
      className={styles.section}
      aria-labelledby="issue-explorer-title"
    >
      <div className={styles.headerRow}>
        <div>
          <h2 id="issue-explorer-title">Daftar Temuan Per Elemen</h2>
          <p className={styles.lead}>
            Rincian elemen bermasalah dalam Bahasa Indonesia beserta pemetaan WCAG,
            regulasi, dan cuplikan kode perbaikan.
          </p>
        </div>
        <p className={styles.resultCount} aria-live="polite">
          Menampilkan <strong>{filtered.length}</strong> dari{" "}
          <strong>{issues.length}</strong> temuan
        </p>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {copyAnnouncement}
      </p>

      <search className={styles.filterBox}>
        <div className={styles.filterGrid}>
          <div className={styles.filterField}>
            <label htmlFor="issue-search">Cari temuan atau selektor</label>
            <input
              id="issue-search"
              type="search"
              className="input"
              placeholder="Contoh: button-name, kontras, 1.4.3"
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
            <label htmlFor="filter-pour">Prinsip POUR</label>
            <select
              id="filter-pour"
              className="input"
              value={pourFilter}
              onChange={(e) =>
                setPourFilter(e.target.value as PourPrinciple | "all")
              }
            >
              <option value="all">Semua prinsip</option>
              <option value="perceivable">Perceivable</option>
              <option value="operable">Operable</option>
              <option value="understandable">Understandable</option>
              <option value="robust">Robust</option>
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

        {hasActiveFilter && (
          <div className={styles.filterActions}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={resetFilters}
            >
              Atur ulang filter
            </button>
          </div>
        )}
      </search>

      {filtered.length === 0 ? (
        <div className={styles.emptyFilter}>
          <p>Tidak ada temuan yang cocok dengan kombinasi filter saat ini.</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={resetFilters}
          >
            Tampilkan semua temuan
          </button>
        </div>
      ) : (
        <ul className={styles.issueList}>
          {filtered.map((issue) => {
            const isSelected = selectedIssueId === issue.id;
            return (
              <li
                key={issue.id}
                id={`issue-card-${issue.id}`}
                className={`${styles.issueCard} ${
                  isSelected ? styles.issueSelected : ""
                }`}
              >
                <div className={styles.cardTop}>
                  <div className={styles.badges}>
                    <span
                      className={`${styles.impactBadge} ${
                        styles[`impact_${issue.impact}`]
                      }`}
                    >
                      {IMPACT_LABEL[issue.impact]}
                    </span>
                    <span
                      className={`${styles.statusBadge} ${
                        styles[`status_${issue.status}`]
                      }`}
                    >
                      {STATUS_LABEL[issue.status]}
                    </span>
                    <span className={styles.pourBadge}>
                      {POUR_LABEL[issue.pour]}
                    </span>
                    <code className={styles.ruleCode}>{issue.ruleId}</code>
                  </div>

                  <div className={styles.scGroup}>
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
                  </div>
                </div>

                <h3 className={styles.issueTitle}>{issue.titleId}</h3>
                <p className={styles.issueDesc}>{issue.descriptionId}</p>
                <p className={styles.issueHelp}>
                  <strong>Saran perbaikan:</strong> {issue.helpId}
                </p>

                <div className={styles.selectorRow}>
                  <span>Selektor:</span>
                  <code>{issue.selector}</code>
                </div>

                {(issue.htmlBefore || issue.htmlAfter) && (
                  <div className={styles.diffGrid}>
                    {issue.htmlBefore && (
                      <div className={styles.codeBlock}>
                        <span className={styles.codeLabelBefore}>Sebelum</span>
                        <pre>
                          <code>{issue.htmlBefore}</code>
                        </pre>
                      </div>
                    )}
                    <div className={styles.codeBlock}>
                      <span className={styles.codeLabelAfter}>
                        {issue.htmlAfter ? "Sesudah (Perbaikan)" : "Perlu Tinjauan Manual"}
                      </span>
                      <pre>
                        <code>
                          {issue.htmlAfter ??
                            "Tidak diubah otomatis untuk mencegah deskripsi keliru."}
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
                        : "Salin Panduan & Selektor"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
