<?php

declare(strict_types=1);

namespace App\Services;

class ReportExporter
{
    public const CSV_HEADERS = [
        'Issue_ID',
        'Rule_ID',
        'Severity',
        'Status',
        'POUR',
        'WCAG_SC',
        'Regulasi_Indonesia',
        'Selector',
        'Judul_Masalah',
        'Saran_Perbaikan',
        'Engines',
    ];

    /**
     * Build structured JSON payload from snapshot and engine report.
     */
    public function buildJsonData(array $snapshot, array $report): array
    {
        return [
            'generatedAt' => gmdate('Y-m-d\TH:i:s.000\Z'),
            'id' => $snapshot['id'] ?? null,
            'engineVersion' => $snapshot['engineVersion'] ?? null,
            'capturedAt' => $snapshot['capturedAt'] ?? null,
            'source' => $snapshot['source'] ?? null,
            'summary' => $snapshot['summary'] ?? null,
            'score' => $snapshot['score'] ?? null,
            'severity' => $snapshot['severity'] ?? null,
            'regulations' => $snapshot['regulations'] ?? [],
            'enginesUsed' => $snapshot['enginesUsed'] ?? [],
            'mobileAudit' => $snapshot['mobileAudit'] ?? null,
            'pdfAudit' => $snapshot['pdfAudit'] ?? null,
            'detectors' => $snapshot['detectors'] ?? null,
            'multiPage' => $snapshot['multiPage'] ?? null,
            'clusters' => $snapshot['clusters'] ?? [],
            'issues' => $snapshot['issues'] ?? [],
            'tabStops' => $snapshot['tabStops'] ?? [],
            'readiness' => $snapshot['readiness'] ?? null,
            'counts' => $snapshot['counts'] ?? null,
            'warnings' => $snapshot['warnings'] ?? null,
            'report' => [
                'fixed' => $report['fixed'] ?? [],
                'review' => $report['review'] ?? [],
                'rolledBackRecords' => $report['rolledBackRecords'] ?? [],
            ],
        ];
    }

    /**
     * Build UTF-8 BOM + RFC 4180 CSV string from snapshot issues (or fallback report records).
     */
    public function buildCsv(array $snapshot, array $report): string
    {
        $lines = [$this->formatCsvRow(self::CSV_HEADERS)];

        if (isset($snapshot['issues']) && is_array($snapshot['issues'])) {
            foreach ($snapshot['issues'] as $issue) {
                if (!is_array($issue)) {
                    continue;
                }
                $lines[] = $this->formatCsvRow([
                    (string) ($issue['id'] ?? ''),
                    (string) ($issue['ruleId'] ?? ''),
                    (string) ($issue['impact'] ?? ''),
                    (string) ($issue['status'] ?? ''),
                    (string) ($issue['pour'] ?? ''),
                    implode('; ', array_map('strval', (array) ($issue['wcagSc'] ?? []))),
                    implode('; ', array_map('strval', (array) ($issue['regulations'] ?? []))),
                    (string) ($issue['selector'] ?? ''),
                    (string) ($issue['titleId'] ?? ''),
                    (string) ($issue['helpId'] ?? ''),
                    implode('; ', array_map('strval', (array) ($issue['engines'] ?? []))),
                ]);
            }
        } else {
            $fallbackGroups = [
                'fixed' => $report['fixed'] ?? [],
                'review' => $report['review'] ?? [],
                'rolled-back' => $report['rolledBackRecords'] ?? [],
            ];
            $idx = 1;
            foreach ($fallbackGroups as $status => $records) {
                if (!is_array($records)) {
                    continue;
                }
                foreach ($records as $record) {
                    if (!is_array($record)) {
                        continue;
                    }
                    $lines[] = $this->formatCsvRow([
                        'legacy-' . $idx++,
                        (string) ($record['rule'] ?? ''),
                        '',
                        (string) ($record['status'] ?? $status),
                        '',
                        '',
                        '',
                        (string) ($record['selector'] ?? ''),
                        (string) ($record['rule'] ?? ''),
                        '',
                        '',
                    ]);
                }
            }
        }

        return "\xEF\xBB\xBF" . implode("\r\n", $lines) . "\r\n";
    }

    /**
     * Write report.json and report.csv to disk.
     */
    public function write(array $snapshot, array $report, string $jsonPath, string $csvPath): void
    {
        $json = json_encode(
            $this->buildJsonData($snapshot, $report),
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        );
        if ($json !== false) {
            file_put_contents($jsonPath, $json . "\n");
        }

        file_put_contents($csvPath, $this->buildCsv($snapshot, $report));
    }

    /**
     * @param list<string> $fields
     */
    private function formatCsvRow(array $fields): string
    {
        $escaped = array_map(static function (string $value): string {
            $normalized = str_replace(["\r\n", "\r"], "\n", $value);
            if (strpbrk($normalized, ",\"\n") !== false) {
                return '"' . str_replace('"', '""', $normalized) . '"';
            }

            return $normalized;
        }, $fields);

        return implode(',', $escaped);
    }
}
