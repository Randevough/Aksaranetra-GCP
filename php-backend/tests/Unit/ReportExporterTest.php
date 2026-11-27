<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\ReportExporter;
use PHPUnit\Framework\TestCase;

class ReportExporterTest extends TestCase
{
    public function test_builds_utf8_bom_rfc4180_csv_with_exact_headers_and_escaping(): void
    {
        $exporter = new ReportExporter();
        $snapshot = [
            'id' => 'aud_export_1',
            'engineVersion' => '0.4.0',
            'issues' => [
                [
                    'id' => 'iss-1',
                    'ruleId' => 'color-contrast',
                    'impact' => 'serious',
                    'status' => 'open',
                    'pour' => 'perceivable',
                    'wcagSc' => ['1.4.3'],
                    'regulations' => ['UU-8-2016', 'PP-42-2020'],
                    'selector' => 'button[aria-label="Kirim, Sekarang"]',
                    'titleId' => "Kontras tombol \"Kirim\" rendah\nPerlu perbaikan",
                    'helpId' => 'Naikkan rasio kontras minimal 4.5:1',
                ],
            ],
        ];

        $csv = $exporter->buildCsv($snapshot, []);

        $this->assertStringStartsWith("\xEF\xBB\xBF", $csv);
        $this->assertStringContainsString("\r\n", $csv);

        $body = substr($csv, 3);
        $lines = explode("\r\n", rtrim($body, "\r\n"));
        $this->assertSame(
            'Issue_ID,Rule_ID,Severity,Status,POUR,WCAG_SC,Regulasi_Indonesia,Selector,Judul_Masalah,Saran_Perbaikan',
            $lines[0]
        );
        $this->assertStringContainsString('"button[aria-label=""Kirim, Sekarang""]"', $body);
        $this->assertStringContainsString("\"Kontras tombol \"\"Kirim\"\" rendah\nPerlu perbaikan\"", $body);
        $this->assertStringContainsString('UU-8-2016; PP-42-2020', $body);
    }

    public function test_write_creates_json_and_csv_files_with_legacy_fallback(): void
    {
        $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'aksara-exporter-' . uniqid();
        mkdir($dir, 0777, true);
        $jsonPath = $dir . DIRECTORY_SEPARATOR . 'report.json';
        $csvPath = $dir . DIRECTORY_SEPARATOR . 'report.csv';

        try {
            $exporter = new ReportExporter();
            $exporter->write(
                ['id' => 'aud_legacy', 'summary' => ['beforeTotal' => 1, 'afterTotal' => 0]],
                [
                    'fixed' => [['rule' => 'image-alt', 'selector' => 'img.hero', 'status' => 'verified-fixed']],
                    'review' => [],
                    'rolledBackRecords' => [],
                ],
                $jsonPath,
                $csvPath
            );

            $this->assertFileExists($jsonPath);
            $this->assertFileExists($csvPath);

            $decoded = json_decode((string) file_get_contents($jsonPath), true);
            $this->assertSame('aud_legacy', $decoded['id']);
            $this->assertCount(1, $decoded['report']['fixed']);

            $csv = (string) file_get_contents($csvPath);
            $this->assertStringStartsWith("\xEF\xBB\xBF", $csv);
            $this->assertStringContainsString('legacy-1,image-alt,,verified-fixed', $csv);
        } finally {
            @unlink($jsonPath);
            @unlink($csvPath);
            @rmdir($dir);
        }
    }
}
