export type AuditMode = "single" | "multi";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TelemetryStep {
  id:
    | "validate"
    | "dns_robots"
    | "browser_ready"
    | "hydration"
    | "capture_before"
    | "audit_wcag"
    | "tab_walk"
    | "remediate"
    | "serialize"
    | "report";
  label: string;
  status: "pending" | "running" | "done" | "warning";
  detail?: string | null;
  durationMs?: number | null;
}

export interface AuditTelemetry {
  steps: TelemetryStep[];
  stats: {
    domElements?: number;
    requestsAllowed?: number;
    requestsBlocked?: number;
    issuesFound?: number;
    tabStopsCount?: number;
    hydrationMs?: number;
  };
  earlyPreviewReady: boolean;
  updatedAt: string;
}

export type ImpactLevel = "critical" | "serious" | "moderate" | "minor";
export type PourPrinciple =
  | "perceivable"
  | "operable"
  | "understandable"
  | "robust";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AuditScore {
  overall: number;
  beforeScore: number;
  afterScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  methodology: "automated-wcag-2.1-aa-impact-weighted";
  automatedCoverageNote: string;
  pour: Record<PourPrinciple, number>;
}

export interface SeverityCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  total: number;
}

export interface RegulationReference {
  code: string;
  title: string;
  article: string;
  matchedIssues: number;
}

export interface AuditIssue {
  id: string;
  ruleId: string;
  impact: ImpactLevel;
  status: "fixed" | "review" | "open" | "skipped" | "rolled-back";
  pour: PourPrinciple;
  wcagSc: string[];
  regulations: string[];
  titleId: string;
  descriptionId: string;
  helpId: string;
  selector: string;
  htmlBefore: string | null;
  htmlAfter: string | null;
  boundingBox: BoundingBox | null;
  confidence: number | null;
  source: string | null;
  engines?: string[];
}

export interface TabStop {
  index: number;
  selector: string;
  tag: string;
  role: string;
  label: string;
  rect: BoundingBox;
  obscured: boolean;
  hasVisibleFocus: boolean;
}

export interface PageReadiness {
  waitStrategy: string;
  hydrationAllowed: boolean;
  loadTimeMs: number;
  settledAfterMs: number;
  domElements: number;
  partialLoad: boolean;
  possibleEmptyShell: boolean;
  viewport: { width: number; height: number };
  pageHeight: number;
}

export interface MobileAudit {
  viewport: { width: number; height: number };
  reflowOk: boolean;
  horizontalOverflowPx: number;
  textSpacingOk: boolean;
  clippedElementsCount: number;
  smallTargetsCount: number;
  pinchZoomBlocked: boolean;
  osPreferences: {
    reducedMotionChecked: boolean;
    reducedMotionUnboundedAnimations: number;
    forcedColorsChecked: boolean;
  };
}

export interface PdfAuditItem {
  url: string;
  filename: string;
  sizeBytes: number;
  pageCount: number;
  isTagged: boolean;
  hasTextLayer: boolean;
  hasTitle: boolean;
  hasLang: boolean;
  status: "accessible-basics" | "untagged" | "scanned-image-only" | "error";
  error?: string | null;
}

export interface PdfAuditReport {
  discoveredCount: number;
  auditedCount: number;
  scannedImageCount: number;
  untaggedCount: number;
  items: PdfAuditItem[];
}

export interface DetectorFlags {
  overlay: {
    detected: boolean;
    vendors: string[];
    summaryId: string | null;
  };
  captcha: {
    detected: boolean;
    types: string[];
    inaccessibleCount: number;
    summaryId: string | null;
  };
}

export interface IssueCluster {
  id: string;
  ruleId: string;
  impact: ImpactLevel;
  selectorPattern: string;
  titleId: string;
  affectedPages: string[];
  occurrences: number;
  blastRadiusPercent: number;
}

export interface MultiPagePageSummary {
  url: string;
  title: string;
  beforeScore: number;
  afterScore: number;
  issuesCount: number;
  status: "completed" | "failed" | "skipped";
  error?: string | null;
}

export interface MultiPageSummary {
  mode: AuditMode;
  requestedMaxPages: number;
  crawledCount: number;
  averageAfterScore: number;
  pages: MultiPagePageSummary[];
}

export interface AuditJob {
  jobId: string;
  url: string;
  status: JobStatus;
  stage: string;
  progress: number;
  queuePosition: number | null;
  attempts: number;
  canCancel: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string;
  error: { code: string; message: string } | null;
  telemetry?: AuditTelemetry | null;
  previewUrl?: string | null;
  mode?: AuditMode;
  maxPages?: number;
}

export interface Snapshot {
  formatVersion?: string;
  id?: string;
  origin?: string;
  engineVersion: string;
  capturedAt: string;
  disclaimer: string;
  source: {
    requestedUrl: string;
    finalUrl: string;
    title: string;
    status: number;
    siteLabel?: string | null;
  };
  summary: {
    beforeTotal: number;
    afterTotal: number;
    reduction: number;
    reductionPercent: number;
    strictImprovement: boolean;
    noRegression: boolean;
  };
  rules: Record<string, { before: number; after: number; reduction?: number }>;
  counts: {
    fixed: number;
    review: number;
    skipped: number;
    rolledBack: number;
    verifiedOverrides: number;
  };
  views?: Record<string, unknown>;
  warnings: {
    rolledBack: boolean;
    wcagRegressionClean: boolean;
    worsenedRules: Array<{
      ruleId: string;
      before: number;
      after: number;
      delta: number;
    }>;
    duplicateLabels: unknown[];
    staleOverrides: string[];
    rolledBackRecords: unknown[];
    partialLoad?: string | null;
    possibleEmptyShell?: boolean;
  };
  files?: {
    beforeScreenshot?: string;
    reportJson?: string;
    reportCsv?: string;
    [key: string]: string | undefined;
  };
  guard?: Record<string, unknown>;
  readerGuarantees?: Record<string, unknown>;
  decisions?: unknown[];
  score?: AuditScore;
  severity?: {
    before: SeverityCounts;
    after: SeverityCounts;
  };
  regulations?: RegulationReference[];
  issues?: AuditIssue[];
  tabStops?: TabStop[];
  readiness?: PageReadiness;
  enginesUsed?: string[];
  mobileAudit?: MobileAudit;
  pdfAudit?: PdfAuditReport;
  detectors?: DetectorFlags;
  multiPage?: MultiPageSummary;
  clusters?: IssueCluster[];
}

export interface AuditResult {
  job: AuditJob;
  result: { snapshot: Snapshot; artifacts: Record<string, string> };
  links: {
    reader: string;
    patched: string;
    reportPdf: string;
    screenshot: string;
    beforeScreenshot?: string;
    reportJson?: string;
    reportCsv?: string;
  };
}

export type PublicErrorCode =
  | "INVALID_URL"
  | "TARGET_NOT_PUBLIC"
  | "TARGET_UNREACHABLE"
  | "TARGET_TIMEOUT"
  | "TARGET_BLOCKED_BY_ROBOTS"
  | "BROWSER_NOT_INSTALLED"
  | "AUDIT_RUNTIME_UNAVAILABLE"
  | "RATE_LIMITED"
  | "RESULT_EXPIRED"
  | "AUDIT_NOT_FOUND"
  | "AUDIT_CANCELLED"
  | "AUDIT_FAILED"
  | "NETWORK_ERROR"
  | "INTERNAL_ERROR";

interface PublicErrorCopy {
  title: string;
  message: string;
  actionLabel: string;
  actionHref: string;
}

const ERROR_COPY: Record<PublicErrorCode, PublicErrorCopy> = {
  INVALID_URL: {
    title: "Alamat belum bisa diproses",
    message: "Periksa kembali URL dan pastikan alamat diawali http atau https.",
    actionLabel: "Periksa URL",
    actionHref: "/periksa",
  },
  TARGET_NOT_PUBLIC: {
    title: "Halaman tidak dapat diaudit",
    message:
      "AksaraNetra hanya dapat membuka halaman web yang tersedia untuk publik.",
    actionLabel: "Gunakan URL lain",
    actionHref: "/periksa",
  },
  TARGET_UNREACHABLE: {
    title: "Halaman tidak dapat dijangkau",
    message:
      "Situs tujuan tidak merespons. Tunggu beberapa saat lalu coba lagi.",
    actionLabel: "Coba lagi",
    actionHref: "/periksa",
  },
  TARGET_TIMEOUT: {
    title: "Audit melewati batas waktu",
    message:
      "Halaman membutuhkan waktu terlalu lama untuk diperiksa dengan aman.",
    actionLabel: "Coba lagi",
    actionHref: "/periksa",
  },
  TARGET_BLOCKED_BY_ROBOTS: {
    title: "Audit tidak diizinkan situs",
    message:
      "Aturan robots.txt situs tersebut tidak mengizinkan audit otomatis.",
    actionLabel: "Gunakan URL lain",
    actionHref: "/periksa",
  },
  BROWSER_NOT_INSTALLED: {
    title: "Audit belum dapat dijalankan",
    message:
      "Layanan audit sedang tidak siap. Coba lagi beberapa saat atau hubungi pengelola.",
    actionLabel: "Kembali ke beranda",
    actionHref: "/",
  },
  AUDIT_RUNTIME_UNAVAILABLE: {
    title: "Layanan audit belum siap",
    message: "Runtime audit sedang tidak tersedia. Coba lagi beberapa saat.",
    actionLabel: "Coba lagi",
    actionHref: "/periksa",
  },
  RATE_LIMITED: {
    title: "Batas audit tercapai",
    message:
      "Terlalu banyak audit dibuat dari jaringan ini. Coba lagi setelah jeda.",
    actionLabel: "Kembali ke beranda",
    actionHref: "/",
  },
  RESULT_EXPIRED: {
    title: "Hasil audit telah kedaluwarsa",
    message:
      "Hasil disimpan selama tujuh hari. Jalankan audit baru untuk membuat hasil terkini.",
    actionLabel: "Audit ulang",
    actionHref: "/periksa",
  },
  AUDIT_NOT_FOUND: {
    title: "Audit tidak ditemukan",
    message:
      "Audit ini tidak tersedia di perangkat atau sudah dihapus dari server.",
    actionLabel: "Mulai audit baru",
    actionHref: "/periksa",
  },
  AUDIT_CANCELLED: {
    title: "Audit dibatalkan",
    message: "Proses dihentikan dan artefak sementara sudah dibersihkan.",
    actionLabel: "Mulai audit baru",
    actionHref: "/periksa",
  },
  AUDIT_FAILED: {
    title: "Halaman gagal dimuat",
    message:
      "Situs tujuan kehabisan waktu, menolak koneksi, atau gagal dimuat di tengah proses audit.",
    actionLabel: "Coba lagi",
    actionHref: "/periksa",
  },
  NETWORK_ERROR: {
    title: "Tidak dapat terhubung ke layanan audit",
    message: "Periksa koneksi dan pastikan layanan backend sedang berjalan.",
    actionLabel: "Coba lagi",
    actionHref: "/periksa",
  },
  INTERNAL_ERROR: {
    title: "Audit belum berhasil",
    message:
      "Terjadi kendala internal. Tidak ada hasil yang diklaim dari proses ini.",
    actionLabel: "Kembali ke beranda",
    actionHref: "/",
  },
};

const LEGACY_CODES: Record<string, PublicErrorCode> = {
  "rate-limit": "RATE_LIMITED",
  expired: "RESULT_EXPIRED",
  "not-found": "AUDIT_NOT_FOUND",
  "internal-error": "INTERNAL_ERROR",
  "browser-failed": "AUDIT_RUNTIME_UNAVAILABLE",
  "audit-timeout": "TARGET_TIMEOUT",
  "audit-failed": "AUDIT_FAILED",
  "status-not-ok": "AUDIT_FAILED",
  "bridge-failed": "AUDIT_FAILED",
  "robots-disallowed": "TARGET_BLOCKED_BY_ROBOTS",
  "robots-unavailable": "TARGET_BLOCKED_BY_ROBOTS",
  "robots-fetch-failed": "TARGET_UNREACHABLE",
  "dns-lookup-failed": "TARGET_UNREACHABLE",
  "blocked-address": "TARGET_NOT_PUBLIC",
};

export class AuditApiError extends Error {
  code: PublicErrorCode;
  status: number;
  requestId?: string;

  constructor(code: PublicErrorCode, status = 0, requestId?: string) {
    super(ERROR_COPY[code].message);
    this.name = "AuditApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export function presentAuditError(error: unknown): PublicErrorCopy & {
  code: PublicErrorCode;
} {
  const candidate =
    error instanceof AuditApiError
      ? error.code
      : error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
  const code =
    typeof candidate === "string"
      ? candidate in ERROR_COPY
        ? (candidate as PublicErrorCode)
        : LEGACY_CODES[candidate] ?? "INTERNAL_ERROR"
      : "INTERNAL_ERROR";
  return { code, ...ERROR_COPY[code] };
}

const configuredBase =
  process.env.NEXT_PUBLIC_AUDIT_API_URL || "http://localhost:8787";
export const AUDIT_API_BASE = configuredBase.replace(/\/$/, "");

function normalizeCode(value: unknown, status: number): PublicErrorCode {
  if (typeof value === "string") {
    if (value in ERROR_COPY) return value as PublicErrorCode;
    if (LEGACY_CODES[value]) return LEGACY_CODES[value];
  }
  if (status === 404) return "AUDIT_NOT_FOUND";
  if (status === 410) return "RESULT_EXPIRED";
  if (status === 429) return "RATE_LIMITED";
  return "INTERNAL_ERROR";
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${AUDIT_API_BASE}${path}`, {
      ...init,
      headers: { accept: "application/json", ...init.headers },
      cache: "no-store",
    });
  } catch {
    throw new AuditApiError("NETWORK_ERROR");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const rawError = body?.error;
    const rawCode =
      rawError && typeof rawError === "object" ? rawError.code : rawError;
    const requestId =
      rawError && typeof rawError === "object"
        ? rawError.requestId
        : response.headers.get("x-request-id") || undefined;
    throw new AuditApiError(
      normalizeCode(rawCode, response.status),
      response.status,
      typeof requestId === "string" ? requestId : undefined,
    );
  }
  return body as T;
}

export async function checkAuditCache(url: string) {
  return json<{
    available: boolean;
    capturedAt: string | null;
    expiresAt: string | null;
  }>(`/audits/cache?url=${encodeURIComponent(url)}`);
}

export interface CreateAuditOptions {
  mode?: AuditMode;
  maxPages?: number;
}

export async function createAudit(
  url: string,
  reuseExisting = false,
  options?: CreateAuditOptions,
) {
  const payload: {
    url: string;
    reuseExisting: boolean;
    mode?: AuditMode;
    maxPages?: number;
  } = { url, reuseExisting };
  if (options?.mode) payload.mode = options.mode;
  if (typeof options?.maxPages === "number") payload.maxPages = options.maxPages;

  return json<{
    jobId: string;
    accessToken: string;
    status: JobStatus;
    expiresAt: string;
  }>("/audits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
export const getAudit = (jobId: string, token: string) =>
  json<{ job: AuditJob }>(`/audits/${encodeURIComponent(jobId)}`, {
    headers: auth(token),
  });
export const getAuditResult = (jobId: string, token: string) =>
  json<AuditResult>(`/audits/${encodeURIComponent(jobId)}/result`, {
    headers: auth(token),
  });
export const cancelAudit = (jobId: string, token: string) =>
  json<{ job: AuditJob }>(`/audits/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    headers: auth(token),
  });

const tokenKey = (jobId: string) => `aksaranetra:job:${jobId}`;
export function saveJobToken(jobId: string, token: string) {
  window.localStorage.setItem(tokenKey(jobId), token);
}
export function readJobToken(jobId: string) {
  return window.localStorage.getItem(tokenKey(jobId));
}
export function removeJobToken(jobId: string) {
  window.localStorage.removeItem(tokenKey(jobId));
}
export function artifactUrl(path: string) {
  if (path.startsWith("http") || path.startsWith("/data/")) return path;
  return `${AUDIT_API_BASE}${path}`;
}

export function badgeUrl(domain: string): string {
  const normalized = domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.svg$/i, "");
  return `${AUDIT_API_BASE}/badges/${encodeURIComponent(normalized)}.svg`;
}
