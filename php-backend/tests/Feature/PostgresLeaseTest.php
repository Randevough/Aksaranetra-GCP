<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\JobStore;
use PDO;
use PHPUnit\Framework\TestCase;

class PostgresLeaseTest extends TestCase
{
    private function connection(): PDO
    {
        return new PDO(getenv('HA_TEST_DSN'), 'postgres', 'postgres', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    }

    public function test_claims_are_exclusive_expiry_is_bounded_and_stale_writes_are_fenced(): void
    {
        if (!getenv('HA_TEST_DSN')) {
            $this->markTestSkipped('PostgreSQL integration DSN not configured');
        }
        $pdo = $this->connection();
        $pdo->exec('DROP TABLE IF EXISTS audit_jobs');
        $first = new JobStore($pdo);
        $now = (int) (microtime(true) * 1000);
        $first->createJob(['id' => 'lease', 'tokenHash' => 'a', 'shareTokenHash' => 'b', 'ipHash' => 'c',
            'targetUrl' => 'https://example.com/', 'createdAt' => $now, 'expiresAt' => $now + 600000,
            'artifactDir' => '/unused']);
        $job = $first->claimNext();
        $this->assertSame(1, $job->attempts);
        $this->assertNotEmpty($job->leaseToken);
        $second = new JobStore($this->connection());
        $this->assertSame('running', $second->getJob('lease')->status, 'Opening API connection must not recover live work');
        $this->assertNull($second->claimNext());
        $this->assertTrue($first->heartbeat('lease', $job->leaseToken));
        $pdo->exec("UPDATE audit_jobs SET lease_expires_at = 0 WHERE id = 'lease'");
        $this->assertFalse($first->heartbeat('lease', $job->leaseToken));
        $next = $second->claimNext();
        $this->assertSame(2, $next->attempts);
        $this->assertNotSame($job->leaseToken, $next->leaseToken);
        $first->updateProgress('lease', ['stage' => 'stale', 'progress' => 90], $job->leaseToken);
        $first->complete('lease', ['stale' => true], $job->leaseToken);
        $first->fail('lease', ['code' => 'stale', 'message' => 'stale'], $job->leaseToken);
        $first->retry('lease', ['code' => 'stale', 'message' => 'stale'], $job->leaseToken);
        $first->cancelRunning('lease', $job->leaseToken);
        $this->assertSame('running', $second->getJob('lease')->status);
        $this->assertSame(5, $second->getJob('lease')->progress);
        $second->updateProgress('lease', ['stage' => 'live', 'progress' => 60], $next->leaseToken);
        $this->assertSame(60, $second->getJob('lease')->progress);
        $pdo->exec("UPDATE audit_jobs SET lease_expires_at = 0 WHERE id = 'lease'");
        $this->assertNull($second->claimNext());
        $this->assertSame('failed', $second->getJob('lease')->status);
        $this->assertSame(2, $second->getJob('lease')->attempts);
    }
}
