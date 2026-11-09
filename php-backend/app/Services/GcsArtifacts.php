<?php

declare(strict_types=1);

namespace App\Services;

use GuzzleHttp\ClientInterface;
use RuntimeException;

class GcsArtifacts
{
    private const BASE_URI = 'https://storage.googleapis.com';

    public function __construct(
        public readonly string $bucket,
        public readonly string $project,
        private readonly ClientInterface $http,
        private readonly mixed $tokenProvider = null,
        public readonly int $timeoutSeconds = 20
    ) {}

    private function getBearerToken(): string
    {
        $token = is_callable($this->tokenProvider) ? ($this->tokenProvider)() : null;
        if (!is_string($token) || !preg_match('/\A[A-Za-z0-9._~+\/-]+=*\z/D', $token)) {
            throw new RuntimeException('GCS access token unavailable');
        }

        return $token;
    }

    /**
     * @return array<string, array{path: string, contentType: string, size: int}>
     */
    public function publish(string $jobId, string $attemptId, string $localDir, callable $heartbeat): array
    {
        if (!$heartbeat()) {
            throw new RuntimeException('Artifact lease lost');
        }

        $manifest = [];
        $files = scandir($localDir) ?: [];
        foreach ($files as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            $fullPath = $localDir . DIRECTORY_SEPARATOR . $name;
            if (!is_file($fullPath)) {
                continue;
            }

            if (!$heartbeat()) {
                throw new RuntimeException('Artifact lease lost');
            }

            $storagePath = sprintf('jobs/%s/%s/%s', $jobId, $attemptId, $name);
            $mime = match (pathinfo($name, PATHINFO_EXTENSION)) {
                'html' => 'text/html; charset=utf-8',
                'pdf' => 'application/pdf',
                'png' => 'image/png',
                'json' => 'application/json',
                default => 'application/octet-stream',
            };

            $url = sprintf(
                '%s/upload/storage/v1/b/%s/o?uploadType=media&name=%s&ifGenerationMatch=0',
                self::BASE_URI,
                rawurlencode($this->bucket),
                rawurlencode($storagePath)
            );

            $this->http->request('POST', $url, [
                'headers' => [
                    'Authorization' => 'Bearer ' . $this->getBearerToken(),
                    'Content-Type' => $mime,
                ],
                'body' => (string) file_get_contents($fullPath),
                'timeout' => $this->timeoutSeconds,
            ]);

            $manifest[$name] = [
                'path' => $storagePath,
                'contentType' => $mime,
                'size' => (int) filesize($fullPath),
            ];
        }

        if (!$heartbeat()) {
            throw new RuntimeException('Artifact lease lost');
        }

        return $manifest;
    }

    /**
     * @param array<string, array{path: string, contentType: string, size: int}> $manifest
     */
    public function read(array $manifest, string $name): string
    {
        if (!isset($manifest[$name])) {
            throw new RuntimeException('Artifact missing in manifest: ' . $name);
        }

        $storagePath = $manifest[$name]['path'];
        $url = sprintf(
            '%s/storage/v1/b/%s/o/%s?alt=media',
            self::BASE_URI,
            rawurlencode($this->bucket),
            rawurlencode($storagePath)
        );

        $res = $this->http->request('GET', $url, [
            'headers' => [
                'Authorization' => 'Bearer ' . $this->getBearerToken(),
            ],
            'timeout' => $this->timeoutSeconds,
        ]);

        return (string) $res->getBody();
    }
}
