"use client";

import type {
  ImpactLevel,
  PourPrinciple,
  Snapshot,
} from "@/lib/audit-api";
import styles from "./ScoreOverview.module.css";

const POUR_LABELS: Record<PourPrinciple, string> = {
  perceivable: "Dapat Dipersepsi (Perceivable)",
  operable: "Dapat Dioperasikan (Operable)",
  understandable: "Dapat Dipahami (Understandable)",
  robust: "Andal (Robust)",
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

export default function ScoreOverview({
  snapshot,
  onSelectSeverity,
}: {
  snapshot: Snapshot;
  onSelectSeverity?: (severity: ImpactLevel) => void;
}) {
  const score = snapshot.score;
  const severity = snapshot.severity;
  const regulations = snapshot.regulations ?? [];

  if (!score && !severity && regulations.length === 0) {
    return null;
  }

  const afterSeverity = severity?.after;
  const beforeSeverity = severity?.before;
  const totalBefore = beforeSeverity?.total || 0;

  return (
    <section className={styles.section} aria-labelledby="score-overview-title">
      <div className={styles.headerRow}>
        <div>
          <h2 id="score-overview-title">Skor Aksesibilitas &amp; Kepatuhan Regulasi</h2>
          <p className={styles.disclaimer}>
            {score?.automatedCoverageNote ||
              "Skor otomatis mencakup ~30–57% kriteria WCAG. Lengkapi dengan uji manual."}
          </p>
        </div>
        {score && (
          <div className={styles.gradePill}>
            <span className={styles.gradeLabel}>Peringkat Otomatis</span>
            <strong className={styles.gradeValue}>{score.grade}</strong>
          </div>
        )}
      </div>

      {score && (
        <div className={styles.scoreAndPourGrid}>
          <article className={styles.scoreCard} aria-label="Perubahan skor otomatis">
            <div className={styles.scorePair}>
              <div>
                <span className={styles.scoreCaption}>Skor Awal</span>
                <strong className={styles.scoreBefore}>{score.beforeScore}</strong>
                <span className={styles.scoreScale}>/ 100</span>
              </div>
              <span className={styles.scoreArrow} aria-hidden="true">
                ke
              </span>
              <div>
                <span className={styles.scoreCaption}>Skor Setelah Perbaikan</span>
                <strong className={styles.scoreAfter}>{score.afterScore}</strong>
                <span className={styles.scoreScale}>/ 100</span>
              </div>
            </div>
            <p className={styles.scoreMethod}>
              Metodologi: pembobotan tingkat dampak pelanggaran WCAG 2.1 Level AA
              sebelum dan sesudah perbaikan aman.
            </p>
          </article>

          <article className={styles.pourCard} aria-label="Skor prinsip POUR WCAG">
            <h3 className={styles.cardSubheading}>Skor Prinsip POUR</h3>
            <div className={styles.pourList}>
              {(Object.keys(POUR_LABELS) as PourPrinciple[]).map((key) => {
                const val = Math.max(0, Math.min(100, Math.round(score.pour[key] ?? 0)));
                return (
                  <div key={key} className={styles.pourRow}>
                    <div className={styles.pourLabelRow}>
                      <span>{POUR_LABELS[key]}</span>
                      <strong>{val}/100</strong>
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
          </article>
        </div>
      )}

      {severity && (
        <article className={styles.severityCard} aria-label="Rincian tingkat keparahan temuan">
          <div className={styles.severityHead}>
            <h3>Rincian Tingkat Keparahan Temuan</h3>
            <span className={styles.severityTotals}>
              Sebelum: <strong>{beforeSeverity?.total ?? 0}</strong> · Sesudah:{" "}
              <strong>{afterSeverity?.total ?? 0}</strong>
            </span>
          </div>

          <div
            className={styles.severityBar}
            role="img"
            aria-label={`Sebaran sebelum perbaikan: ${beforeSeverity?.critical ?? 0} kritis, ${beforeSeverity?.serious ?? 0} serius, ${beforeSeverity?.moderate ?? 0} sedang, ${beforeSeverity?.minor ?? 0} rendah`}
          >
            {SEVERITY_META.map((item) => {
              const count = beforeSeverity?.[item.key] ?? 0;
              if (count <= 0 || totalBefore <= 0) return null;
              const pct = (count / totalBefore) * 100;
              return (
                <span
                  key={item.key}
                  className={`${styles.severitySegment} ${styles[item.className]}`}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>

          <div className={styles.severityLegend}>
            {SEVERITY_META.map((item) => {
              const beforeVal = beforeSeverity?.[item.key] ?? 0;
              const afterVal = afterSeverity?.[item.key] ?? 0;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={styles.severityChip}
                  onClick={() => onSelectSeverity?.(item.key)}
                >
                  <span
                    className={`${styles.legendDot} ${styles[item.className]}`}
                    aria-hidden="true"
                  />
                  <span className={styles.legendLabel}>{item.label}</span>
                  <span className={styles.legendCount}>
                    {beforeVal} ke {afterVal}
                  </span>
                </button>
              );
            })}
          </div>
        </article>
      )}

      {regulations.length > 0 && (
        <div className={styles.regSection}>
          <h3 className={styles.cardSubheading}>
            Pemetaan Regulasi &amp; Standar Indonesia
          </h3>
          <ul className={styles.regGrid}>
            {regulations.map((reg) => (
              <li key={reg.code} className={styles.regCard}>
                <div className={styles.regTop}>
                  <span className={styles.regCode}>{reg.code}</span>
                  <span className={styles.regMatch}>
                    {reg.matchedIssues} temuan terkait
                  </span>
                </div>
                <h4>{reg.title}</h4>
                <p>{reg.article}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
