<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\GceAccessTokenProvider;
use App\Services\GcsArtifacts;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\TestCase;

class GceAccessTokenProviderTest extends TestCase
{
    public function test_metadata_token_is_cached_then_refreshed_before_expiry(): void
    {
        $history = [];
        $stack = HandlerStack::create(new MockHandler([
            new Response(200, [], '{"access_token":"first-token","token_type":"Bearer","expires_in":3600}'),
            new Response(200, [], '{"access_token":"next-token","token_type":"Bearer","expires_in":3600}'),
        ]));
        $stack->push(Middleware::history($history));
        $now = 1000;
        $provider = new GceAccessTokenProvider(new Client(['handler' => $stack]), function () use (&$now) { return $now; });
        $this->assertSame('first-token', $provider());
        $now = 4569;
        $this->assertSame('first-token', $provider());
        $this->assertCount(1, $history);
        $now = 4570;
        $this->assertSame('next-token', $provider());
        $this->assertCount(2, $history);
        $this->assertSame('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token', (string) $history[0]['request']->getUri());
        $this->assertSame('Google', $history[0]['request']->getHeaderLine('Metadata-Flavor'));
        $this->assertSame(2, $history[0]['options']['timeout']);
        $this->assertFalse($history[0]['options']['allow_redirects']);
        $this->assertSame('', $history[0]['options']['proxy']);
    }

    public function test_invalid_metadata_and_http_failure_fail_closed_without_response_secrets(): void
    {
        foreach (['not-json', '{}', '{"access_token":"secret","token_type":"Bearer","expires_in":0}', '{"access_token":"secret","token_type":"Bearer","expires_in":"3600"}', '{"access_token":"bad token","token_type":"Bearer","expires_in":3600}', '{"access_token":"secret","token_type":"Basic","expires_in":3600}'] as $body) {
            foreach ([200, 500] as $status) {
                $provider = new GceAccessTokenProvider(new Client(['handler' => HandlerStack::create(new MockHandler([new Response($status, [], $body)]))]));
                try {
                    $provider();
                    $this->fail('Invalid metadata accepted');
                } catch (\RuntimeException $e) {
                    $this->assertSame('VM identity token unavailable', $e->getMessage());
                    $this->assertNull($e->getPrevious());
                }
            }
        }
    }

    public function test_metadata_connection_failure_hides_request_details(): void
    {
        $error = new \GuzzleHttp\Exception\ConnectException('secret transport detail', new \GuzzleHttp\Psr7\Request('GET', 'http://169.254.169.254/'));
        $provider = new GceAccessTokenProvider(new Client(['handler' => HandlerStack::create(new MockHandler([$error]))]));
        try {
            $provider();
            $this->fail('Connection failure accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('VM identity token unavailable', $e->getMessage());
            $this->assertNull($e->getPrevious());
        }
    }

    public function test_refresh_failure_does_not_reuse_cached_token(): void
    {
        $now = 1000;
        $provider = new GceAccessTokenProvider(new Client(['handler' => HandlerStack::create(new MockHandler([
            new Response(200, [], '{"access_token":"old-token","token_type":"Bearer","expires_in":60}'),
            new Response(503, [], 'secret'),
        ]))]), function () use (&$now) { return $now; });
        $this->assertSame('old-token', $provider());
        $now = 1030;
        $this->expectExceptionMessage('VM identity token unavailable');
        $provider();
    }

    public function test_missing_or_invalid_injected_token_never_sends_gcs_request(): void
    {
        foreach ([null, fn () => '', fn () => "bad\r\ntoken", fn () => 123] as $tokenProvider) {
            $history = [];
            $stack = HandlerStack::create(new MockHandler([]));
            $stack->push(Middleware::history($history));
            $store = new GcsArtifacts('bucket', 'project', new Client(['handler' => $stack]), $tokenProvider);
            try {
                $store->read(['reader.html' => ['path' => 'jobs/job/attempt/reader.html']], 'reader.html');
                $this->fail('Missing token accepted');
            } catch (\RuntimeException $e) {
                $this->assertSame('GCS access token unavailable', $e->getMessage());
            }
            $this->assertCount(0, $history);
        }
    }
}
