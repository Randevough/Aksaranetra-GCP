<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\AksaraConfig;
use App\Services\GceAccessTokenProvider;
use GuzzleHttp\Client;
use App\Services\JobStore;
use Illuminate\Http\JsonResponse;
use Throwable;

class HealthController
{
    public function __construct(
        private readonly AksaraConfig $config
    ) {}

    public function show(): JsonResponse
    {
        $database = false;
        $artifacts = false;
        try {
            // Resolve here so connection failures become readiness failures, not HTTP 500.
            $pdo = app(JobStore::class)->getPdo();
            $database = $pdo !== null && $pdo->query('SELECT lease_token, lease_expires_at FROM audit_jobs WHERE 1 = 0') !== false;
        } catch (Throwable) {
            // Never expose connection details or credentials.
        }
        try {
            if ($this->config->artifactStore === 'local') {
                $dir = $this->config->artifactsDir;
                $artifacts = is_dir($dir) && is_readable($dir) && is_writable($dir);
            } elseif ($this->config->artifactStore === 'gcs' && $this->config->gcsBucket !== '') {
                $token = (app(GceAccessTokenProvider::class))();
                $response = app(Client::class)->request('GET',
                    'https://storage.googleapis.com/storage/v1/b/' . rawurlencode($this->config->gcsBucket) . '/iam/testPermissions', [
                        'headers' => ['Authorization' => 'Bearer ' . $token],
                        'query' => 'permissions=storage.objects.create&permissions=storage.objects.get',
                        'timeout' => 3,
                    ]);
                $permissions = json_decode((string) $response->getBody(), true)['permissions'] ?? [];
                $artifacts = count(array_intersect(['storage.objects.create', 'storage.objects.get'], $permissions)) === 2;
            }
        } catch (Throwable) {
            // Missing capability or unavailable storage must fail closed.
        }
        $ok = $database && $artifacts;
        return response()->json([
            'ok' => $ok,
            // ponytail: no worker heartbeat registry; do not infer liveness from API health.
            'worker' => 'unknown',
            'concurrency' => $this->config->concurrency,
            'dependencies' => ['database' => $database, 'artifacts' => $artifacts],
        ], $ok ? 200 : 503);
    }
}
