"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AuditResult, ImpactLevel, Snapshot } from "@/lib/audit-api";
import { artifactUrl } from "@/lib/audit-api";
import { DEMO_AUDITS } from "@/lib/demo-audits";
import ScoreOverview from "./ScoreOverview";
import VisualInspector from "./VisualInspector";
import IssueExplorer from "./IssueExplorer";
import styles from "@/app/result/page.module.css";

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

function AngkaNaik({ value }: { value: number }) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || value <= 0) {
      queueMicrotask(() => setShown(value));
      return;
    }

    let frame = 0;
    const duration = 650;
    const started = performance.now();

    queueMicrotask(() => setShown(0));

    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(value * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className={styles.srOnly}>{value}</span>
    </>
  );
}

function conclusion(snapshot: Snapshot) {
  const before = count(snapshot.summary.beforeTotal);
  const after = count(snapshot.summary.afterTotal);
  const fixed = count(snapshot.counts.fixed);
  const unresolved =
    after +
    count(snapshot.counts.review) +
    count(snapshot.counts.skipped) +
    count(snapshot.counts.rolledBack);

  if (before === 0 && fixed === 0 && unresolved === 0) {
    return {
      title: "Tidak ada bagian yang bisa diperbaiki di sini",
      text: "Pemeriksaan ini tidak menemukan bagian yang bisa diperbaiki sendiri oleh AksaraNetra. Ini bukan berarti halaman sudah mudah digunakan semua orang.",
      tone: "neutral",
    } as const;
  }

  if (unresolved > 0) {
    return {
      title: "Masih ada bagian yang perlu diperiksa orang",
      text: "Sebagian hambatan belum aman untuk diperbaiki sendiri oleh AksaraNetra, jadi masih perlu diperiksa lebih lanjut. Kesimpulan ini hanya berlaku untuk halaman yang diperiksa.",
      tone: "attention",
    } as const;
  }

  if (fixed > 0 && after < before) {
    return {
      title: "Sebagian besar hambatan berhasil diperbaiki",
      text: `${fixed} bagian sudah diperbaiki dan diperiksa ulang. Tidak ada masalah baru yang muncul setelah perbaikan.`,
      tone: "success",
    } as const;
  }

  return {
    title: "Belum ada bagian yang bisa diperbaiki dengan aman",
    text: "Hambatan ditemukan, tetapi belum ada yang bisa diperbaiki tanpa risiko mengubah arti halaman. Kesimpulan ini hanya berlaku untuk halaman yang diperiksa.",
    tone: "attention",
  } as const;
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

function Comparison({ snapshot }: { snapshot: Snapshot }) {
  const before = count(snapshot.summary.beforeTotal);
  const after = count(snapshot.summary.afterTotal);
  const maximum = Math.max(before, after, 1);
  const reduction = count(snapshot.summary.reductionPercent);

  return (
    <section className={styles.section} aria-labelledby="comparison-title">
      <div className={styles.sectionHeading}>
        <h2 id="comparison-title">Sebelum dan sesudah diperbaiki</h2>
        <strong className={styles.reduction}>{reduction}% berkurang</strong>
      </div>

      <div
        className={styles.chart}
        role="img"
        aria-label={`${before} hambatan sebelum diperbaiki dan ${after} hambatan setelah diperbaiki`}
      >
        <div className={styles.chartRow}>
          <span>Sebelum</span>
          <div>
            <i style={{ width: `${(before / maximum) * 100}%` }} />
          </div>
          <strong>{before}</strong>
        </div>
        <div className={styles.chartRow}>
          <span>Sesudah</span>
          <div>
            <i
              className={styles.afterBar}
              style={{ width: `${(after / maximum) * 100}%` }}
            />
          </div>
          <strong>{after}</strong>
        </div>
      </div>

      <div
        className={styles.tableWrap}
        role="region"
        aria-label="Perbandingan per aturan"
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption>
            Rincian teknis: jumlah bagian bermasalah pada setiap aturan yang
            diperiksa
          </caption>
          <thead>
            <tr>
              <th scope="col">Aturan</th>
              <th scope="col">Sebelum</th>
              <th scope="col">Sesudah</th>
              <th scope="col">Perubahan</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(snapshot.rules).map(([rule, value]) => (
              <tr key={rule}>
                <th scope="row">
                  <code>{rule}</code>
                </th>
                <td>{count(value.before)}</td>
                <td>{count(value.after)}</td>
                <td>{count(value.before) - count(value.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
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
  const summary = conclusion(snapshot);
  const fixed = count(snapshot.counts.fixed);
  const rolledBack = count(snapshot.counts.rolledBack);
  const skipped = count(snapshot.counts.skipped);

  const [severityFilter, setSeverityFilter] = useState<ImpactLevel | "all">("all");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    snapshot.issues?.[0]?.id ?? null,
  );
  const localHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const resolvedHeadingRef = headingRef ?? localHeadingRef;

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

  const handleSelectSeverity = useCallback((severity: ImpactLevel) => {
    setSeverityFilter((curr) => (curr === severity ? "all" : severity));
    document.getElementById("issue-explorer")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, []);

  const handleJumpToIssue = useCallback((issueId: string) => {
    setSeverityFilter("all");
    setSelectedIssueId(issueId);
    setTimeout(() => {
      const card = document.getElementById(`issue-card-${issueId}`);
      if (card) {
        card.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "center",
        });
      }
    }, 50);
  }, []);

  const recheckHref = `/result?url=${encodeURIComponent(snapshot.source.finalUrl || snapshot.source.requestedUrl)}`;

  return (
    <main className={styles.resultContainer}>
      <div className={styles.notice}>
        <span aria-hidden="true">i</span>
        <p>
          {isDemo
            ? "Mode Demo Interaktif: menampilkan data simulasi statis tanpa menjalankan peramban backend. Situs asli tidak diubah."
            : "Halaman ini adalah tampilan buatan AksaraNetra. Isinya tetap berasal dari situs aslinya, dan situs aslinya tidak diubah."}
        </p>
      </div>

      {isDemo && (
        <div className={styles.demoSwitcher} aria-label="Pilihan data demo">
          <span>Ganti contoh demo:</span>
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

      <header className={styles.resultHeader}>
        <p className={styles.statusLabel}>Pemeriksaan selesai</p>
        <h1 ref={resolvedHeadingRef} tabIndex={-1}>
          {snapshot.source.title || "Hasil pemeriksaan halaman"}
        </h1>
        <p className={styles.source}>
          Sumber:{" "}
          <a
            href={snapshot.source.finalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {snapshot.source.finalUrl}
            <span className="sr-only"> (buka di tab baru)</span>
          </a>
        </p>
        <p className={styles.timestamp}>
          Diperiksa {waktu(snapshot.capturedAt)} · Versi pemeriksaan{" "}
          {snapshot.engineVersion}
        </p>
      </header>

      <section
        className={styles.primaryActions}
        aria-labelledby="actions-title"
      >
        <div className={styles.actionsIntro}>
          <h2 id="actions-title">Baca &amp; Ekspor Hasil</h2>
          <p>
            Baca isi halaman dalam tampilan ramah akses, tinjau halaman hasil
            perbaikan, atau unduh laporan untuk dokumentasi tim.
          </p>
        </div>
        <a
          className="btn btn-primary"
          href={readerHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          Buka versi ramah akses
          <span className="sr-only"> (buka di tab baru)</span>
        </a>
        <a
          className="btn btn-secondary"
          href={patchedHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          Lihat halaman setelah perbaikan
          <span className="sr-only"> (buka di tab baru)</span>
        </a>
        <a
          className="btn btn-secondary"
          href={reportPdfHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          Unduh laporan PDF
          <span className="sr-only"> (buka di tab baru)</span>
        </a>

        <div className={styles.exportRow}>
          {reportJsonHref ? (
            <a
              className="btn btn-secondary"
              href={reportJsonHref}
              download={`aksaranetra-${data.job.jobId}.json`}
            >
              Export JSON
            </a>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                triggerClientDownload(
                  `aksaranetra-${data.job.jobId}.json`,
                  JSON.stringify(data, null, 2),
                  "application/json",
                )
              }
            >
              Export JSON
            </button>
          )}

          {reportCsvHref ? (
            <a
              className="btn btn-secondary"
              href={reportCsvHref}
              download={`aksaranetra-${data.job.jobId}.csv`}
            >
              Export CSV
            </a>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                triggerClientDownload(
                  `aksaranetra-${data.job.jobId}.csv`,
                  buildFallbackCsv(snapshot),
                  "text/csv;charset=utf-8",
                )
              }
            >
              Export CSV
            </button>
          )}

          <Link href="/periksa" className="btn btn-secondary">
            Periksa halaman lain
          </Link>
          <Link href={recheckHref} className="btn btn-secondary">
            Periksa ulang
          </Link>
        </div>
      </section>

      <section className={styles.metricGrid} aria-label="Ringkasan pemeriksaan">
        <article>
          <span>Hambatan ditemukan</span>
          <strong>
            <AngkaNaik value={count(snapshot.summary.beforeTotal)} />
          </strong>
        </article>
        <article>
          <span>Hambatan yang masih ada</span>
          <strong>
            <AngkaNaik value={count(snapshot.summary.afterTotal)} />
          </strong>
        </article>
        <article>
          <span>Berhasil diperbaiki</span>
          <strong>
            <AngkaNaik value={fixed} />
          </strong>
        </article>
        <article>
          <span>Perlu diperiksa orang</span>
          <strong>
            <AngkaNaik value={count(snapshot.counts.review)} />
          </strong>
        </article>
      </section>

      <section
        className={`${styles.conclusionCard} ${styles[summary.tone]}`}
        aria-labelledby="conclusion-title"
      >
        <h2 id="conclusion-title">{summary.title}</h2>
        <p>{summary.text}</p>
      </section>

      <ScoreOverview
        snapshot={snapshot}
        onSelectSeverity={handleSelectSeverity}
      />

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

      <IssueExplorer
        issues={snapshot.issues}
        regulations={snapshot.regulations}
        severityFilter={severityFilter}
        onSeverityFilterChange={setSeverityFilter}
        selectedIssueId={selectedIssueId}
      />

      <Comparison snapshot={snapshot} />

      <section className={styles.section} aria-labelledby="verification-title">
        <div className={styles.sectionHeading}>
          <h2 id="verification-title">Pemeriksaan ulang setelah perbaikan</h2>
          <span
            className={
              snapshot.warnings.wcagRegressionClean
                ? styles.goodBadge
                : styles.attentionBadge
            }
          >
            {snapshot.warnings.wcagRegressionClean
              ? "Tidak ada masalah baru setelah perbaikan"
              : "Masih perlu diperiksa lagi"}
          </span>
        </div>

        <div className={styles.verificationGrid}>
          <div>
            <strong>{fixed}</strong>
            <span>Berhasil diperbaiki</span>
          </div>
          <div>
            <strong>{rolledBack}</strong>
            <span>Dibatalkan karena tidak membantu</span>
          </div>
          <div>
            <strong>{skipped}</strong>
            <span>Belum dapat diperbaiki</span>
          </div>
        </div>

        <details className={styles.details}>
          <summary>Lihat rincian teknis</summary>
          <dl>
            <div>
              <dt>Jumlah hambatan benar-benar menurun</dt>
              <dd>{snapshot.summary.strictImprovement ? "Ya" : "Tidak"}</dd>
            </div>
            <div>
              <dt>Masalah baru setelah perbaikan</dt>
              <dd>{snapshot.summary.noRegression ? "Tidak ada" : "Ada"}</dd>
            </div>
            <div>
              <dt>Perbaikan yang ditinjau orang</dt>
              <dd>{count(snapshot.counts.verifiedOverrides)}</dd>
            </div>
            <div>
              <dt>Tinjauan yang perlu diperbarui</dt>
              <dd>{snapshot.warnings.staleOverrides?.length ?? 0}</dd>
            </div>
            <div>
              <dt>Perbaikan yang diperiksa satu per satu</dt>
              <dd>{fixed}</dd>
            </div>
            <div>
              <dt>Rincian pemeriksaan</dt>
              <dd>Tersedia pada laporan PDF, JSON, dan CSV</dd>
            </div>
          </dl>
        </details>
      </section>

      <section className={styles.evidenceCard}>
        <div>
          <h2>Tangkapan halaman</h2>
          <p>
            Gambar ini memperlihatkan tampilan halaman setelah diperbaiki.
            Rincian lengkapnya ada di laporan yang bisa diunduh.
          </p>
        </div>
        <a
          className="btn btn-secondary"
          href={afterScreenshotHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          Lihat tangkapan halaman
          <span className="sr-only"> (buka di tab baru)</span>
        </a>
      </section>
    </main>
  );
}
