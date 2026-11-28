"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, Info } from "lucide-react";
import type {
  ImpactLevel,
  PourPrinciple,
  Snapshot,
} from "@/lib/audit-api";
import styles from "./ScoreOverview.module.css";

const POUR_LABELS: Record<PourPrinciple, string> = {
  perceivable: "Mudah Dilihat",
  operable: "Mudah Dinavigasi",
  understandable: "Mudah Dipahami",
  robust: "Kompatibel Alat Bantu",
};

const SEVERITY_META: Array<{
  key: ImpactLevel;
  label: string;
  weight: number;
  className: string;
}> = [
  { key: "critical", label: "Kritis", weight: -10, className: "sevCritical" },
  { key: "serious", label: "Serius", weight: -6, className: "sevSerious" },
  { key: "moderate", label: "Sedang", weight: -3, className: "sevModerate" },
  { key: "minor", label: "Rendah", weight: -1, className: "sevMinor" },
];

const GRADE_SCALE = [
  { grade: "A", rule: "≥90" },
  { grade: "B", rule: "≥80" },
  { grade: "C", rule: "≥65" },
  { grade: "D", rule: "≥50" },
  { grade: "F", rule: "<50" },
] as const;

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function gradeToneClass(grade: string): string {
  if (grade === "A" || grade === "B") return styles.gradeGood;
  if (grade === "C") return styles.gradeWarn;
  return styles.gradeDanger;
}

export default function ScoreOverview({
  snapshot,
  activeSeverity = "all",
  onSelectSeverity,
}: {
  snapshot: Snapshot;
  activeSeverity?: ImpactLevel | "all";
  onSelectSeverity?: (severity: ImpactLevel) => void;
}) {
  const score = snapshot.score;
  const severity = snapshot.severity;

  const [formulaOpen, setFormulaOpen] = useState(false);
  const formulaPanelId = useId();
  const formulaTitleId = useId();
  const formulaAnchorRef = useRef<HTMLDivElement | null>(null);
  const formulaBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!formulaOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFormulaOpen(false);
        formulaBtnRef.current?.focus();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!formulaAnchorRef.current?.contains(event.target as Node)) {
        setFormulaOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [formulaOpen]);

  const beforeTotal = safeCount(snapshot.summary.beforeTotal);
  const afterTotal = safeCount(snapshot.summary.afterTotal);
  const fixedTotal = safeCount(snapshot.counts.fixed);
  const regressionClean = Boolean(snapshot.warnings?.wcagRegressionClean);

  const afterScore = score ? Math.max(0, Math.min(100, Math.round(score.afterScore))) : 0;
  const beforeScore = score ? Math.max(0, Math.min(100, Math.round(score.beforeScore))) : 0;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (afterScore / 100) * circumference;

  const afterSeverity = severity?.after;
  const beforeSeverity = severity?.before;
  const totalFound = beforeSeverity?.total ?? beforeTotal;
  const remainingIssues = afterSeverity?.total ?? afterTotal;
  const resolvedIssues = Math.max(0, totalFound - remainingIssues);
  const resolvedPercent =
    totalFound > 0 ? Math.round((resolvedIssues / totalFound) * 100) : 100;

  const pourEntries = score
    ? (Object.keys(POUR_LABELS) as PourPrinciple[]).map((key) => ({
        key,
        label: POUR_LABELS[key],
        val: Math.max(0, Math.min(100, Math.round(score.pour[key] ?? 0))),
      }))
    : [];
  const allPourPerfect =
    pourEntries.length > 0 && pourEntries.every((entry) => entry.val === 100);

  return (
    <section className={styles.bento} aria-labelledby="score-overview-title">
      <div className={styles.leftCard}>
        <div className={styles.leftTop}>
          <h2 id="score-overview-title" className={styles.cardTitle}>
            Skor Aksesibilitas
          </h2>
          {score && (
            <span className={`${styles.gradeBadge} ${gradeToneClass(score.grade)}`}>
              Peringkat {score.grade}
            </span>
          )}
        </div>

        {score ? (
          <div className={styles.ringWrap}>
            <div className={styles.ringSvgBox}>
              <svg
                className={styles.ringSvg}
                viewBox="0 0 108 108"
                role="img"
                aria-label={`Skor aksesibilitas setelah perbaikan ${afterScore} dari 100`}
              >
                <circle
                  cx="54"
                  cy="54"
                  r={radius}
                  className={styles.ringTrack}
                />
                <circle
                  cx="54"
                  cy="54"
                  r={radius}
                  className={styles.ringProgress}
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                />
              </svg>
              <div className={styles.ringCenter}>
                <strong className={styles.ringNumber}>{afterScore}</strong>
                <span className={styles.ringScale}>/ 100</span>
              </div>
            </div>

            <div ref={formulaAnchorRef} className={styles.scoreMetaRow}>
              <div
                className={styles.deltaPill}
                aria-label={`Skor awal ${beforeScore} menjadi ${afterScore}`}
              >
                <span>{beforeScore}</span>
                <ArrowRight size={13} strokeWidth={2.2} aria-hidden="true" />
                <strong>{afterScore}</strong>
              </div>

              <button
                ref={formulaBtnRef}
                type="button"
                className={styles.formulaBtn}
                aria-expanded={formulaOpen}
                aria-controls={formulaPanelId}
                onClick={() => setFormulaOpen((open) => !open)}
              >
                <Info size={14} strokeWidth={1.9} aria-hidden="true" />
                <span>Cara hitung skor</span>
              </button>

              {formulaOpen && (
                <div
                  id={formulaPanelId}
                  role="region"
                  aria-labelledby={formulaTitleId}
                  className={styles.formulaPopover}
                >
                  <div className={styles.formulaHeader}>
                    <h3 id={formulaTitleId} className={styles.formulaTitle}>
                      Cara Skor Dihitung
                    </h3>
                    <button
                      type="button"
                      className={styles.formulaCloseBtn}
                      onClick={() => {
                        setFormulaOpen(false);
                        formulaBtnRef.current?.focus();
                      }}
                    >
                      Tutup
                    </button>
                  </div>

                  <p className={styles.formulaIntro}>
                    Dimulai dari <strong>100</strong>, lalu dikurangi bobot temuan
                    dan diseimbangkan oleh jumlah aturan WCAG yang sudah lolos.
                  </p>

                  <ul className={styles.formulaRules}>
                    <li>
                      <strong>Tingkat dampak:</strong> Kritis (-10), Serius (-6),
                      Sedang (-3), Rendah (-1).
                    </li>
                    <li>
                      <strong>Temuan berulang diredam:</strong> masalah sama di
                      banyak elemen (seperti daftar kartu) tidak dihukum
                      berkali-kali lipat.
                    </li>
                    <li>
                      <strong>Kepatuhan ikut dihitung:</strong> makin banyak aturan
                      WCAG yang sudah lolos, makin seimbang penaltinya.
                    </li>
                  </ul>

                  <details className={styles.formulaTechDetails}>
                    <summary className={styles.formulaTechSummary}>
                      Lihat rumus matematis
                    </summary>
                    <div className={styles.formulaTechBody}>
                      <div>
                        Normalisasi: <code>100 × e^(-penalti / skala)</code> dengan{" "}
                        <code>skala = maks(85, 65 + 2,5 × aturan lolos)</code>
                      </div>
                      <div>
                        Pengulangan per aturan:{" "}
                        <code>× (1 + 0,15 × log₂(jumlah))</code>
                      </div>
                    </div>
                  </details>

                  {severity && (
                    <div className={styles.formulaSnapshot}>
                      <span className={styles.formulaSubheading}>
                        Rincian Snapshot Ini
                      </span>
                      <ul className={styles.formulaBreakdownList}>
                        {SEVERITY_META.map((item) => {
                          const beforeCnt = beforeSeverity?.[item.key] ?? 0;
                          const afterCnt = afterSeverity?.[item.key] ?? 0;
                          return (
                            <li key={item.key} className={styles.formulaBreakdownRow}>
                              <span>
                                {item.label} ({item.weight})
                              </span>
                              <strong>
                                {beforeCnt} -&gt; {afterCnt}
                              </strong>
                            </li>
                          );
                        })}
                        <li
                          className={`${styles.formulaBreakdownRow} ${styles.formulaBreakdownTotal}`}
                        >
                          <span>Total temuan</span>
                          <strong>
                            {beforeSeverity?.total ?? beforeTotal} -&gt;{" "}
                            {afterSeverity?.total ?? afterTotal}
                          </strong>
                        </li>
                      </ul>
                    </div>
                  )}

                  <div className={styles.formulaGrades}>
                    <span className={styles.formulaSubheading}>
                      Skala Peringkat
                    </span>
                    <div className={styles.gradeScaleRow}>
                      {GRADE_SCALE.map((item) => (
                        <span key={item.grade} className={styles.gradeScaleChip}>
                          <strong>{item.grade}</strong> {item.rule}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.ringFallback}>
            <strong>{fixedTotal}</strong>
            <span>perbaikan diterapkan</span>
          </div>
        )}

        <p className={styles.honestyNote}>
          Uji otomatis mencakup ~30–57% standar WCAG.
        </p>
      </div>

      <div className={styles.rightCard}>
        <div className={styles.heroSummary}>
          <div className={styles.heroTopRow}>
            <div className={styles.heroMetricBlock}>
              <div className={styles.heroHeadline}>
                <strong className={styles.heroPercent}>{resolvedPercent}%</strong>
                <span className={styles.heroLabel}>Temuan teratasi</span>
              </div>
              <p className={styles.heroSubtext}>
                {totalFound === 0
                  ? "Tidak ada temuan otomatis pada halaman ini."
                  : remainingIssues === 0
                    ? `Semua ${totalFound} temuan berhasil diatasi.`
                    : `Tersisa ${remainingIssues} dari ${totalFound} temuan.`}
              </p>
            </div>

            <div className={styles.heroMetaStats}>
              <div className={styles.heroMetaItem}>
                <span className={styles.statLabel}>Total temuan</span>
                <strong className={styles.statValue}>{totalFound}</strong>
              </div>
              <div className={styles.heroMetaItem}>
                <span className={styles.statLabel}>Teratasi</span>
                <strong className={styles.statValue}>{resolvedIssues}</strong>
              </div>
              <div className={styles.heroMetaItem}>
                <span className={styles.statLabel}>Tersisa</span>
                <strong className={styles.statValue}>{remainingIssues}</strong>
              </div>
              {!regressionClean && (
                <span className={styles.regressionWarn}>Perlu cek ulang</span>
              )}
            </div>
          </div>

          <div
            className={styles.resolutionBar}
            role="img"
            aria-label={
              totalFound === 0
                ? "100% bersih tanpa temuan otomatis"
                : `${resolvedPercent}% teratasi (${resolvedIssues} dari ${totalFound} temuan), tersisa ${remainingIssues} temuan`
            }
          >
            {totalFound === 0 || resolvedIssues > 0 ? (
              <span
                className={styles.resolutionResolved}
                style={{
                  width: `${
                    totalFound === 0 ? 100 : (resolvedIssues / totalFound) * 100
                  }%`,
                }}
              />
            ) : null}
            {totalFound > 0 &&
              SEVERITY_META.map((item) => {
                const cnt = afterSeverity?.[item.key] ?? 0;
                if (cnt <= 0) return null;
                return (
                  <span
                    key={item.key}
                    className={`${styles.severitySegment} ${styles[item.className]}`}
                    style={{ width: `${(cnt / totalFound) * 100}%` }}
                  />
                );
              })}
          </div>
        </div>

        {severity && (
          <div className={styles.severityBlock}>
            <div className={styles.blockHeader}>
              <h3 className={styles.blockTitle}>Tingkat Keparahan</h3>
              <span className={styles.blockMeta}>Pilih untuk filter</span>
            </div>

            <div className={styles.severityChips}>
              {SEVERITY_META.map((item) => {
                const beforeVal = beforeSeverity?.[item.key] ?? 0;
                const afterVal = afterSeverity?.[item.key] ?? 0;
                const isActive = activeSeverity === item.key;
                const isResolved = afterVal === 0;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`${styles.severityChip} ${
                      isResolved && !isActive ? styles.severityChipResolved : ""
                    } ${isActive ? styles.severityChipActive : ""}`}
                    aria-pressed={isActive}
                    onClick={() => onSelectSeverity?.(item.key)}
                  >
                    {beforeVal > 0 && isResolved ? (
                      <Check
                        size={13}
                        strokeWidth={2.4}
                        className={styles.chipResolvedIcon}
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className={`${styles.chipDot} ${styles[item.className]}`}
                        aria-hidden="true"
                      />
                    )}
                    <span className={styles.chipLabel}>{item.label}</span>
                    <span className={styles.chipCount}>
                      <span>{beforeVal}</span>
                      <ArrowRight size={11} strokeWidth={2.1} aria-hidden="true" />
                      <span className="sr-only"> menjadi </span>
                      <strong>{afterVal}</strong>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {score && (
          <div className={styles.pourBlock} aria-label="Skor aspek aksesibilitas">
            {allPourPerfect ? (
              <div className={styles.pourPerfectBar}>
                <span className={styles.pourPerfectLabel}>
                  <Check size={14} strokeWidth={2.4} aria-hidden="true" />
                  <span>Semua aspek aksesibilitas 100%</span>
                </span>
                <span className={styles.pourPerfectTrack} aria-hidden="true" />
              </div>
            ) : (
              <>
                <h3 className={styles.blockTitleMuted}>Aspek Aksesibilitas</h3>
                <div className={styles.pourGrid}>
                  {pourEntries.map((item) => (
                    <div key={item.key} className={styles.pourItem}>
                      <div className={styles.pourTop}>
                        <span>{item.label}</span>
                        <strong>{item.val}%</strong>
                      </div>
                      <div className={styles.pourTrack} aria-hidden="true">
                        <div
                          className={styles.pourFill}
                          style={{ width: `${item.val}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
