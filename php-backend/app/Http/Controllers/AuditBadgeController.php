<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\JobStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class AuditBadgeController
{
    private const LEFT_LABEL = 'AksaraNetra (Skor Otomatis)';
    private const HOSTNAME_PATTERN = '/^[a-z0-9.-]+$/';

    public function __construct(
        private readonly JobStore $store
    ) {}

    public function show(string $domain): Response|JsonResponse
    {
        $normalized = strtolower(trim(rtrim($domain, '.')));
        if (
            $normalized === ''
            || strlen($normalized) > 253
            || preg_match(self::HOSTNAME_PATTERN, $normalized) !== 1
            || str_contains($normalized, '..')
            || str_starts_with($normalized, '.')
            || str_starts_with($normalized, '-')
            || str_ends_with($normalized, '-')
        ) {
            return response()->json([
                'error' => 'invalid-domain',
                'message' => 'Nama domain tidak valid.',
            ], 400, [
                'Cache-Control' => 'no-store',
                'X-Content-Type-Options' => 'nosniff',
            ]);
        }

        $job = $this->store->findLatestCompletedByHost($normalized);
        [$rightLabel, $rightColor] = $this->resolveBadgeState($job?->result['snapshot']['score'] ?? null);

        $svg = $this->renderSvg(self::LEFT_LABEL, $rightLabel, $rightColor, $normalized);

        $response = response($svg, 200, [
            'Content-Type' => 'image/svg+xml; charset=utf-8',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; style-src 'unsafe-inline'",
        ]);
        $response->setPublic();
        $response->setMaxAge(300);

        return $response;
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function resolveBadgeState(mixed $score): array
    {
        if (!is_array($score)) {
            return ['Belum Diaudit', '#475569'];
        }

        $rawScore = $score['afterScore'] ?? $score['overall'] ?? null;
        if (!is_numeric($rawScore)) {
            return ['Belum Diaudit', '#475569'];
        }

        $afterScore = max(0, min(100, (int) round((float) $rawScore)));
        $grade = strtoupper(trim((string) ($score['grade'] ?? '')));
        if ($grade === '') {
            $grade = match (true) {
                $afterScore >= 90 => 'A',
                $afterScore >= 75 => 'B',
                $afterScore >= 60 => 'C',
                $afterScore >= 40 => 'D',
                default => 'F',
            };
        }

        $color = match ($grade) {
            'A', 'B' => '#0f766e',
            'C' => '#b45309',
            default => '#be123c',
        };

        return ["{$afterScore}/100 · {$grade}", $color];
    }

    private function renderSvg(string $leftText, string $rightText, string $rightColor, string $domain): string
    {
        $leftWidth = (int) max(180, round(mb_strlen($leftText, 'UTF-8') * 6.6) + 18);
        $rightWidth = (int) max(96, round(mb_strlen($rightText, 'UTF-8') * 6.8) + 20);
        $totalWidth = $leftWidth + $rightWidth;

        $leftCenter = round($leftWidth / 2, 1);
        $rightCenter = round($leftWidth + ($rightWidth / 2), 1);

        $escLeft = self::escXml($leftText);
        $escRight = self::escXml($rightText);
        $escColor = self::escXml($rightColor);
        $escAria = self::escXml("{$domain}: {$leftText} - {$rightText}");

        return <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="{$totalWidth}" height="20" role="img" aria-label="{$escAria}">
  <title>{$escAria}</title>
  <linearGradient id="aksara-badge-grad" x2="0" y2="100%">
    <stop offset="0" stop-color="#ffffff" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="aksara-badge-clip">
    <rect width="{$totalWidth}" height="20" rx="3" fill="#ffffff"/>
  </clipPath>
  <g clip-path="url(#aksara-badge-clip)">
    <rect width="{$leftWidth}" height="20" fill="#1e293b"/>
    <rect x="{$leftWidth}" width="{$rightWidth}" height="20" fill="{$escColor}"/>
    <rect width="{$totalWidth}" height="20" fill="url(#aksara-badge-grad)"/>
  </g>
  <g fill="#ffffff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="{$leftCenter}" y="15" fill="#010101" fill-opacity=".3">{$escLeft}</text>
    <text x="{$leftCenter}" y="14" fill="#ffffff">{$escLeft}</text>
    <text x="{$rightCenter}" y="15" fill="#010101" fill-opacity=".3">{$escRight}</text>
    <text x="{$rightCenter}" y="14" fill="#ffffff">{$escRight}</text>
  </g>
</svg>
SVG;
    }

    private static function escXml(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
