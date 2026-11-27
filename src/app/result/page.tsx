"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { useAuditJob } from "@/hooks/useAuditJob";
import LiveTelemetryPanel from "@/components/result/LiveTelemetryPanel";
import ResultWorkspace from "@/components/result/ResultWorkspace";

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

function ResultPageContent() {
  const {
    phase,
    job,
    result,
    isDemo,
    isReconnecting,
    cacheInfo,
    failure,
    liveStage,
    notifyOptIn,
    beginAudit,
    handleDirectRetry,
    stopAudit,
    requestBrowserNotification,
  } = useAuditJob();

  const phaseHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const prevPhaseRef = useRef(phase);

  useEffect(() => {
    if (prevPhaseRef.current === phase) return;
    prevPhaseRef.current = phase;
    if (phase === "initial") return;
    const id = requestAnimationFrame(() => {
      phaseHeadingRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [phase]);

  if (phase === "result" && result) {
    return (
      <ResultWorkspace
        data={result}
        isDemo={isDemo}
        headingRef={phaseHeadingRef}
      />
    );
  }

  const useLinkForErrorAction =
    failure.actionLabel === "Periksa URL" ||
    failure.actionLabel === "Gunakan URL lain" ||
    failure.actionLabel === "Kembali ke beranda" ||
    failure.actionLabel === "Mulai audit baru" ||
    failure.actionLabel === "Periksa halaman" ||
    failure.actionLabel === "Kembali ke pemeriksaan";

  return (
    <main className={styles.shell}>
      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {liveStage}
      </p>

      {(phase === "checking-cache" ||
        phase === "creating" ||
        phase === "initial") && (
        <section className={styles.centerCard}>
          <div className={styles.spinner} aria-hidden="true" />
          <h1 ref={phaseHeadingRef} tabIndex={-1}>
            {phase === "checking-cache"
              ? "Memeriksa hasil tersimpan"
              : "Menyiapkan pemeriksaan"}
          </h1>
          <p>Ini hanya perlu beberapa saat.</p>
        </section>
      )}

      {phase === "cache-choice" && (
        <section className={styles.centerCard}>
          <h1 ref={phaseHeadingRef} tabIndex={-1}>
            Ada hasil pemeriksaan sebelumnya
          </h1>
          <p>
            Hasil dibuat {waktu(cacheInfo?.capturedAt)} dan tersedia sampai{" "}
            {waktu(cacheInfo?.expiresAt)}.
          </p>
          <div className={styles.choiceActions}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void beginAudit(true)}
            >
              Gunakan hasil tersimpan
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void beginAudit(false)}
            >
              Periksa ulang
            </button>
          </div>
        </section>
      )}

      {phase === "tracking" && (
        <LiveTelemetryPanel
          job={job}
          onCancel={() => void stopAudit()}
          isReconnecting={isReconnecting}
          notifyOptIn={notifyOptIn}
          onEnableNotify={() => void requestBrowserNotification()}
        />
      )}

      {phase === "loading-result" && (
        <section className={styles.centerCard} role="status">
          <div className={styles.spinner} aria-hidden="true" />
          <h1 ref={phaseHeadingRef} tabIndex={-1}>
            Membuka hasil pemeriksaan
          </h1>
          <p>Ringkasan, inspeksi visual, dan daftar temuan sedang disiapkan.</p>
        </section>
      )}

      {phase === "cancelled" && (
        <section className={styles.centerCard}>
          <h1 ref={phaseHeadingRef} tabIndex={-1}>
            Pemeriksaan dihentikan
          </h1>
          <p>Tidak ada hasil yang disimpan dari pemeriksaan ini.</p>
          <Link href="/" className="btn btn-primary">
            Kembali ke beranda
          </Link>
        </section>
      )}

      {phase === "error" && (
        <section
          className={`${styles.centerCard} ${styles.errorCard}`}
          role="alert"
        >
          <h1 ref={phaseHeadingRef} tabIndex={-1}>
            {failure.title}
          </h1>
          <p>{failure.message}</p>
          <div className={styles.choiceActions}>
            {useLinkForErrorAction ? (
              <Link href={failure.actionHref} className="btn btn-primary">
                {failure.actionLabel}
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleDirectRetry}
              >
                {failure.actionLabel || "Coba lagi"}
              </button>
            )}
            <Link href="/katalog" className="btn btn-secondary">
              Kembali ke riwayat
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.shell}>
          <section className={styles.centerCard}>
            <h1>Membuka halaman pemeriksaan</h1>
          </section>
        </main>
      }
    >
      <ResultPageContent />
    </Suspense>
  );
}
