"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import styles from "./page.module.css";
import {
  AuditApiError,
  getAudit,
  readJobToken,
  removeJobToken,
} from "@/lib/audit-api";
import {
  RecentAudit,
  readRecentAudits,
  recentAuditFromJob,
  removeRecentAudit,
  saveRecentAudit,
} from "@/lib/recent-audits";

const ACTIVE = new Set(["queued", "running"]);

/** Lama jendela pembatalan, dalam milidetik. */
const UNDO_DURATION = 7000;

function readableDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function statusLabel(item: RecentAudit) {
  if (item.status === "queued") return "Menunggu giliran";
  if (item.status === "running") return "Sedang diperiksa";
  if (item.status === "completed") return "Hasil siap";
  if (item.status === "failed") return "Tidak berhasil";
  return "Dihentikan";
}

function AuditCard({
  item,
  onRemove,
}: {
  item: RecentAudit;
  onRemove: (jobId: string, triggerEl: HTMLButtonElement) => void;
}) {
  const active = ACTIVE.has(item.status);
  const completed = item.status === "completed";
  const resultHref = `/result?job=${encodeURIComponent(item.jobId)}${completed ? "&open=1" : ""}`;
  const labelTarget = item.title || host(item.sourceUrl);

  return (
    <article className={styles.auditCard}>
      {/* Kolom 1: Informasi Situs & Status */}
      <div className={styles.cardDomainCol}>
        <div className={styles.titleRow}>
          <h3 className={styles.itemTitle}>{labelTarget}</h3>
          <span className={`${styles.status} ${styles[item.status]}`}>
            {statusLabel(item)}
          </span>
        </div>
        <p className={styles.itemUrl} title={item.sourceUrl}>
          {item.sourceUrl}
        </p>
      </div>

      {/* Kolom 2: Metadata Diperiksa */}
      <div className={styles.metaCol}>
        <span className={styles.metaLabel}>DIPERIKSA</span>
        <span className={styles.metaValue}>{readableDate(item.createdAt)}</span>
      </div>

      {/* Kolom 3: Metadata Tahap Terakhir */}
      <div className={styles.metaCol}>
        <span className={styles.metaLabel}>TAHAP TERAKHIR</span>
        <span className={styles.metaValue}>{item.stage}</span>
        {active && (
          <div className={styles.miniProgress}>
            <progress
              className={styles.progress}
              max="100"
              value={item.progress}
              aria-label={`Kemajuan pemeriksaan ${labelTarget}: ${item.progress}%`}
            >
              {item.progress}%
            </progress>
            <span className={styles.progressPct}>{item.progress}%</span>
          </div>
        )}
      </div>

      {/* Kolom 4: Tombol Aksi */}
      <div className={styles.cardActions}>
        <Link
          className="btn btn-primary"
          href={resultHref}
          aria-label={`${
            active ? "Lanjutkan" : completed ? "Baca hasil" : "Keterangan"
          } ${labelTarget}`}
        >
          {active
            ? "Lanjutkan"
            : completed
              ? "Baca hasil"
              : "Keterangan"}
        </Link>
        <Link
          className="btn btn-secondary"
          href={`/periksa?url=${encodeURIComponent(item.sourceUrl)}`}
          aria-label={`Periksa ulang ${labelTarget}`}
        >
          Periksa ulang
        </Link>
        <button
          className={styles.removeButton}
          type="button"
          onClick={(e) => onRemove(item.jobId, e.currentTarget)}
          aria-label={`Hapus riwayat pemeriksaan ${labelTarget}`}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </button>
      </div>
    </article>
  );
}

export default function RiwayatAuditPage() {
  const [items, setItems] = useState<RecentAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState("");

  const [confirmTarget, setConfirmTarget] = useState<RecentAudit | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<RecentAudit | null>(
    null,
  );
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRemovalRef = useRef<RecentAudit | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const undoButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    pendingRemovalRef.current = pendingRemoval;
  }, [pendingRemoval]);

  const refresh = useCallback(async () => {
    const stored = readRecentAudits();
    if (stored.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    const withTokens: Array<{ item: RecentAudit; token: string }> = [];
    for (const item of stored) {
      const token = readJobToken(item.jobId);
      if (!token) {
        removeRecentAudit(item.jobId);
      } else {
        withTokens.push({ item, token });
      }
    }

    const settled = await Promise.allSettled(
      withTokens.map(({ item, token }) => getAudit(item.jobId, token)),
    );

    const verified: RecentAudit[] = [];
    let connectionFailed = false;

    settled.forEach((outcome, index) => {
      const { item } = withTokens[index];
      if (outcome.status === "fulfilled") {
        const next = recentAuditFromJob(outcome.value.job, item);
        saveRecentAudit(next);
        verified.push(next);
      } else {
        const error = outcome.reason;
        if (
          error instanceof AuditApiError &&
          (error.code === "AUDIT_NOT_FOUND" || error.code === "RESULT_EXPIRED")
        ) {
          removeRecentAudit(item.jobId);
          removeJobToken(item.jobId);
          return;
        }
        connectionFailed = true;
        verified.push(item);
      }
    });

    setItems(verified);
    setWarning(
      connectionFailed
        ? "Sebagian keterangan belum dapat dipastikan. Catatan terakhir di perangkat ini tetap ditampilkan."
        : "",
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const handleRemove = useCallback((jobId: string) => {
    removeRecentAudit(jobId);
    removeJobToken(jobId);
    setItems((current) => current.filter((item) => item.jobId !== jobId));
  }, []);

  const requestRemove = (jobId: string, triggerEl: HTMLButtonElement) => {
    const target = items.find((item) => item.jobId === jobId) ?? null;
    if (target) {
      lastTriggerRef.current = triggerEl;
      setConfirmTarget(target);
    }
  };

  const closeDialog = useCallback(() => {
    setConfirmTarget(null);
    requestAnimationFrame(() => {
      lastTriggerRef.current?.focus();
    });
  }, []);

  const confirmRemove = () => {
    const target = confirmTarget;
    if (!target) return;

    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
      if (pendingRemoval) handleRemove(pendingRemoval.jobId);
    }

    setConfirmTarget(null);
    setPendingRemoval(target);
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      handleRemove(target.jobId);
      setPendingRemoval(null);
    }, UNDO_DURATION);
  };

  const undoRemove = () => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    setPendingRemoval(null);
    requestAnimationFrame(() => {
      lastTriggerRef.current?.focus();
    });
  };

  // Jika halaman ditinggalkan sebelum jendela pembatalan habis, selesaikan penghapusan.
  useEffect(() => {
    return () => {
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
        undoTimer.current = null;
        if (pendingRemovalRef.current) {
          removeRecentAudit(pendingRemovalRef.current.jobId);
          removeJobToken(pendingRemovalRef.current.jobId);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (confirmTarget) {
      cancelButtonRef.current?.focus();
    }
  }, [confirmTarget]);

  useEffect(() => {
    if (pendingRemoval) {
      undoButtonRef.current?.focus();
    }
  }, [pendingRemoval]);

  useEffect(() => {
    if (!confirmTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDialog, confirmTarget]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusables = [confirmButtonRef.current, cancelButtonRef.current].filter(
      (el): el is HTMLButtonElement => el !== null,
    );
    if (focusables.length < 2) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const visible = useMemo(
    () =>
      pendingRemoval
        ? items.filter((item) => item.jobId !== pendingRemoval.jobId)
        : items,
    [items, pendingRemoval],
  );

  const groups = useMemo(
    () => ({
      active: visible.filter((item) => ACTIVE.has(item.status)),
      completed: visible.filter((item) => item.status === "completed"),
      ended: visible.filter(
        (item) => item.status === "failed" || item.status === "cancelled",
      ),
    }),
    [visible],
  );

  return (
    <main className={styles.main} aria-busy={loading}>
      <div className={styles.heroWrap}>
        <section className={`container ${styles.hero}`}>
          <div>
            <span className="mono-pill">Riwayat</span>
            <h1>Pemeriksaan tujuh hari terakhir</h1>
            <p className={styles.heroLead}>
              Catatan ini hanya tersimpan di perangkat ini. Lanjutkan pemeriksaan
              yang masih berjalan, atau baca hasil yang sudah siap.
            </p>
          </div>
          <Link href="/periksa" className="btn btn-primary">
            Periksa halaman baru
          </Link>
        </section>
      </div>

      <div className={`container ${styles.content}`}>
        {warning && (
          <p className={styles.warning} role="status">
            {warning}
          </p>
        )}

        {loading ? (
          <section className={styles.loadingState} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            <div>
              <h2>Membuka riwayat</h2>
              <p>Keterangan tiap pemeriksaan sedang dipastikan.</p>
            </div>
          </section>
        ) : visible.length === 0 ? (
          <section className={styles.emptyState}>
            <span className={styles.emptyMark} aria-hidden="true" />
            <h2>Belum ada pemeriksaan tersimpan</h2>
            <p>
              Setelah satu halaman diperiksa, catatannya muncul di sini dan bisa
              dibuka kembali selama tujuh hari.
            </p>
            <Link href="/periksa" className="btn btn-primary">
              Periksa halaman pertama
            </Link>
          </section>
        ) : (
          <div className={styles.sections}>
            {groups.active.length > 0 && (
              <section aria-labelledby="active-title">
                <div className={styles.sectionHeading}>
                  <h2 id="active-title">Sedang berjalan</h2>
                  <span>{groups.active.length}</span>
                </div>
                <div className={styles.auditList}>
                  {groups.active.map((item) => (
                    <AuditCard
                      key={item.jobId}
                      item={item}
                      onRemove={requestRemove}
                    />
                  ))}
                </div>
              </section>
            )}

            {groups.completed.length > 0 && (
              <section aria-labelledby="completed-title">
                <div className={styles.sectionHeading}>
                  <h2 id="completed-title">Hasil siap dibaca</h2>
                  <span>{groups.completed.length}</span>
                </div>
                <div className={styles.auditList}>
                  {groups.completed.map((item) => (
                    <AuditCard
                      key={item.jobId}
                      item={item}
                      onRemove={requestRemove}
                    />
                  ))}
                </div>
              </section>
            )}

            {groups.ended.length > 0 && (
              <section aria-labelledby="ended-title">
                <div className={styles.sectionHeading}>
                  <h2 id="ended-title">Tidak selesai</h2>
                  <span>{groups.ended.length}</span>
                </div>
                <div className={styles.auditList}>
                  {groups.ended.map((item) => (
                    <AuditCard
                      key={item.jobId}
                      item={item}
                      onRemove={requestRemove}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {confirmTarget && (
          <div className={styles.dialogLapis}>
            <div
              className={styles.dialog}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="hapus-title"
              aria-describedby="hapus-desc"
              onKeyDown={handleDialogKeyDown}
            >
              <h2 id="hapus-title">Hapus catatan pemeriksaan ini?</h2>
              <p id="hapus-desc">
                Catatan untuk{" "}
                <strong>
                  {confirmTarget.title || host(confirmTarget.sourceUrl)}
                </strong>{" "}
                akan hilang dari perangkat ini. Halaman aslinya tidak terpengaruh,
                dan halaman itu bisa diperiksa ulang kapan saja.
              </p>
              <div className={styles.dialogActions}>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={confirmRemove}
                  ref={confirmButtonRef}
                >
                  Ya, hapus
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeDialog}
                  ref={cancelButtonRef}
                >
                  Batal
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingRemoval && (
          <div className={styles.snackbar} role="status">
            <p>
              Catatan{" "}
              {pendingRemoval.title || host(pendingRemoval.sourceUrl)} dihapus.
            </p>
            <button
              type="button"
              className={styles.undoButton}
              onClick={undoRemove}
              ref={undoButtonRef}
            >
              Urungkan
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
