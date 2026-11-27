export type FastPassStatus = "untested" | "pass" | "fail";

export interface FastPassSummary {
  total: number;
  checked: number;
  passed: number;
  failed: number;
}

export const FASTPASS_TOTAL_ITEMS = 6;

export function fastPassStorageKey(jobId: string): string {
  return `aksaranetra:fastpass:${jobId}`;
}

export function readFastPassSummary(jobId: string): FastPassSummary {
  const empty: FastPassSummary = {
    total: FASTPASS_TOTAL_ITEMS,
    checked: 0,
    passed: 0,
    failed: 0,
  };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(fastPassStorageKey(jobId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Record<string, FastPassStatus>;
    if (!parsed || typeof parsed !== "object") return empty;
    let passed = 0;
    let failed = 0;
    for (const val of Object.values(parsed)) {
      if (val === "pass") passed += 1;
      else if (val === "fail") failed += 1;
    }
    return {
      total: FASTPASS_TOTAL_ITEMS,
      checked: passed + failed,
      passed,
      failed,
    };
  } catch {
    return empty;
  }
}

export function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0] || "situs";
  }
}
