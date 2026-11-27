<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\AuditJob;
use App\Services\BridgeClientInterface;
use App\Services\JobStore;
use App\Services\SecurityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuditCacheController
{
    public function __construct(
        private readonly BridgeClientInterface $bridge,
        private readonly JobStore $store
    ) {}

    public function show(Request $request): JsonResponse
    {
        $rawUrl = $request->query('url');
        $verdict = SecurityService::checkUrl(is_string($rawUrl) ? $rawUrl : null);

        if (!$verdict['ok']) {
            return response()->json([
                'error' => $verdict['code'],
                'message' => $verdict['message'],
            ], 400);
        }

        $now = (int) (microtime(true) * 1000);
        $options = JobStore::normalizeOptions([
            'mode' => $request->query('mode'),
            'maxPages' => $request->query('maxPages'),
        ]);
        $cached = $this->store->findReusable($verdict['url'], $now, $options['mode'], $options['maxPages']);

        return response()->json([
            'available' => $cached !== null,
            'capturedAt' => $cached?->finishedAt ? AuditJob::formatIsoMilliseconds($cached->finishedAt) : null,
            'expiresAt' => $cached ? AuditJob::formatIsoMilliseconds($cached->expiresAt) : null,
        ]);
    }
}
