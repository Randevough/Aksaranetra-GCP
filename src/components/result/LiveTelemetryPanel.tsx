"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { AuditJob, TelemetryStep, artifactUrl } from "@/lib/audit-api";
import { friendlyStage, useSmoothProgress } from "@/hooks/useAuditJob";
import styles from "./LiveTelemetryPanel.module.css";

export interface LiveTelemetryPanelProps {
  job: AuditJob | null;
  onCancel: () => void;
  isReconnecting?: boolean;
  notifyOptIn?: boolean;
  onEnableNotify?: () => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
}

interface QuizQuestion {
  id: string;
  prompt: string;
  options: { id: string; label: string; correct: boolean; note: string }[];
}

const MICRO_QUIZ: QuizQuestion[] = [
  {
    id: "contrast",
    prompt:
      "Berapa rasio kontras minimum WCAG 2.1 Level AA untuk teks ukuran normal (< 18pt)?",
    options: [
      {
        id: "a",
        label: "3,0 : 1",
        correct: false,
        note: "3,0:1 hanya berlaku untuk teks besar (>= 18pt atau 14pt tebal) dan batas komponen UI.",
      },
      {
        id: "b",
        label: "4,5 : 1",
        correct: true,
        note: "Benar. Teks normal memerlukan kontras minimal 4,5:1 terhadap latar belakangnya.",
      },
      {
        id: "c",
        label: "2,0 : 1",
        correct: false,
        note: "2,0:1 terlalu rendah dan menyulitkan pembaca low-vision maupun layar di luar ruangan.",
      },
    ],
  },
  {
    id: "alt",
    prompt:
      "Atribut alt apa yang tepat untuk ikon dekoratif di dalam tombol bertuliskan \"Unduh PDF\"?",
    options: [
      {
        id: "a",
        label: "alt=\"\" (string kosong) dan aria-hidden=\"true\"",
        correct: true,
        note: "Benar. Ikon dekoratif disembunyikan agar pembaca layar tidak membacakan label ganda.",
      },
      {
        id: "b",
        label: "alt=\"gambar-panah-bawah.png\"",
        correct: false,
        note: "Nama berkas hanya menambah kebisingan dan tidak menjelaskan fungsi tombol.",
      },
      {
        id: "c",
        label: "Hapus atribut alt sama sekali",
        correct: false,
        note: "Tanpa atribut alt, pembaca layar sering membacakan URL berkas gambar secara utuh.",
      },
    ],
  },
  {
    id: "link",
    prompt:
      "Mengapa teks tautan \"Klik di sini\" pada daftar berita dianggap hambatan WCAG 2.4.4?",
    options: [
      {
        id: "a",
        label: "Karena terlalu pendek dari sisi panjang karakter",
        correct: false,
        note: "Panjang karakter bukan masalahnya; yang penting adalah kejelasan tujuan tautan.",
      },
      {
        id: "b",
        label: "Karena pembaca layar yang melompat antar-tautan tidak tahu tujuannya",
        correct: true,
        note: "Benar. Pengguna pembaca layar sering menavigasi halaman lewat daftar tautan di luar konteks paragraf.",
      },
      {
        id: "c",
        label: "Karena browser melarang kata \"klik\" pada tag <a>",
        correct: false,
        note: "Browser tidak melarangnya, namun pengguna keyboard dan pembaca layar kehilangan konteks tujuan.",
      },
    ],
  },
];

const FALLBACK_STEPS: Array<{ id: TelemetryStep["id"]; label: string }> = [
  { id: "validate", label: "Validasi alamat" },
  { id: "dns_robots", label: "Verifikasi DNS & robots.txt" },
  { id: "browser_ready", label: "Menyiapkan peramban" },
  { id: "hydration", label: "Menunggu stabilitas DOM" },
  { id: "capture_before", label: "Potret kondisi awal" },
  { id: "audit_wcag", label: "Pindai WCAG 2.1 AA" },
  { id: "tab_walk", label: "Uji alur fokus keyboard" },
  { id: "remediate", label: "Uji perbaikan & rollback" },
  { id: "serialize", label: "Buat versi ramah akses" },
  { id: "report", label: "Susun laporan & ekspor" },
];

function stepStatusLabel(status: TelemetryStep["status"]) {
  if (status === "done") return "Selesai";
  if (status === "running") return "Berjalan";
  if (status === "warning") return "Catatan";
  return "Menunggu";
}

function formatElapsedSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function displayHost(rawUrl?: string): string {
  if (!rawUrl) return "Memuat pratinjau";
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

function StepIndicator({ status }: { status: TelemetryStep["status"] }) {
  if (status === "done") {
    return (
      <span className={`${styles.stepIcon} ${styles.stepIcon_done}`} aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.2L4.9 8.6L9.5 3.6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "running") {
    return <span className={styles.stepSpinner} aria-hidden="true" />;
  }
  if (status === "warning") {
    return (
      <span className={`${styles.stepIcon} ${styles.stepIcon_warning}`} aria-hidden="true">
        !
      </span>
    );
  }
  return <span className={styles.stepDotPending} aria-hidden="true" />;
}

export default function LiveTelemetryPanel({
  job,
  onCancel,
  isReconnecting = false,
  notifyOptIn = false,
  onEnableNotify,
  headingRef,
}: LiveTelemetryPanelProps) {
  const rawProgress = typeof job?.progress === "number" ? job.progress : 0;
  const smoothProgress = useSmoothProgress(rawProgress);
  const stage = isReconnecting
    ? "Menghubungkan kembali ke layanan..."
    : friendlyStage(job?.stage, job?.status);

  const isActive = !job || job.status === "queued" || job.status === "running";
  const anchorIso = job?.createdAt ?? job?.startedAt ?? null;
  const fallbackStartRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (fallbackStartRef.current === null) {
      fallbackStartRef.current = Date.now();
    }
    const parsedStart = anchorIso ? Date.parse(anchorIso) : Number.NaN;
    const startMs = Number.isFinite(parsedStart)
      ? parsedStart
      : fallbackStartRef.current;

    const syncElapsed = () => {
      const next = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      setElapsedSeconds((prev) => (prev === next ? prev : next));
    };

    const initialTimer = setTimeout(syncElapsed, 0);
    if (!isActive) {
      return () => clearTimeout(initialTimer);
    }

    const interval = setInterval(syncElapsed, 500);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [anchorIso, isActive]);

  const telemetry = job?.telemetry ?? null;
  const steps: TelemetryStep[] =
    telemetry?.steps && telemetry.steps.length > 0
      ? telemetry.steps
      : FALLBACK_STEPS.map((item, idx) => ({
          id: item.id,
          label: item.label,
          status:
            smoothProgress >= (idx + 1) * 10
              ? "done"
              : smoothProgress >= idx * 10 && job?.status === "running"
                ? "running"
                : "pending",
        }));

  const [challengeOpen, setChallengeOpen] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const activeQuestion = MICRO_QUIZ[questionIndex];
  const chosen = activeQuestion.options.find((o) => o.id === selectedOption);
  const showNotifyOffer =
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission !== "denied" &&
    !notifyOptIn;
  const formattedElapsed = formatElapsedSeconds(elapsedSeconds);

  return (
    <div className={styles.wrapper}>
      <section className={styles.statusCard} aria-labelledby="status-title">
        <div className={styles.statusTop}>
          <div className={styles.stageColumn}>
            <p className={styles.statusLabel}>
              <span
                className={`${styles.activeDot} ${
                  isReconnecting ? styles.activeDotReconnecting : ""
                }`}
                aria-hidden="true"
              />
              <span>
                {isReconnecting
                  ? "Menyambung ulang"
                  : job?.status === "queued"
                    ? "Dalam antrean"
                    : "Pemeriksaan langsung"}
              </span>
            </p>
            <div className={styles.stageArea}>
              <h1 id="status-title" ref={headingRef} tabIndex={-1}>
                {stage}
              </h1>
            </div>
            {job?.url && <p className={styles.targetUrl}>{job.url}</p>}
          </div>

          <div className={styles.statusMetrics}>
            {isActive && (
              <div
                className={styles.elapsedPill}
                aria-label={`Waktu berjalan ${formattedElapsed}`}
              >
                <span className={styles.elapsedLabel}>Waktu</span>
                <time
                  className={styles.elapsedValue}
                  dateTime={`PT${elapsedSeconds}S`}
                >
                  {formattedElapsed}
                </time>
              </div>
            )}
            <strong className={styles.percent}>{smoothProgress}%</strong>
          </div>
        </div>

        <div
          className={styles.progressBarWrapper}
          role="progressbar"
          aria-valuenow={smoothProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Kemajuan pemeriksaan: ${smoothProgress}%`}
        >
          <div
            className={styles.progressBarFill}
            style={{ width: `${Math.max(smoothProgress, 3)}%` }}
          >
            <span className={styles.progressBarShimmer} aria-hidden="true" />
          </div>
        </div>

        <div className={styles.statusMeta}>
          <span>
            {isReconnecting
              ? "Menghubungkan kembali ke layanan..."
              : job?.queuePosition
                ? `Urutan antrean #${job.queuePosition}`
                : "Hasil terbuka otomatis setelah selesai."}
          </span>
          <div className={styles.metaActions}>
            {showNotifyOffer && onEnableNotify && (
              <button
                type="button"
                className={styles.notifyButton}
                onClick={onEnableNotify}
              >
                Beri tahu saat selesai
              </button>
            )}
            {notifyOptIn && (
              <span className={styles.notifyActive}>Notifikasi aktif</span>
            )}
            {job?.canCancel && (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={onCancel}
              >
                Batalkan pemeriksaan
              </button>
            )}
          </div>
        </div>

        {telemetry?.stats && (
          <dl className={styles.statsRow} aria-label="Statistik pemindaian langsung">
            {typeof telemetry.stats.domElements === "number" && (
              <div>
                <dt>Elemen DOM</dt>
                <dd>{telemetry.stats.domElements.toLocaleString("id-ID")}</dd>
              </div>
            )}
            {typeof telemetry.stats.requestsAllowed === "number" && (
              <div>
                <dt>Diizinkan</dt>
                <dd>{telemetry.stats.requestsAllowed}</dd>
              </div>
            )}
            {typeof telemetry.stats.requestsBlocked === "number" && (
              <div>
                <dt>Diblokir</dt>
                <dd>{telemetry.stats.requestsBlocked}</dd>
              </div>
            )}
            {typeof telemetry.stats.issuesFound === "number" && (
              <div>
                <dt>Temuan awal</dt>
                <dd>{telemetry.stats.issuesFound}</dd>
              </div>
            )}
            {typeof telemetry.stats.tabStopsCount === "number" && (
              <div>
                <dt>Titik Tab</dt>
                <dd>{telemetry.stats.tabStopsCount}</dd>
              </div>
            )}
          </dl>
        )}

        <div className={styles.xrayGrid}>
          <div className={styles.pipelineBox}>
            <h2 className={styles.subHeading}>Alur pemeriksaan</h2>
            <ol className={styles.stepList}>
              {steps.map((step) => (
                <li
                  key={step.id}
                  className={`${styles.stepItem} ${styles[`step_${step.status}`]}`}
                >
                  <StepIndicator status={step.status} />
                  <div className={styles.stepText}>
                    <span className={styles.stepLabel}>{step.label}</span>
                    {step.detail && (
                      <span className={styles.stepDetail}>{step.detail}</span>
                    )}
                  </div>
                  <div className={styles.stepTrailing}>
                    {typeof step.durationMs === "number" ? (
                      <span className={styles.stepDuration}>
                        {step.durationMs} ms
                      </span>
                    ) : (
                      <span className={styles.stepStateBadge}>
                        {stepStatusLabel(step.status)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className={styles.previewBox}>
            <h2 className={styles.subHeading}>Pratinjau langsung halaman</h2>
            {telemetry?.earlyPreviewReady && job?.previewUrl ? (
              <div className={styles.previewFrame}>
                <img
                  src={artifactUrl(job.previewUrl)}
                  alt={`Tangkapan awal halaman ${job.url}`}
                  className={styles.previewImg}
                />
                <div className={styles.scanOverlay} aria-hidden="true">
                  <span className={styles.scanLine} />
                </div>
              </div>
            ) : (
              <div className={styles.previewPlaceholder}>
                <div className={styles.scannerBrowser} aria-hidden="true">
                  <div className={styles.scannerTopbar}>
                    <span className={styles.scannerDots}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className={styles.scannerUrlPill}>
                      {displayHost(job?.url)}
                    </span>
                  </div>
                  <div className={styles.scannerWireframe}>
                    <span className={styles.wireHero} />
                    <div className={styles.wireCols}>
                      <span className={styles.wireBlock} />
                      <span className={styles.wireBlock} />
                    </div>
                    <span className={styles.wireLineShort} />
                  </div>
                  <div className={styles.scannerBeam} />
                </div>
                <p className={styles.placeholderCaption}>
                  Menunggu tangkapan awal halaman...
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        className={styles.challengeCard}
        aria-label="Latihan singkat aksesibilitas"
      >
        <button
          type="button"
          className={styles.challengeToggle}
          aria-expanded={challengeOpen}
          aria-controls="uji-10-detik-panel"
          onClick={() => setChallengeOpen((prev) => !prev)}
        >
          <span className={styles.challengeTitle}>
            Uji Aksesibilitas 10 Detik
          </span>
          <span className={styles.toggleHint}>
            <span>{challengeOpen ? "Tutup" : "Buka kuis"}</span>
            <svg
              className={`${styles.toggleChevron} ${
                challengeOpen ? styles.toggleChevronOpen : ""
              }`}
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3.5 5.25L7 8.75L10.5 5.25"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>

        {challengeOpen && (
          <div id="uji-10-detik-panel" className={styles.challengeBody}>
            <p className={styles.quizMeta}>
              Pertanyaan {questionIndex + 1} dari {MICRO_QUIZ.length}
            </p>
            <p className={styles.quizPrompt}>{activeQuestion.prompt}</p>
            <div
              className={styles.quizOptions}
              role="group"
              aria-label="Pilihan jawaban"
            >
              {activeQuestion.options.map((option) => {
                const isSelected = selectedOption === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`${styles.quizOption} ${
                      isSelected
                        ? option.correct
                          ? styles.quizCorrect
                          : styles.quizWrong
                        : ""
                    }`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedOption(option.id)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div aria-live="polite" className={styles.quizFeedback}>
              {chosen && (
                <p>
                  <strong>{chosen.correct ? "Tepat:" : "Kurang tepat:"}</strong>{" "}
                  {chosen.note}
                </p>
              )}
            </div>
            <div className={styles.quizNav}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setSelectedOption(null);
                  setQuestionIndex((prev) => (prev + 1) % MICRO_QUIZ.length);
                }}
              >
                Pertanyaan berikutnya
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
