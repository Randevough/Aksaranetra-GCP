"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
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
  const reviewTotal = safeCount(snapshot.counts.review);
  const regressionClean = Boolean(snapshot.warnings?.wcagRegressionClean);

  const afterScore = score ? Math.max(0, Math.min(100, Math.round(score.afterScore))) : 0;
  const beforeScore = score ? Math.max(0, Math.min(100, Math.round(score.beforeScore))) : 0;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (afterScore / 100) * circumference;

  const afterSeverity = severity?.after;
  const beforeSeverity = severity?.before;
  const totalBeforeSeverity = beforeSeverity?.total || 0;

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
                <span aria-hidden="true">-&gt;</span>
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
                      Rumus Skor Aksesibilitas
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

                  <ul className={styles.formulaRules}>
                    <li>
                      Skor dasar <strong>100</strong>, dinormalisasi dengan{" "}
                      <code>100 × e^(-penalti / skala)</code> (
                      <code>skala = maks(85, 65 + 2,5 × aturan lolos)</code> —
                      memperhitungkan aturan WCAG yang sudah lolos agar selaras
                      dengan Lighthouse)
                    </li>
                    <li>
                      Bobot dampak:{" "}
                      <strong>Kritis (-10)</strong>,{" "}
                      <strong>Serius (-6)</strong>,{" "}
                      <strong>Sedang (-3)</strong>,{" "}
                      <strong>Rendah (-1)</strong>
                    </li>
                    <li>
                      Faktor temuan berulang logaritmik:{" "}
                      <code>× (1 + 0,15 × log₂(jumlah))</code> pada aturan yang
                      sama (tidak menghukum template berulang secara berlebihan,
                      namun tetap naik saat perbaikan bertahap)
                    </li>
                  </ul>

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
        <div className={styles.statStrip}>
          <div className={styles.statItems}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Ditemukan</span>
              <strong className={styles.statValue}>{beforeTotal}</strong>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Diperbaiki</span>
              <strong className={`${styles.statValue} ${styles.statGood}`}>{fixedTotal}</strong>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Perlu Tinjauan</span>
              <strong className={styles.statValue}>{reviewTotal}</strong>
            </div>
          </div>

          <span
            className={
              regressionClean ? styles.regressionClean : styles.regressionWarn
            }
          >
            {regressionClean ? "Tanpa masalah baru" : "Perlu cek ulang"}
          </span>
        </div>

        {severity && (
          <div className={styles.severityBlock}>
            <div className={styles.blockHeader}>
              <h3 className={styles.blockTitle}>Tingkat Keparahan</h3>
              <span className={styles.blockMeta}>
                Pilih untuk filter
              </span>
            </div>

            <div
              className={styles.severityBar}
              role="img"
              aria-label={`Sebaran awal: ${beforeSeverity?.critical ?? 0} kritis, ${beforeSeverity?.serious ?? 0} serius, ${beforeSeverity?.moderate ?? 0} sedang, ${beforeSeverity?.minor ?? 0} rendah`}
            >
              {SEVERITY_META.map((item) => {
                const cnt = beforeSeverity?.[item.key] ?? 0;
                if (cnt <= 0 || totalBeforeSeverity <= 0) return null;
                return (
                  <span
                    key={item.key}
                    className={`${styles.severitySegment} ${styles[item.className]}`}
                    style={{ width: `${(cnt / totalBeforeSeverity) * 100}%` }}
                  />
                );
              })}
            </div>

            <div className={styles.severityChips}>
              {SEVERITY_META.map((item) => {
                const beforeVal = beforeSeverity?.[item.key] ?? 0;
                const afterVal = afterSeverity?.[item.key] ?? 0;
                const isActive = activeSeverity === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`${styles.severityChip} ${
                      isActive ? styles.severityChipActive : ""
                    }`}
                    aria-pressed={isActive}
                    onClick={() => onSelectSeverity?.(item.key)}
                  >
                    <span
                      className={`${styles.chipDot} ${styles[item.className]}`}
                      aria-hidden="true"
                    />
                    <span className={styles.chipLabel}>{item.label}</span>
                    <span className={styles.chipCount}>
                      {beforeVal}
                      <span aria-hidden="true"> / </span>
                      <span className="sr-only"> menjadi </span>
                      {afterVal}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {score && (
          <div className={styles.pourBlock} aria-label="Skor aspek aksesibilitas">
            <h3 className={styles.blockTitle}>Aspek Aksesibilitas</h3>
            <div className={styles.pourGrid}>
              {(Object.keys(POUR_LABELS) as PourPrinciple[]).map((key) => {
                const val = Math.max(0, Math.min(100, Math.round(score.pour[key] ?? 0)));
                return (
                  <div key={key} className={styles.pourItem}>
                    <div className={styles.pourTop}>
                      <span>{POUR_LABELS[key]}</span>
                      <strong>{val}%</strong>
                    </div>
                    <div className={styles.pourTrack} aria-hidden="true">
                      <div
                        className={styles.pourFill}
                        style={{ width: `${val}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
