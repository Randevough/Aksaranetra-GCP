"use client";

import type {
  ImpactLevel,
  PourPrinciple,
  Snapshot,
} from "@/lib/audit-api";
import styles from "./ScoreOverview.module.css";

const POUR_LABELS: Record<PourPrinciple, string> = {
  perceivable: "Perceivable",
  operable: "Operable",
  understandable: "Understandable",
  robust: "Robust",
};

const SEVERITY_META: Array<{
  key: ImpactLevel;
  label: string;
  className: string;
}> = [
  { key: "critical", label: "Kritis", className: "sevCritical" },
  { key: "serious", label: "Serius", className: "sevSerious" },
  { key: "moderate", label: "Sedang", className: "sevModerate" },
  { key: "minor", label: "Rendah", className: "sevMinor" },
];

const REG_SHORT_LABEL: Record<string, string> = {
  "UU-8-2016": "UU 8/2016",
  "PP-42-2020": "PP 42/2020",
  "PERMENPANRB-11-2024": "PermenPANRB 11/2024",
  "SPBE-2018": "Perpres 95/2018",
  "UU-KIP-2008": "UU 14/2008 KIP",
  "SNI-ISO-40500": "SNI ISO 40500",
};

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
  const regulations = snapshot.regulations ?? [];

  const beforeTotal = safeCount(snapshot.summary.beforeTotal);
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

            <div className={styles.deltaPill} aria-label={`Skor awal ${beforeScore} menjadi ${afterScore}`}>
              <span>{beforeScore}</span>
              <span aria-hidden="true">-&gt;</span>
              <strong>{afterScore}</strong>
            </div>
          </div>
        ) : (
          <div className={styles.ringFallback}>
            <strong>{fixedTotal}</strong>
            <span>perbaikan diterapkan</span>
          </div>
        )}

        <p className={styles.honestyNote}>
          Skor otomatis mencakup ~30–57% kriteria WCAG. Lengkapi dengan uji manual.
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
            {regressionClean ? "Bebas regresi" : "Perlu cek regresi"}
          </span>
        </div>

        {severity && (
          <div className={styles.severityBlock}>
            <div className={styles.blockHeader}>
              <h3 className={styles.blockTitle}>Tingkat Keparahan</h3>
              <span className={styles.blockMeta}>
                Klik untuk filter temuan
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
          <div className={styles.pourBlock} aria-label="Skor prinsip POUR WCAG">
            <h3 className={styles.blockTitle}>Prinsip POUR</h3>
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

        {regulations.length > 0 && (
          <div className={styles.regRow} aria-label="Ringkasan kepatuhan regulasi">
            <span className={styles.regRowLabel}>Regulasi:</span>
            <ul className={styles.regPills}>
              {regulations.map((reg) => (
                <li key={reg.code} className={styles.regPill} title={`${reg.title} (${reg.article})`}>
                  <span>{REG_SHORT_LABEL[reg.code] ?? reg.code}</span>
                  <strong>{reg.matchedIssues}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
