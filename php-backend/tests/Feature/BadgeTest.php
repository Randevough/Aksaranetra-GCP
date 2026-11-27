<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\AksaraConfig;
use App\Services\AuditWorkerInterface;
use App\Services\JobStore;
use Tests\Fakes\FakeAuditWorker;
use Tests\TestCase;

class BadgeTest extends TestCase
{
    private string $tempDir;
    private AksaraConfig $config;
    private JobStore $store;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tempDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'aksara-badge-' . uniqid();
        mkdir($this->tempDir, 0777, true);
        mkdir($this->tempDir . DIRECTORY_SEPARATOR . 'artifacts', 0777, true);

        $dbPath = $this->tempDir . DIRECTORY_SEPARATOR . 'jobs.sqlite';
        $this->config = new AksaraConfig([
            'dataDir' => $this->tempDir,
            'databasePath' => $dbPath,
            'artifactsDir' => $this->tempDir . DIRECTORY_SEPARATOR . 'artifacts',
            'secret' => 'test-secret-that-is-long-enough-123456',
            'frontendOrigins' => ['https://frontend.test'],
            'retentionMs' => 3600000,
        ]);

        $this->store = new JobStore($dbPath);
        $worker = new FakeAuditWorker($this->store);

        $this->app->instance(AksaraConfig::class, $this->config);
        $this->app->instance(JobStore::class, $this->store);
        $this->app->instance(AuditWorkerInterface::class, $worker);
    }

    protected function tearDown(): void
    {
        $this->store->close();
        if (is_dir($this->tempDir)) {
            $items = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($this->tempDir, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($items as $item) {
                $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
            }
            @rmdir($this->tempDir);
        }
        parent::tearDown();
    }

    private function seedCompletedHostJob(string $id, string $url, int $afterScore, string $grade, ?int $expiresAt = null): void
    {
        $now = (int) round(microtime(true) * 1000);
        $this->store->createJob([
            'id' => $id,
            'tokenHash' => str_repeat('a', 64),
            'shareTokenHash' => str_repeat('b', 64),
            'ipHash' => str_repeat('c', 64),
            'targetUrl' => $url,
            'createdAt' => $now,
            'expiresAt' => $expiresAt ?? ($now + 3600000),
            'artifactDir' => $this->tempDir . DIRECTORY_SEPARATOR . 'artifacts' . DIRECTORY_SEPARATOR . $id,
        ]);
        $this->store->claimNext();
        $this->store->complete($id, [
            'snapshot' => [
                'score' => [
                    'overall' => $afterScore,
                    'beforeScore' => max(0, $afterScore - 15),
                    'afterScore' => $afterScore,
                    'grade' => $grade,
                ],
            ],
        ]);
    }

    public function test_returns_belum_diaudit_badge_when_host_has_no_completed_job(): void
    {
        $response = $this->get('/badges/belum-pernah.go.id.svg');

        $response->assertStatus(200);
        $response->assertHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $cacheControl = (string) $response->headers->get('Cache-Control');
        $this->assertStringContainsString('public', $cacheControl);
        $this->assertStringContainsString('max-age=300', $cacheControl);

        $svg = $response->getContent();
        $this->assertStringContainsString('AksaraNetra (Skor Otomatis)', $svg);
        $this->assertStringContainsString('Belum Diaudit', $svg);
        $this->assertStringContainsString('#475569', $svg);
    }

    public function test_returns_color_coded_grade_badges_and_normalizes_host(): void
    {
        $this->seedCompletedHostJob('aud_grade_a', 'https://portal.go.id/', 94, 'A');
        $resA = $this->get('/badges/Portal.GO.ID.svg');
        $resA->assertStatus(200);
        $resA->assertHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        $this->assertStringContainsString('94/100 · A', $resA->getContent());
        $this->assertStringContainsString('#0f766e', $resA->getContent());

        $this->seedCompletedHostJob('aud_grade_c', 'https://c-site.go.id/', 68, 'C');
        $resC = $this->get('/badges/c-site.go.id.svg');
        $resC->assertStatus(200);
        $this->assertStringContainsString('68/100 · C', $resC->getContent());
        $this->assertStringContainsString('#b45309', $resC->getContent());

        $this->seedCompletedHostJob('aud_grade_f', 'https://f-site.go.id/', 32, 'F');
        $resF = $this->get('/badges/f-site.go.id.svg');
        $resF->assertStatus(200);
        $this->assertStringContainsString('32/100 · F', $resF->getContent());
        $this->assertStringContainsString('#be123c', $resF->getContent());
    }

    public function test_ignores_expired_completed_jobs(): void
    {
        $past = (int) round(microtime(true) * 1000) - 5000;
        $this->seedCompletedHostJob('aud_expired', 'https://expired.go.id/', 90, 'A', $past);

        $response = $this->get('/badges/expired.go.id.svg');
        $response->assertStatus(200);
        $this->assertStringContainsString('Belum Diaudit', $response->getContent());
    }

    public function test_rejects_invalid_domain_names_and_escapes_svg_xml_entities(): void
    {
        $badUnderscore = $this->get('/badges/bad_domain!.svg');
        $badUnderscore->assertStatus(400);
        $badUnderscore->assertJson(['error' => 'invalid-domain']);

        $badDots = $this->get('/badges/a..b.com.svg');
        $badDots->assertStatus(400);

        $badHyphen = $this->get('/badges/-example.com.svg');
        $badHyphen->assertStatus(400);

        $this->seedCompletedHostJob('aud_xml_escape', 'https://escape.go.id/', 80, '<script>&"');
        $res = $this->get('/badges/escape.go.id.svg');
        $res->assertStatus(200);
        $svg = $res->getContent();
        $this->assertStringNotContainsString('<script>', $svg);
        $this->assertStringContainsString('&lt;SCRIPT&gt;&amp;&quot;', $svg);
    }
}
