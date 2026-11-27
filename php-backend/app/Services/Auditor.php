<?php

declare(strict_types=1);

namespace App\Services;

use App\Exceptions\AuditCancelledException;
use App\Models\AuditJob;
use Throwable;

class Auditor implements AuditorInterface
{
    private readonly ReportExporter $reportExporter;

    public function __construct(
        private readonly BridgeClientInterface $bridge,
        private readonly ReportRendererInterface $reportRenderer,
        ?ReportExporter $reportExporter = null,
        private ?int $timeoutSeconds = null
    ) {
        $this->reportExporter = $reportExporter ?? new ReportExporter();
    }

    public function setTimeoutMs(int $timeoutMs): void
    {
        $this->timeoutSeconds = max(1, (int) ceil($timeoutMs / 1000));
    }

    public function audit(AuditJob $job, ?callable $onProgress = null, ?callable $shouldCancel = null): array
    {
        if (!is_dir($job->artifactDir)) {
            mkdir($job->artifactDir, 0777, true);
        }

        $snapshotPath = $job->artifactDir . DIRECTORY_SEPARATOR . 'snapshot.json';
        $reportPath = $job->artifactDir . DIRECTORY_SEPARATOR . 'engine-result.json';
        $snapshot = null;
        $report = null;

        // Checkpoint 1: Jika snapshot & engine-result sudah tersimpan dari eksekusi sebelumnya,
        // lanjutkan langsung tanpa menjalankan ulang proses browser audit yang berat.
        if (file_exists($snapshotPath) && file_exists($reportPath)) {
            try {
                $snapshot = json_decode((string) file_get_contents($snapshotPath), true);
                $report = json_decode((string) file_get_contents($reportPath), true);
                if (is_array($snapshot) && is_array($report)) {
                    if ($onProgress !== null) {
                        $onProgress([
                            'progress' => 95,
                            'stage' => 'Memulihkan hasil audit dari checkpoint tersimpan',
                        ]);
                    }
                } else {
                    $snapshot = null;
                    $report = null;
                }
            } catch (Throwable) {
                $snapshot = null;
                $report = null;
            }
        }

        if ($snapshot === null || $report === null) {
            $effectiveTimeoutSeconds = $this->timeoutSeconds;
            if ($job->mode === 'multi') {
                $effectiveTimeoutSeconds = $effectiveTimeoutSeconds !== null
                    ? max($effectiveTimeoutSeconds, 240)
                    : 240;
            }

            $outcome = $this->bridge->audit(
                id: $job->id,
                url: $job->targetUrl,
                artifactDir: $job->artifactDir,
                onProgress: $onProgress,
                shouldCancel: $shouldCancel,
                timeoutSeconds: $effectiveTimeoutSeconds,
                options: [
                    'mode' => $job->mode,
                    'maxPages' => $job->maxPages,
                ]
            );

            $snapshot = $outcome['snapshot'] ?? null;
            if (file_exists($reportPath)) {
                try {
                    $report = json_decode((string) file_get_contents($reportPath), true);
                } catch (Throwable) {
                    $report = null;
                }
            }
        }

        if ($shouldCancel !== null && $shouldCancel()) {
            throw new AuditCancelledException('Audit dibatalkan.');
        }

        if ($onProgress !== null) {
            $onProgress([
                'progress' => 96,
                'stage' => 'Menyiapkan laporan hasil',
            ]);
        }

        $pdfPath = $job->artifactDir . DIRECTORY_SEPARATOR . 'report.pdf';
        $reportHtmlPath = $job->artifactDir . DIRECTORY_SEPARATOR . 'report.html';
        $reportJsonPath = $job->artifactDir . DIRECTORY_SEPARATOR . 'report.json';
        $reportCsvPath = $job->artifactDir . DIRECTORY_SEPARATOR . 'report.csv';

        if (!file_exists($reportHtmlPath) && is_array($report)) {
            $reportHtml = $this->reportRenderer->render($snapshot ?? [], $report);
            file_put_contents($reportHtmlPath, $reportHtml);
        }

        if (is_array($snapshot) || is_array($report)) {
            $this->reportExporter->write($snapshot ?? [], $report ?? [], $reportJsonPath, $reportCsvPath);
        }

        if (!file_exists($pdfPath) && file_exists($reportHtmlPath)) {
            try {
                $this->bridge->renderPdf($reportHtmlPath, $pdfPath, $shouldCancel);
            } catch (Throwable $pdfError) {
                error_log('Pembuatan PDF dilewati/fallback karena resource rendah: ' . $pdfError->getMessage());
            }
        }

        if ($onProgress !== null) {
            $onProgress([
                'progress' => 99,
                'stage' => 'Memfinalisasi hasil',
            ]);
        }

        return [
            'snapshot' => $snapshot,
            'artifacts' => [
                'reader' => 'reader.html',
                'patched' => 'patched.html',
                'reportPdf' => file_exists($pdfPath) ? 'report.pdf' : (file_exists($reportHtmlPath) ? 'report.html' : null),
                'screenshot' => 'after.png',
                'beforeScreenshot' => file_exists($job->artifactDir . DIRECTORY_SEPARATOR . 'before.png') ? 'before.png' : null,
                'reportJson' => file_exists($reportJsonPath) ? 'report.json' : null,
                'reportCsv' => file_exists($reportCsvPath) ? 'report.csv' : null,
            ],
        ];
    }
}
