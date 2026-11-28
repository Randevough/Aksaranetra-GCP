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

type PhaseKey = "validate" | "open" | "scan" | "remediate" | "report";
type PhaseStatus = "done" | "active" | "pending" | "error";

interface PhaseDefinition {
  key: PhaseKey;
  label: string;
  stepIds: ReadonlyArray<TelemetryStep["id"]>;
}

const PHASE_DEFINITIONS: ReadonlyArray<PhaseDefinition> = [
  {
    key: "validate",
    label: "Validasi",
    stepIds: ["validate", "dns_robots"],
  },
  {
    key: "open",
    label: "Buka Halaman",
    stepIds: ["browser_ready", "hydration", "capture_before"],
  },
  {
    key: "scan",
    label: "Pindai",
    stepIds: ["audit_wcag", "tab_walk"],
  },
  {
    key: "remediate",
    label: "Uji Perbaikan",
    stepIds: ["remediate"],
  },
  {
    key: "report",
    label: "Laporan",
    stepIds: ["serialize", "report"],
  },
];

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
      'Atribut alt apa yang tepat untuk ikon dekoratif di dalam tombol bertuliskan "Unduh PDF"?',
    options: [
      {
        id: "a",
        label: 'alt="" (string kosong) dan aria-hidden="true"',
        correct: true,
        note: "Benar. Ikon dekoratif disembunyikan agar pembaca layar tidak membacakan label ganda.",
      },
      {
        id: "b",
        label: 'alt="gambar-panah-bawah.png"',
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
      'Mengapa teks tautan "Klik di sini" pada daftar berita dianggap hambatan WCAG 2.4.4?',
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
        label: 'Karena browser melarang kata "klik" pada tag <a>',
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

function phaseStatusLabel(status: PhaseStatus): string {
  if (status === "done") return "Selesai";
  if (status === "active") return "Sedang berjalan";
  if (status === "error") return "Perlu perhatian";
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

function resolvePhaseStates(
  steps: TelemetryStep[],
  jobStatus?: AuditJob["status"],
): Array<PhaseDefinition & { status: PhaseStatus }> {
  const stepMap = new Map(steps.map((step) => [step.id, step]));
  let failedPhaseMarked = false;

  return PHASE_DEFINITIONS.map((phase) => {
    const mapped = phase.stepIds
      .map((id) => stepMap.get(id))
      .filter((s): s is TelemetryStep => Boolean(s));

    if (mapped.length === 0) {
      return { ...phase, status: "pending" };
    }

    const hasRunning = mapped.some((s) => s.status === "running");
    const hasWarning = mapped.some((s) => s.status === "warning");
    const allFinished = mapped.every(
      (s) => s.status === "done" || s.status === "warning",
    );

    let status: PhaseStatus = "pending";
    if (hasRunning) {
      if (jobStatus === "failed") {
        status = "error";
        failedPhaseMarked = true;
      } else {
        status = "active";
      }
    } else if (hasWarning) {
      status = "error";
      failedPhaseMarked = true;
    } else if (allFinished) {
      status = "done";
    } else if (jobStatus === "failed" && !failedPhaseMarked) {
      status = "error";
      failedPhaseMarked = true;
    }

    return { ...phase, status };
  });
}

function selectTickerItems(steps: TelemetryStep[]): {
  items: TelemetryStep[];
  currentStepNumber: number;
  totalSteps: number;
} {
  const totalSteps = steps.length;
  const runningIndex = steps.findIndex((s) => s.status === "running");
  const finishedSteps = steps.filter(
    (s) => s.status === "done" || s.status === "warning",
  );

  if (runningIndex !== -1) {
    const activeStep = steps[runningIndex];
    const recentBefore = steps
      .slice(0, runningIndex)
      .filter((s) => s.status !== "pending")
      .slice(-2);
    return {
      items: [...recentBefore, activeStep],
      currentStepNumber: runningIndex + 1,
      totalSteps,
    };
  }

  if (finishedSteps.length > 0) {
    return {
      items: finishedSteps.slice(-3),
      currentStepNumber: Math.min(finishedSteps.length, totalSteps),
      totalSteps,
    };
  }

  return {
    items: steps.slice(0, 1),
    currentStepNumber: 0,
    totalSteps,
  };
}

function PhaseNode({ status }: { status: PhaseStatus }) {
  if (status === "done") {
    return (
      <span className={`${styles.phaseNode} ${styles.phaseNode_done}`} aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.2L4.9 8.6L9.5 3.6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className={`${styles.phaseNode} ${styles.phaseNode_active}`} aria-hidden="true">
        <span className={styles.phaseSpinner} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className={`${styles.phaseNode} ${styles.phaseNode_error}`} aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M6 3.2V6.4M6 8.7H6.01"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className={`${styles.phaseNode} ${styles.phaseNode_pending}`} aria-hidden="true">
      <span className={styles.phaseDotPending} />
    </span>
  );
}

function StepIndicator({ status }: { status: TelemetryStep["status"] }) {
  if (status === "done") {
    return (
      <span className={`${styles.stepIcon} ${styles.stepIcon_done}`} aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.2L4.9 8.6L9.5 3.6"
            stroke="currentColor"
            strokeWidth="1.9"
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

  const phases = resolvePhaseStates(steps, job?.status);
  const ticker = selectTickerItems(steps);

  const stats = telemetry?.stats;
  const allowedCount =
    typeof stats?.requestsAllowed === "number" ? stats.requestsAllowed : 0;
  const blockedCount =
    typeof stats?.requestsBlocked === "number" ? stats.requestsBlocked : 0;
  const showNetworkCounters = allowedCount > 0 || blockedCount > 0;
  const domElementsCount =
    typeof stats?.domElements === "number" && stats.domElements > 0
      ? stats.domElements
      : null;
  const issuesFoundCount =
    typeof stats?.issuesFound === "number" && stats.issuesFound > 0
      ? stats.issuesFound
      : null;
  const tabStopsCount =
    typeof stats?.tabStopsCount === "number" && stats.tabStopsCount > 0
      ? stats.tabStopsCount
      : null;
  const hasInlineStats =
    showNetworkCounters ||
    domElementsCount !== null ||
    issuesFoundCount !== null ||
    tabStopsCount !== null;

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
        <header className={styles.compactHeader}>
          <div className={styles.headerTopRow}>
            <div className={styles.stageColumn}>
              <div className={styles.eyebrowRow}>
                <span className={styles.statusLabel}>
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
                </span>
                {job?.queuePosition ? (
                  <span className={styles.queueChip}>
                    Antrean #{job.queuePosition}
                  </span>
                ) : null}
              </div>
              <h1 id="status-title" ref={headingRef} tabIndex={-1} className={styles.stageTitle}>
                {stage}
              </h1>
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
            />
          </div>

          <div className={styles.headerBottomRow}>
            <div className={styles.metaLeft}>
              <span className={styles.autoHint}>
                {isReconnecting
                  ? "Menghubungkan kembali ke layanan..."
                  : "Hasil terbuka otomatis setelah selesai."}
              </span>
              {hasInlineStats && (
                <div className={styles.inlineStats} aria-label="Statistik pemindaian">
                  {domElementsCount !== null && (
                    <span className={styles.statChip}>
                      <span className={styles.statChipLabel}>DOM</span>
                      <strong className={styles.statChipValue}>
                        {domElementsCount.toLocaleString("id-ID")}
                      </strong>
                    </span>
                  )}
                  {showNetworkCounters && (
                    <>
                      <span className={`${styles.statChip} ${styles.statChipAllowed}`}>
                        <span className={styles.statChipLabel}>Diizinkan</span>
                        <strong className={styles.statChipValue}>{allowedCount}</strong>
                      </span>
                      <span
                        className={`${styles.statChip} ${
                          blockedCount > 0 ? styles.statChipBlocked : ""
                        }`}
                      >
                        <span className={styles.statChipLabel}>Diblokir</span>
                        <strong className={styles.statChipValue}>{blockedCount}</strong>
                      </span>
                    </>
                  )}
                  {issuesFoundCount !== null && (
                    <span className={styles.statChip}>
                      <span className={styles.statChipLabel}>Temuan</span>
                      <strong className={styles.statChipValue}>{issuesFoundCount}</strong>
                    </span>
                  )}
                  {tabStopsCount !== null && (
                    <span className={styles.statChip}>
                      <span className={styles.statChipLabel}>Titik Tab</span>
                      <strong className={styles.statChipValue}>{tabStopsCount}</strong>
                    </span>
                  )}
                </div>
              )}
            </div>

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
                  className={`btn btn-secondary ${styles.cancelButton}`}
                  type="button"
                  onClick={onCancel}
                >
                  Batalkan pemeriksaan
                </button>
              )}
            </div>
          </div>
        </header>

        <nav className={styles.stepperWrap} aria-label="Tahapan pemeriksaan">
          <ol className={styles.stepperList}>
            {phases.map((phase, idx) => {
              const prevDone = idx > 0 && phases[idx - 1].status === "done";
              const currentDone = phase.status === "done";
              return (
                <li
                  key={phase.key}
                  className={`${styles.stepperItem} ${styles[`phase_${phase.status}`]}`}
                  aria-current={phase.status === "active" ? "step" : undefined}
                >
                  <div className={styles.stepperTrackRow}>
                    <span
                      className={`${styles.trackSegment} ${
                        idx === 0
                          ? styles.trackHidden
                          : prevDone
                            ? styles.trackDone
                            : ""
                      }`}
                      aria-hidden="true"
                    />
                    <PhaseNode status={phase.status} />
                    <span
                      className={`${styles.trackSegment} ${
                        idx === phases.length - 1
                          ? styles.trackHidden
                          : currentDone
                            ? styles.trackDone
                            : ""
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                  <div className={styles.phaseMeta}>
                    <span className={styles.phaseLabel}>{phase.label}</span>
                    <span className={styles.srOnly}>
                      {` (${phaseStatusLabel(phase.status)})`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className={styles.stageGrid}>
          <div className={styles.tickerPane}>
            <div className={styles.paneHeader}>
              <h2 className={styles.subHeading}>Aktivitas langsung</h2>
              <span className={styles.stepProgressLabel}>
                {ticker.currentStepNumber > 0
                  ? `Langkah ${ticker.currentStepNumber} dari ${ticker.totalSteps}`
                  : `0 dari ${ticker.totalSteps} langkah`}
              </span>
            </div>

            <ol className={styles.tickerList} aria-live="off">
              {ticker.items.map((step) => (
                <li
                  key={step.id}
                  className={`${styles.tickerItem} ${styles[`ticker_${step.status}`]}`}
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
                        {`${Math.round(step.durationMs)} ms`}
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

          <div className={styles.previewPane}>
            <div className={styles.paneHeader}>
              <h2 className={styles.subHeading}>Pratinjau langsung halaman</h2>
              <span className={styles.previewHostTag}>{displayHost(job?.url)}</span>
            </div>
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
