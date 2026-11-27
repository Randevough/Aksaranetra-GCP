<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\BridgeClient;
use Tests\TestCase;

class BridgeTest extends TestCase
{
    private BridgeClient $client;

    protected function setUp(): void
    {
        parent::setUp();
        $this->client = new BridgeClient();
    }

    public function test_check_url_allows_valid_public_url(): void
    {
        $verdict = $this->client->checkUrl('https://example.com/');
        $this->assertTrue($verdict['ok']);
        $this->assertNull($verdict['code']);
        $this->assertSame('https://example.com/', $verdict['url']);
        $this->assertSame('example.com', $verdict['hostname']);
        $this->assertSame('https:', $verdict['protocol']);
    }

    public function test_check_url_rejects_empty_url(): void
    {
        $verdict = $this->client->checkUrl('');
        $this->assertFalse($verdict['ok']);
        $this->assertSame('empty-url', $verdict['code']);
        $this->assertSame('URL kosong.', $verdict['message']);
    }

    public function test_check_url_rejects_ip_literal(): void
    {
        $verdict = $this->client->checkUrl('http://127.0.0.1/');
        $this->assertFalse($verdict['ok']);
        $this->assertSame('ip-literal-not-allowed', $verdict['code']);
        $this->assertSame('Alamat IP langsung tidak diterima. Gunakan nama domain.', $verdict['message']);
    }

    public function test_check_url_rejects_localhost(): void
    {
        $verdict = $this->client->checkUrl('http://localhost/test');
        $this->assertFalse($verdict['ok']);
        $this->assertSame('local-host-name', $verdict['code']);
        $this->assertSame('Nama localhost mengarah ke mesin lokal.', $verdict['message']);
    }

    public function test_check_url_rejects_non_http_protocol(): void
    {
        $verdict = $this->client->checkUrl('ftp://example.com/');
        $this->assertFalse($verdict['ok']);
        $this->assertSame('protocol-not-allowed', $verdict['code']);
        $this->assertSame('Hanya http dan https yang didukung, bukan ftp.', $verdict['message']);
    }

    public function test_bridge_forwards_telemetry_from_progress_ndjson(): void
    {
        $script = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'aksara-bridge-telemetry-' . uniqid() . '.mjs';
        file_put_contents($script, <<<'JS'
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    type: 'progress',
    progress: 46,
    stage: 'Menangkap pratinjau',
    telemetry: { steps: [], stats: { domElements: 42 }, earlyPreviewReady: true, updatedAt: '2026-11-27T00:00:00.000Z' }
  }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'result', snapshot: { ok: true } }) + '\n');
});
JS);

        try {
            $client = new BridgeClient($script);
            $updates = [];
            $res = $client->audit('job1', 'https://example.com/', sys_get_temp_dir(), function ($u) use (&$updates) {
                $updates[] = $u;
            });

            $this->assertSame(['ok' => true], $res['snapshot']);
            $this->assertCount(1, $updates);
            $this->assertSame(46, $updates[0]['progress']);
            $this->assertTrue($updates[0]['telemetry']['earlyPreviewReady']);
            $this->assertSame(42, $updates[0]['telemetry']['stats']['domElements']);
        } finally {
            @unlink($script);
        }
    }

    public function test_bridge_forwards_mode_and_max_pages_options_via_stdin(): void
    {
        $script = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'aksara-bridge-options-' . uniqid() . '.mjs';
        file_put_contents($script, <<<'JS'
let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  const input = JSON.parse(raw);
  process.stdout.write(JSON.stringify({ type: 'result', snapshot: { received: input } }) + '\n');
});
JS);

        try {
            $client = new BridgeClient($script);
            $res = $client->audit('job-multi', 'https://example.com/', sys_get_temp_dir(), null, null, null, [
                'mode' => 'multi',
                'maxPages' => 4,
            ]);

            $this->assertSame('multi', $res['snapshot']['received']['mode']);
            $this->assertSame(4, $res['snapshot']['received']['maxPages']);
        } finally {
            @unlink($script);
        }
    }
}
