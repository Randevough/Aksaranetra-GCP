<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\AksaraConfig;
use App\Services\JobStore;
use Tests\TestCase;

class ReadinessTest extends TestCase
{
    public function test_readiness_checks_schema_and_local_artifact_capability(): void
    {
        $store = new JobStore(':memory:');
        $this->app->instance(JobStore::class, $store);
        $this->app->instance(AksaraConfig::class, new AksaraConfig(['artifactsDir' => sys_get_temp_dir()]));
        $this->getJson('/health')->assertOk()->assertJson([
            'ok' => true, 'worker' => 'unknown', 'dependencies' => ['database' => true, 'artifacts' => true],
        ]);
        $store->getPdo()->exec('DROP TABLE audit_jobs');
        $this->getJson('/health')->assertStatus(503)->assertJson([
            'ok' => false, 'dependencies' => ['database' => false],
        ]);
    }

    public function test_readiness_rejects_missing_artifact_directory(): void
    {
        $this->app->instance(JobStore::class, new JobStore(':memory:'));
        $this->app->instance(AksaraConfig::class, new AksaraConfig(['artifactsDir' => '/missing-aksaranetra-readiness']));
        $this->getJson('/health')->assertStatus(503)->assertJson([
            'ok' => false, 'dependencies' => ['artifacts' => false],
        ]);
    }

    public function test_gcs_readiness_uses_configured_adapter_capability(): void
    {
        $this->app->instance(JobStore::class, new JobStore(':memory:'));
        $this->app->instance(AksaraConfig::class, new AksaraConfig(['artifactStore' => 'gcs', 'gcsBucket' => 'private-bucket']));
        $mock = new \GuzzleHttp\Handler\MockHandler([
            new \GuzzleHttp\Psr7\Response(200, [], '{"access_token":"test-token","expires_in":3600}'),
            new \GuzzleHttp\Psr7\Response(200, [], '{"permissions":["storage.objects.create","storage.objects.get"]}'),
            new \GuzzleHttp\Psr7\Response(200, [], '{"permissions":["storage.objects.get"]}'),
        ]);
        $client = new \GuzzleHttp\Client(['handler' => \GuzzleHttp\HandlerStack::create($mock)]);
        $this->app->instance(\App\Services\GceAccessTokenProvider::class, new \App\Services\GceAccessTokenProvider($client));
        $this->app->instance(\GuzzleHttp\Client::class, $client);
        $this->getJson('/health')->assertOk()->assertJson(['dependencies' => ['artifacts' => true]]);
        $this->getJson('/health')->assertStatus(503)->assertJson(['dependencies' => ['artifacts' => false]]);
    }

    public function test_closed_database_returns_unavailable_without_leaking_errors(): void
    {
        $store = new JobStore(':memory:');
        $store->close();
        $this->app->instance(JobStore::class, $store);
        $this->getJson('/health')->assertStatus(503)->assertJson(['ok' => false]);
    }
}
