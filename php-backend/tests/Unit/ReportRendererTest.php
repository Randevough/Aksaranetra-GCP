<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\ReportRenderer;
use PHPUnit\Framework\TestCase;

class ReportRendererTest extends TestCase
{
    public function test_esc_escapes_only_html_special_chars_matching_node(): void
    {
        // Ampersand, less-than, greater-than, double-quote
        $this->assertSame(
            '&amp;&lt;&gt;&quot;',
            ReportRenderer::esc('&<>"')
        );

        // Single quote is NOT escaped in Node report.mjs
        $this->assertSame(
            "It's 'AksaraNetra'",
            ReportRenderer::esc("It's 'AksaraNetra'")
        );

        // Mixed content (single quote remains unescaped)
        $this->assertSame(
            'Nilai &quot;aria-expanded&quot; &amp; \'test\' &lt;invalid&gt;',
            ReportRenderer::esc('Nilai "aria-expanded" & \'test\' <invalid>')
        );

        // Null and empty string become empty string
        $this->assertSame('', ReportRenderer::esc(null));
        $this->assertSame('', ReportRenderer::esc(''));

        // Booleans
        $this->assertSame('true', ReportRenderer::esc(true));
        $this->assertSame('false', ReportRenderer::esc(false));

        // Numbers including zero
        $this->assertSame('0', ReportRenderer::esc(0));
        $this->assertSame('100', ReportRenderer::esc(100));
        $this->assertSame('0.95', ReportRenderer::esc(0.95));
    }

    public function test_rows_renders_empty_notice_when_empty(): void
    {
        $this->assertSame('<p>Tidak ada.</p>', ReportRenderer::rows([]));
        $this->assertSame('<p>Tidak ada.</p>', ReportRenderer::rows(null));
    }

    public function test_rows_renders_table_with_escaped_cells(): void
    {
        $records = [
            [
                'rule' => 'link-name',
                'selector' => 'a[href*="&"]',
                'status' => 'verified-fixed',
                'confidence' => 0.9,
            ],
            [
                'rule' => 'image-alt',
                'selector' => '<img class="logo">',
                'status' => 'needs-review',
                'confidence' => 1,
            ],
        ];

        $expected = '<table><thead><tr><th>Rule</th><th>Elemen</th><th>Status</th><th>Confidence</th></tr></thead><tbody>' .
            '<tr><td>link-name</td><td><code>a[href*=&quot;&amp;&quot;]</code></td><td>verified-fixed</td><td>0.9</td></tr>' .
            '<tr><td>image-alt</td><td><code>&lt;img class=&quot;logo&quot;&gt;</code></td><td>needs-review</td><td>1</td></tr>' .
            '</tbody></table>';

        $this->assertSame($expected, ReportRenderer::rows($records));
    }

    public function test_stringify_regression_matches_node_two_space_json(): void
    {
        $regression = [
            [
                'ruleId' => 'color-contrast',
                'before' => 0,
                'after' => 2,
                'delta' => 2,
                'tags' => ['wcag2aa', 'wcag143'],
            ],
        ];

        $expected = "[\n  {\n    \"ruleId\": \"color-contrast\",\n    \"before\": 0,\n    \"after\": 2,\n    \"delta\": 2,\n    \"tags\": [\n      \"wcag2aa\",\n      \"wcag143\"\n    ]\n  }\n]";
        $this->assertSame($expected, ReportRenderer::stringifyRegression($regression));
    }

    public function test_byte_identical_parity_against_all_node_fixtures(): void
    {
        $fixturesDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'Fixtures' . DIRECTORY_SEPARATOR . 'reports';
        $this->assertDirectoryExists($fixturesDir);

        $renderer = new ReportRenderer();

        for ($i = 1; $i <= 5; $i++) {
            $inputFile = $fixturesDir . DIRECTORY_SEPARATOR . "fixture_{$i}_input.json";
            $expectedFile = $fixturesDir . DIRECTORY_SEPARATOR . "fixture_{$i}_expected.html";

            $this->assertFileExists($inputFile, "Fixture input {$i} should exist");
            $this->assertFileExists($expectedFile, "Fixture expected {$i} should exist");

            $inputData = json_decode((string) file_get_contents($inputFile), true);
            $expectedHtml = (string) file_get_contents($expectedFile);

            $snapshot = $inputData['snapshot'] ?? [];
            $report = $inputData['report'] ?? [];

            // Test both instance render() and static renderAuditReport()
            $actualHtmlFromRender = $renderer->render($snapshot, $report);
            $actualHtmlFromStatic = ReportRenderer::renderAuditReport($inputData);

            $this->assertSame($actualHtmlFromRender, $actualHtmlFromStatic);

            $expectedNormalized = str_replace("\r\n", "\n", $expectedHtml);
            $actualNormalized = str_replace("\r\n", "\n", $actualHtmlFromRender);

            $this->assertSame(
                strlen($expectedNormalized),
                strlen($actualNormalized),
                "Fixture {$i} HTML length must match byte-for-byte"
            );

            $this->assertSame(
                md5($expectedNormalized),
                md5($actualNormalized),
                "Fixture {$i} MD5 hash must match byte-for-byte"
            );

            $this->assertSame(
                $expectedNormalized,
                $actualNormalized,
                "Fixture {$i} string content must match byte-for-byte"
            );
        }
    }

    public function test_renders_score_severity_and_verified_indonesian_regulations_without_revoked_law(): void
    {
        $renderer = new ReportRenderer();
        $html = $renderer->render([
            'engineVersion' => '0.4.0',
            'capturedAt' => '2026-11-27T00:00:00.000Z',
            'disclaimer' => 'Catatan pengujian.',
            'source' => ['title' => 'Portal Layanan Publik', 'finalUrl' => 'https://example.go.id/'],
            'summary' => ['beforeTotal' => 5, 'afterTotal' => 1, 'reductionPercent' => 80],
            'counts' => ['fixed' => 4],
            'warnings' => ['wcagRegressionClean' => true, 'worsenedRules' => []],
            'score' => [
                'overall' => 88,
                'beforeScore' => 62,
                'afterScore' => 88,
                'grade' => 'B',
                'automatedCoverageNote' => 'Audit otomatis mencakup sebagian kriteria WCAG 2.1 AA.',
                'pour' => ['perceivable' => 90, 'operable' => 85, 'understandable' => 88, 'robust' => 89],
            ],
            'severity' => [
                'before' => ['critical' => 1, 'serious' => 2, 'moderate' => 1, 'minor' => 1, 'total' => 5],
                'after' => ['critical' => 0, 'serious' => 1, 'moderate' => 0, 'minor' => 0, 'total' => 1],
            ],
            'regulations' => [
                ['code' => 'UU-8-2016', 'title' => 'UU No. 8 Tahun 2016', 'article' => 'Pasal 19, 24, 105', 'matchedIssues' => 3],
                ['code' => 'PP-42-2020', 'title' => 'PP No. 42 Tahun 2020', 'article' => 'Pasal 17-18', 'matchedIssues' => 2],
                ['code' => 'PERMENPANRB-11-2024', 'title' => 'PermenPANRB No. 11 Tahun 2024', 'article' => 'Layanan Digital', 'matchedIssues' => 2],
                ['code' => 'SPBE-2018', 'title' => 'Perpres No. 95 Tahun 2018 (SPBE)', 'article' => 'SPBE', 'matchedIssues' => 1],
                ['code' => 'UU-KIP-2008', 'title' => 'UU No. 14 Tahun 2008 (KIP) & PerKI No. 1 Tahun 2021', 'article' => 'PPID', 'matchedIssues' => 1],
                ['code' => 'SNI-ISO-40500', 'title' => 'SNI ISO/IEC 40500', 'article' => 'WCAG', 'matchedIssues' => 5],
            ],
        ], ['fixed' => [], 'review' => [], 'rolledBackRecords' => []]);

        $this->assertStringContainsString('Skor Kepatuhan', $html);
        $this->assertStringContainsString('Grade B', $html);
        $this->assertStringContainsString('Rincian Tingkat Keparahan', $html);
        $this->assertStringContainsString('Acuan Regulasi Indonesia', $html);
        $this->assertStringContainsString('UU-8-2016', $html);
        $this->assertStringContainsString('PERMENPANRB-11-2024', $html);
        $this->assertStringNotContainsString('Permen Kominfo', $html);
        $this->assertStringNotContainsString('Permenkominfo', $html);
        $this->assertStringNotContainsString('8/2021', $html);
    }
}
