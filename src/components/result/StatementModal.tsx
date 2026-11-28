"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { badgeUrl, type Snapshot } from "@/lib/audit-api";
import { extractHost, type FastPassSummary } from "./wave2-types";
import styles from "./StatementModal.module.css";

type ModalTab = "statement" | "badge";

function formatTanggalIndonesia(iso?: string): string {
  const bulan = [
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
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "Tanggal belum tercatat";
  return `${date.getDate()} ${bulan[date.getMonth()]} ${date.getFullYear()}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function StatementModal({
  open,
  onClose,
  snapshot,
  fastPass,
  isDemo,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: Snapshot;
  fastPass: FastPassSummary;
  isDemo: boolean;
}) {
  const [activeTab, setActiveTab] = useState<ModalTab>("statement");
  const [contactEmail, setContactEmail] = useState("");
  const [copiedKind, setCopiedKind] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const statementTabRef = useRef<HTMLButtonElement | null>(null);
  const badgeTabRef = useRef<HTMLButtonElement | null>(null);

  const titleId = useId();
  const contactInputId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Fallback light-dismiss for browsers without <dialog closedby="any">
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if ("closedBy" in HTMLDialogElement.prototype) return;

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };

    const handlePointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener("pointerdown", handlePointerDown);
    dialog.addEventListener("pointerup", handlePointerUp);
    return () => {
      dialog.removeEventListener("pointerdown", handlePointerDown);
      dialog.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const siteUrl = snapshot.source.finalUrl || snapshot.source.requestedUrl;
  const host = extractHost(siteUrl);
  const siteTitle = snapshot.source.siteLabel || snapshot.source.title || host;
  const afterScore = snapshot.score
    ? Math.round(snapshot.score.afterScore)
    : 0;
  const beforeScore = snapshot.score
    ? Math.round(snapshot.score.beforeScore)
    : 0;
  const grade = snapshot.score?.grade ?? "-";
  const auditDate = formatTanggalIndonesia(snapshot.capturedAt);
  const remainingIssues = snapshot.summary.afterTotal ?? 0;

  const manualLine =
    fastPass.checked === 0
      ? "Belum dilakukan (0 dari 6 poin cek manual diperiksa)."
      : `${fastPass.passed} lolos, ${fastPass.failed} bermasalah, dan ${fastPass.total - fastPass.checked} belum diperiksa (dari ${fastPass.total} poin cek manual).`;

  const contactDisplay = contactEmail.trim() || "[isi email/kontak pengelola]";

  const statementMarkdown = useMemo(() => {
    return [
      `# Pernyataan Aksesibilitas Digital: ${siteTitle}`,
      "",
      `Pengelola situs **${siteTitle}** (${siteUrl}) berkomitmen menyediakan layanan informasi elektronik yang dapat diakses oleh penyandang disabilitas dan seluruh masyarakat.`,
      "",
      "## Landasan Standar & Regulasi",
      "- **UU No. 8 Tahun 2016** tentang Penyandang Disabilitas (Pasal 19, 24, dan 105).",
      "- **PP No. 42 Tahun 2020** tentang Aksesibilitas terhadap Permukiman, Pelayanan Publik, dan Pelindungan dari Bencana bagi Penyandang Disabilitas.",
      "- **PermenPANRB No. 11 Tahun 2024** tentang Penyelenggaraan Pelayanan Publik Ramah Kelompok Rentan.",
      "- **SNI ISO/IEC 40500** (WCAG 2.1 Level AA).",
      "",
      "## Status Pemeriksaan Terakhir",
      `- **Tanggal pemeriksaan:** ${auditDate}`,
      `- **Skor pemeriksaan otomatis:** ${afterScore}/100 (Peringkat ${grade}; sebelum perbaikan otomatis: ${beforeScore}/100; sisa temuan otomatis: ${remainingIssues}).`,
      "- **Cakupan uji otomatis:** Pemeriksaan otomatis mencakup sekitar 30 sampai 57 persen kriteria WCAG 2.1 Level AA dan tidak menggantikan pengujian manusia.",
      `- **Status cek manual 5 menit (FastPass):** ${manualLine}`,
      "",
      "## Umpan Balik & Bantuan Akses",
      `Jika Anda menemukan kendala akses pada situs ini, silakan hubungi pengelola melalui ${contactDisplay}.`,
    ].join("\n");
  }, [
    afterScore,
    auditDate,
    beforeScore,
    contactDisplay,
    grade,
    manualLine,
    remainingIssues,
    siteTitle,
    siteUrl,
  ]);

  const statementHtml = useMemo(() => {
    return [
      `<section aria-labelledby="pernyataan-aksesibilitas">`,
      `  <h1 id="pernyataan-aksesibilitas">Pernyataan Aksesibilitas Digital: ${escapeHtml(siteTitle)}</h1>`,
      `  <p>Pengelola situs <strong>${escapeHtml(siteTitle)}</strong> (<a href="${escapeHtml(siteUrl)}">${escapeHtml(siteUrl)}</a>) berkomitmen menyediakan layanan informasi elektronik yang dapat diakses oleh penyandang disabilitas dan seluruh masyarakat.</p>`,
      `  <h2>Landasan Standar dan Regulasi</h2>`,
      `  <ul>`,
      `    <li><strong>UU No. 8 Tahun 2016</strong> tentang Penyandang Disabilitas.</li>`,
      `    <li><strong>PP No. 42 Tahun 2020</strong> tentang Aksesibilitas Pelayanan Publik.</li>`,
      `    <li><strong>PermenPANRB No. 11 Tahun 2024</strong> tentang Pelayanan Publik Ramah Kelompok Rentan.</li>`,
      `    <li><strong>SNI ISO/IEC 40500</strong> (WCAG 2.1 Level AA).</li>`,
      `  </ul>`,
      `  <h2>Status Pemeriksaan Terakhir</h2>`,
      `  <ul>`,
      `    <li><strong>Tanggal pemeriksaan:</strong> ${escapeHtml(auditDate)}</li>`,
      `    <li><strong>Skor pemeriksaan otomatis:</strong> ${afterScore}/100 (Peringkat ${escapeHtml(grade)}; sebelum perbaikan otomatis: ${beforeScore}/100; sisa temuan otomatis: ${remainingIssues}).</li>`,
      `    <li><strong>Cakupan uji otomatis:</strong> Sekitar 30 sampai 57 persen kriteria WCAG 2.1 Level AA.</li>`,
      `    <li><strong>Status cek manual 5 menit:</strong> ${escapeHtml(manualLine)}</li>`,
      `  </ul>`,
      `  <h2>Umpan Balik dan Bantuan Akses</h2>`,
      `  <p>Jika Anda menemukan kendala akses pada situs ini, hubungi pengelola melalui ${escapeHtml(contactDisplay)}.</p>`,
      `</section>`,
    ].join("\n");
  }, [
    afterScore,
    auditDate,
    beforeScore,
    contactDisplay,
    grade,
    manualLine,
    remainingIssues,
    siteTitle,
    siteUrl,
  ]);

  const badgeSrc = badgeUrl(host);
  const badgeAlt = `AksaraNetra (Skor Otomatis): ${afterScore}/100 Peringkat ${grade} untuk ${host}`;
  const badgeHtmlSnippet = `<a href="${siteUrl}" target="_blank" rel="noopener noreferrer"><img src="${badgeSrc}" alt="${escapeHtml(badgeAlt)}" width="310" height="28" /></a>`;
  const badgeMarkdownSnippet = `[![${badgeAlt}](${badgeSrc})](${siteUrl})`;

  const copyPayload = async (kind: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKind(kind);
      setCopyMessage(`${kind} berhasil disalin ke papan klip.`);
      setTimeout(() => {
        setCopiedKind((curr) => (curr === kind ? null : curr));
      }, 2400);
    } catch {
      setCopyMessage("Gagal menyalin otomatis. Salin teks dari kotak pratinjau.");
    }
  };

  const handleTabKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    current: ModalTab,
  ) => {
    if (
      e.key === "ArrowRight" ||
      e.key === "ArrowLeft" ||
      e.key === "Home" ||
      e.key === "End"
    ) {
      e.preventDefault();
      const next: ModalTab =
        e.key === "Home"
          ? "statement"
          : e.key === "End"
            ? "badge"
            : current === "statement"
              ? "badge"
              : "statement";
      setActiveTab(next);
      requestAnimationFrame(() => {
        (next === "statement" ? statementTabRef : badgeTabRef).current?.focus();
      });
    }
  };

  const badgeScoreText = `${afterScore}/100 (${grade})`;
  const badgeColor =
    afterScore >= 80 ? "#0f766e" : afterScore >= 60 ? "#854d0e" : "#9f1239";

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      {...({ closedby: "any" } as Record<string, string>)}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className={styles.header}>
        <h2
          id={titleId}
          style={{
            fontSize: "19px",
            fontWeight: 800,
            lineHeight: 1.25,
            color: "var(--color-heading)",
          }}
        >
          Pernyataan Aksesibilitas &amp; Badge Skor
        </h2>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
        >
          Tutup
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Pilih format publikasi aksesibilitas"
        className={styles.tablist}
      >
        <button
          ref={statementTabRef}
          id="statement-modal-tab-a"
          type="button"
          role="tab"
          aria-selected={activeTab === "statement"}
          tabIndex={activeTab === "statement" ? 0 : -1}
          className={styles.tabBtn}
          onClick={() => setActiveTab("statement")}
          onKeyDown={(e) => handleTabKeyDown(e, "statement")}
        >
          Pernyataan Aksesibilitas
        </button>
        <button
          ref={badgeTabRef}
          id="statement-modal-tab-b"
          type="button"
          role="tab"
          aria-selected={activeTab === "badge"}
          tabIndex={activeTab === "badge" ? 0 : -1}
          className={styles.tabBtn}
          onClick={() => setActiveTab("badge")}
          onKeyDown={(e) => handleTabKeyDown(e, "badge")}
        >
          Badge Skor SVG
        </button>
      </div>

      <div className={styles.body}>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {copyMessage}
        </p>

        <div
          role="tabpanel"
          aria-labelledby="statement-modal-tab-a"
          hidden={activeTab !== "statement"}
        >
          <div className={styles.panelInner}>
            <div className={styles.honestyBanner}>
              Skor otomatis ({afterScore}/100) dipisah dari cek manual FastPass (
              {fastPass.checked}/{fastPass.total} diperiksa), mengacu pada UU No.
              8/2016, PP No. 42/2020, PermenPANRB No. 11/2024, dan SNI ISO/IEC 40500.
            </div>

            <div className={styles.fieldRow}>
              <label htmlFor={contactInputId}>
                Email atau kontak pengelola (opsional)
              </label>
              <input
                id={contactInputId}
                type="text"
                className="input"
                placeholder="Contoh: ppid@instansi.go.id"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>

            <pre className={styles.previewBox}>{statementMarkdown}</pre>

            <div className={styles.actionRow}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void copyPayload("Markdown pernyataan", statementMarkdown)}
              >
                {copiedKind === "Markdown pernyataan"
                  ? "Markdown Tersalin"
                  : "Salin Markdown"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void copyPayload("HTML pernyataan", statementHtml)}
              >
                {copiedKind === "HTML pernyataan" ? "HTML Tersalin" : "Salin HTML"}
              </button>
            </div>
          </div>
        </div>

        <div
          role="tabpanel"
          aria-labelledby="statement-modal-tab-b"
          hidden={activeTab !== "badge"}
        >
          <div className={styles.panelInner}>
            <div className={styles.badgeStage}>
              {isDemo ? (
                <svg
                  width="310"
                  height="28"
                  viewBox="0 0 310 28"
                  role="img"
                  aria-label={badgeAlt}
                >
                  <rect width="222" height="28" rx="4" fill="#16181d" />
                  <rect x="218" width="92" height="28" rx="4" fill={badgeColor} />
                  <rect x="218" width="6" height="28" fill={badgeColor} />
                  <text
                    x="12"
                    y="18"
                    fill="#ffffff"
                    fontFamily="system-ui, sans-serif"
                    fontSize="12"
                    fontWeight="700"
                  >
                    AksaraNetra (Skor Otomatis)
                  </text>
                  <text
                    x="264"
                    y="18"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontFamily="system-ui, sans-serif"
                    fontSize="12"
                    fontWeight="800"
                  >
                    {badgeScoreText}
                  </text>
                </svg>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={badgeSrc}
                  alt={badgeAlt}
                  width={310}
                  height={28}
                />
              )}
              <p className={styles.badgeNote}>
                Label &ldquo;Skor Otomatis&rdquo; menandai hasil uji mesin, bukan
                bukti kepatuhan WCAG 100% tanpa uji pengguna.
              </p>
            </div>

            <pre className={styles.previewBox}>{badgeHtmlSnippet}</pre>

            <div className={styles.actionRow}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void copyPayload("HTML badge", badgeHtmlSnippet)}
              >
                {copiedKind === "HTML badge" ? "HTML Tersalin" : "Salin HTML"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  void copyPayload("Markdown badge", badgeMarkdownSnippet)
                }
              >
                {copiedKind === "Markdown badge"
                  ? "Markdown Tersalin"
                  : "Salin Markdown"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
