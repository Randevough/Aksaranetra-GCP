<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\AuditJob;
use App\Services\AksaraConfig;
use App\Services\JobStore;
use App\Services\SecurityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuditResultController
{
    public function __construct(
        private readonly AksaraConfig $config,
        private readonly SecurityService $security,
        private readonly JobStore $store
    ) {}

    public function show(Request $request, string $id): JsonResponse
    {
        $accessToken = $this->security->bearerToken($request);
        $job = $this->authorizedJob($id, $accessToken);

        if (!$job) {
            return response()->json([
                'error' => 'not-found',
                'message' => 'Audit tidak ditemukan.',
            ], 404);
        }

        if ($job->status !== 'completed') {
            return response()->json([
                'error' => 'not-ready',
                'job' => $job->toPublic($this->store->queuePosition($job->id)),
            ], 409);
        }

        $shareToken = $this->security->deriveShareToken([
            'jobId' => $job->id,
            'accessToken' => $accessToken,
            'secret' => $this->config->secret,
        ]);

        $base = "/audits/{$job->id}/artifacts";
        $encodedToken = urlencode($shareToken);
        $previewUrl = (($job->telemetry['earlyPreviewReady'] ?? false) === true)
            ? "{$base}/before-screenshot?token={$encodedToken}"
            : null;

        return response()->json([
            'job' => $job->toPublic($this->store->queuePosition($job->id), $previewUrl),
            'result' => $job->result,
            'links' => [
                'reader' => "{$base}/reader?token={$encodedToken}",
                'patched' => "{$base}/patched?token={$encodedToken}",
                'reportPdf' => "{$base}/report.pdf?token={$encodedToken}",
                'screenshot' => "{$base}/screenshot?token={$encodedToken}",
                'beforeScreenshot' => "{$base}/before-screenshot?token={$encodedToken}",
                'reportJson' => "{$base}/report.json?token={$encodedToken}",
                'reportCsv' => "{$base}/report.csv?token={$encodedToken}",
            ],
        ]);
    }

    private function authorizedJob(string $id, ?string $token): ?AuditJob
    {
        $job = $this->store->getJob($id);
        if (!$job || empty($token)) {
            return null;
        }

        $expected = $this->security->digest($token, $this->config->secret);
        return $this->security->safeEqualHex($job->tokenHash, $expected) ? $job : null;
    }
}
