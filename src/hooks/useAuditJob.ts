"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AuditJob,
  AuditResult,
  cancelAudit,
  checkAuditCache,
  createAudit,
  getAudit,
  getAuditResult,
  presentAuditError,
  readJobToken,
  saveJobToken,
} from "@/lib/audit-api";
import { getDemoAudit } from "@/lib/demo-audits";
import {
  RECENT_AUDIT_VERSION,
  findRecentAudit,
  recentAuditFromJob,
  saveRecentAudit,
} from "@/lib/recent-audits";

export type AuditPhase =
  | "initial"
  | "checking-cache"
  | "cache-choice"
  | "creating"
  | "tracking"
  | "loading-result"
  | "result"
  | "cancelled"
  | "error";

export interface AuditFailure {
  title: string;
  message: string;
  actionLabel: string;
  actionHref: string;
}

export function friendlyStage(stage?: string, status?: AuditJob["status"]) {
  if (status === "queued") return "Menyiapkan halaman";
  const value = (stage || "").toLowerCase();
  if (/reader/.test(value)) return "Menyiapkan tampilan ramah akses";
  if (/report|pdf|artifact|summary|ringkas|serialize/.test(value))
    return "Merangkum hasil";
  if (/patch|apply|verify|verif|rollback|perbaikan|remediat/.test(value)) {
    return "Menguji perbaikan";
  }
  if (/tab/.test(value)) {
    return "Memeriksa alur fokus keyboard";
  }
  if (/audit|axe|scan|rule|hambatan|wcag/.test(value)) {
    return "Memeriksa hambatan pada halaman";
  }
  if (/capture|hydration|browser|dns|validate/.test(value)) {
    return "Membuka dan memotret halaman";
  }
  return "Menyiapkan halaman";
}

export function useSmoothProgress(targetProgress: number): number {
  const safeTarget = Math.max(0, Math.min(100, Math.round(targetProgress)));
  const [displayProgress, setDisplayProgress] = useState(safeTarget);
  const currentRef = useRef(safeTarget);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      currentRef.current = safeTarget;
      queueMicrotask(() => setDisplayProgress(safeTarget));
      return;
    }

    let animationFrameId = 0;
    const startValue = currentRef.current;
    const diff = safeTarget - startValue;
    if (diff === 0) return;

    const duration = Math.min(Math.max(Math.abs(diff) * 12, 280), 650);
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const ratio = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - ratio, 3);
      const val = Math.round(startValue + diff * ease);
      currentRef.current = val;
      setDisplayProgress(val);

      if (ratio < 1) {
        animationFrameId = requestAnimationFrame(step);
      }
    };

    animationFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrameId);
  }, [safeTarget]);

  return Math.round(displayProgress);
}

export function useAuditJob() {
  const params = useSearchParams();
  const router = useRouter();
  const urlParam = params.get("url");
  const jobParam = params.get("job");
  const demoParam = params.get("demo");
  const directOpen = params.get("open") === "1";

  const [phase, setPhase] = useState<AuditPhase>("initial");
  const [jobId, setJobId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [job, setJob] = useState<AuditJob | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [targetUrl, setTargetUrl] = useState<string>(() => {
    if (urlParam) return urlParam;
    if (jobParam && typeof window !== "undefined") {
      const rec = findRecentAudit(jobParam);
      if (rec?.sourceUrl) return rec.sourceUrl;
    }
    return "";
  });
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<{
    capturedAt: string | null;
    expiresAt: string | null;
  } | null>(null);
  const [failure, setFailureState] = useState<AuditFailure>({
    title: "Pemeriksaan belum berhasil",
    message: "Terjadi kendala yang tidak terduga.",
    actionLabel: "Coba periksa lagi",
    actionHref: "/periksa",
  });
  const [liveStage, setLiveStage] = useState("");
  const [notifyOptIn, setNotifyOptIn] = useState(false);

  const creatingAudit = useRef(false);
  const lastStage = useRef("");
  const consecutiveErrors = useRef(0);
  const notifyOptInRef = useRef(false);

  useEffect(() => {
    notifyOptInRef.current = notifyOptIn;
  }, [notifyOptIn]);

  const fail = useCallback((error: unknown) => {
    const presented = presentAuditError(error);
    setFailureState(presented);
    setIsReconnecting(false);
    setPhase("error");
  }, []);

  const requestBrowserNotification = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      setNotifyOptIn(true);
      return;
    }
    if (Notification.permission === "denied") {
      setNotifyOptIn(false);
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotifyOptIn(perm === "granted");
    } catch {
      setNotifyOptIn(false);
    }
  }, []);

  const loadResult = useCallback(
    async (targetJobId: string, accessToken: string) => {
      setPhase("loading-result");
      try {
        const nextResult = await getAuditResult(targetJobId, accessToken);
        setResult(nextResult);
        setJob(nextResult.job);
        const previous = findRecentAudit(targetJobId);
        saveRecentAudit({
          ...recentAuditFromJob(nextResult.job, previous),
          title:
            nextResult.result.snapshot.source.title ||
            previous?.title ||
            undefined,
        });
        setPhase("result");
      } catch (error) {
        fail(error);
      }
    },
    [fail],
  );

  const beginAuditForUrl = useCallback(
    async (urlToAudit: string, reuseExisting: boolean) => {
      if (!urlToAudit || creatingAudit.current) return;
      creatingAudit.current = true;
      setPhase("creating");
      try {
        const created = await createAudit(urlToAudit, reuseExisting);
        const now = new Date().toISOString();
        saveJobToken(created.jobId, created.accessToken);
        saveRecentAudit({
          version: RECENT_AUDIT_VERSION,
          jobId: created.jobId,
          sourceUrl: urlToAudit,
          status: created.status,
          stage: "Menyiapkan halaman",
          progress: 0,
          createdAt: now,
          updatedAt: now,
          expiresAt: created.expiresAt,
        });
        setJobId(created.jobId);
        setToken(created.accessToken);
        setTargetUrl(urlToAudit);
        consecutiveErrors.current = 0;
        setIsReconnecting(false);
        setPhase("tracking");
        router.replace(`/result?job=${encodeURIComponent(created.jobId)}`);
      } catch (error) {
        creatingAudit.current = false;
        fail(error);
      }
    },
    [fail, router],
  );

  const beginAudit = useCallback(
    async (reuseExisting: boolean) => {
      const activeUrl = targetUrl || urlParam;
      if (activeUrl) {
        await beginAuditForUrl(activeUrl, reuseExisting);
      }
    },
    [beginAuditForUrl, targetUrl, urlParam],
  );

  const handleDirectRetry = useCallback(() => {
    const candidateUrl =
      targetUrl ||
      urlParam ||
      job?.url ||
      (jobId ? findRecentAudit(jobId)?.sourceUrl : null);

    if (candidateUrl) {
      creatingAudit.current = false;
      consecutiveErrors.current = 0;
      setIsReconnecting(false);
      setTargetUrl(candidateUrl);
      setPhase("checking-cache");
      checkAuditCache(candidateUrl)
        .then((cache) => {
          if (cache.available) {
            setCacheInfo(cache);
            setPhase("cache-choice");
          } else {
            void beginAuditForUrl(candidateUrl, false);
          }
        })
        .catch(() => {
          void beginAuditForUrl(candidateUrl, false);
        });
    } else if (jobId && token) {
      consecutiveErrors.current = 0;
      setIsReconnecting(false);
      setPhase("tracking");
    } else {
      router.push("/periksa");
    }
  }, [beginAuditForUrl, job?.url, jobId, router, targetUrl, token, urlParam]);

  useEffect(() => {
    if (demoParam) {
      const demo = getDemoAudit(demoParam);
      if (demo) {
        queueMicrotask(() => {
          setIsDemo(true);
          setJob(demo.job);
          setTargetUrl(demo.job.url);
          setResult(demo);
          setPhase("result");
        });
        return;
      }
      queueMicrotask(() => {
        setFailureState({
          title: "Data demo tidak ditemukan",
          message:
            "Preset demo yang diminta tidak tersedia. Pilih demo dari halaman pemeriksaan.",
          actionLabel: "Kembali ke pemeriksaan",
          actionHref: "/periksa",
        });
        setPhase("error");
      });
      return;
    }

    if (jobParam) {
      const saved = readJobToken(jobParam);
      if (!saved) {
        queueMicrotask(() => {
          setIsDemo(false);
          setFailureState({
            title: "Hasil tidak dapat dibuka",
            message:
              "Token pemeriksaan tidak ditemukan di perangkat ini. Jalankan pemeriksaan ulang.",
            actionLabel: "Periksa ulang",
            actionHref: "/periksa",
          });
          setPhase("error");
        });
        return;
      }
      queueMicrotask(() => {
        setIsDemo(false);
        setJobId(jobParam);
        setToken(saved);
        const recent = findRecentAudit(jobParam);
        if (recent?.sourceUrl) setTargetUrl(recent.sourceUrl);
        if (directOpen) {
          void loadResult(jobParam, saved);
        } else {
          setPhase("tracking");
        }
      });
      return;
    }

    if (!urlParam) {
      queueMicrotask(() => {
        setIsDemo(false);
        setFailureState({
          title: "Alamat pemeriksaan tidak ditemukan",
          message: "Mulai pemeriksaan baru.",
          actionLabel: "Periksa halaman",
          actionHref: "/periksa",
        });
        setPhase("error");
      });
      return;
    }

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setIsDemo(false);
      setTargetUrl(urlParam);
      setPhase("checking-cache");
      checkAuditCache(urlParam)
        .then((cache) => {
          if (!active) return;
          if (cache.available) {
            setCacheInfo(cache);
            setPhase("cache-choice");
          } else {
            void beginAuditForUrl(urlParam, false);
          }
        })
        .catch((error) => {
          if (active) fail(error);
        });
    });

    return () => {
      active = false;
    };
  }, [beginAuditForUrl, demoParam, directOpen, fail, jobParam, loadResult, urlParam]);

  useEffect(() => {
    if (phase !== "tracking" || !jobId || !token || isDemo) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const response = await getAudit(jobId, token);
        if (!active) return;
        consecutiveErrors.current = 0;
        setIsReconnecting(false);
        setJob(response.job);
        if (response.job.url) setTargetUrl(response.job.url);
        saveRecentAudit(
          recentAuditFromJob(response.job, findRecentAudit(jobId)),
        );
        const nextStage = friendlyStage(
          response.job.stage,
          response.job.status,
        );
        if (nextStage !== lastStage.current) {
          lastStage.current = nextStage;
          setLiveStage(nextStage);
        }
        if (response.job.status === "completed") {
          setJob({
            ...response.job,
            progress: 100,
            stage: "Pemeriksaan selesai",
          });
          setLiveStage("Pemeriksaan selesai, membuka hasil");
          if (
            notifyOptInRef.current &&
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            try {
              new Notification("Pemeriksaan selesai", {
                body: response.job.url || "Hasil audit AksaraNetra sudah siap.",
              });
            } catch {
              // Abaikan bila browser memblokir notifikasi latar belakang.
            }
          }
          void loadResult(jobId, token);
          return;
        }
        if (response.job.status === "failed") {
          fail(response.job.error);
          return;
        }
        if (response.job.status === "cancelled") {
          setPhase("cancelled");
          return;
        }
        timer = setTimeout(poll, 1000);
      } catch (error) {
        if (!active) return;
        consecutiveErrors.current += 1;
        if (consecutiveErrors.current <= 15) {
          setIsReconnecting(true);
          const reconnectMsg = "Sedang menghubungkan kembali ke layanan audit...";
          setLiveStage(reconnectMsg);
          timer = setTimeout(poll, 3000);
        } else {
          setIsReconnecting(false);
          fail(error);
        }
      }
    };

    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [fail, isDemo, jobId, loadResult, phase, token]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (phase === "tracking") {
      const pct = Math.max(0, Math.min(100, Math.round(job?.progress ?? 0)));
      document.title = `[${pct}%] Mengaudit... — AksaraNetra`;
    } else if (phase === "result" && result) {
      const pageName =
        result.result.snapshot.source.title || "Hasil pemeriksaan";
      document.title = `${pageName} | AksaraNetra`;
    } else if (phase === "error") {
      document.title = `${failure.title} | AksaraNetra`;
    } else if (phase === "cancelled") {
      document.title = "Pemeriksaan dihentikan | AksaraNetra";
    } else {
      document.title = "Hasil pemeriksaan | AksaraNetra";
    }
  }, [failure.title, job?.progress, phase, result]);

  const stopAudit = useCallback(async () => {
    if (!jobId || !token) return;
    try {
      const response = await cancelAudit(jobId, token);
      setJob(response.job);
      saveRecentAudit(recentAuditFromJob(response.job, findRecentAudit(jobId)));
      setPhase("cancelled");
    } catch (error) {
      fail(error);
    }
  }, [fail, jobId, token]);

  return {
    phase,
    job,
    result,
    isDemo,
    targetUrl,
    isReconnecting,
    cacheInfo,
    failure,
    liveStage,
    notifyOptIn,
    beginAudit,
    handleDirectRetry,
    stopAudit,
    requestBrowserNotification,
  };
}
