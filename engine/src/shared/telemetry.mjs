/**
 * Live telemetry state tracker matching the AuditTelemetry contract.
 */

export const TELEMETRY_STEP_DEFINITIONS = Object.freeze([
  { id: "validate", label: "Validasi URL & kebijakan keamanan" },
  { id: "dns_robots", label: "Verifikasi DNS publik & robots.txt" },
  { id: "browser_ready", label: "Persiapan browser & network guard" },
  { id: "hydration", label: "Pemuatan & hidrasi halaman" },
  { id: "capture_before", label: "Tangkapan layar awal (before)" },
  { id: "audit_wcag", label: "Pemindaian WCAG awal" },
  { id: "tab_walk", label: "Penelusuran fokus keyboard & bounding box" },
  { id: "remediate", label: "Penerapan & verifikasi patch" },
  { id: "serialize", label: "Penyusunan reader view & patched HTML" },
  { id: "report", label: "Finalisasi laporan & artefak" },
]);

export function createTelemetryTracker({ guardStats = null } = {}) {
  let activeGuard = guardStats;
  let earlyPreviewReady = false;
  const stats = {};
  const steps = TELEMETRY_STEP_DEFINITIONS.map((def) => ({
    id: def.id,
    label: def.label,
    status: "pending",
    detail: null,
    durationMs: null,
  }));
  const startedAt = new Map();

  function setGuardStats(nextGuard) {
    activeGuard = nextGuard;
  }

  function setStep(id, status, detail = null, durationMs = null) {
    const step = steps.find((item) => item.id === id);
    if (!step) return;

    if (status === "running" && !startedAt.has(id)) {
      startedAt.set(id, Date.now());
    }

    if ((status === "done" || status === "warning") && durationMs === null) {
      const began = startedAt.get(id);
      if (typeof began === "number") {
        step.durationMs = Math.max(0, Date.now() - began);
      }
    } else if (typeof durationMs === "number") {
      step.durationMs = durationMs;
    }

    step.status = status;
    if (detail !== undefined) {
      step.detail = detail;
    }
  }

  function updateStats(patch = {}) {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        stats[key] = value;
      }
    }
  }

  function setEarlyPreviewReady(ready) {
    earlyPreviewReady = Boolean(ready);
  }

  function snapshot() {
    const mergedStats = { ...stats };
    if (activeGuard) {
      if (typeof activeGuard.allowed === "number") {
        mergedStats.requestsAllowed = activeGuard.allowed;
      }
      if (typeof activeGuard.blocked === "number") {
        mergedStats.requestsBlocked = activeGuard.blocked;
      }
    }

    return {
      steps: steps.map((step) => ({ ...step })),
      stats: mergedStats,
      earlyPreviewReady,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    setGuardStats,
    setStep,
    updateStats,
    setEarlyPreviewReady,
    snapshot,
  };
}
