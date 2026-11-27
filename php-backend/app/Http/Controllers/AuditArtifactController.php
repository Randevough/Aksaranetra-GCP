<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\AksaraConfig;
use App\Services\JobStore;
use App\Services\SecurityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class AuditArtifactController
{
    private const ARTIFACTS = [
        'reader' => ['file' => 'reader.html', 'type' => 'text/html; charset=utf-8'],
        'patched' => ['file' => 'patched.html', 'type' => 'text/html; charset=utf-8'],
        'report.pdf' => ['file' => 'report.pdf', 'type' => 'application/pdf'],
        'screenshot' => ['file' => 'after.png', 'type' => 'image/png'],
        'before-screenshot' => ['file' => 'before.png', 'type' => 'image/png'],
        'report.json' => ['file' => 'report.json', 'type' => 'application/json; charset=utf-8'],
        'report.csv' => ['file' => 'report.csv', 'type' => 'text/csv; charset=utf-8'],
    ];

    public function __construct(
        private readonly AksaraConfig $config,
        private readonly SecurityService $security,
        private readonly JobStore $store,
        private readonly ?\App\Services\GcsArtifacts $gcs = null
    ) {}

    public function show(Request $request, string $id, string $artifact): JsonResponse|\Symfony\Component\HttpFoundation\Response
    {
        $job = $this->store->getJob($id);
        if (!$job) {
            return $this->notFoundResponse();
        }

        $suppliedToken = (string) $request->query('token', '');
        $expected = $this->security->digest($suppliedToken, $this->config->secret);

        if ($suppliedToken === '' || !$this->security->safeEqualHex($job->shareTokenHash, $expected)) {
            return $this->notFoundResponse('Artefak tidak ditemukan.');
        }

        return $this->serveArtifact($job, $artifact);
    }

    public function export(Request $request, string $id, string $format): JsonResponse|\Symfony\Component\HttpFoundation\Response
    {
        $artifact = match ($format) {
            'json' => 'report.json',
            'csv' => 'report.csv',
            default => '',
        };
        if ($artifact === '') {
            return $this->notFoundResponse('Artefak tidak ditemukan.');
        }

        $job = $this->store->getJob($id);
        if (!$job) {
            return $this->notFoundResponse();
        }

        $accessToken = $this->security->bearerToken($request);
        $shareToken = (string) $request->query('token', '');

        $validAccess = $accessToken !== '' && $this->security->safeEqualHex(
            $job->tokenHash,
            $this->security->digest($accessToken, $this->config->secret)
        );
        $validShare = $shareToken !== '' && $this->security->safeEqualHex(
            $job->shareTokenHash,
            $this->security->digest($shareToken, $this->config->secret)
        );

        if (!$validAccess && !$validShare) {
            return $this->notFoundResponse('Artefak tidak ditemukan.');
        }

        return $this->serveArtifact($job, $artifact);
    }

    private function serveArtifact(\App\Models\AuditJob $job, string $artifact): JsonResponse|\Symfony\Component\HttpFoundation\Response
    {
        $allowedStatuses = $artifact === 'before-screenshot' ? ['running', 'completed'] : ['completed'];
        $now = (int) (microtime(true) * 1000);
        if (!in_array($job->status, $allowedStatuses, true) || $job->expiresAt <= $now) {
            return response()->json([
                'error' => 'expired',
                'message' => 'Artefak sudah kedaluwarsa.',
            ], 410);
        }

        $definition = self::ARTIFACTS[$artifact] ?? null;
        if (!$definition) {
            return $this->notFoundResponse('Artefak tidak ditemukan.');
        }

        $headers = [
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => $this->buildCsp($artifact),
        ];

        if ($this->config->artifactStore === 'gcs' && $this->gcs !== null) {
            $manifest = $job->result['manifest'] ?? null;
            $targetFile = $definition['file'];
            $targetType = $definition['type'];

            if (is_array($manifest)) {
                if (!isset($manifest[$targetFile]) && $artifact === 'report.pdf' && isset($manifest['report.html'])) {
                    $targetFile = 'report.html';
                    $targetType = 'text/html; charset=utf-8';
                }

                if (isset($manifest[$targetFile])) {
                    try {
                        $content = $this->gcs->read($manifest, $targetFile);
                        $response = response($content, 200, array_merge($headers, [
                            'Content-Type' => $targetType,
                        ]));
                        $response->setPrivate();
                        $response->setMaxAge(300);

                        return $response;
                    } catch (\Throwable) {
                        return $this->notFoundResponse('Artefak tidak ditemukan.');
                    }
                }
            }

            if ($artifact === 'before-screenshot') {
                try {
                    $attemptKey = 'attempt-' . $job->attempts . '-' . ($job->leaseToken ?? '1');
                    $content = $this->gcs->readEarlyPreview($job->id, $attemptKey);
                    $response = response($content, 200, array_merge($headers, [
                        'Content-Type' => $targetType,
                    ]));
                    $response->setPrivate();
                    $response->setMaxAge(300);

                    return $response;
                } catch (\Throwable) {
                    // Fall through to local artifactDir check if early preview isn't in GCS
                }
            }
        }

        $targetType = $definition['type'];
        $filePath = $job->artifactDir . DIRECTORY_SEPARATOR . $definition['file'];
        if (!file_exists($filePath) && $artifact === 'report.pdf') {
            $fallbackPath = $job->artifactDir . DIRECTORY_SEPARATOR . 'report.html';
            if (file_exists($fallbackPath)) {
                $filePath = $fallbackPath;
                $targetType = 'text/html; charset=utf-8';
            }
        }

        if (!file_exists($filePath)) {
            return $this->notFoundResponse('Artefak tidak ditemukan.');
        }

        $realJobDir = realpath($job->artifactDir);
        $realFilePath = realpath($filePath);
        if (!$realFilePath || !$realJobDir || !str_starts_with($realFilePath, $realJobDir)) {
            return $this->notFoundResponse('Artefak tidak ditemukan.');
        }

        $response = response()->file($realFilePath, array_merge($headers, [
            'Content-Type' => $targetType,
        ]));
        $response->setPrivate();
        $response->setMaxAge(300);

        return $response;
    }

    private function buildCsp(string $artifact): string
    {
        $frameAncestors = $this->frameAncestorsDirective();

        if ($artifact === 'patched') {
            return "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; base-uri 'none'; form-action 'none'; frame-ancestors {$frameAncestors}";
        }

        return "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors {$frameAncestors}";
    }

    private function frameAncestorsDirective(): string
    {
        $sources = ["'self'"];

        foreach ($this->config->frontendOrigins as $origin) {
            if (!is_string($origin)) {
                continue;
            }
            $trimmed = trim($origin);
            if ($trimmed === '' || preg_match('/[\s;"\'*]/', $trimmed)) {
                continue;
            }
            $parts = parse_url($trimmed);
            if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
                continue;
            }
            $scheme = strtolower($parts['scheme']);
            if ($scheme !== 'http' && $scheme !== 'https') {
                continue;
            }
            if (isset($parts['path']) && $parts['path'] !== '' && $parts['path'] !== '/') {
                continue;
            }
            if (isset($parts['query']) || isset($parts['fragment']) || isset($parts['user']) || isset($parts['pass'])) {
                continue;
            }

            $normalized = $scheme . '://' . strtolower($parts['host']);
            if (isset($parts['port'])) {
                $normalized .= ':' . (int) $parts['port'];
            }

            if (!in_array($normalized, $sources, true)) {
                $sources[] = $normalized;
            }
        }

        return implode(' ', $sources);
    }

    private function notFoundResponse(string $message = 'Audit tidak ditemukan.'): JsonResponse
    {
        return response()->json([
            'error' => 'not-found',
            'message' => $message,
        ], 404);
    }
}
