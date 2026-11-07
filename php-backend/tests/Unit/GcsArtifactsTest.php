<?php

declare(strict_types=1);
namespace Tests\Unit;

use App\Services\GcsArtifacts;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;

// HTTP fixtures only: no live Google credentials or GCS exercised here.
class GcsArtifactsTest extends TestCase
{
    public function test_private_immutable_upload_then_manifest_read_on_other_node(): void
    {
        $history = [];
        $stack = HandlerStack::create(new MockHandler([new Response(200), new Response(200, [], 'reader bytes')]));
        $stack->push(Middleware::history($history));
        $client = new Client(['handler' => $stack]);
        $dir = sys_get_temp_dir() . '/gcs-' . bin2hex(random_bytes(6));
        mkdir($dir);
        file_put_contents($dir . '/reader.html', 'reader bytes');
        $heartbeats = 0;
        try {
            $store = new GcsArtifacts('private-bucket', 'project-id', $client, fn () => 'fixture-token');
            $manifest = $store->publish('job', 'attempt-1', $dir, function () use (&$heartbeats) { $heartbeats++; return true; });
            $this->assertSame(['reader.html'], array_keys($manifest));
            $otherNode = new GcsArtifacts('private-bucket', 'project-id', $client, fn () => 'fixture-token');
            $this->assertSame('reader bytes', $otherNode->read($manifest, 'reader.html'));
            $this->assertGreaterThanOrEqual(2, $heartbeats);
            $request = $history[0]['request'];
            $this->assertSame('Bearer fixture-token', $request->getHeaderLine('Authorization'));
            $this->assertStringContainsString('ifGenerationMatch=0', (string) $request->getUri());
            $this->assertStringContainsString('attempt-1', urldecode((string) $request->getUri()));
            $this->assertStringNotContainsString('predefinedAcl', (string) $request->getUri());
            $this->assertSame(20, $history[0]['options']['timeout']);
        } finally { unlink($dir . '/reader.html'); rmdir($dir); }
    }

    public function test_lost_lease_prevents_any_upload(): void
    {
        $history = [];
        $stack = HandlerStack::create(new MockHandler([]));
        $stack->push(Middleware::history($history));
        $store = new GcsArtifacts('private-bucket', 'project-id', new Client(['handler' => $stack]), fn () => 'fixture-token');
        try {
            $store->publish('job', 'attempt', __DIR__, fn () => false);
            $this->fail('Lost lease accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('Artifact lease lost', $e->getMessage());
        }
        $this->assertCount(0, $history);
    }
}
