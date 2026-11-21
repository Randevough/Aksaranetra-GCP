#!/usr/bin/env python3
"""
AksaraNetra Multi-Zone Chaos Testing & Failover Orchestrator.

Automates a 6-phase resilience experiment against the AksaraNetra production
topology on Google Cloud Platform (project: linear-ellipse-513814-b9,
region: asia-southeast2):
  Phase 1 (0-10s)   : Baseline calibration via 5 req/s HTTP health probes.
  Phase 2 (10s)     : In-flight accessibility audit injection (POST /api/audits).
  Phase 3 (15s)     : Abrupt termination of Node 1 (aksaranetra-vm, zone a).
  Phase 4 (15-45s)  : High-frequency failover observation (10 req/s) & RTO calc.
  Phase 5 (45-90s)  : Worker B lease-reclaim & audit completion verification.
  Phase 6 (90-120s) : Automated cluster self-healing (restart Node 1).

Guarantees VM restart on SIGINT, SIGTERM, or unhandled exceptions via a
centralized recovery lock so the cluster is never left degraded.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import math
import os
import signal
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple

import aiohttp

try:
    from google.cloud import compute_v1  # type: ignore

    HAS_GCP_SDK = True
except ImportError:
    HAS_GCP_SDK = False

try:
    from rich.console import Console
    from rich.layout import Layout
    from rich.live import Live
    from rich.panel import Panel
    from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
    from rich.table import Table
    from rich.text import Text

    HAS_RICH = True
except ImportError:
    HAS_RICH = False


DEFAULT_PROJECT = "linear-ellipse-513814-b9"
DEFAULT_ZONE = "asia-southeast2-a"
DEFAULT_INSTANCE = "aksaranetra-vm"
DEFAULT_BASE_URL = "https://aksaranetra.rafifernanda.site"
DEFAULT_AUDIT_TARGET = "https://kepriprov.go.id"
SPARK_CHARS = "▁▂▃▄▅▆▇█"


@dataclass
class ProbeRecord:
    """Single HTTP probe measurement persisted to CSV."""

    timestamp_iso: str
    elapsed_sec: float
    phase: str
    http_status: int
    latency_ms: float
    error_type: str


@dataclass
class AuditState:
    """Tracks the in-flight accessibility audit across node failure and reclaim."""

    job_id: Optional[str] = None
    submitted_at: Optional[float] = None
    last_status: str = "NOT_SUBMITTED"
    progress: int = 0
    completed_at: Optional[float] = None
    reclaimed_verified: bool = False
    poll_errors: int = 0
    raw_last_payload: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ExperimentState:
    """Mutable shared state for concurrent probe, fault, and UI coroutines."""

    start_monotonic: float = field(default_factory=time.monotonic)
    current_phase: str = "PHASE_1_BASELINE"
    phase_label: str = "Phase 1: Baseline Calibration (0-10s)"
    total_duration: float = 120.0
    vm_stopped_by_script: bool = False
    vm_restored: bool = False
    fault_trigger_elapsed: Optional[float] = None
    first_failure_elapsed: Optional[float] = None
    last_failure_elapsed: Optional[float] = None
    recovery_elapsed: Optional[float] = None
    consecutive_200_post_fault: int = 0
    fault_injected: bool = False
    stop_requested: bool = False
    records: List[ProbeRecord] = field(default_factory=list)
    recent_latencies: Deque[float] = field(default_factory=lambda: deque(maxlen=40))
    events: Deque[str] = field(default_factory=lambda: deque(maxlen=10))
    audit: AuditState = field(default_factory=AuditState)

    def elapsed(self) -> float:
        return round(time.monotonic() - self.start_monotonic, 3)

    def log_event(self, message: str) -> None:
        stamp = f"{self.elapsed():6.2f}s"
        self.events.append(f"[{stamp}] {message}")


def percentile(values: List[float], pct: float) -> Optional[float]:
    """Compute linear-interpolated percentile without external numpy dependency."""
    if not values:
        return None
    sorted_vals = sorted(values)
    if len(sorted_vals) == 1:
        return round(sorted_vals[0], 2)
    rank = (pct / 100.0) * (len(sorted_vals) - 1)
    low = math.floor(rank)
    high = math.ceil(rank)
    weight = rank - low
    val = sorted_vals[low] * (1.0 - weight) + sorted_vals[high] * weight
    return round(val, 2)


def render_sparkline(latencies: Deque[float]) -> str:
    """Render an 8-level Unicode sparkline from recent latency samples."""
    if not latencies:
        return "(collecting samples...)"
    vals = list(latencies)
    lo, hi = min(vals), max(vals)
    span = hi - lo if hi > lo else 1.0
    chars = []
    for v in vals:
        idx = int(((v - lo) / span) * (len(SPARK_CHARS) - 1))
        idx = max(0, min(len(SPARK_CHARS) - 1, idx))
        chars.append(SPARK_CHARS[idx])
    return "".join(chars)


class GCPFaultInjector:
    """Controls Compute Engine instance lifecycle via GCP SDK or gcloud fallback."""

    def __init__(self, project: str, zone: str, instance: str, dry_run: bool = False) -> None:
        self.project = project
        self.zone = zone
        self.instance = instance
        self.dry_run = dry_run
        self._client = compute_v1.InstancesClient() if (HAS_GCP_SDK and not dry_run) else None

    async def stop_instance(self) -> Tuple[bool, str]:
        """Abruptly stop target VM instance."""
        if self.dry_run:
            await asyncio.sleep(0.5)
            return True, "DRY-RUN: simulated VM stop"

        if self._client is not None:
            try:
                op = await asyncio.to_thread(
                    self._client.stop,
                    project=self.project,
                    zone=self.zone,
                    instance=self.instance,
                )
                return True, f"GCP SDK stop initiated (operation={op.name})"
            except Exception as exc:
                return await self._gcloud_action("stop", fallback_reason=str(exc))
        return await self._gcloud_action("stop")

    async def start_instance(self) -> Tuple[bool, str]:
        """Restart target VM instance to restore 2-node HA baseline."""
        if self.dry_run:
            await asyncio.sleep(0.5)
            return True, "DRY-RUN: simulated VM start"

        if self._client is not None:
            try:
                op = await asyncio.to_thread(
                    self._client.start,
                    project=self.project,
                    zone=self.zone,
                    instance=self.instance,
                )
                return True, f"GCP SDK start initiated (operation={op.name})"
            except Exception as exc:
                return await self._gcloud_action("start", fallback_reason=str(exc))
        return await self._gcloud_action("start")

    async def _gcloud_action(
        self, action: str, fallback_reason: Optional[str] = None
    ) -> Tuple[bool, str]:
        cmd = [
            "gcloud",
            "compute",
            "instances",
            action,
            self.instance,
            f"--project={self.project}",
            f"--zone={self.zone}",
            "--quiet",
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=90.0)
            if proc.returncode == 0:
                prefix = f"gcloud fallback ({fallback_reason}) -> " if fallback_reason else ""
                return True, f"{prefix}gcloud {action} succeeded"
            err_msg = stderr.decode("utf-8", errors="replace").strip() or stdout.decode(
                "utf-8", errors="replace"
            ).strip()
            return False, f"gcloud {action} failed (rc={proc.returncode}): {err_msg}"
        except FileNotFoundError:
            return False, "Neither google-cloud-compute SDK nor gcloud CLI is available."
        except asyncio.TimeoutError:
            return False, f"gcloud {action} timed out after 90s."


class ChaosOrchestrator:
    """Coordinates probes, audit tracking, fault injection, recovery, and reporting."""

    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.state = ExperimentState()
        self.injector = GCPFaultInjector(
            project=args.project,
            zone=args.zone,
            instance=args.instance,
            dry_run=args.dry_run,
        )
        self.health_url = f"{args.base_url.rstrip('/')}/api/health"
        self.audits_url = f"{args.base_url.rstrip('/')}/api/audits"
        self._recovery_lock = asyncio.Lock()
        self._probe_rate_hz = 5.0
        self._stable_threshold = 5

    async def _send_single_probe(self, session: aiohttp.ClientSession) -> None:
        """Issue one non-blocking HTTP health probe and record telemetry."""
        t0 = time.monotonic()
        ts_iso = datetime.now(timezone.utc).isoformat()
        phase = self.state.current_phase
        status = 0
        error_type = "NONE"

        try:
            async with session.get(self.health_url) as resp:
                status = resp.status
                await resp.read()
                if status >= 500:
                    error_type = f"HTTP_{status}"
                elif status >= 400:
                    error_type = f"HTTP_{status}"
        except asyncio.TimeoutError:
            error_type = "TCP_TIMEOUT"
        except aiohttp.ClientConnectorError:
            error_type = "CONNECTION_ERROR"
        except aiohttp.ServerDisconnectedError:
            error_type = "SERVER_DISCONNECTED"
        except aiohttp.ClientError as exc:
            error_type = f"CLIENT_ERROR:{type(exc).__name__}"

        latency_ms = round((time.monotonic() - t0) * 1000.0, 2)
        elapsed = self.state.elapsed()
        record = ProbeRecord(
            timestamp_iso=ts_iso,
            elapsed_sec=elapsed,
            phase=phase,
            http_status=status,
            latency_ms=latency_ms,
            error_type=error_type,
        )
        self.state.records.append(record)
        self.state.recent_latencies.append(latency_ms)

        if self.state.fault_injected:
            is_failure = status == 0 or status >= 500
            if is_failure:
                if self.state.first_failure_elapsed is None:
                    self.state.first_failure_elapsed = elapsed
                    self.state.log_event(
                        f"First failover anomaly detected: status={status} err={error_type}"
                    )
                self.state.last_failure_elapsed = elapsed
                self.state.consecutive_200_post_fault = 0
            elif status == 200:
                self.state.consecutive_200_post_fault += 1
                if (
                    self.state.recovery_elapsed is None
                    and self.state.first_failure_elapsed is not None
                    and self.state.consecutive_200_post_fault >= self._stable_threshold
                ):
                    self.state.recovery_elapsed = elapsed
                    self.state.log_event(
                        f"Stable HTTP 200 stream restored ({self._stable_threshold} consecutive OK)"
                    )

    async def probe_loop(self, session: aiohttp.ClientSession) -> None:
        """Continuously dispatch probes at the active phase cadence."""
        pending: set[asyncio.Task[None]] = set()
        while not self.state.stop_requested:
            interval = 1.0 / self._probe_rate_hz
            tick_start = time.monotonic()
            task = asyncio.create_task(self._send_single_probe(session))
            pending.add(task)
            task.add_done_callback(pending.discard)

            sleep_for = max(0.01, interval - (time.monotonic() - tick_start))
            await asyncio.sleep(sleep_for)

        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    async def submit_in_flight_audit(self, session: aiohttp.ClientSession) -> None:
        """Submit live accessibility audit to create an active PostgreSQL job."""
        payload = {"url": self.args.target_url}
        self.state.log_event(f"Submitting audit job for {self.args.target_url}")
        try:
            async with session.post(self.audits_url, json=payload) as resp:
                body = await resp.json(content_type=None)
                if resp.status in (200, 201, 202) and isinstance(body, dict):
                    job_id = (
                        body.get("jobId")
                        or body.get("job_id")
                        or body.get("id")
                        or (body.get("data") or {}).get("jobId")
                        or (body.get("data") or {}).get("id")
                    )
                    if job_id:
                        self.state.audit.job_id = str(job_id)
                        self.state.audit.submitted_at = self.state.elapsed()
                        self.state.audit.last_status = str(body.get("status", "queued"))
                        self.state.log_event(f"Audit accepted: jobId={job_id}")
                        return
                self.state.audit.last_status = f"SUBMIT_HTTP_{resp.status}"
                self.state.log_event(f"Audit submission non-2xx: status={resp.status}")
        except Exception as exc:
            self.state.audit.last_status = f"SUBMIT_ERR:{type(exc).__name__}"
            self.state.log_event(f"Audit submission failed: {exc}")

    async def poll_audit_status(self, session: aiohttp.ClientSession) -> None:
        """Poll GET /api/audits/{jobId} every 3s during Phase 5 to verify reclaim."""
        job_id = self.state.audit.job_id
        if not job_id:
            self.state.log_event("Skipping Phase 5 polling: no jobId captured.")
            return

        url = f"{self.audits_url}/{job_id}"
        while (
            not self.state.stop_requested
            and self.state.elapsed() < 90.0
            and self.state.audit.last_status.lower() not in ("completed", "failed")
        ):
            try:
                async with session.get(url) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        if isinstance(data, dict):
                            inner = data.get("data") if isinstance(data.get("data"), dict) else data
                            status = str(inner.get("status", self.state.audit.last_status))
                            progress = int(inner.get("progress", self.state.audit.progress) or 0)
                            self.state.audit.last_status = status
                            self.state.audit.progress = progress
                            self.state.audit.raw_last_payload = inner
                            self.state.log_event(
                                f"Audit {job_id}: status={status} progress={progress}%"
                            )
                            if status.lower() == "completed" and progress >= 100:
                                self.state.audit.completed_at = self.state.elapsed()
                                self.state.audit.reclaimed_verified = True
                                self.state.log_event(
                                    "Worker B lease reclaim & audit completion verified (RPO=0)."
                                )
                                return
                    else:
                        self.state.audit.poll_errors += 1
            except Exception:
                self.state.audit.poll_errors += 1
            await asyncio.sleep(3.0)

    async def ensure_vm_restored(self, reason: str = "Phase 6 self-healing") -> None:
        """Idempotently restart aksaranetra-vm if stopped by this orchestrator."""
        async with self._recovery_lock:
            if not self.state.vm_stopped_by_script or self.state.vm_restored:
                return
            self.state.log_event(f"Restoring {self.args.instance} ({reason})...")
            ok, msg = await self.injector.start_instance()
            if ok:
                self.state.vm_restored = True
                self.state.log_event(f"Restore OK: {msg}")
            else:
                self.state.log_event(f"CRITICAL RESTORE FAILURE: {msg}")

    async def _sleep_until(self, target_elapsed: float) -> None:
        while not self.state.stop_requested:
            remaining = target_elapsed - self.state.elapsed()
            if remaining <= 0:
                return
            await asyncio.sleep(min(0.25, remaining))

    async def timeline_controller(self, session: aiohttp.ClientSession) -> None:
        """Drive the 6 deterministic phases from t=0s to t=120s."""
        # Phase 1: 0-10s Baseline
        self.state.current_phase = "PHASE_1_BASELINE"
        self.state.phase_label = "Phase 1: Baseline Calibration (0-10s) @ 5 req/s"
        self._probe_rate_hz = 5.0
        self.state.log_event("Baseline calibration started.")
        await self._sleep_until(10.0)
        if self.state.stop_requested:
            return

        # Phase 2: 10-15s In-Flight Audit Injection
        self.state.current_phase = "PHASE_2_AUDIT_INJECT"
        self.state.phase_label = "Phase 2: In-Flight Audit Injection (10-15s)"
        await self.submit_in_flight_audit(session)
        await self._sleep_until(15.0)
        if self.state.stop_requested:
            return

        # Phase 3: 15s Fault Trigger
        self.state.current_phase = "PHASE_3_CHAOS_TRIGGER"
        self.state.phase_label = f"Phase 3: Terminating {self.args.instance} ({self.args.zone})"
        self._probe_rate_hz = 10.0
        self.state.fault_injected = True
        self.state.fault_trigger_elapsed = self.state.elapsed()
        if not self.args.skip_fault:
            self.state.vm_stopped_by_script = True
            ok, msg = await self.injector.stop_instance()
            self.state.log_event(f"Fault injection ({'OK' if ok else 'ERR'}): {msg}")
        else:
            self.state.log_event("Fault injection skipped (--skip-fault active).")

        # Phase 4: 15-45s Failover Observation
        self.state.current_phase = "PHASE_4_FAILOVER_WINDOW"
        self.state.phase_label = "Phase 4: Failover Window Observation (15-45s) @ 10 req/s"
        await self._sleep_until(45.0)
        if self.state.stop_requested:
            return

        # Phase 5: 45-90s Worker Lease Expiration & Recovery Verification
        self.state.current_phase = "PHASE_5_WORKER_RECOVERY"
        self.state.phase_label = "Phase 5: Worker B Lease Reclaim Verification (45-90s)"
        self._probe_rate_hz = 5.0
        await self.poll_audit_status(session)
        await self._sleep_until(90.0)
        if self.state.stop_requested:
            return

        # Phase 6: 90-120s Cluster Self-Healing & Teardown
        self.state.current_phase = "PHASE_6_SELF_HEALING"
        self.state.phase_label = "Phase 6: Cluster Self-Healing & Teardown (90-120s)"
        await self.ensure_vm_restored(reason="Phase 6 scheduled recovery")
        await self._sleep_until(120.0)
        self.state.stop_requested = True

    def compute_metrics(self) -> Dict[str, Any]:
        """Calculate RTO, RPO, status breakdown, packet loss, and latency percentiles."""
        records = self.state.records
        total = len(records)
        c_2xx = sum(1 for r in records if 200 <= r.http_status < 300)
        c_4xx = sum(1 for r in records if 400 <= r.http_status < 500)
        c_5xx = sum(1 for r in records if 500 <= r.http_status < 600)
        c_timeout = sum(1 for r in records if r.error_type == "TCP_TIMEOUT")
        c_net_err = sum(
            1 for r in records if r.http_status == 0 and r.error_type != "TCP_TIMEOUT"
        )
        failed = c_5xx + c_timeout + c_net_err
        loss_pct = round((failed / total) * 100.0, 3) if total else 0.0

        normal_phases = {"PHASE_1_BASELINE", "PHASE_2_AUDIT_INJECT", "PHASE_6_SELF_HEALING"}
        failover_phases = {"PHASE_3_CHAOS_TRIGGER", "PHASE_4_FAILOVER_WINDOW"}

        normal_lat = [r.latency_ms for r in records if r.phase in normal_phases and r.http_status == 200]
        failover_lat = [
            r.latency_ms for r in records if r.phase in failover_phases and r.http_status > 0
        ]

        rto_from_trigger: Optional[float] = None
        rto_outage_window: Optional[float] = None
        if self.state.recovery_elapsed is not None and self.state.fault_trigger_elapsed is not None:
            rto_from_trigger = round(
                self.state.recovery_elapsed - self.state.fault_trigger_elapsed, 3
            )
        if self.state.recovery_elapsed is not None and self.state.first_failure_elapsed is not None:
            rto_outage_window = round(
                self.state.recovery_elapsed - self.state.first_failure_elapsed, 3
            )
        elif self.state.fault_injected and self.state.first_failure_elapsed is None:
            rto_from_trigger = 0.0
            rto_outage_window = 0.0

        rpo_status = (
            "0s (ZERO DATA LOSS VERIFIED)"
            if self.state.audit.reclaimed_verified
            else f"UNVERIFIED (audit_status={self.state.audit.last_status}, progress={self.state.audit.progress}%)"
        )

        return {
            "total_requests": total,
            "count_2xx": c_2xx,
            "count_4xx": c_4xx,
            "count_5xx": c_5xx,
            "count_tcp_timeouts": c_timeout,
            "count_net_errors": c_net_err,
            "packet_loss_pct": loss_pct,
            "rto_from_trigger_sec": rto_from_trigger,
            "rto_outage_window_sec": rto_outage_window,
            "rpo_status": rpo_status,
            "normal_p50_ms": percentile(normal_lat, 50),
            "normal_p90_ms": percentile(normal_lat, 90),
            "normal_p95_ms": percentile(normal_lat, 95),
            "normal_p99_ms": percentile(normal_lat, 99),
            "failover_p50_ms": percentile(failover_lat, 50),
            "failover_p90_ms": percentile(failover_lat, 90),
            "failover_p95_ms": percentile(failover_lat, 95),
            "failover_p99_ms": percentile(failover_lat, 99),
        }

    def export_csv(self) -> str:
        """Write high-resolution probe telemetry to timestamped CSV file."""
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"chaos_metrics_{stamp}.csv"
        fieldnames = [
            "timestamp_iso",
            "elapsed_sec",
            "phase",
            "http_status",
            "latency_ms",
            "error_type",
        ]
        with open(filename, mode="w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames)
            writer.writeheader()
            for r in self.state.records:
                writer.writerow(
                    {
                        "timestamp_iso": r.timestamp_iso,
                        "elapsed_sec": f"{r.elapsed_sec:.3f}",
                        "phase": r.phase,
                        "http_status": r.http_status,
                        "latency_ms": f"{r.latency_ms:.2f}",
                        "error_type": r.error_type,
                    }
                )
        return os.path.abspath(filename)

    def _build_rich_dashboard(self, progress: Progress, task_id: Any) -> Layout:
        elapsed = min(self.state.elapsed(), self.state.total_duration)
        progress.update(task_id, completed=elapsed, description=self.state.phase_label)
        metrics = self.compute_metrics()

        layout = Layout()
        layout.split_column(
            Layout(name="header", size=5),
            Layout(name="body", ratio=1),
            Layout(name="events", size=12),
        )

        layout["header"].update(
            Panel(
                progress,
                title="[bold cyan]AksaraNetra Chaos & Multi-Zone Failover Orchestrator[/bold cyan]",
                border_style="cyan",
            )
        )

        stats_table = Table(expand=True, show_header=True, header_style="bold magenta")
        stats_table.add_column("Metric", style="bold")
        stats_table.add_column("Value")
        stats_table.add_column("Audit / Failover State", style="bold")
        stats_table.add_column("Status")

        spark = render_sparkline(self.state.recent_latencies)
        stats_table.add_row(
            "Total Probes / Rate",
            f"{metrics['total_requests']} ({self._probe_rate_hz:.0f} req/s)",
            "In-Flight Job ID",
            self.state.audit.job_id or "Pending",
        )
        stats_table.add_row(
            "2xx / 4xx / 5xx / Timeout",
            f"{metrics['count_2xx']} / {metrics['count_4xx']} / {metrics['count_5xx']} / {metrics['count_tcp_timeouts']}",
            "Audit Status & Progress",
            f"{self.state.audit.last_status} ({self.state.audit.progress}%)",
        )
        stats_table.add_row(
            "Normal Latency (p50/p95)",
            f"{metrics['normal_p50_ms']} ms / {metrics['normal_p95_ms']} ms",
            "Measured Outage RTO",
            f"{metrics['rto_outage_window_sec']} s"
            if metrics["rto_outage_window_sec"] is not None
            else "Observing...",
        )
        stats_table.add_row(
            "Failover Latency (p50/p95)",
            f"{metrics['failover_p50_ms']} ms / {metrics['failover_p95_ms']} ms",
            "Latency Sparkline",
            spark,
        )

        layout["body"].update(Panel(stats_table, title="Live Telemetry", border_style="green"))
        event_text = Text("\n".join(self.state.events) if self.state.events else "Initializing...")
        layout["events"].update(Panel(event_text, title="Experiment Event Log", border_style="yellow"))
        return layout

    async def ui_loop(self) -> None:
        """Render live terminal dashboard via Rich or ANSI fallback."""
        if HAS_RICH:
            console = Console()
            progress = Progress(
                SpinnerColumn(),
                TextColumn("[bold blue]{task.description}"),
                BarColumn(),
                TextColumn("{task.percentage:>3.0f}%"),
                TimeElapsedColumn(),
            )
            task_id = progress.add_task(self.state.phase_label, total=self.state.total_duration)
            with Live(
                self._build_rich_dashboard(progress, task_id),
                console=console,
                refresh_per_second=4,
            ) as live:
                while not self.state.stop_requested:
                    live.update(self._build_rich_dashboard(progress, task_id))
                    await asyncio.sleep(0.25)
                live.update(self._build_rich_dashboard(progress, task_id))
        else:
            while not self.state.stop_requested:
                m = self.compute_metrics()
                spark = render_sparkline(self.state.recent_latencies)
                sys.stdout.write(
                    f"\r[{self.state.elapsed():6.1f}s] {self.state.current_phase:<24} "
                    f"2xx={m['count_2xx']} 5xx={m['count_5xx']} to={m['count_tcp_timeouts']} "
                    f"p95={m['normal_p95_ms']}ms {spark}   "
                )
                sys.stdout.flush()
                await asyncio.sleep(0.5)
            sys.stdout.write("\n")

    def print_scorecard(self, csv_path: str) -> None:
        """Display final academic resilience summary scorecard."""
        m = self.compute_metrics()
        if HAS_RICH:
            console = Console()
            table = Table(
                title="AksaraNetra Chaos Experiment Final Scorecard",
                show_header=True,
                header_style="bold cyan",
            )
            table.add_column("Indicator", style="bold")
            table.add_column("Measured Result")
            table.add_row("Target Endpoint", self.health_url)
            table.add_row("Fault Target", f"{self.args.instance} ({self.args.zone})")
            table.add_row("Total Requests", str(m["total_requests"]))
            table.add_row(
                "Status Breakdown",
                f"2xx={m['count_2xx']}, 4xx={m['count_4xx']}, 5xx={m['count_5xx']}, "
                f"Timeouts={m['count_tcp_timeouts']}, NetErr={m['count_net_errors']}",
            )
            table.add_row("Packet / Error Loss Rate", f"{m['packet_loss_pct']}%")
            table.add_row("RTO (From VM Stop Trigger)", f"{m['rto_from_trigger_sec']} s")
            table.add_row("RTO (Observed Outage Window)", f"{m['rto_outage_window_sec']} s")
            table.add_row("RPO Verification", m["rpo_status"])
            table.add_row(
                "Normal Latency (p50 / p90 / p95 / p99)",
                f"{m['normal_p50_ms']} / {m['normal_p90_ms']} / {m['normal_p95_ms']} / {m['normal_p99_ms']} ms",
            )
            table.add_row(
                "Failover Latency (p50 / p90 / p95 / p99)",
                f"{m['failover_p50_ms']} / {m['failover_p90_ms']} / {m['failover_p95_ms']} / {m['failover_p99_ms']} ms",
            )
            table.add_row("CSV Telemetry Export", csv_path)
            console.print(table)
        else:
            print("\n=== AksaraNetra Chaos Experiment Final Scorecard ===")
            for key, val in m.items():
                print(f"  {key:<28}: {val}")
            print(f"  {'csv_export':<28}: {csv_path}")

    async def run(self) -> int:
        """Execute full experiment with strict signal handling and teardown guarantees."""
        loop = asyncio.get_running_loop()

        def _handle_signal(sig_name: str) -> None:
            if not self.state.stop_requested:
                self.state.log_event(f"Signal {sig_name} received: initiating safe abort & VM restore.")
                self.state.stop_requested = True

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, _handle_signal, sig.name)
            except NotImplementedError:
                pass

        timeout = aiohttp.ClientTimeout(total=5.0, connect=2.5)
        connector = aiohttp.TCPConnector(limit=100, ttl_dns_cache=60)

        try:
            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
                await asyncio.gather(
                    self.probe_loop(session),
                    self.timeline_controller(session),
                    self.ui_loop(),
                )
        finally:
            self.state.stop_requested = True
            await self.ensure_vm_restored(reason="finally safety trap")
            csv_path = self.export_csv()
            self.print_scorecard(csv_path)

        return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AksaraNetra Multi-Zone Chaos & Failover Testing Orchestrator"
    )
    parser.add_argument("--project", default=DEFAULT_PROJECT, help="GCP Project ID")
    parser.add_argument("--zone", default=DEFAULT_ZONE, help="Target VM Zone")
    parser.add_argument("--instance", default=DEFAULT_INSTANCE, help="Target VM Instance Name")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="AksaraNetra HTTPS Base URL")
    parser.add_argument(
        "--target-url", default=DEFAULT_AUDIT_TARGET, help="Target website for in-flight audit"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate GCP stop/start without mutating live Compute Engine instances",
    )
    parser.add_argument(
        "--skip-fault",
        action="store_true",
        help="Run probes and audit submission without stopping Node 1",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    orchestrator = ChaosOrchestrator(args)
    try:
        return asyncio.run(orchestrator.run())
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
