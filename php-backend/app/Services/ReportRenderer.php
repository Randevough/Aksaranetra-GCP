<?php

declare(strict_types=1);

namespace App\Services;

class ReportRenderer implements ReportRendererInterface
{
    /**
     * Escape special HTML characters matching Node.js esc() helper in report.mjs:
     * String(value ?? "")
     *   .replace(/&/g, "&amp;")
     *   .replace(/</g, "&lt;")
     *   .replace(/>/g, "&gt;")
     *   .replace(/"/g, "&quot;")
     */
    public static function esc(mixed $value): string
    {
        if (is_bool($value)) {
            $str = $value ? 'true' : 'false';
        } elseif ($value === null) {
            $str = '';
        } else {
            $str = (string) $value;
        }

        $str = str_replace('&', '&amp;', $str);
        $str = str_replace('<', '&lt;', $str);
        $str = str_replace('>', '&gt;', $str);

        return str_replace('"', '&quot;', $str);
    }

    /**
     * Render table rows matching rows() helper in report.mjs:
     * if (!records.length) return "<p>Tidak ada.</p>";
     * return `<table><thead><tr><th>Rule</th><th>Elemen</th><th>Status</th><th>Confidence</th></tr></thead><tbody>...</tbody></table>`;
     */
    public static function rows(mixed $records = []): string
    {
        if (!is_array($records) || count($records) === 0) {
            return '<p>Tidak ada.</p>';
        }

        $itemsHtml = '';
        foreach ($records as $item) {
            $rule = self::esc($item['rule'] ?? null);
            $selector = self::esc($item['selector'] ?? null);
            $status = self::esc($item['status'] ?? null);
            $confidence = self::esc($item['confidence'] ?? null);
            $itemsHtml .= "<tr><td>{$rule}</td><td><code>{$selector}</code></td><td>{$status}</td><td>{$confidence}</td></tr>";
        }

        return "<table><thead><tr><th>Rule</th><th>Elemen</th><th>Status</th><th>Confidence</th></tr></thead><tbody>{$itemsHtml}</tbody></table>";
    }

    /**
     * Format regression list as 2-space indented JSON matching JSON.stringify(regression, null, 2).
     */
    public static function stringifyRegression(array $regression): string
    {
        $json = json_encode($regression, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            return '[]';
        }

        // Convert 4-space indentation to 2-space indentation per nesting level
        return preg_replace_callback('/^( +)/m', function ($matches) {
            return str_repeat(' ', (int) (strlen($matches[1]) / 2));
        }, $json) ?? $json;
    }

    /**
     * Render the standalone audit HTML report byte-identically to backend/src/report.mjs:renderAuditReport.
     */
    public function render(array $snapshot, array $report): string
    {
        return self::renderAuditReport([
            'snapshot' => $snapshot,
            'report' => $report,
        ]);
    }

    /**
     * Static entrypoint accepting ['snapshot' => ..., 'report' => ...] matching Node API signature.
     */
    public static function renderAuditReport(array $args): string
    {
        $snapshot = $args['snapshot'] ?? [];
        $report = $args['report'] ?? [];

        $summary = $snapshot['summary'] ?? [];
        $rawTitle = $snapshot['source']['title'] ?? null;
        $title = ($rawTitle !== null && $rawTitle !== '') ? (string) $rawTitle : 'Laporan audit AksaraNetra';
        $regression = $snapshot['warnings']['worsenedRules'] ?? [];
        if (!is_array($regression)) {
            $regression = [];
        }

        $escTitle = self::esc($title);
        $escEngineVersion = self::esc($snapshot['engineVersion'] ?? null);
        $escDisclaimer = self::esc($snapshot['disclaimer'] ?? null);
        $escFinalUrl = self::esc($snapshot['source']['finalUrl'] ?? null);
        $escCapturedAt = self::esc($snapshot['capturedAt'] ?? null);
        $escBeforeTotal = self::esc($summary['beforeTotal'] ?? null);
        $escAfterTotal = self::esc($summary['afterTotal'] ?? null);
        $escFixedCount = self::esc($snapshot['counts']['fixed'] ?? null);
        $escReductionPercent = self::esc($summary['reductionPercent'] ?? null);

        $wcagClean = !empty($snapshot['warnings']['wcagRegressionClean']);
        $wcagClass = $wcagClean ? 'ok' : 'warn';
        $wcagText = $wcagClean ? 'Tidak ada rule WCAG luas yang memburuk.' : 'Ada perubahan yang perlu ditinjau pada pemindaian WCAG luas.';

        $regressionBlock = '';
        if (count($regression) > 0) {
            $regressionBlock = '<pre>' . self::esc(self::stringifyRegression($regression)) . '</pre>';
        }

        $rowsFixed = self::rows($report['fixed'] ?? []);
        $rowsReview = self::rows($report['review'] ?? []);
        $rowsRolledBack = self::rows($report['rolledBackRecords'] ?? []);

        $complianceSections = self::renderComplianceSections($snapshot);
        $wave2Sections = self::renderWave2Sections($snapshot);

        return '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>' . $escTitle . '</title><style>
@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font:11pt/1.55 Arial,sans-serif;color:#172033}h1{font-size:22pt}h2{margin-top:22pt;border-bottom:2px solid #294f91;padding-bottom:4pt}a{color:#0b3d91}code{font:9pt Consolas,monospace;overflow-wrap:anywhere}.meta,.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:10pt}.card{border:1px solid #aab4c5;border-radius:6pt;padding:10pt}.number{font-size:20pt;font-weight:700}table{border-collapse:collapse;width:100%;font-size:9pt}th,td{border:1px solid #aab4c5;padding:6pt;text-align:left;vertical-align:top}th{background:#edf2fb}.ok{color:#176b37}.warn{color:#8a4b08}footer{margin-top:24pt;border-top:1px solid #aab4c5;padding-top:8pt;font-size:9pt}
</style></head><body><header><p>AksaraNetra · Engine ' . $escEngineVersion . '</p><h1>' . $escTitle . '</h1><p>' . $escDisclaimer . '</p></header>
<section class="meta"><div><strong>Sumber</strong><br>' . $escFinalUrl . '</div><div><strong>Waktu audit</strong><br>' . $escCapturedAt . '</div></section>
<h2>Ringkasan</h2><section class="cards"><div class="card"><div class="number">' . $escBeforeTotal . '</div>Temuan target sebelum</div><div class="card"><div class="number">' . $escAfterTotal . '</div>Temuan target setelah</div><div class="card"><div class="number">' . $escFixedCount . '</div>Patch terverifikasi</div><div class="card"><div class="number">' . $escReductionPercent . '%</div>Pengurangan</div></section>
' . $complianceSections . $wave2Sections . '<h2>Status verifikasi</h2><p class="' . $wcagClass . '">' . $wcagText . '</p>' . $regressionBlock . '
<h2>Patch terverifikasi</h2>' . $rowsFixed . '
<h2>Perlu review manusia</h2>' . $rowsReview . '
<h2>Patch yang dibatalkan</h2>' . $rowsRolledBack . '
<footer>Laporan dibuat otomatis. Hasil ini tidak menyatakan situs asli telah diperbaiki dan tidak menggantikan pengujian manual dengan teknologi bantu.</footer></body></html>';
    }

    /**
     * Render score, severity, and verified Indonesian regulatory sections when Wave 1 snapshot data is present.
     */
    private static function renderComplianceSections(array $snapshot): string
    {
        $hasScore = isset($snapshot['score']) && is_array($snapshot['score']);
        $hasSeverity = isset($snapshot['severity']) && is_array($snapshot['severity']);
        $hasRegulations = isset($snapshot['regulations']) && is_array($snapshot['regulations']);
        if (!$hasScore && !$hasSeverity && !$hasRegulations) {
            return '';
        }

        $html = '';

        if ($hasScore) {
            $score = $snapshot['score'];
            $pour = is_array($score['pour'] ?? null) ? $score['pour'] : [];
            $html .= '<h2>Skor Kepatuhan</h2><section class="cards">'
                . '<div class="card"><div class="number">' . self::esc($score['overall'] ?? 0) . '</div>Skor keseluruhan (Grade ' . self::esc($score['grade'] ?? '-') . ')</div>'
                . '<div class="card"><div class="number">' . self::esc($score['beforeScore'] ?? 0) . ' &rarr; ' . self::esc($score['afterScore'] ?? 0) . '</div>Skor sebelum &amp; setelah patch</div>'
                . '</section>'
                . '<table><thead><tr><th>Perceivable</th><th>Operable</th><th>Understandable</th><th>Robust</th></tr></thead><tbody><tr>'
                . '<td>' . self::esc($pour['perceivable'] ?? 0) . '</td>'
                . '<td>' . self::esc($pour['operable'] ?? 0) . '</td>'
                . '<td>' . self::esc($pour['understandable'] ?? 0) . '</td>'
                . '<td>' . self::esc($pour['robust'] ?? 0) . '</td>'
                . '</tr></tbody></table>';
            if (!empty($score['automatedCoverageNote'])) {
                $html .= '<p>' . self::esc($score['automatedCoverageNote']) . '</p>';
            }
        }

        if ($hasSeverity) {
            $before = is_array($snapshot['severity']['before'] ?? null) ? $snapshot['severity']['before'] : [];
            $after = is_array($snapshot['severity']['after'] ?? null) ? $snapshot['severity']['after'] : [];
            $html .= '<h2>Rincian Tingkat Keparahan</h2><table><thead><tr><th>Fase</th><th>Kritis</th><th>Serius</th><th>Sedang</th><th>Ringan</th><th>Total</th></tr></thead><tbody>'
                . '<tr><td>Sebelum</td><td>' . self::esc($before['critical'] ?? 0) . '</td><td>' . self::esc($before['serious'] ?? 0) . '</td><td>' . self::esc($before['moderate'] ?? 0) . '</td><td>' . self::esc($before['minor'] ?? 0) . '</td><td>' . self::esc($before['total'] ?? 0) . '</td></tr>'
                . '<tr><td>Setelah</td><td>' . self::esc($after['critical'] ?? 0) . '</td><td>' . self::esc($after['serious'] ?? 0) . '</td><td>' . self::esc($after['moderate'] ?? 0) . '</td><td>' . self::esc($after['minor'] ?? 0) . '</td><td>' . self::esc($after['total'] ?? 0) . '</td></tr>'
                . '</tbody></table>';
        }

        $regulations = $hasRegulations && count($snapshot['regulations']) > 0
            ? $snapshot['regulations']
            : [
                ['code' => 'UU-8-2016', 'title' => 'UU No. 8 Tahun 2016 tentang Penyandang Disabilitas', 'article' => 'Pasal 19, 24, 105', 'matchedIssues' => 0],
                ['code' => 'PP-42-2020', 'title' => 'PP No. 42 Tahun 2020 tentang Aksesibilitas terhadap Permukiman, Pelayanan Publik, dan Pelindungan dari Bencana', 'article' => 'Pasal 17-18', 'matchedIssues' => 0],
                ['code' => 'PERMENPANRB-11-2024', 'title' => 'PermenPANRB No. 11 Tahun 2024 tentang Penyelenggaraan Pelayanan Publik Ramah Kelompok Rentan', 'article' => 'Standar Layanan Digital', 'matchedIssues' => 0],
                ['code' => 'SPBE-2018', 'title' => 'Perpres No. 95 Tahun 2018 tentang Sistem Pemerintahan Berbasis Elektronik', 'article' => 'Tata Kelola SPBE', 'matchedIssues' => 0],
                ['code' => 'UU-KIP-2008', 'title' => 'UU No. 14 Tahun 2008 (KIP) & PerKI No. 1 Tahun 2021', 'article' => 'Standar Layanan Informasi Publik', 'matchedIssues' => 0],
                ['code' => 'SNI-ISO-40500', 'title' => 'SNI ISO/IEC 40500 (WCAG 2.0/2.1 AA)', 'article' => 'Standar Nasional Aksesibilitas Web', 'matchedIssues' => 0],
            ];

        $regRows = '';
        foreach ($regulations as $reg) {
            if (!is_array($reg)) {
                continue;
            }
            $regRows .= '<tr><td>' . self::esc($reg['code'] ?? '') . '</td><td>' . self::esc($reg['title'] ?? '') . '</td><td>' . self::esc($reg['article'] ?? '') . '</td><td>' . self::esc($reg['matchedIssues'] ?? 0) . '</td></tr>';
        }
        $html .= '<h2>Acuan Regulasi Indonesia</h2><table><thead><tr><th>Kode</th><th>Regulasi</th><th>Pasal / Cakupan</th><th>Temuan Terkait</th></tr></thead><tbody>' . $regRows . '</tbody></table>';

        return $html . "\n";
    }

    /**
     * Render Wave 2 sections (enginesUsed, mobileAudit, detectors, pdfAudit, multiPage, clusters) when present.
     */
    private static function renderWave2Sections(array $snapshot): string
    {
        $enginesUsed = isset($snapshot['enginesUsed']) && is_array($snapshot['enginesUsed']) ? $snapshot['enginesUsed'] : [];
        $mobileAudit = isset($snapshot['mobileAudit']) && is_array($snapshot['mobileAudit']) ? $snapshot['mobileAudit'] : null;
        $pdfAudit = isset($snapshot['pdfAudit']) && is_array($snapshot['pdfAudit']) ? $snapshot['pdfAudit'] : null;
        $detectors = isset($snapshot['detectors']) && is_array($snapshot['detectors']) ? $snapshot['detectors'] : null;
        $multiPage = isset($snapshot['multiPage']) && is_array($snapshot['multiPage']) ? $snapshot['multiPage'] : null;
        $clusters = isset($snapshot['clusters']) && is_array($snapshot['clusters']) ? $snapshot['clusters'] : [];

        if (
            count($enginesUsed) === 0
            && $mobileAudit === null
            && $pdfAudit === null
            && $detectors === null
            && $multiPage === null
            && count($clusters) === 0
        ) {
            return '';
        }

        $html = '';

        if (count($enginesUsed) > 0) {
            $engineList = implode(', ', array_map(static fn ($e): string => self::esc($e), $enginesUsed));
            $html .= '<h2>Mesin Audit</h2><p>' . $engineList . '</p>';
        }

        if ($mobileAudit !== null) {
            $vp = is_array($mobileAudit['viewport'] ?? null) ? $mobileAudit['viewport'] : [];
            $vpText = self::esc(($vp['width'] ?? 320) . 'x' . ($vp['height'] ?? 568));
            $reflowText = !empty($mobileAudit['reflowOk']) ? 'Lolos' : 'Meluber (' . self::esc($mobileAudit['horizontalOverflowPx'] ?? 0) . 'px)';
            $spacingText = !empty($mobileAudit['textSpacingOk']) ? 'Lolos' : 'Terpotong (' . self::esc($mobileAudit['clippedElementsCount'] ?? 0) . ')';
            $pinchText = !empty($mobileAudit['pinchZoomBlocked']) ? 'Diblokir' : 'Diizinkan';
            $osPrefs = is_array($mobileAudit['osPreferences'] ?? null) ? $mobileAudit['osPreferences'] : [];
            $html .= '<h2>Audit Mobile &amp; Preferensi OS</h2><table><thead><tr><th>Viewport</th><th>Reflow 320px</th><th>Spasi Teks</th><th>Target &lt; 24px</th><th>Pinch Zoom</th><th>Reduced Motion (Unbounded)</th><th>Forced Colors</th></tr></thead><tbody><tr>'
                . '<td>' . $vpText . '</td>'
                . '<td>' . $reflowText . '</td>'
                . '<td>' . $spacingText . '</td>'
                . '<td>' . self::esc($mobileAudit['smallTargetsCount'] ?? 0) . '</td>'
                . '<td>' . $pinchText . '</td>'
                . '<td>' . self::esc(!empty($osPrefs['reducedMotionChecked']) ? ($osPrefs['reducedMotionUnboundedAnimations'] ?? 0) : '-') . '</td>'
                . '<td>' . (!empty($osPrefs['forcedColorsChecked']) ? 'Diperiksa' : '-') . '</td>'
                . '</tr></tbody></table>';
        }

        if ($detectors !== null) {
            $overlay = is_array($detectors['overlay'] ?? null) ? $detectors['overlay'] : [];
            $captcha = is_array($detectors['captcha'] ?? null) ? $detectors['captcha'] : [];
            $overlayStatus = !empty($overlay['detected'])
                ? 'Terdeteksi (' . implode(', ', array_map([self::class, 'esc'], (array) ($overlay['vendors'] ?? []))) . ')'
                : 'Tidak terdeteksi';
            $captchaStatus = !empty($captcha['detected'])
                ? 'Terdeteksi (' . implode(', ', array_map([self::class, 'esc'], (array) ($captcha['types'] ?? []))) . '; tanpa alternatif aksesibel: ' . self::esc($captcha['inaccessibleCount'] ?? 0) . ')'
                : 'Tidak terdeteksi';
            $html .= '<h2>Detektor Overlay &amp; CAPTCHA</h2><table><thead><tr><th>Pemeriksaan</th><th>Status</th></tr></thead><tbody>'
                . '<tr><td>Widget Overlay Aksesibilitas</td><td>' . $overlayStatus . '</td></tr>'
                . '<tr><td>Gerbang CAPTCHA</td><td>' . $captchaStatus . '</td></tr>'
                . '</tbody></table>';
        }

        if ($pdfAudit !== null) {
            $html .= '<h2>Audit Dokumen PDF</h2><section class="cards">'
                . '<div class="card"><div class="number">' . self::esc($pdfAudit['auditedCount'] ?? 0) . ' / ' . self::esc($pdfAudit['discoveredCount'] ?? 0) . '</div>PDF diaudit</div>'
                . '<div class="card"><div class="number">' . self::esc($pdfAudit['untaggedCount'] ?? 0) . ' / ' . self::esc($pdfAudit['scannedImageCount'] ?? 0) . '</div>Tanpa tag / Hasil pindai gambar</div>'
                . '</section>';
            $items = is_array($pdfAudit['items'] ?? null) ? $pdfAudit['items'] : [];
            if (count($items) > 0) {
                $rows = '';
                foreach ($items as $item) {
                    if (!is_array($item)) {
                        continue;
                    }
                    $rows .= '<tr><td><code>' . self::esc($item['filename'] ?? ($item['url'] ?? '')) . '</code></td>'
                        . '<td>' . self::esc($item['pageCount'] ?? 0) . '</td>'
                        . '<td>' . (!empty($item['isTagged']) ? 'Ya' : 'Tidak') . '</td>'
                        . '<td>' . (!empty($item['hasTextLayer']) ? 'Ya' : 'Tidak') . '</td>'
                        . '<td>' . (!empty($item['hasTitle']) ? 'Ya' : 'Tidak') . '</td>'
                        . '<td>' . (!empty($item['hasLang']) ? 'Ya' : 'Tidak') . '</td>'
                        . '<td>' . self::esc($item['status'] ?? '') . '</td></tr>';
                }
                $html .= '<table><thead><tr><th>Dokumen</th><th>Halaman</th><th>Tagged</th><th>Teks</th><th>Judul</th><th>Bahasa</th><th>Status</th></tr></thead><tbody>' . $rows . '</tbody></table>';
            }
        }

        if ($multiPage !== null) {
            $html .= '<h2>Ringkasan Multi-Halaman</h2><p>Mode: ' . self::esc($multiPage['mode'] ?? 'single')
                . ' · Halaman dipindai: ' . self::esc($multiPage['crawledCount'] ?? 0) . '/' . self::esc($multiPage['requestedMaxPages'] ?? 1)
                . ' · Skor rata-rata: ' . self::esc($multiPage['averageAfterScore'] ?? 0) . '/100</p>';
            $pages = is_array($multiPage['pages'] ?? null) ? $multiPage['pages'] : [];
            if (count($pages) > 0) {
                $pageRows = '';
                foreach ($pages as $page) {
                    if (!is_array($page)) {
                        continue;
                    }
                    $pageRows .= '<tr><td>' . self::esc($page['title'] ?? '') . '</td>'
                        . '<td><code>' . self::esc($page['url'] ?? '') . '</code></td>'
                        . '<td>' . self::esc($page['beforeScore'] ?? 0) . ' &rarr; ' . self::esc($page['afterScore'] ?? 0) . '</td>'
                        . '<td>' . self::esc($page['issuesCount'] ?? 0) . '</td>'
                        . '<td>' . self::esc($page['status'] ?? '') . '</td></tr>';
                }
                $html .= '<table><thead><tr><th>Judul</th><th>URL</th><th>Skor</th><th>Temuan</th><th>Status</th></tr></thead><tbody>' . $pageRows . '</tbody></table>';
            }
        }

        if (count($clusters) > 0) {
            $clusterRows = '';
            foreach ($clusters as $cluster) {
                if (!is_array($cluster)) {
                    continue;
                }
                $affectedCount = is_array($cluster['affectedPages'] ?? null) ? count($cluster['affectedPages']) : 0;
                $clusterRows .= '<tr><td>' . self::esc($cluster['ruleId'] ?? '') . '</td>'
                    . '<td>' . self::esc($cluster['impact'] ?? '') . '</td>'
                    . '<td>' . self::esc($cluster['titleId'] ?? '') . '</td>'
                    . '<td><code>' . self::esc($cluster['selectorPattern'] ?? '') . '</code></td>'
                    . '<td>' . self::esc($cluster['occurrences'] ?? 0) . '</td>'
                    . '<td>' . self::esc($cluster['blastRadiusPercent'] ?? 0) . '% (' . $affectedCount . ' halaman)</td></tr>';
            }
            $html .= '<h2>Klaster Temuan Berulang</h2><table><thead><tr><th>Rule</th><th>Dampak</th><th>Masalah</th><th>Pola Selektor</th><th>Kemunculan</th><th>Blast Radius</th></tr></thead><tbody>' . $clusterRows . '</tbody></table>';
        }

        return $html . "\n";
    }
}
