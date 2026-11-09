<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\AuditJob;
use PDO;
use Throwable;

class JobStore
{
    private const COLUMNS = 'id, token_hash, share_token_hash, ip_hash, target_url, status,
      stage, progress, attempts, cancel_requested, result_json, error_code, error_message,
      created_at, updated_at, started_at, finished_at, expires_at, artifact_dir, lease_token, lease_expires_at';

    private ?PDO $pdo = null;
    private bool $postgres = false;

    private function clock(): string
    {
        return '(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint';
    }

    private function fence(?string $token): string
    {
        if (!$this->postgres) {
            return '';
        }
        return ' AND lease_token = ' . $this->pdo->quote($token ?? '') . ' AND lease_expires_at > ' . $this->clock();
    }

    public function heartbeat(string $id, string $token): bool
    {
        if (!$this->postgres) {
            return true;
        }
        $stmt = $this->pdo->prepare("UPDATE audit_jobs SET lease_expires_at = " . $this->clock() . " + 45000 WHERE id = ? AND status = 'running'" . $this->fence($token));
        $stmt->execute([$id]);
        return $stmt->rowCount() === 1;
    }
    /** @var callable(): int */
    private $now;

    public function __construct(string|PDO|array $databaseOrConfig, ?callable $now = null)
    {
        $databasePath = null;
        if (is_array($databaseOrConfig)) {
            $databasePath = $databaseOrConfig['databasePath'] ?? $databaseOrConfig['database'] ?? null;
            $now = $databaseOrConfig['now'] ?? $now;
        } elseif ($databaseOrConfig instanceof PDO) {
            $this->pdo = $databaseOrConfig;
        } else {
            $databasePath = $databaseOrConfig;
        }

        $this->now = $now ?? fn(): int => (int) round(microtime(true) * 1000);

        if ($this->pdo === null && is_string($databasePath)) {
            $dir = dirname($databasePath);
            if (!is_dir($dir)) {
                mkdir($dir, 0777, true);
            }

            $this->pdo = new PDO(
                'sqlite:' . $databasePath,
                null,
                null,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_TIMEOUT => 5,
                ]
            );
        }

        if ($this->pdo !== null) {
            $this->postgres = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'pgsql';
            if (!$this->postgres) {
                $this->pdo->exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
            }
            if (!$this->postgres) {
                $this->initSchema();
                $this->recoverInterrupted();
            }
        }
    }

    public function getPdo(): ?PDO
    {
        return $this->pdo;
    }

    public function close(): void
    {
        $this->pdo = null;
    }

    private function initSchema(): void
    {
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS audit_jobs (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL,
            share_token_hash TEXT NOT NULL,
            ip_hash TEXT NOT NULL,
            target_url TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
            stage TEXT NOT NULL,
            progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100),
            attempts INTEGER NOT NULL DEFAULT 0,
            cancel_requested INTEGER NOT NULL DEFAULT 0,
            result_json TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            started_at BIGINT,
            finished_at BIGINT,
            expires_at BIGINT NOT NULL,
            artifact_dir TEXT NOT NULL,
            lease_token TEXT,
            lease_expires_at BIGINT
        );
        CREATE INDEX IF NOT EXISTS audit_jobs_queue_idx ON audit_jobs(status, created_at);
        CREATE INDEX IF NOT EXISTS audit_jobs_ip_idx ON audit_jobs(ip_hash, created_at);
        CREATE INDEX IF NOT EXISTS audit_jobs_expiry_idx ON audit_jobs(expires_at);");
        $columns = $this->pdo->query('PRAGMA table_info(audit_jobs)')->fetchAll(PDO::FETCH_ASSOC);
        if (!in_array('lease_token', array_column($columns, 'name'), true)) {
            $this->pdo->exec('ALTER TABLE audit_jobs ADD COLUMN lease_token TEXT; ALTER TABLE audit_jobs ADD COLUMN lease_expires_at BIGINT');
        }
    }

    public function recoverInterrupted(): int
    {
        if ($this->pdo === null) {
            return 0;
        }

        if ($this->postgres) {
            $clock = $this->clock();
            return $this->pdo->exec("UPDATE audit_jobs SET
                status = CASE WHEN cancel_requested = 1 THEN 'cancelled' WHEN attempts < 2 THEN 'queued' ELSE 'failed' END,
                stage = 'Lease expired', error_code = CASE WHEN attempts >= 2 THEN 'lease-expired' ELSE NULL END,
                finished_at = CASE WHEN attempts >= 2 OR cancel_requested = 1 THEN $clock ELSE NULL END,
                updated_at = $clock, lease_token = NULL, lease_expires_at = NULL
                WHERE status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= $clock)");
        }
        $now = ($this->now)();
        $stmt = $this->pdo->query("SELECT id, artifact_dir, attempts, progress FROM audit_jobs WHERE status = 'running'");
        $runningJobs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($runningJobs as $job) {
            $snapshotPath = rtrim($job['artifact_dir'], '/\\') . DIRECTORY_SEPARATOR . 'snapshot.json';
            $hasCheckpoint = file_exists($snapshotPath);
            $shouldRetry = ((int) $job['attempts']) < 2;

            if ($hasCheckpoint) {
                // Jika snapshot sudah ada, job sudah 90% selesai. Pulihkan ke antrean dengan progress 90%
                $update = $this->pdo->prepare("UPDATE audit_jobs SET status = 'queued',
                    stage = 'Melanjutkan finalisasi dari checkpoint tersimpan',
                    progress = 90,
                    error_code = NULL,
                    error_message = NULL,
                    updated_at = ?, finished_at = NULL
                    WHERE id = ?");
                $update->execute([$now, $job['id']]);
            } elseif ($shouldRetry) {
                $update = $this->pdo->prepare("UPDATE audit_jobs SET status = 'queued',
                    stage = 'Dipulihkan setelah server restart',
                    progress = 0,
                    error_code = NULL,
                    error_message = NULL,
                    updated_at = ?, finished_at = NULL
                    WHERE id = ?");
                $update->execute([$now, $job['id']]);
            } else {
                $update = $this->pdo->prepare("UPDATE audit_jobs SET status = 'failed',
                    stage = 'Gagal setelah server restart',
                    progress = progress,
                    error_code = 'server-restarted',
                    error_message = 'Audit terputus dua kali karena server restart.',
                    updated_at = ?, finished_at = ?
                    WHERE id = ?");
                $update->execute([$now, $now, $job['id']]);
            }
        }

        return count($runningJobs);
    }

    public function createJob(array|object $job): ?AuditJob
    {
        $data = is_object($job) ? (array) $job : $job;

        $id = $data['id'];
        $tokenHash = $data['tokenHash'] ?? $data['token_hash'];
        $shareTokenHash = $data['shareTokenHash'] ?? $data['share_token_hash'];
        $ipHash = $data['ipHash'] ?? $data['ip_hash'];
        $targetUrl = $data['targetUrl'] ?? $data['target_url'];
        $createdAt = $data['createdAt'] ?? $data['created_at'];
        $expiresAt = $data['expiresAt'] ?? $data['expires_at'];
        $artifactDir = $data['artifactDir'] ?? $data['artifact_dir'];

        $sql = "INSERT INTO audit_jobs (" . "id, token_hash, share_token_hash, ip_hash, target_url, status, stage, progress, attempts, cancel_requested, result_json, error_code, error_message, created_at, updated_at, started_at, finished_at, expires_at, artifact_dir" . ") VALUES (?, ?, ?, ?, ?, 'queued', ?, 0, 0, 0, NULL, NULL, NULL, ?, ?, NULL, NULL, ?, ?)";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            $id,
            $tokenHash,
            $shareTokenHash,
            $ipHash,
            $targetUrl,
            'Menunggu antrean',
            $createdAt,
            $createdAt,
            $expiresAt,
            $artifactDir,
        ]);

        return $this->getJob($id);
    }

    public function getJob(string $id): ?AuditJob
    {
        $stmt = $this->pdo->prepare("SELECT " . self::COLUMNS . " FROM audit_jobs WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ? AuditJob::fromRow($row) : null;
    }

    public function countRecentByIp(string $ipHash, int $since): int
    {
        $stmt = $this->pdo->prepare("SELECT COUNT(*) AS total FROM audit_jobs WHERE ip_hash = ? AND created_at >= CAST(? AS BIGINT)");
        $stmt->execute([$ipHash, $since]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return (int) ($row['total'] ?? 0);
    }

    public function queuePosition(string $id): ?int
    {
        $job = $this->getJob($id);
        if (!$job || $job->status !== 'queued') {
            return null;
        }

        $stmt = $this->pdo->prepare("SELECT COUNT(*) AS total FROM audit_jobs WHERE status = 'queued' AND created_at <= CAST(? AS BIGINT)");
        $stmt->execute([$job->createdAt]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return (int) ($row['total'] ?? 0);
    }

    public function findReusable(string $targetUrl, ?int $now = null): ?AuditJob
    {
        $now = $now ?? ($this->now)();
        $stmt = $this->pdo->prepare("SELECT " . self::COLUMNS . " FROM audit_jobs
            WHERE target_url = ? AND status = 'completed' AND expires_at > CAST(? AS BIGINT)
            ORDER BY finished_at DESC LIMIT 1");
        $stmt->execute([$targetUrl, $now]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ? AuditJob::fromRow($row) : null;
    }

    public function claimNext(): ?AuditJob
    {
        if ($this->postgres) {
            $this->recoverInterrupted();
            $clock = $this->clock();
            $stmt = $this->pdo->prepare("WITH candidate AS (
                SELECT id FROM audit_jobs WHERE status = 'queued' AND cancel_requested = 0 AND attempts < 2
                ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
            ) UPDATE audit_jobs j SET status = 'running', stage = 'Menyiapkan audit', progress = 5,
                attempts = attempts + 1, started_at = COALESCE(started_at, $clock), updated_at = $clock,
                lease_token = ?, lease_expires_at = $clock + 45000
                FROM candidate WHERE j.id = candidate.id RETURNING j.*");
            $stmt->execute([bin2hex(random_bytes(24))]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ? AuditJob::fromRow($row) : null;
        }
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $stmt = $this->pdo->query("SELECT id FROM audit_jobs WHERE status = 'queued' AND cancel_requested = 0 ORDER BY created_at ASC LIMIT 1");
            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$row) {
                $this->pdo->exec('COMMIT');
                return null;
            }

            $now = ($this->now)();
            $update = $this->pdo->prepare("UPDATE audit_jobs SET status = 'running', stage = 'Menyiapkan audit', progress = 5,
                attempts = attempts + 1, started_at = COALESCE(started_at, ?), updated_at = ?
                WHERE id = ? AND status = 'queued'");
            $update->execute([$now, $now, $row['id']]);
            $changes = $update->rowCount();

            $this->pdo->exec('COMMIT');

            return $changes > 0 ? $this->getJob($row['id']) : null;
        } catch (Throwable $error) {
            $this->pdo->exec('ROLLBACK');
            throw $error;
        }
    }

    public function updateProgress(string $id, array $data, ?string $leaseToken = null): void
    {
        $now = ($this->now)();
        $stage = $data['stage'];
        $progress = max(0, min(99, (int) $data['progress']));

        $stmt = $this->pdo->prepare("UPDATE audit_jobs SET stage = ?, progress = " . ($this->postgres ? 'GREATEST' : 'MAX') . "(progress, CAST(? AS BIGINT)), updated_at = ?
            WHERE id = ? AND status = 'running'" . $this->fence($leaseToken));
        $stmt->execute([$stage, $progress, $now, $id]);
    }

    public function requestCancel(string $id): ?AuditJob
    {
        $now = ($this->now)();
        $stmt = $this->pdo->prepare("UPDATE audit_jobs SET cancel_requested = 1,
            status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
            stage = CASE WHEN status = 'queued' THEN 'Dibatalkan' ELSE 'Membatalkan audit' END,
            finished_at = CASE WHEN status = 'queued' THEN ? ELSE finished_at END, updated_at = ?
            WHERE id = ? AND status IN ('queued', 'running')");
        $stmt->execute([$now, $now, $id]);

        return $this->getJob($id);
    }

    public function complete(string $id, array|object $result, ?string $leaseToken = null): void
    {
        $now = ($this->now)();
        $stmt = $this->pdo->prepare("UPDATE audit_jobs SET status = 'completed', stage = 'Audit selesai', progress = 100,
            result_json = ?, error_code = NULL, error_message = NULL, finished_at = ?, updated_at = ?
            WHERE id = ? AND status = 'running'" . $this->fence($leaseToken));
        $stmt->execute([json_encode($result), $now, $now, $id]);
    }

    public function completeQueued(string $id, array|object $result): void
    {
        $now = ($this->now)();
        $stmt = $this->pdo->prepare("UPDATE audit_jobs SET status = 'completed', stage = 'Menggunakan hasil tersimpan', progress = 100,
            result_json = ?, started_at = ?, finished_at = ?, updated_at = ?
            WHERE id = ? AND status = 'queued'");
        $stmt->execute([json_encode($result), $now, $now, $now, $id]);
    }

    public function fail(string $id, array $error, ?string $leaseToken = null): void
    {
        $now = ($this->now)();
        $stmt = $this->pdo->prepare("UPDATE audit_jobs SET status = 'failed', stage = 'Audit gagal', error_code = ?, error_message = ?,
            finished_at = ?, updated_at = ?
            WHERE id = ? AND status = 'running'" . $this->fence($leaseToken));
        $stmt->execute([$error['code'], $error['message'], $now, $now, $id]);
    }

    public function cancelRunning(string $id, ?string $leaseToken = null): void
    {
        $now = ($this->now)();
        $stmt = $this->pdo->prepare("UPDATE audit_jobs SET status = 'cancelled', stage = 'Dibatalkan', error_code = NULL,
            error_message = NULL, finished_at = ?, updated_at = ?
            WHERE id = ? AND status = 'running'" . $this->fence($leaseToken));
        $stmt->execute([$now, $now, $id]);
    }

    public function retry(string $id, array $error, ?string $leaseToken = null): void
    {
        $now = ($this->now)();
        $stmt = $this->pdo->prepare("UPDATE audit_jobs SET status = 'queued', stage = 'Menunggu percobaan ulang', progress = 0,
            error_code = ?, error_message = ?, updated_at = ?
            WHERE id = ? AND status = 'running' AND attempts < 2" . $this->fence($leaseToken));
        $stmt->execute([$error['code'], $error['message'], $now, $id]);
    }

    /**
     * @return list<array{id: string, artifact_dir: string, artifactDir: string}>
     */
    public function expired(?int $now = null): array
    {
        $now = $now ?? ($this->now)();
        $stmt = $this->pdo->prepare("SELECT id, artifact_dir FROM audit_jobs WHERE expires_at <= CAST(? AS BIGINT)");
        $stmt->execute([$now]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        return array_map(fn($row) => [
            'id' => $row['id'],
            'artifact_dir' => $row['artifact_dir'],
            'artifactDir' => $row['artifact_dir'],
        ], $rows);
    }

    /**
     * @return list<array{id: string, artifact_dir: string, artifactDir: string}>
     */
    public function deleteExpired(?int $now = null): array
    {
        $rows = $this->expired($now);
        $now = $now ?? ($this->now)();
        $stmt = $this->pdo->prepare("DELETE FROM audit_jobs WHERE expires_at <= CAST(? AS BIGINT)");
        $stmt->execute([$now]);

        return $rows;
    }
}
