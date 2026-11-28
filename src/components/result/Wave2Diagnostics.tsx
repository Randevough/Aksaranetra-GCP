"use client";

import { useId, useState } from "react";
import { FileText, Layers, ShieldAlert, Smartphone } from "lucide-react";
import type { PdfAuditItem, Snapshot } from "@/lib/audit-api";
import styles from "./Wave2Diagnostics.module.css";

type DrawerKey = "mobile" | "pdf" | "detectors" | "multipage";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pdfStatusMeta(status: PdfAuditItem["status"]): {
  label: string;
  className: string;
} {
  if (status === "accessible-basics") {
    return { label: "Dasar OK", className: styles.badgeGood };
  }
  if (status === "untagged") {
    return { label: "Tanpa Tag", className: styles.badgeWarn };
  }
  if (status === "scanned-image-only") {
    return { label: "Scan Gambar", className: styles.badgeDanger };
  }
  return { label: "Gagal Periksa", className: styles.badgeDanger };
}

export default function Wave2Diagnostics({
  snapshot,
}: {
  snapshot: Snapshot;
}) {
  const [openDrawer, setOpenDrawer] = useState<DrawerKey | null>(null);
  const drawerId = useId();
  const pdfCaptionId = useId();

  const { mobileAudit, pdfAudit, detectors, multiPage, clusters } = snapshot;

  const hasAnyWave2 = Boolean(
    mobileAudit ||
      pdfAudit ||
      detectors ||
      multiPage ||
      (clusters && clusters.length > 0),
  );

  if (!hasAnyWave2) return null;

  const mobileSummary = (() => {
    if (!mobileAudit) {
      return { text: "Belum diperiksa", tone: styles.toneNeutral };
    }
    if (mobileAudit.pinchZoomBlocked) {
      return { text: "Zoom diblokir", tone: styles.toneDanger };
    }
    if (!mobileAudit.reflowOk) {
      return {
        text: `Ada overflow (${mobileAudit.horizontalOverflowPx}px)`,
        tone: styles.toneWarn,
      };
    }
    return { text: "Aman", tone: styles.toneGood };
  })();

  const pdfSummary = (() => {
    if (!pdfAudit) {
      return { text: "Tidak ditemukan", tone: styles.toneNeutral };
    }
    const base = `${pdfAudit.auditedCount} diperiksa (${pdfAudit.scannedImageCount} scan gambar)`;
    if (pdfAudit.scannedImageCount > 0) {
      return { text: base, tone: styles.toneDanger };
    }
    if (pdfAudit.untaggedCount > 0) {
      return { text: base, tone: styles.toneWarn };
    }
    return { text: base, tone: styles.toneGood };
  })();

  const detectorSummary = (() => {
    if (!detectors) {
      return { text: "Belum diperiksa", tone: styles.toneNeutral };
    }
    const hasOverlay = detectors.overlay.detected;
    const hasCaptcha = detectors.captcha.detected;
    if (hasOverlay || hasCaptcha) {
      const parts: string[] = [];
      if (hasOverlay) parts.push("Overlay");
      if (hasCaptcha) parts.push("CAPTCHA");
      return {
        text: `Terdeteksi (${parts.join(" & ")})`,
        tone: hasCaptcha ? styles.toneDanger : styles.toneWarn,
      };
    }
    return { text: "Bersih", tone: styles.toneGood };
  })();

  const multiPageSummary = (() => {
    if (!multiPage && (!clusters || clusters.length === 0)) {
      return { text: "1 halaman", tone: styles.toneNeutral };
    }
    const pagesCount = multiPage?.crawledCount ?? 1;
    const clusterCount = clusters?.length ?? 0;
    return {
      text: `${pagesCount} halaman, ${clusterCount} pola berulang`,
      tone: clusterCount > 0 ? styles.toneWarn : styles.toneGood,
    };
  })();

  const toggleDrawer = (key: DrawerKey) => {
    setOpenDrawer((prev) => (prev === key ? null : key));
  };

  return (
    <section
      className={styles.wrapper}
      aria-label="Diagnostik lanjutan perangkat seluler, dokumen PDF, overlay, dan lintas halaman"
    >
      <div className={styles.stripCard}>
        <div className={styles.stripHeader}>
          <h2 className={styles.stripTitle}>Pemeriksaan Lanjutan</h2>
        </div>

        <div className={styles.pillRow}>
          <button
            type="button"
            className={`${styles.pillBtn} ${
              openDrawer === "mobile" ? styles.pillBtnActive : ""
            }`}
            aria-expanded={openDrawer === "mobile"}
            aria-controls={drawerId}
            onClick={() => toggleDrawer("mobile")}
          >
            <span className={styles.pillTop}>
              <span
                className={styles.pillLabel}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <Smartphone size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>Tampilan HP (320px)</span>
              </span>
              <span
                className={`${styles.pillChevron} ${
                  openDrawer === "mobile" ? styles.pillChevronOpen : ""
                }`}
                aria-hidden="true"
              >
                ▾
              </span>
            </span>
            <strong className={`${styles.pillValue} ${mobileSummary.tone}`}>
              {mobileSummary.text}
            </strong>
          </button>

          <button
            type="button"
            className={`${styles.pillBtn} ${
              openDrawer === "pdf" ? styles.pillBtnActive : ""
            }`}
            aria-expanded={openDrawer === "pdf"}
            aria-controls={drawerId}
            onClick={() => toggleDrawer("pdf")}
          >
            <span className={styles.pillTop}>
              <span
                className={styles.pillLabel}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <FileText size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>Dokumen PDF</span>
              </span>
              <span
                className={`${styles.pillChevron} ${
                  openDrawer === "pdf" ? styles.pillChevronOpen : ""
                }`}
                aria-hidden="true"
              >
                ▾
              </span>
            </span>
            <strong className={`${styles.pillValue} ${pdfSummary.tone}`}>
              {pdfSummary.text}
            </strong>
          </button>

          <button
            type="button"
            className={`${styles.pillBtn} ${
              openDrawer === "detectors" ? styles.pillBtnActive : ""
            }`}
            aria-expanded={openDrawer === "detectors"}
            aria-controls={drawerId}
            onClick={() => toggleDrawer("detectors")}
          >
            <span className={styles.pillTop}>
              <span
                className={styles.pillLabel}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <ShieldAlert size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>Overlay &amp; CAPTCHA</span>
              </span>
              <span
                className={`${styles.pillChevron} ${
                  openDrawer === "detectors" ? styles.pillChevronOpen : ""
                }`}
                aria-hidden="true"
              >
                ▾
              </span>
            </span>
            <strong className={`${styles.pillValue} ${detectorSummary.tone}`}>
              {detectorSummary.text}
            </strong>
          </button>

          <button
            type="button"
            className={`${styles.pillBtn} ${
              openDrawer === "multipage" ? styles.pillBtnActive : ""
            }`}
            aria-expanded={openDrawer === "multipage"}
            aria-controls={drawerId}
            onClick={() => toggleDrawer("multipage")}
          >
            <span className={styles.pillTop}>
              <span
                className={styles.pillLabel}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <Layers size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>Lintas Halaman</span>
              </span>
              <span
                className={`${styles.pillChevron} ${
                  openDrawer === "multipage" ? styles.pillChevronOpen : ""
                }`}
                aria-hidden="true"
              >
                ▾
              </span>
            </span>
            <strong className={`${styles.pillValue} ${multiPageSummary.tone}`}>
              {multiPageSummary.text}
            </strong>
          </button>
        </div>
      </div>

      {openDrawer && (
        <div id={drawerId} className={styles.drawer}>
          <div className={styles.drawerHeader}>
            <h3 className={styles.drawerTitle}>
              {openDrawer === "mobile" && "Tampilan HP (320px) & Preferensi OS"}
              {openDrawer === "pdf" && "Audit Dokumen PDF"}
              {openDrawer === "detectors" && "Overlay Widget & CAPTCHA"}
              {openDrawer === "multipage" && "Ringkasan Lintas Halaman"}
            </h3>
            <button
              type="button"
              className={styles.closeDrawerBtn}
              onClick={() => setOpenDrawer(null)}
            >
              Tutup detail
            </button>
          </div>

          {openDrawer === "mobile" && (
            <>
              {mobileAudit ? (
                <>
                  <div className={styles.metricGrid}>
                    <div className={styles.metricBox}>
                      <span className={styles.metricLabel}>
                        Luapan Horizontal (WCAG 1.4.10)
                      </span>
                      <strong className={styles.metricValue}>
                        {mobileAudit.horizontalOverflowPx} px
                      </strong>
                      <span className={styles.metricSub}>
                        {mobileAudit.reflowOk
                          ? "Tidak memaksa gulir samping."
                          : "Melebar melewati layar 320px."}
                      </span>
                    </div>

                    <div className={styles.metricBox}>
                      <span className={styles.metricLabel}>
                        Target Sentuh Kecil (WCAG 2.5.8)
                      </span>
                      <strong className={styles.metricValue}>
                        {mobileAudit.smallTargetsCount} elemen
                      </strong>
                      <span className={styles.metricSub}>
                        {mobileAudit.smallTargetsCount === 0
                          ? "Semua tombol minimal 24x24px."
                          : "Ada target di bawah 24x24px."}
                      </span>
                    </div>

                    <div className={styles.metricBox}>
                      <span className={styles.metricLabel}>
                        Spasi Teks (WCAG 1.4.12)
                      </span>
                      <strong className={styles.metricValue}>
                        {mobileAudit.textSpacingOk
                          ? "Aman"
                          : `${mobileAudit.clippedElementsCount} terpotong`}
                      </strong>
                      <span className={styles.metricSub}>
                        {mobileAudit.textSpacingOk
                          ? "Tetap terbaca saat jarak baris diperbesar."
                          : "Teks terpotong saat spasi diperbesar."}
                      </span>
                    </div>

                    <div className={styles.metricBox}>
                      <span className={styles.metricLabel}>
                        Reduced Motion (WCAG 2.3.3)
                      </span>
                      <strong className={styles.metricValue}>
                        {mobileAudit.osPreferences.reducedMotionChecked
                          ? mobileAudit.osPreferences.reducedMotionUnboundedAnimations > 0
                            ? `${mobileAudit.osPreferences.reducedMotionUnboundedAnimations} animasi aktif`
                            : "Patuh"
                          : "Belum dicek"}
                      </strong>
                      <span className={styles.metricSub}>
                        {mobileAudit.osPreferences.reducedMotionUnboundedAnimations > 0
                          ? "Animasi tetap berjalan saat reduced-motion aktif."
                          : "Mengikuti prefers-reduced-motion."}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`${styles.advisoryBox} ${
                      mobileAudit.pinchZoomBlocked
                        ? styles.advisoryDanger
                        : styles.advisoryClean
                    }`}
                  >
                    <strong>
                      {mobileAudit.pinchZoomBlocked
                        ? "Zoom cubit diblokir meta viewport."
                        : "Zoom layar diizinkan."}
                    </strong>
                    <span>
                      {mobileAudit.pinchZoomBlocked
                        ? "Hapus user-scalable=no atau maximum-scale < 2 agar halaman bisa diperbesar 200%+ (WCAG 1.4.4)."
                        : "Pengguna dapat memperbesar tampilan di peramban seluler."}
                    </span>
                  </div>
                </>
              ) : (
                <p className={styles.emptyNote}>
                  Data pemeriksaan seluler 320px belum tersedia.
                </p>
              )}
            </>
          )}

          {openDrawer === "pdf" && (
            <>
              {pdfAudit && pdfAudit.items.length > 0 ? (
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby={pdfCaptionId}
                  className={styles.tableWrapper}
                >
                  <table className={styles.pdfTable}>
                    <caption id={pdfCaptionId}>
                      Daftar dokumen PDF tertaut ({pdfAudit.auditedCount} diperiksa dari{" "}
                      {pdfAudit.discoveredCount} ditemukan)
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Nama Berkas</th>
                        <th scope="col">Halaman</th>
                        <th scope="col">Ukuran</th>
                        <th scope="col">Tag Struktur</th>
                        <th scope="col">Lapisan Teks</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pdfAudit.items.map((item) => {
                        const badge = pdfStatusMeta(item.status);
                        return (
                          <tr key={item.url}>
                            <th scope="row">
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.pdfLink}
                              >
                                {item.filename}
                                <span className="sr-only"> (buka di tab baru)</span>
                              </a>
                            </th>
                            <td>{item.pageCount}</td>
                            <td>{formatBytes(item.sizeBytes)}</td>
                            <td>{item.isTagged ? "Ada tag" : "Tanpa tag"}</td>
                            <td>{item.hasTextLayer ? "Ada teks" : "Gambar scan"}</td>
                            <td>
                              <span
                                className={`${styles.statusBadge} ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.emptyNote}>
                  Tidak ada dokumen PDF tertaut di halaman ini.
                </p>
              )}
            </>
          )}

          {openDrawer === "detectors" && (
            <>
              {detectors ? (
                <>
                  {detectors.overlay.detected && (
                    <div className={styles.advisoryBox}>
                      <strong>
                        Overlay Widget Terdeteksi:{" "}
                        {detectors.overlay.vendors.join(", ") || "Widget Mengambang"}
                      </strong>
                      <p>
                        {detectors.overlay.summaryId ??
                          "Terdeteksi skrip overlay aksesibilitas pihak ketiga."}
                      </p>
                      <p>
                        Widget overlay tidak memperbaiki DOM asli, label formulir,
                        atau urutan fokus. Perbaiki langsung di kode sumber.
                      </p>
                    </div>
                  )}

                  {detectors.captcha.detected && (
                    <div
                      className={`${styles.advisoryBox} ${styles.advisoryDanger}`}
                    >
                      <strong>
                        CAPTCHA Terdeteksi ({detectors.captcha.types.join(", ")})
                      </strong>
                      <p>
                        {detectors.captcha.summaryId ??
                          `Ditemukan ${detectors.captcha.inaccessibleCount} CAPTCHA yang berisiko mengunci pembaca layar.`}
                      </p>
                      <p>
                        Sediakan alternatif non-visual (audio, logika sederhana,
                        atau verifikasi otomatis) sesuai WCAG 3.3.8.
                      </p>
                    </div>
                  )}

                  {!detectors.overlay.detected && !detectors.captcha.detected && (
                    <div
                      className={`${styles.advisoryBox} ${styles.advisoryClean}`}
                    >
                      <strong>Bebas overlay widget dan CAPTCHA penghambat.</strong>
                      <span>
                        Tidak ditemukan widget mengambang atau CAPTCHA gambar yang
                        mengunci pembaca layar.
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <p className={styles.emptyNote}>
                  Data overlay dan CAPTCHA belum tersedia.
                </p>
              )}
            </>
          )}

          {openDrawer === "multipage" && (
            <>
              {multiPage && multiPage.pages.length > 0 && (
                <div>
                  <h4 className={styles.subSectionTitle}>
                    Halaman yang Dipindai ({multiPage.crawledCount} halaman, rata-rata skor{" "}
                    {Math.round(multiPage.averageAfterScore)}/100)
                  </h4>
                  <ul className={styles.pageList} style={{ marginTop: "8px" }}>
                    {multiPage.pages.map((p) => (
                      <li key={p.url} className={styles.pageCard}>
                        <span className={styles.pageTitle}>{p.title}</span>
                        <span className={styles.pageUrl}>{p.url}</span>
                        <span className={styles.pageScore}>
                          Skor: {p.beforeScore} -&gt; {p.afterScore}/100 ({p.issuesCount} temuan)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {clusters && clusters.length > 0 ? (
                <div>
                  <h4 className={styles.subSectionTitle}>
                    Pola Komponen Berulang (Component Clustering)
                  </h4>
                  <ul className={styles.clusterList} style={{ marginTop: "8px" }}>
                    {clusters.map((cluster) => (
                      <li key={cluster.id} className={styles.clusterCard}>
                        <div className={styles.clusterTop}>
                          <span className={styles.clusterTitle}>
                            {cluster.titleId}
                          </span>
                          <span className={`${styles.statusBadge} ${styles.badgeWarn}`}>
                            Dampak {cluster.blastRadiusPercent}% halaman
                          </span>
                        </div>
                        <div className={styles.clusterMeta}>
                          <code className={styles.clusterSelector}>
                            {cluster.selectorPattern}
                          </code>
                          <span>
                            {cluster.occurrences} kemunculan di{" "}
                            {cluster.affectedPages.length} halaman
                          </span>
                        </div>
                        <div className={styles.blastBarTrack} aria-hidden="true">
                          <div
                            className={styles.blastBarFill}
                            style={{
                              width: `${Math.max(4, Math.min(100, cluster.blastRadiusPercent))}%`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                !multiPage?.pages?.length && (
                  <p className={styles.emptyNote}>
                    Audit dijalankan pada satu halaman tunggal.
                  </p>
                )
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
