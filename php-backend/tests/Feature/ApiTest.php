<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\AksaraConfig;
use App\Services\AuditWorkerInterface;
use App\Services\BridgeClientInterface;
use App\Services\JobStore;
use Illuminate\Testing\TestResponse;
use Tests\Fakes\FakeAuditWorker;
use Tests\TestCase;

class ApiTest extends TestCase
{
    private string $tempDir;
    private AksaraConfig $config;
    private JobStore $store;
    private FakeAuditWorker $worker;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tempDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'aksara-api-' . uniqid();
        mkdir($this->tempDir, 0777, true);
        mkdir($this->tempDir . DIRECTORY_SEPARATOR . 'artifacts', 0777, true);

        $dbPath = $this->tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite';

        $this->config = new AksaraConfig([
            'dataDir' => $this->tempDir,
            'databasePath' => $dbPath,
            'artifactsDir' => $this->tempDir . DIRECTORY_SEPARATOR . 'artifacts',
            'secret' => 'test-secret-that-is-long-enough-123456',
            'frontendOrigins' => ['https://frontend.test'],
            'rateLimit' => 10,
            'retentionMs' => 3600000,
            'maxBodyBytes' => 65536,
        ]);

        $this->store = new JobStore($dbPath);
        $this->worker = new FakeAuditWorker($this->store);

        $this->app->instance(AksaraConfig::class, $this->config);
        $this->app->instance(JobStore::class, $this->store);
        $this->app->instance(AuditWorkerInterface::class, $this->worker);
    }

    protected function tearDown(): void
    {
        $this->store->close();
        $this->removeDirectoryRecursive($this->tempDir);
        parent::tearDown();
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

    private function createJob(string $url = 'https://example.com/', array $extra = []): TestResponse
    {
        return $this->postJson('/audits', array_merge(['url' => $url], $extra), [
            'Origin' => 'https://frontend.test',
        ]);
    }

    public function test_creates_anonymous_job_and_hides_without_token(): void
    {
        $response = $this->createJob();
        $response->assertStatus(202);

        $data = $response->json();
        $this->assertMatchesRegularExpression('/^aud_/', $data['jobId']);
        $this->assertGreaterThan(30, strlen($data['accessToken']));
        $this->assertSame(1, $this->worker->kicks);
        $this->assertSame('/audits/' . $data['jobId'], $data['statusPath']);
        $response->assertHeader('Location', '/audits/' . $data['jobId']);

        // Hidden without token
        $hidden = $this->get('/audits/' . $data['jobId'], [
            'Origin' => 'https://frontend.test',
        ]);
        $hidden->assertStatus(404);

        // Visible with Bearer token in header
        $visible = $this->get('/audits/' . $data['jobId'], [
            'Origin' => 'https://frontend.test',
            'Authorization' => 'Bearer ' . $data['accessToken'],
        ]);
        $visible->assertStatus(200);
        $this->assertSame('queued', $visible->json('job.status'));
        $this->assertSame('https://example.com/', $visible->json('job.url'));

        // Visible with token in query param
        $visibleQuery = $this->get('/audits/' . $data['jobId'] . '?accessToken=' . $data['accessToken'], [
            'Origin' => 'https://frontend.test',
        ]);
        $visibleQuery->assertStatus(200);
        $this->assertSame('queued', $visibleQuery->json('job.status'));
    }

    public function test_returns_expiring_reader_and_pdf_links_only_after_completion(): void
    {
        $response = $this->createJob();
        $data = $response->json();

        // Before completion, /result returns 409 not-ready
        $notReady = $this->get('/audits/' . $data['jobId'] . '/result', [
            'Origin' => 'https://frontend.test',
            'Authorization' => 'Bearer ' . $data['accessToken'],
        ]);
        $notReady->assertStatus(409);
        $this->assertSame('not-ready', $notReady->json('error'));

        // Claim job and write artifacts
        $job = $this->store->claimNext();
        $this->assertNotNull($job);

        mkdir($job->artifactDir, 0777, true);
        file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'reader.html', '<!doctype html><title>Reader</title>');
        file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'patched.html', '<!doctype html><title>Patched</title>');
        file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'report.pdf', '%PDF-test');
        file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'after.png', 'png');

        $this->store->complete($job->id, ['snapshot' => ['summary' => ['beforeTotal' => 2, 'afterTotal' => 0]]]);

        // After completion, /result returns 200 with artifact links
        $result = $this->get('/audits/' . $job->id . '/result', [
            'Origin' => 'https://frontend.test',
            'Authorization' => 'Bearer ' . $data['accessToken'],
        ]);
        $result->assertStatus(200);

        $resultData = $result->json();
        $this->assertStringContainsString('token=', $resultData['links']['reader']);
        $this->assertStringContainsString('token=', $resultData['links']['reportPdf']);

        // Download reader artifact
        $reader = $this->get($resultData['links']['reader'], [
            'Origin' => 'https://frontend.test',
        ]);
        $reader->assertStatus(200);
        $reader->assertHeader('Content-Type', 'text/html; charset=utf-8');
        $cacheControl = (string) $reader->headers->get('Cache-Control');
        $this->assertStringContainsString('private', $cacheControl);
        $this->assertStringContainsString('max-age=300', $cacheControl);
        $reader->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringContainsString('Reader', file_get_contents($reader->getFile()->getPathname()));

        // Download report.pdf artifact
        $pdf = $this->get($resultData['links']['reportPdf'], [
            'Origin' => 'https://frontend.test',
        ]);
        $pdf->assertStatus(200);
        $pdf->assertHeader('Content-Type', 'application/pdf');
        $pdfCacheControl = (string) $pdf->headers->get('Cache-Control');
        $this->assertStringContainsString('private', $pdfCacheControl);
        $this->assertStringContainsString('max-age=300', $pdfCacheControl);
        $pdf->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringContainsString("default-src 'none'", (string) $pdf->headers->get('Content-Security-Policy'));
        $this->assertSame('%PDF-test', file_get_contents($pdf->getFile()->getPathname()));

        // Artifact request without token returns 404
        $noToken = $this->get("/audits/{$job->id}/artifacts/reader", [
            'Origin' => 'https://frontend.test',
        ]);
        $noToken->assertStatus(404);
        $this->assertSame('Artefak tidak ditemukan.', $noToken->json('message'));

        // Artifact request with invalid token returns 404
        $invalidToken = $this->get("/audits/{$job->id}/artifacts/reader?token=wrong-token", [
            'Origin' => 'https://frontend.test',
        ]);
        $invalidToken->assertStatus(404);
        $this->assertSame('Artefak tidak ditemukan.', $invalidToken->json('message'));
    }

    public function test_artifact_route_serves_report_html_fallback_when_report_pdf_missing(): void
    {
        $response = $this->createJob();
        $data = $response->json();
        $job = $this->store->claimNext();
        $this->assertNotNull($job);

        mkdir($job->artifactDir, 0777, true);
        file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'report.html', '<!doctype html><title>Report</title>');

        $this->store->complete($job->id, [
            'snapshot' => ['summary' => ['beforeTotal' => 1, 'afterTotal' => 0]],
            'artifacts' => [
                'reader' => 'reader.html',
                'patched' => 'patched.html',
                'reportPdf' => 'report.html',
                'screenshot' => 'after.png',
            ],
        ]);

        $result = $this->get('/audits/' . $job->id . '/result', [
            'Origin' => 'https://frontend.test',
            'Authorization' => 'Bearer ' . $data['accessToken'],
        ]);
        $result->assertStatus(200);
        $resultData = $result->json();

        $this->assertStringContainsString('/artifacts/report.pdf?token=', $resultData['links']['reportPdf']);

        $pdfResponse = $this->get($resultData['links']['reportPdf'], [
            'Origin' => 'https://frontend.test',
        ]);
        $pdfResponse->assertStatus(200);
        $pdfResponse->assertHeader('Content-Type', 'text/html; charset=utf-8');
        $this->assertStringContainsString('Report', file_get_contents($pdfResponse->getFile()->getPathname()));

        preg_match('/token=([^&]+)/', $resultData['links']['reportPdf'], $matches);
        $shareToken = $matches[1] ?? '';
        $htmlResponse = $this->get("/audits/{$job->id}/artifacts/report.html?token={$shareToken}", [
            'Origin' => 'https://frontend.test',
        ]);
        $htmlResponse->assertStatus(404);
        $this->assertSame('Artefak tidak ditemukan.', $htmlResponse->json('message'));
    }

    public function test_result_links_and_convenience_export_routes_work_with_bearer_or_share_token(): void
    {
        $response = $this->createJob();
        $data = $response->json();
        $job = $this->store->claimNext();
        $this->assertNotNull($job);

        mkdir($job->artifactDir, 0777, true);
        file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'before.png', 'before-png');
        file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'report.json', '{"ok":true}');
        file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'report.csv', "\xEF\xBB\xBFIssue_ID,Rule_ID\r\n1,image-alt\r\n");

        $this->store->complete($job->id, ['snapshot' => ['ok' => true]]);

        $result = $this->get('/audits/' . $job->id . '/result', [
            'Origin' => 'https://frontend.test',
            'Authorization' => 'Bearer ' . $data['accessToken'],
        ]);
        $result->assertStatus(200);
        $links = $result->json('links');

        $this->assertArrayHasKey('beforeScreenshot', $links);
        $this->assertArrayHasKey('reportJson', $links);
        $this->assertArrayHasKey('reportCsv', $links);

        // Via /artifacts/report.json and /artifacts/report.csv
        $jsonArt = $this->get($links['reportJson'], ['Origin' => 'https://frontend.test']);
        $jsonArt->assertStatus(200);
        $jsonArt->assertHeader('Content-Type', 'application/json; charset=utf-8');

        $csvArt = $this->get($links['reportCsv'], ['Origin' => 'https://frontend.test']);
        $csvArt->assertStatus(200);
        $csvArt->assertHeader('Content-Type', 'text/csv; charset=utf-8');

        // Convenience export routes with Bearer accessToken
        $bearerJson = $this->get("/audits/{$job->id}/report.json", [
            'Origin' => 'https://frontend.test',
            'Authorization' => 'Bearer ' . $data['accessToken'],
        ]);
        $bearerJson->assertStatus(200);
        $bearerJson->assertHeader('Content-Type', 'application/json; charset=utf-8');

        $bearerCsv = $this->get("/audits/{$job->id}/report.csv", [
            'Origin' => 'https://frontend.test',
            'Authorization' => 'Bearer ' . $data['accessToken'],
        ]);
        $bearerCsv->assertStatus(200);
        $bearerCsv->assertHeader('Content-Type', 'text/csv; charset=utf-8');

        // Convenience export routes with ?token=<shareToken>
        preg_match('/token=([^&]+)/', $links['reportJson'], $m);
        $shareToken = $m[1] ?? '';

        $shareJson = $this->get("/audits/{$job->id}/report.json?token={$shareToken}", ['Origin' => 'https://frontend.test']);
        $shareJson->assertStatus(200);

        $shareCsv = $this->get("/audits/{$job->id}/report.csv?token={$shareToken}", ['Origin' => 'https://frontend.test']);
        $shareCsv->assertStatus(200);

        // Invalid token returns 404
        $badExport = $this->get("/audits/{$job->id}/report.json?token=invalid", ['Origin' => 'https://frontend.test']);
        $badExport->assertStatus(404);
    }

    public function test_before_screenshot_served_while_running_and_completed_with_live_telemetry(): void
    {
        $response = $this->createJob();
        $data = $response->json();
        $job = $this->store->claimNext();
        $this->assertNotNull($job);

        mkdir($job->artifactDir, 0777, true);
        file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'before.png', 'early-png-data');

        $telemetry = [
            'steps' => [
                ['id' => 'capture_before', 'label' => 'Mengambil pratinjau', 'status' => 'done'],
            ],
            'stats' => ['domElements' => 120],
            'earlyPreviewReady' => true,
            'updatedAt' => '2026-11-27T00:00:00.000Z',
        ];
        $this->store->updateProgress($job->id, [
            'progress' => 46,
            'stage' => 'Menangkap pratinjau awal',
            'telemetry' => $telemetry,
        ]);

        // Subsequent progress update without telemetry must preserve existing telemetry
        $this->store->updateProgress($job->id, [
            'progress' => 60,
            'stage' => 'Mengaudit WCAG',
        ]);

        $statusRes = $this->get('/audits/' . $job->id, [
            'Origin' => 'https://frontend.test',
            'Authorization' => 'Bearer ' . $data['accessToken'],
        ]);
        $statusRes->assertStatus(200);
        $this->assertSame($telemetry, $statusRes->json('job.telemetry'));
        $previewUrl = $statusRes->json('job.previewUrl');
        $this->assertIsString($previewUrl);
        $this->assertStringContainsString('/artifacts/before-screenshot?token=', $previewUrl);

        // Allowed while running
        $previewRes = $this->get($previewUrl, ['Origin' => 'https://frontend.test']);
        $previewRes->assertStatus(200);
        $previewRes->assertHeader('Content-Type', 'image/png');

        // Other artifacts remain blocked while running
        preg_match('/token=([^&]+)/', $previewUrl, $m);
        $shareToken = $m[1] ?? '';
        $readerWhileRunning = $this->get("/audits/{$job->id}/artifacts/reader?token={$shareToken}", ['Origin' => 'https://frontend.test']);
        $readerWhileRunning->assertStatus(410);

        // Still allowed after completion
        $this->store->complete($job->id, ['snapshot' => ['ok' => true]]);
        $previewCompleted = $this->get($previewUrl, ['Origin' => 'https://frontend.test']);
        $previewCompleted->assertStatus(200);
    }

    public function test_patched_artifact_csp_allows_external_styles_fonts_and_sanitized_frame_ancestors(): void
    {
        $this->config = new AksaraConfig([
            'dataDir' => $this->tempDir,
            'databasePath' => $this->tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite',
            'artifactsDir' => $this->tempDir . DIRECTORY_SEPARATOR . 'artifacts',
            'secret' => 'test-secret-that-is-long-enough-123456',
            'frontendOrigins' => [
                'https://frontend.test',
                'http://localhost:3000',
                "https://evil.test; script-src 'unsafe-inline'",
            ],
            'rateLimit' => 10,
            'retentionMs' => 3600000,
        ]);
        $this->app->instance(AksaraConfig::class, $this->config);

        $response = $this->createJob();
        $data = $response->json();
        $job = $this->store->claimNext();
        mkdir($job->artifactDir, 0777, true);
        file_put_contents($job->artifactDir . DIRECTORY_SEPARATOR . 'patched.html', '<!doctype html><p>Patched</p>');
        $this->store->complete($job->id, ['snapshot' => ['ok' => true]]);

        $result = $this->get('/audits/' . $job->id . '/result', [
            'Origin' => 'https://frontend.test',
            'Authorization' => 'Bearer ' . $data['accessToken'],
        ]);
        $patchedRes = $this->get($result->json('links.patched'), ['Origin' => 'https://frontend.test']);
        $patchedRes->assertStatus(200);

        $csp = (string) $patchedRes->headers->get('Content-Security-Policy');
        $this->assertSame(
            "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://frontend.test http://localhost:3000",
            $csp
        );
    }

    public function test_gcs_ha_cache_reuse_succeeds_without_local_artifact_dir(): void
    {
        $this->config = new AksaraConfig([
            'dataDir' => $this->tempDir,
            'databasePath' => $this->tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite',
            'artifactsDir' => $this->tempDir . DIRECTORY_SEPARATOR . 'artifacts',
            'secret' => 'test-secret-that-is-long-enough-123456',
            'frontendOrigins' => ['https://frontend.test'],
            'artifactStore' => 'gcs',
            'gcsBucket' => 'private-bucket',
            'rateLimit' => 10,
            'retentionMs' => 3600000,
        ]);
        $this->app->instance(AksaraConfig::class, $this->config);

        $first = $this->createJob('https://example.com/ha-cache');
        $firstJob = $this->store->claimNext();
        $this->assertNotNull($firstJob);
        $this->assertFalse(is_dir($firstJob->artifactDir));

        $this->store->complete($firstJob->id, [
            'snapshot' => ['cached' => true],
            'manifest' => [
                'reader.html' => ['path' => 'jobs/1/reader.html', 'contentType' => 'text/html; charset=utf-8', 'size' => 10],
            ],
        ]);

        $reused = $this->createJob('https://example.com/ha-cache', ['reuseExisting' => true]);
        $reused->assertStatus(200);
        $this->assertSame('completed', $reused->json('status'));
        $this->assertSame(1, $this->worker->kicks);
        $storedReused = $this->store->getJob($reused->json('jobId'));
        $this->assertArrayHasKey('manifest', $storedReused->result);
    }

    public function test_gcs_artifact_controller_serves_early_preview_and_report_html_fallback(): void
    {
        $history = [];
        $mock = new \GuzzleHttp\Handler\MockHandler([
            new \GuzzleHttp\Psr7\Response(200, [], 'early-gcs-png'),
            new \GuzzleHttp\Psr7\Response(200, [], '<!doctype html><title>GCS Fallback</title>'),
        ]);
        $stack = \GuzzleHttp\HandlerStack::create($mock);
        $stack->push(\GuzzleHttp\Middleware::history($history));
        $gcs = new \App\Services\GcsArtifacts('private-bucket', 'project-id', new \GuzzleHttp\Client(['handler' => $stack]), fn () => 'token');

        $this->config = new AksaraConfig([
            'dataDir' => $this->tempDir,
            'databasePath' => $this->tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite',
            'artifactsDir' => $this->tempDir . DIRECTORY_SEPARATOR . 'artifacts',
            'secret' => 'test-secret-that-is-long-enough-123456',
            'frontendOrigins' => ['https://frontend.test'],
            'artifactStore' => 'gcs',
            'gcsBucket' => 'private-bucket',
            'rateLimit' => 10,
            'retentionMs' => 3600000,
        ]);
        $this->app->instance(AksaraConfig::class, $this->config);
        $this->app->instance(\App\Http\Controllers\AuditArtifactController::class, new \App\Http\Controllers\AuditArtifactController(
            $this->config,
            $this->app->make(\App\Services\SecurityService::class),
            $this->store,
            $gcs
        ));

        $create = $this->createJob('https://example.com/gcs-serve');
        $jobId = $create->json('jobId');
        $accessToken = $create->json('accessToken');
        $job = $this->store->claimNext();

        $this->store->updateProgress($job->id, [
            'progress' => 46,
            'stage' => 'Pratinjau',
            'telemetry' => ['steps' => [], 'stats' => [], 'earlyPreviewReady' => true, 'updatedAt' => '2026-11-27T00:00:00.000Z'],
        ]);

        $statusRes = $this->get("/audits/{$jobId}", [
            'Origin' => 'https://frontend.test',
            'Authorization' => "Bearer {$accessToken}",
        ]);
        $previewUrl = $statusRes->json('job.previewUrl');
        $previewRes = $this->get($previewUrl, ['Origin' => 'https://frontend.test']);
        $previewRes->assertStatus(200);
        $previewRes->assertHeader('Content-Type', 'image/png');
        $this->assertSame('early-gcs-png', $previewRes->getContent());

        // Complete with report.html in manifest (no report.pdf)
        $this->store->complete($job->id, [
            'snapshot' => ['ok' => true],
            'manifest' => [
                'report.html' => ['path' => "jobs/{$jobId}/attempt-1-1/report.html", 'contentType' => 'text/html; charset=utf-8', 'size' => 40],
            ],
        ]);
        $resultRes = $this->get("/audits/{$jobId}/result", [
            'Origin' => 'https://frontend.test',
            'Authorization' => "Bearer {$accessToken}",
        ]);
        $pdfRes = $this->get($resultRes->json('links.reportPdf'), ['Origin' => 'https://frontend.test']);
        $pdfRes->assertStatus(200);
        $pdfRes->assertHeader('Content-Type', 'text/html; charset=utf-8');
        $this->assertStringContainsString('GCS Fallback', $pdfRes->getContent());
    }

    public function test_lets_user_explicitly_reuse_stored_result(): void
    {
        $first = $this->createJob('https://example.com/');
        $firstJob = $this->store->claimNext();
        $this->assertNotNull($firstJob);

        mkdir($firstJob->artifactDir, 0777, true);
        file_put_contents($firstJob->artifactDir . DIRECTORY_SEPARATOR . 'reader.html', 'stored reader');
        $this->store->complete($firstJob->id, ['snapshot' => ['cached' => true]]);

        // Check cache lookup
        $lookup = $this->get('/audits/cache?url=' . urlencode('https://example.com/'), [
            'Origin' => 'https://frontend.test',
        ]);
        $lookup->assertStatus(200);
        $this->assertTrue($lookup->json('available'));
        $this->assertNotNull($lookup->json('capturedAt'));
        $this->assertNotNull($lookup->json('expiresAt'));

        // Create job with reuseExisting: true
        $reused = $this->createJob('https://example.com/', ['reuseExisting' => true]);
        $reused->assertStatus(200);
        $this->assertSame('completed', $reused->json('status'));
        $this->assertSame(1, $this->worker->kicks);

        $storedReused = $this->store->getJob($reused->json('jobId'));
        $this->assertTrue($storedReused->result['snapshot']['cached']);
        $this->assertFileExists($storedReused->artifactDir . DIRECTORY_SEPARATOR . 'reader.html');
        $this->assertSame('stored reader', file_get_contents($storedReused->artifactDir . DIRECTORY_SEPARATOR . 'reader.html'));
    }

    public function test_enforces_rate_limit_and_queued_cancellation(): void
    {
        // Reconfigure with rateLimit = 1
        $this->config = new AksaraConfig([
            'dataDir' => $this->tempDir,
            'databasePath' => $this->tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite',
            'artifactsDir' => $this->tempDir . DIRECTORY_SEPARATOR . 'artifacts',
            'secret' => 'test-secret-that-is-long-enough-123456',
            'frontendOrigins' => ['https://frontend.test'],
            'rateLimit' => 1,
            'retentionMs' => 3600000,
        ]);
        $this->app->instance(AksaraConfig::class, $this->config);

        $first = $this->createJob('https://example.com/');
        $first->assertStatus(202);

        $second = $this->createJob('https://example.org/');
        $second->assertStatus(429);
        $second->assertHeader('Retry-After', '3600');
        $second->assertJson([
            'error' => 'rate-limit',
            'message' => 'Batas 1 audit per jam sudah tercapai.',
        ]);

        // Cancel the first job
        $cancelled = $this->delete('/audits/' . $first->json('jobId'), [], [
            'Origin' => 'https://frontend.test',
            'Authorization' => 'Bearer ' . $first->json('accessToken'),
        ]);
        $cancelled->assertStatus(202);
        $this->assertSame('cancelled', $cancelled->json('job.status'));
    }

    public function test_json_body_validation_and_size_limits(): void
    {
        // 415 on wrong Content-Type
        $wrongType = $this->call('POST', '/audits', [], [], [], [
            'CONTENT_TYPE' => 'text/plain',
            'HTTP_ORIGIN' => 'https://frontend.test',
        ], 'some plain text');
        $wrongType->assertStatus(415);
        $wrongType->assertJson([
            'error' => 'bad-request',
            'message' => 'Gunakan Content-Type application/json.',
        ]);

        // 400 on invalid JSON
        $invalidJson = $this->call('POST', '/audits', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ORIGIN' => 'https://frontend.test',
        ], '{malformed json');
        $invalidJson->assertStatus(400);
        $invalidJson->assertJson([
            'error' => 'bad-request',
            'message' => 'JSON tidak valid.',
        ]);

        // 413 on payload too large
        $this->config = new AksaraConfig([
            'dataDir' => $this->tempDir,
            'databasePath' => $this->tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite',
            'artifactsDir' => $this->tempDir . DIRECTORY_SEPARATOR . 'artifacts',
            'secret' => 'test-secret-that-is-long-enough-123456',
            'frontendOrigins' => ['https://frontend.test'],
            'maxBodyBytes' => 1024,
            'retentionMs' => 3600000,
        ]);
        $this->app->instance(AksaraConfig::class, $this->config);

        $tooLarge = $this->call('POST', '/audits', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ORIGIN' => 'https://frontend.test',
        ], json_encode(['url' => 'https://example.com/', 'extra' => str_repeat('a', 2000)]));
        $tooLarge->assertStatus(413);
        $tooLarge->assertJson([
            'error' => 'bad-request',
            'message' => 'Body permintaan terlalu besar.',
        ]);
    }

    public function test_health_endpoint(): void
    {
        $response = $this->get('/health');
        $response->assertStatus(200);
        $response->assertJson([
            'ok' => true,
            'worker' => 'unknown',
            'concurrency' => 1,
        ]);
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
    }

    public function test_not_found_endpoint(): void
    {
        $response = $this->get('/non-existent-endpoint');
        $response->assertStatus(404);
        $response->assertJson([
            'error' => 'not-found',
            'message' => 'Endpoint tidak ditemukan.',
        ]);
    }

    public function test_multi_page_options_validation_clamping_and_cache_isolation(): void
    {
        // Rejects invalid mode
        $badMode = $this->createJob('https://example.com/bad-mode', ['mode' => 'invalid']);
        $badMode->assertStatus(400);
        $badMode->assertJson(['error' => 'bad-request']);

        // Single mode forces maxPages = 1 even if maxPages is passed
        $single = $this->createJob('https://example.com/multi-test', ['mode' => 'single', 'maxPages' => 5]);
        $single->assertStatus(202);
        $this->assertSame('single', $single->json('mode'));
        $this->assertSame(1, $single->json('maxPages'));
        $singleJob = $this->store->claimNext();
        $this->assertNotNull($singleJob);
        $this->assertSame('example.com', $singleJob->targetHost);
        mkdir($singleJob->artifactDir, 0777, true);
        file_put_contents($singleJob->artifactDir . DIRECTORY_SEPARATOR . 'reader.html', 'single');
        $this->store->complete($singleJob->id, ['snapshot' => ['mode' => 'single']]);

        // Multi request with reuseExisting=true must NOT reuse single cached job
        $multiDefault = $this->createJob('https://example.com/multi-test', [
            'mode' => 'multi',
            'reuseExisting' => true,
        ]);
        $multiDefault->assertStatus(202);
        $this->assertSame('multi', $multiDefault->json('mode'));
        $this->assertSame(3, $multiDefault->json('maxPages'));
        $this->assertNotSame('completed', $multiDefault->json('status'));

        // Clamps maxPages > 5 to 5
        $multiClamped = $this->createJob('https://example.com/multi-clamp', [
            'mode' => 'multi',
            'maxPages' => 99,
        ]);
        $multiClamped->assertStatus(202);
        $this->assertSame('multi', $multiClamped->json('mode'));
        $this->assertSame(5, $multiClamped->json('maxPages'));

        // Complete multiDefault (maxPages=3) and verify cache lookup and reuse match mode + maxPages
        $multiJob = $this->store->claimNext();
        $this->assertSame($multiDefault->json('jobId'), $multiJob->id);
        mkdir($multiJob->artifactDir, 0777, true);
        file_put_contents($multiJob->artifactDir . DIRECTORY_SEPARATOR . 'reader.html', 'multi-3');
        $this->store->complete($multiJob->id, ['snapshot' => ['mode' => 'multi']]);

        $cacheMulti3 = $this->get('/audits/cache?url=' . urlencode('https://example.com/multi-test') . '&mode=multi&maxPages=3', [
            'Origin' => 'https://frontend.test',
        ]);
        $cacheMulti3->assertStatus(200);
        $this->assertTrue($cacheMulti3->json('available'));

        $cacheMulti5 = $this->get('/audits/cache?url=' . urlencode('https://example.com/multi-test') . '&mode=multi&maxPages=5', [
            'Origin' => 'https://frontend.test',
        ]);
        $cacheMulti5->assertStatus(200);
        $this->assertFalse($cacheMulti5->json('available'));

        $reusedMulti = $this->createJob('https://example.com/multi-test', [
            'mode' => 'multi',
            'maxPages' => 3,
            'reuseExisting' => true,
        ]);
        $reusedMulti->assertStatus(200);
        $this->assertSame('completed', $reusedMulti->json('status'));
        $this->assertSame('multi', $reusedMulti->json('mode'));
        $this->assertSame(3, $reusedMulti->json('maxPages'));
    }
}
