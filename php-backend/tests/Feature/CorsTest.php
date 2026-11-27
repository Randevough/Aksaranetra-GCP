<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\AksaraConfig;
use App\Services\JobStore;
use Tests\TestCase;

class CorsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->app->instance(JobStore::class, new JobStore(':memory:'));
        $this->app->instance(AksaraConfig::class, new AksaraConfig([
            'artifactStore' => 'local',
            'artifactsDir' => sys_get_temp_dir(),
        ]));
    }

    public function test_rejects_untrusted_browser_origins(): void
    {
        $response = $this->get('/health', [
            'Origin' => 'https://evil.test',
        ]);

        $response->assertStatus(403);
        $response->assertJson([
            'error' => 'origin-not-allowed',
            'message' => 'Origin frontend tidak diizinkan.',
        ]);
        $this->assertFalse($response->headers->has('access-control-allow-origin'));
    }

    public function test_allows_trusted_browser_origins(): void
    {
        $response = $this->get('/health', [
            'Origin' => 'http://localhost:3000',
        ]);

        $response->assertStatus(200);
        $response->assertHeader('access-control-allow-origin', 'http://localhost:3000');
        $response->assertHeader('vary', 'Origin');
        $response->assertHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
        $response->assertHeader('access-control-allow-headers', 'Authorization, Content-Type');
        $response->assertHeader('access-control-allow-credentials', 'true');
        $response->assertHeader('access-control-max-age', '600');
    }

    public function test_preflight_options_for_trusted_origin(): void
    {
        $response = $this->call('OPTIONS', '/health', [], [], [], [
            'HTTP_ORIGIN' => 'http://localhost:3000',
        ]);

        $response->assertStatus(204);
        $response->assertHeader('access-control-allow-origin', 'http://localhost:3000');
        $response->assertHeader('access-control-max-age', '600');
        $this->assertEmpty($response->getContent());
    }

    public function test_preflight_options_for_untrusted_origin_returns_403(): void
    {
        $response = $this->call('OPTIONS', '/health', [], [], [], [
            'HTTP_ORIGIN' => 'https://evil.test',
        ]);

        $response->assertStatus(403);
        $response->assertJson([
            'error' => 'origin-not-allowed',
            'message' => 'Origin frontend tidak diizinkan.',
        ]);
    }

    public function test_requests_without_origin_are_allowed(): void
    {
        $response = $this->get('/health');

        $response->assertStatus(200);
        $response->assertJson([
            'ok' => true,
            'worker' => 'unknown',
        ]);
        $this->assertFalse($response->headers->has('access-control-allow-origin'));
    }

    public function test_options_request_without_origin_header(): void
    {
        $response = $this->call('OPTIONS', '/health');
        $response->assertStatus(204);
        $this->assertFalse($response->headers->has('access-control-allow-origin'));
    }

    public function test_artifact_reader_attaches_cors_headers_for_binary_file_response(): void
    {
        $tempDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'aksara-cors-local-' . uniqid();
        $artifactsDir = $tempDir . DIRECTORY_SEPARATOR . 'artifacts';
        mkdir($artifactsDir, 0777, true);

        $store = new JobStore($tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite');

        try {
            $config = new AksaraConfig([
                'dataDir' => $tempDir,
                'databasePath' => $tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite',
                'artifactsDir' => $artifactsDir,
                'secret' => 'test-secret-that-is-long-enough-123456',
                'frontendOrigins' => ['http://localhost:3000'],
                'artifactStore' => 'local',
                'retentionMs' => 3600000,
            ]);
            $this->app->instance(AksaraConfig::class, $config);
            $this->app->instance(JobStore::class, $store);

            $security = $this->app->make(\App\Services\SecurityService::class);
            $now = (int) (microtime(true) * 1000);
            $shareToken = 'share-token-reader-cors';

            $job = $store->createJob([
                'id' => 'aud_cors_local',
                'tokenHash' => $security->digest('access-token-local', $config->secret),
                'shareTokenHash' => $security->digest($shareToken, $config->secret),
                'ipHash' => str_repeat('c', 64),
                'targetUrl' => 'https://example.com/',
                'createdAt' => $now,
                'expiresAt' => $now + 3600000,
                'artifactDir' => $artifactsDir . DIRECTORY_SEPARATOR . 'aud_cors_local',
            ]);
            $store->claimNext();

            mkdir($job->artifactDir, 0777, true);
            file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'reader.html', '<!doctype html><title>Reader</title>');
            $store->complete($job->id, ['snapshot' => ['ok' => true]]);

            $localRes = $this->get("/audits/{$job->id}/artifacts/reader?token={$shareToken}", [
                'Origin' => 'http://localhost:3000',
            ]);
            $localRes->assertStatus(200);
            $localRes->assertHeader('Content-Type', 'text/html; charset=utf-8');
            $localRes->assertHeader('access-control-allow-origin', 'http://localhost:3000');
            $localRes->assertHeader('vary', 'Origin');
            $this->assertInstanceOf(\Symfony\Component\HttpFoundation\BinaryFileResponse::class, $localRes->baseResponse);
        } finally {
            $store->close();
            $this->removeDirectoryRecursive($tempDir);
        }
    }

    public function test_artifact_reader_attaches_cors_headers_for_gcs_response(): void
    {
        $tempDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'aksara-cors-gcs-' . uniqid();
        $artifactsDir = $tempDir . DIRECTORY_SEPARATOR . 'artifacts';
        mkdir($artifactsDir, 0777, true);

        $store = new JobStore($tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite');

        try {
            $security = $this->app->make(\App\Services\SecurityService::class);
            $mock = new \GuzzleHttp\Handler\MockHandler([
                new \GuzzleHttp\Psr7\Response(200, [], '<!doctype html><title>GCS Reader</title>'),
            ]);
            $gcs = new \App\Services\GcsArtifacts(
                'private-bucket',
                'project-id',
                new \GuzzleHttp\Client(['handler' => \GuzzleHttp\HandlerStack::create($mock)]),
                fn () => 'token'
            );
            $gcsConfig = new AksaraConfig([
                'dataDir' => $tempDir,
                'databasePath' => $tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite',
                'artifactsDir' => $artifactsDir,
                'secret' => 'test-secret-that-is-long-enough-123456',
                'frontendOrigins' => ['http://localhost:3000'],
                'artifactStore' => 'gcs',
                'gcsBucket' => 'private-bucket',
                'retentionMs' => 3600000,
            ]);
            $this->app->instance(AksaraConfig::class, $gcsConfig);
            $this->app->instance(JobStore::class, $store);
            $this->app->instance(\App\Http\Controllers\AuditArtifactController::class, new \App\Http\Controllers\AuditArtifactController(
                $gcsConfig,
                $security,
                $store,
                $gcs
            ));

            $now = (int) (microtime(true) * 1000);
            $shareToken = 'share-token-reader-cors';
            $gcsJob = $store->createJob([
                'id' => 'aud_cors_gcs',
                'tokenHash' => $security->digest('access-token-gcs', $gcsConfig->secret),
                'shareTokenHash' => $security->digest($shareToken, $gcsConfig->secret),
                'ipHash' => str_repeat('d', 64),
                'targetUrl' => 'https://example.org/',
                'createdAt' => $now,
                'expiresAt' => $now + 3600000,
                'artifactDir' => $artifactsDir . DIRECTORY_SEPARATOR . 'aud_cors_gcs',
            ]);
            $store->claimNext();
            $store->complete($gcsJob->id, [
                'snapshot' => ['ok' => true],
                'manifest' => [
                    'reader.html' => ['path' => "jobs/{$gcsJob->id}/reader.html", 'contentType' => 'text/html; charset=utf-8', 'size' => 42],
                ],
            ]);

            $gcsRes = $this->get("/audits/{$gcsJob->id}/artifacts/reader?token={$shareToken}", [
                'Origin' => 'http://localhost:3000',
            ]);
            $gcsRes->assertStatus(200);
            $gcsRes->assertHeader('Content-Type', 'text/html; charset=utf-8');
            $gcsRes->assertHeader('access-control-allow-origin', 'http://localhost:3000');
            $gcsRes->assertHeader('vary', 'Origin');
            $this->assertInstanceOf(\Illuminate\Http\Response::class, $gcsRes->baseResponse);
            $this->assertSame('<!doctype html><title>GCS Reader</title>', $gcsRes->getContent());
        } finally {
            $store->close();
            $this->removeDirectoryRecursive($tempDir);
        }
    }

    private function removeDirectoryRecursive(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        $items = scandir($dir);
        if ($items === false) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir . DIRECTORY_SEPARATOR . $item;
            if (is_dir($path)) {
                $this->removeDirectoryRecursive($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }
}
