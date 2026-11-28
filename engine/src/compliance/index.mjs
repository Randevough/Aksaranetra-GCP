/**
 * Pure compliance, scoring, severity, and Indonesian issue normalizer.
 *
 * Maps axe-core violations and engine remediation records to WCAG 2.1 POUR
 * principles, impact-weighted scores, and verified Indonesian regulations.
 */

import { createSanitizedSnippet } from "../decisions/index.mjs";

export const POUR_PRINCIPLES = Object.freeze([
  "perceivable",
  "operable",
  "understandable",
  "robust",
]);

export const IMPACT_ORDER = Object.freeze([
  "critical",
  "serious",
  "moderate",
  "minor",
]);

export const MAX_ISSUES = 150;

export const AUTOMATED_COVERAGE_NOTE =
  "Skor dihitung otomatis berdasarkan pelanggaran WCAG 2.1 Level A/AA berbobot dampak (critical/serious/moderate/minor). Pengujian otomatis mencakup sekitar 30-40% kriteria WCAG; pengujian manual dengan pembaca layar tetap dianjurkan.";

const IMPACT_WEIGHTS = Object.freeze({
  critical: 10,
  serious: 6,
  moderate: 3,
  minor: 1,
});

const IMPACT_RANK = Object.freeze({
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
});

export const VERIFIED_REGULATIONS = Object.freeze([
  {
    code: "UU-8-2016",
    title: "UU No. 8 Tahun 2016 tentang Penyandang Disabilitas",
    article: "Pasal 19, Pasal 24, dan Pasal 105",
  },
  {
    code: "PP-42-2020",
    title:
      "PP No. 42 Tahun 2020 tentang Aksesibilitas terhadap Permukiman, Pelayanan Publik, dan Pelindungan dari Bencana bagi Penyandang Disabilitas",
    article: "Pasal 17-18",
  },
  {
    code: "PERMENPANRB-11-2024",
    title:
      "PermenPANRB No. 11 Tahun 2024 tentang Penyelenggaraan Pelayanan Publik Ramah Kelompok Rentan",
    article: "Standar Pelayanan Publik Digital Inklusif",
  },
  {
    code: "SPBE-2018",
    title:
      "Perpres No. 95 Tahun 2018 tentang Sistem Pemerintahan Berbasis Elektronik (SPBE)",
    article: "Tata Kelola & Kualitas Layanan Publik Elektronik",
  },
  {
    code: "UU-KIP-2008",
    title:
      "UU No. 14 Tahun 2008 tentang Keterbukaan Informasi Publik & PerKI No. 1 Tahun 2021",
    article: "Standar Layanan Informasi Publik (PPID)",
  },
  {
    code: "SNI-ISO-40500",
    title: "SNI ISO/IEC 40500 (Adopsi Nasional WCAG)",
    article: "Prinsip Perceivable, Operable, Understandable, Robust",
  },
]);

const RULE_CATALOG = Object.freeze({
  "image-alt": {
    pour: "perceivable",
    wcagSc: ["1.1.1"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "UU-KIP-2008", "SNI-ISO-40500"],
    titleId: "Gambar tidak memiliki teks alternatif (alt)",
    descriptionId:
      "Elemen gambar <img> tidak memiliki atribut alt yang menjelaskan isi atau menandai gambar dekoratif.",
    helpId:
      "Tambahkan atribut alt yang deskriptif untuk gambar informatif, atau alt=\"\" untuk gambar dekoratif.",
  },
  "color-contrast": {
    pour: "perceivable",
    wcagSc: ["1.4.3"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SNI-ISO-40500"],
    titleId: "Kontras warna teks dan latar belakang kurang memadai",
    descriptionId:
      "Rasio kontras antara warna teks dan latar belakang berada di bawah batas minimum WCAG AA (4.5:1 untuk teks biasa, 3:1 untuk teks besar).",
    helpId:
      "Gelapkan warna teks atau cerahkan warna latar belakang hingga memenuhi rasio kontras minimum.",
  },
  "link-name": {
    pour: "operable",
    wcagSc: ["2.4.4", "4.1.2"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "UU-KIP-2008", "SNI-ISO-40500"],
    titleId: "Tautan tidak memiliki teks yang dapat dibaca",
    descriptionId:
      "Elemen tautan <a> hanya berisi ikon atau gambar tanpa label aksesibel sehingga pembaca layar tidak mengetahui tujuannya.",
    helpId:
      "Berikan teks tautan yang jelas atau tambahkan atribut aria-label yang menjelaskan tujuan tautan.",
  },
  "button-name": {
    pour: "robust",
    wcagSc: ["4.1.2"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SPBE-2018", "SNI-ISO-40500"],
    titleId: "Tombol tidak memiliki nama aksesibel",
    descriptionId:
      "Elemen <button> atau kontrol ber-role button tidak memiliki teks maupun atribut label untuk pembaca layar.",
    helpId:
      "Tambahkan teks di dalam tombol atau pasang atribut aria-label yang mendeskripsikan aksinya.",
  },
  "scrollable-region-focusable": {
    pour: "operable",
    wcagSc: ["2.1.1"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SNI-ISO-40500"],
    titleId: "Area gulir tidak dapat dijangkau dengan keyboard",
    descriptionId:
      "Kontainer dengan konten yang dapat digulir tidak memiliki elemen fokus atau tabindex sehingga pengguna keyboard tidak dapat menggulirnya.",
    helpId:
      "Tambahkan tabindex=\"0\" serta role=\"region\" dan aria-label pada kontainer yang dapat digulir.",
  },
  "label": {
    pour: "understandable",
    wcagSc: ["1.3.1", "3.3.2", "4.1.2"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SPBE-2018", "SNI-ISO-40500"],
    titleId: "Kolom formulir tidak memiliki label",
    descriptionId:
      "Elemen input, select, atau textarea tidak terhubung dengan elemen <label>, aria-label, atau aria-labelledby.",
    helpId:
      "Pasangkan elemen <label for=\"...\"> atau tambahkan aria-label yang menjelaskan data yang diminta.",
  },
  "html-has-lang": {
    pour: "understandable",
    wcagSc: ["3.1.1"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SPBE-2018", "SNI-ISO-40500"],
    titleId: "Dokumen tidak mendeklarasikan atribut bahasa (lang)",
    descriptionId:
      "Elemen akar <html> tidak memiliki atribut lang sehingga pembaca layar tidak mengetahui bahasa pelafalan yang tepat.",
    helpId: "Tambahkan atribut lang yang sesuai (misalnya lang=\"id\" atau lang=\"en\") pada tag <html>.",
  },
  "html-lang-valid": {
    pour: "understandable",
    wcagSc: ["3.1.1"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SPBE-2018", "SNI-ISO-40500"],
    titleId: "Nilai atribut bahasa (lang) pada <html> tidak valid",
    descriptionId:
      "Atribut lang pada elemen <html> tidak menggunakan kode bahasa BCP 47 yang valid.",
    helpId: "Perbaiki atribut lang menjadi kode BCP 47 yang sah seperti \"id\" atau \"en\".",
  },
  "document-title": {
    pour: "operable",
    wcagSc: ["2.4.2"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "UU-KIP-2008", "SNI-ISO-40500"],
    titleId: "Halaman tidak memiliki judul dokumen (<title>)",
    descriptionId:
      "Dokumen tidak memiliki elemen <title> yang deskriptif di dalam <head> untuk mengidentifikasi topik halaman.",
    helpId: "Sediakan elemen <title> yang ringkas dan menjelaskan isi atau layanan halaman.",
  },
  "landmark-one-main": {
    pour: "operable",
    wcagSc: ["1.3.1", "2.4.1"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SPBE-2018", "SNI-ISO-40500"],
    titleId: "Halaman tidak memiliki landmark konten utama (<main>)",
    descriptionId:
      "Dokumen tidak menandai area konten utama dengan elemen <main> atau role=\"main\" untuk navigasi cepat pembaca layar.",
    helpId: "Bungkus konten pokok halaman dengan tag <main> atau tambahkan role=\"main\".",
  },
  "region": {
    pour: "operable",
    wcagSc: ["1.3.1", "2.4.1"],
    regulations: ["UU-8-2016", "PP-42-2020", "SPBE-2018", "SNI-ISO-40500"],
    titleId: "Konten halaman berada di luar wilayah landmark",
    descriptionId:
      "Sebagian konten halaman tidak berada di dalam landmark semantik (header, nav, main, footer, aside).",
    helpId: "Kelompokkan seluruh bagian halaman ke dalam elemen landmark HTML5 yang sesuai.",
  },
  "bypass": {
    pour: "operable",
    wcagSc: ["2.4.1"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SNI-ISO-40500"],
    titleId: "Tidak tersedia mekanisme lewati blok navigasi (skip link)",
    descriptionId:
      "Pengguna keyboard tidak memiliki tautan pintas untuk melompati menu berulang menuju konten utama.",
    helpId: "Tambahkan tautan \"Lewati ke konten utama\" di awal halaman atau pastikan landmark <main> tersedia.",
  },
  "heading-order": {
    pour: "perceivable",
    wcagSc: ["1.3.1"],
    regulations: ["UU-8-2016", "PP-42-2020", "UU-KIP-2008", "SNI-ISO-40500"],
    titleId: "Urutan tingkat judul (heading) melompat",
    descriptionId:
      "Hierarki heading (h1-h6) melompati tingkatan sehingga menyulitkan pengguna pembaca layar memahami struktur dokumen.",
    helpId: "Susun tingkat heading secara berurutan (h1 diikuti h2, lalu h3) tanpa melompat.",
  },
  "empty-heading": {
    pour: "perceivable",
    wcagSc: ["1.3.1", "2.4.6"],
    regulations: ["UU-8-2016", "PP-42-2020", "SNI-ISO-40500"],
    titleId: "Elemen heading tidak memiliki teks",
    descriptionId:
      "Terdapat tag heading (h1-h6) yang kosong atau tidak memiliki teks yang terbaca pembaca layar.",
    helpId: "Isi heading dengan teks yang jelas atau hapus elemen heading yang kosong.",
  },
  "frame-title": {
    pour: "robust",
    wcagSc: ["4.1.2"],
    regulations: ["UU-8-2016", "PP-42-2020", "SPBE-2018", "SNI-ISO-40500"],
    titleId: "Elemen iframe tidak memiliki atribut title",
    descriptionId:
      "Bingkai tertanam (<iframe>) tidak memiliki atribut title sehingga pengguna pembaca layar tidak mengetahui isinya.",
    helpId: "Tambahkan atribut title yang menjelaskan konten atau fungsi iframe tersebut.",
  },
  "meta-viewport": {
    pour: "perceivable",
    wcagSc: ["1.4.4"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SNI-ISO-40500"],
    titleId: "Meta viewport membatasi pembesaran layar (zoom)",
    descriptionId:
      "Tag meta viewport menonaktifkan zoom (user-scalable=no atau maximum-scale kecil) sehingga pengguna low-vision terhalang.",
    helpId: "Hapus user-scalable=no dan pastikan pengguna dapat memperbesar halaman minimal 200%.",
  },
  "duplicate-id": {
    pour: "robust",
    wcagSc: ["4.1.1"],
    regulations: ["UU-8-2016", "SPBE-2018", "SNI-ISO-40500"],
    titleId: "Atribut id digunakan lebih dari satu kali",
    descriptionId:
      "Terdapat dua atau lebih elemen dengan nilai atribut id yang sama sehingga referensi label dan ARIA dapat keliru.",
    helpId: "Pastikan setiap nilai atribut id unik dalam satu halaman.",
  },
  "nested-interactive": {
    pour: "robust",
    wcagSc: ["4.1.2"],
    regulations: ["UU-8-2016", "PP-42-2020", "SNI-ISO-40500"],
    titleId: "Elemen interaktif bersarang di dalam kontrol lain",
    descriptionId:
      "Kontrol interaktif seperti tombol atau tautan berada di dalam elemen interaktif lain sehingga membingungkan teknologi bantu.",
    helpId: "Pisahkan elemen interaktif agar tidak saling membungkus satu sama lain.",
  },
  "aria-allowed-attr": {
    pour: "robust",
    wcagSc: ["4.1.2"],
    regulations: ["UU-8-2016", "PP-42-2020", "SNI-ISO-40500"],
    titleId: "Atribut ARIA tidak diizinkan pada role elemen ini",
    descriptionId:
      "Elemen menggunakan atribut aria-* yang tidak didukung oleh role atau tag HTML-nya.",
    helpId: "Gunakan hanya atribut ARIA yang valid untuk role elemen terkait.",
  },
  "aria-required-attr": {
    pour: "robust",
    wcagSc: ["4.1.2"],
    regulations: ["UU-8-2016", "PP-42-2020", "SNI-ISO-40500"],
    titleId: "Atribut ARIA wajib belum lengkap",
    descriptionId:
      "Elemen dengan role ARIA tertentu belum menyertakan atribut aria-* yang diwajibkan spesifikasi.",
    helpId: "Lengkapi seluruh atribut ARIA wajib sesuai definisi role yang digunakan.",
  },
  "aria-hidden-focus": {
    pour: "operable",
    wcagSc: ["4.1.2", "2.4.3"],
    regulations: ["UU-8-2016", "PP-42-2020", "SNI-ISO-40500"],
    titleId: "Elemen tersembunyi (aria-hidden) masih dapat difokuskan",
    descriptionId:
      "Elemen di dalam kontainer aria-hidden=\"true\" tetap dapat menerima fokus keyboard sehingga fokus menghilang dari pembaca layar.",
    helpId: "Hapus aria-hidden=\"true\" pada area aktif atau nonaktifkan elemen fokus di dalamnya.",
  },
  "select-name": {
    pour: "understandable",
    wcagSc: ["4.1.2", "1.3.1"],
    regulations: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SPBE-2018", "SNI-ISO-40500"],
    titleId: "Daftar pilihan (<select>) tidak memiliki label",
    descriptionId: "Elemen <select> tidak memiliki nama aksesibel bagi pembaca layar.",
    helpId: "Hubungkan <select> dengan <label> atau tambahkan aria-label yang jelas.",
  },
  "input-button-name": {
    pour: "robust",
    wcagSc: ["4.1.2"],
    regulations: ["UU-8-2016", "PP-42-2020", "SPBE-2018", "SNI-ISO-40500"],
    titleId: "Tombol input tidak memiliki label teks",
    descriptionId: "Elemen <input type=\"button|submit|reset\"> tidak memiliki value atau label aksesibel.",
    helpId: "Tambahkan atribut value yang jelas atau aria-label pada tombol input.",
  },
});

const DEFAULT_REGS_BY_POUR = Object.freeze({
  perceivable: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SNI-ISO-40500"],
  operable: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "UU-KIP-2008", "SNI-ISO-40500"],
  understandable: ["UU-8-2016", "PP-42-2020", "PERMENPANRB-11-2024", "SPBE-2018", "SNI-ISO-40500"],
  robust: ["UU-8-2016", "PP-42-2020", "SPBE-2018", "SNI-ISO-40500"],
});

function normalizeImpact(impact) {
  const value = String(impact || "").toLowerCase();
  return IMPACT_ORDER.includes(value) ? value : "moderate";
}

function extractWcagScFromTags(tags = []) {
  const sc = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const match = /^wcag(\d)(\d)(\d+)$/i.exec(String(tag));
    if (match) {
      sc.push(`${match[1]}.${match[2]}.${match[3]}`);
    }
  }
  return [...new Set(sc)];
}

function inferPourFromSc(scList = [], tags = []) {
  for (const sc of scList) {
    if (sc.startsWith("1.")) return "perceivable";
    if (sc.startsWith("2.")) return "operable";
    if (sc.startsWith("3.")) return "understandable";
    if (sc.startsWith("4.")) return "robust";
  }

  const tagStr = (tags || []).join(" ").toLowerCase();
  if (/cat\.color|cat\.text-alternatives|cat\.sensory|cat\.time-and-media/.test(tagStr)) {
    return "perceivable";
  }
  if (/cat\.keyboard|cat\.navigation/.test(tagStr)) {
    return "operable";
  }
  if (/cat\.language|cat\.forms/.test(tagStr)) {
    return "understandable";
  }
  return "robust";
}

function ruleMetadata(violation) {
  const ruleId = String(violation?.id || "unknown-rule");
  const entry = RULE_CATALOG[ruleId];
  const tagSc = extractWcagScFromTags(violation?.tags);
  const wcagSc = entry?.wcagSc?.length ? entry.wcagSc : tagSc;
  const pour = entry?.pour || inferPourFromSc(wcagSc, violation?.tags);
  const regulations = entry?.regulations || DEFAULT_REGS_BY_POUR[pour];

  if (entry) {
    return {
      pour,
      wcagSc,
      regulations,
      titleId: entry.titleId,
      descriptionId: entry.descriptionId,
      helpId: entry.helpId,
    };
  }

  const scText = wcagSc.length ? ` (WCAG ${wcagSc.join(", ")})` : "";
  const rawHelp = String(violation?.help || "").trim();
  const rawDesc = String(violation?.description || "").trim();
  return {
    pour,
    wcagSc,
    regulations,
    titleId: `Pelanggaran aksesibilitas: ${ruleId}${scText}`,
    descriptionId: rawDesc
      ? `Aturan ${ruleId} terdeteksi belum memenuhi standar WCAG${scText}. Keterangan aturan: ${rawDesc}`
      : `Aturan ${ruleId} terdeteksi belum memenuhi kriteria aksesibilitas WCAG 2.1 Level A/AA${scText}.`,
    helpId: rawHelp
      ? `Perbaiki elemen sesuai panduan aturan ${ruleId}: ${rawHelp}`
      : `Tinjau elemen terdampak pada aturan ${ruleId} dan pastikan sesuai standar WCAG 2.1 AA.`,
  };
}

/**
 * Strips script/iframe/svg tags, dangerous attributes, and unsafe URLs from
 * a single raw HTML snippet so it can be stored safely in snapshot JSON.
 */
export function sanitizeHtmlSnippet(rawHtml, maxLength = 240) {
  if (!rawHtml || typeof rawHtml !== "string") return null;

  let text = rawHtml
    .replace(/<(script|style|iframe|object|embed|applet|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|applet|svg)\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:srcdoc|ping|formaction|xlink:href|http-equiv)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html):[\s\S]*?\2/gi, "")
    .replace(/\s+style\s*=\s*(["'])[^"']*(?:expression\s*\(|javascript\s*:|behavior\s*:|@import)[^"']*\1/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;
  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength - 3)}...`;
  }
  return text;
}

function countSeverity(axeResult, fallbackTotal = 0) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0 };
  const violations = axeResult?.violations;

  if (!Array.isArray(violations)) {
    const n = Math.max(0, Number(fallbackTotal) || 0);
    counts.moderate = n;
    counts.total = n;
    return counts;
  }

  for (const violation of violations) {
    const impact = normalizeImpact(violation?.impact);
    const nodeCount = Array.isArray(violation?.nodes) ? violation.nodes.length : 0;
    counts[impact] += nodeCount;
    counts.total += nodeCount;
  }

  return counts;
}

function penaltyForViolations(violations = []) {
  let totalPenalty = 0;
  for (const violation of violations) {
    const count = Array.isArray(violation?.nodes) ? violation.nodes.length : 0;
    if (count === 0) continue;
    const impact = normalizeImpact(violation?.impact);
    const base = IMPACT_WEIGHTS[impact];
    totalPenalty += base * (1 + 0.15 * Math.log2(count));
  }
  return totalPenalty;
}

function computeScoreDivisor(passedRuleCount = 0) {
  const passed = Math.max(0, Number(passedRuleCount) || 0);
  return Math.max(85, 65 + passed * 2.5);
}

function penaltyToScoreWithDivisor(penalty, divisor) {
  if (penalty <= 0) return 100;
  return Math.max(0, Math.min(99, Math.round(100 * Math.exp(-penalty / divisor))));
}

function penaltyToScore(penalty, passedRuleCount = 0) {
  if (penalty <= 0) return 100;
  const divisor = computeScoreDivisor(passedRuleCount);
  return penaltyToScoreWithDivisor(penalty, divisor);
}

function gradeForScore(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

function computePourScores(axeAfter, fallbackAfterTotal = 0) {
  if (!Array.isArray(axeAfter?.violations)) {
    const fallbackPenalty = Math.max(0, Number(fallbackAfterTotal) || 0) * 3;
    const baseScore = penaltyToScore(fallbackPenalty, 0);
    return {
      perceivable: baseScore,
      operable: baseScore,
      understandable: baseScore,
      robust: baseScore,
    };
  }

  const buckets = {
    perceivable: [],
    operable: [],
    understandable: [],
    robust: [],
  };

  for (const violation of axeAfter.violations) {
    const meta = ruleMetadata(violation);
    buckets[meta.pour].push(violation);
  }

  const passedCounts = {
    perceivable: 0,
    operable: 0,
    understandable: 0,
    robust: 0,
  };

  for (const pass of Array.isArray(axeAfter?.passes) ? axeAfter.passes : []) {
    const meta = ruleMetadata(pass);
    passedCounts[meta.pour] += 1;
  }

  const pourScores = {};
  for (const principle of POUR_PRINCIPLES) {
    const bucketPenalty = penaltyForViolations(buckets[principle]);
    const bucketDivisor = Math.max(45, 45 + passedCounts[principle] * 4);
    pourScores[principle] = penaltyToScoreWithDivisor(bucketPenalty, bucketDivisor);
  }
  return pourScores;
}

export function computeAuditScore({ report, wcagBefore, wcagAfter } = {}) {
  const beforeAxe = wcagBefore || report?.beforeAxe || null;
  const afterAxe = wcagAfter || report?.wideAfterAxe || report?.afterAxe || null;

  const beforePenalty = Array.isArray(beforeAxe?.violations)
    ? penaltyForViolations(beforeAxe.violations)
    : Math.max(0, Number(report?.metrics?.beforeTotal) || 0) * 3;

  const afterPenalty = Array.isArray(afterAxe?.violations)
    ? penaltyForViolations(afterAxe.violations)
    : Math.max(0, Number(report?.metrics?.afterTotal) || 0) * 3;

  const beforePassedCount = Array.isArray(beforeAxe?.passes) ? beforeAxe.passes.length : 0;
  const afterPassedCount = Array.isArray(afterAxe?.passes) ? afterAxe.passes.length : 0;

  const beforeScore = penaltyToScore(beforePenalty, beforePassedCount);
  const afterScore = penaltyToScore(afterPenalty, afterPassedCount);
  const overall = afterScore;

  return {
    overall,
    beforeScore,
    afterScore,
    grade: gradeForScore(overall),
    methodology: "automated-wcag-2.1-aa-impact-weighted",
    automatedCoverageNote: AUTOMATED_COVERAGE_NOTE,
    pour: computePourScores(afterAxe, report?.metrics?.afterTotal),
  };
}

function selectorOfNode(node) {
  if (!Array.isArray(node?.target) || node.target.length === 0) return "";
  return node.target.length === 1
    ? String(node.target[0])
    : node.target.map(String).join(" >>> ");
}

function normalizeSelectorForDedupe(selector) {
  return String(selector || "")
    .trim()
    .replace(/\s*>\s*/g, " > ")
    .replace(/\s+/g, " ");
}

function buildRecordLookup(records = []) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.rule || !record?.selector) continue;
    map.set(`${record.rule}::${record.selector}`, record);
  }
  return map;
}

function buildAfterSet(axeAfter) {
  const set = new Set();
  for (const violation of axeAfter?.violations ?? []) {
    for (const node of violation?.nodes ?? []) {
      const selector = selectorOfNode(node);
      if (selector) set.add(`${violation.id}::${selector}`);
    }
  }
  return set;
}

export function normalizeIssues({
  report = {},
  wcagBefore = null,
  wcagAfter = null,
  issueBoundingBoxes = null,
  aceViolations = null,
} = {}) {
  const beforeSource = wcagBefore || report?.beforeAxe || null;
  const afterSource = wcagAfter || report?.wideAfterAxe || report?.afterAxe || null;
  const bboxes = issueBoundingBoxes || report?.issueBoundingBoxes || {};
  const aceList = Array.isArray(aceViolations)
    ? aceViolations
    : Array.isArray(report?.aceViolations)
      ? report.aceViolations
      : [];

  const fixedMap = buildRecordLookup(report?.fixed);
  const rolledBackMap = buildRecordLookup(report?.rolledBackRecords);
  const reviewMap = buildRecordLookup(report?.review);
  const skippedMap = buildRecordLookup(report?.skipped);
  const afterSet = buildAfterSet(afterSource);

  const collected = [];
  const dedupeIndex = new Map();
  let seq = 0;

  for (const violation of beforeSource?.violations ?? []) {
    const ruleId = String(violation?.id || "unknown-rule");
    const impact = normalizeImpact(violation?.impact);
    const meta = ruleMetadata(violation);

    for (const node of violation?.nodes ?? []) {
      seq += 1;
      const selector = selectorOfNode(node);
      const key = `${ruleId}::${selector}`;

      const fixedRec = fixedMap.get(key);
      const rolledRec = rolledBackMap.get(key);
      const reviewRec = reviewMap.get(key);
      const skippedRec = skippedMap.get(key);
      const matchedRec = fixedRec || rolledRec || reviewRec || skippedRec || null;

      let status = "open";
      if (fixedRec) {
        status = "fixed";
      } else if (rolledRec) {
        status = "rolled-back";
      } else if (reviewRec) {
        status = "review";
      } else if (skippedRec) {
        status = "skipped";
      } else if (afterSource && !afterSet.has(key)) {
        status = "fixed";
      }

      const snippet = matchedRec?.snippet || (matchedRec ? createSanitizedSnippet(matchedRec) : null);
      const htmlBefore =
        matchedRec?.snippet?.before ||
        sanitizeHtmlSnippet(node?.html) ||
        snippet?.before ||
        null;
      const htmlAfter = fixedRec
        ? snippet?.after || sanitizeHtmlSnippet(fixedRec?.htmlAfter) || null
        : null;

      const issue = {
        id: `${ruleId}-${seq}`,
        ruleId,
        impact,
        status,
        pour: meta.pour,
        wcagSc: meta.wcagSc,
        regulations: meta.regulations,
        titleId: meta.titleId,
        descriptionId: meta.descriptionId,
        helpId: meta.helpId,
        selector,
        htmlBefore,
        htmlAfter,
        boundingBox: (selector && bboxes[selector]) || null,
        confidence: typeof matchedRec?.confidence === "number" ? matchedRec.confidence : null,
        source: matchedRec?.source ? String(matchedRec.source) : null,
        engines: ["axe-core"],
      };

      collected.push(issue);

      const primarySc = meta.wcagSc?.[0] || "";
      const normSel = normalizeSelectorForDedupe(selector);
      if (primarySc && normSel) {
        const dedupeKey = `${primarySc}::${normSel}`;
        if (!dedupeIndex.has(dedupeKey)) {
          dedupeIndex.set(dedupeKey, issue);
        }
      }
    }
  }

  for (const ace of aceList) {
    if (!ace || typeof ace !== "object") continue;
    const ruleId = String(ace.ruleId || "unknown-ace-rule");
    const wcagSc = Array.isArray(ace.wcagSc)
      ? ace.wcagSc.map(String).filter(Boolean)
      : [];
    const selector = String(ace.selector || "");
    const primarySc = wcagSc[0] || "";
    const normSel = normalizeSelectorForDedupe(selector);
    const dedupeKey = primarySc && normSel ? `${primarySc}::${normSel}` : null;

    if (dedupeKey && dedupeIndex.has(dedupeKey)) {
      const existing = dedupeIndex.get(dedupeKey);
      if (!existing.engines.includes("ibm-ace")) {
        existing.engines.push("ibm-ace");
      }
      continue;
    }

    seq += 1;
    const impact = normalizeImpact(ace.impact);
    const pour = inferPourFromSc(wcagSc);
    const regulations = DEFAULT_REGS_BY_POUR[pour];
    const scText = wcagSc.length ? ` (WCAG ${wcagSc.join(", ")})` : "";
    const helpText = String(ace.help || "").trim();

    const aceIssue = {
      id: `ace-${ruleId}-${seq}`,
      ruleId,
      impact,
      status: "open",
      pour,
      wcagSc,
      regulations,
      titleId: `Temuan IBM Equal Access: ${ruleId}${scText}`,
      descriptionId: helpText
        ? `Mesin IBM Equal Access mendeteksi pelanggaran aturan ${ruleId}${scText}: ${helpText}`
        : `Aturan ${ruleId} terdeteksi oleh IBM Equal Access belum memenuhi standar WCAG${scText}.`,
      helpId: helpText
        ? `Perbaiki elemen sesuai panduan IBM Equal Access (${ruleId}): ${helpText}`
        : `Tinjau elemen terdampak pada aturan ${ruleId} dan pastikan sesuai standar WCAG 2.2 AA.`,
      selector,
      htmlBefore: sanitizeHtmlSnippet(ace.html) || null,
      htmlAfter: null,
      boundingBox: (selector && bboxes[selector]) || null,
      confidence: null,
      source: "ibm-ace",
      engines: ["ibm-ace"],
    };

    collected.push(aceIssue);
    if (dedupeKey && !dedupeIndex.has(dedupeKey)) {
      dedupeIndex.set(dedupeKey, aceIssue);
    }
  }

  collected.sort((a, b) => (IMPACT_RANK[a.impact] ?? 2) - (IMPACT_RANK[b.impact] ?? 2));
  return collected.slice(0, MAX_ISSUES);
}

export function buildRegulationsSummary(issues = []) {
  const counts = new Map(VERIFIED_REGULATIONS.map((reg) => [reg.code, 0]));

  for (const issue of issues) {
    for (const code of issue?.regulations ?? []) {
      if (counts.has(code)) {
        counts.set(code, counts.get(code) + 1);
      }
    }
  }

  return VERIFIED_REGULATIONS.map((reg) => ({
    code: reg.code,
    title: reg.title,
    article: reg.article,
    matchedIssues: counts.get(reg.code) ?? 0,
  }));
}

export function buildComplianceReport({
  report = {},
  wcagBefore = null,
  wcagAfter = null,
  issueBoundingBoxes = null,
  aceViolations = null,
} = {}) {
  const beforeSource = wcagBefore || report?.beforeAxe || null;
  const afterSource = wcagAfter || report?.wideAfterAxe || report?.afterAxe || null;

  const severity = {
    before: countSeverity(beforeSource, report?.metrics?.beforeTotal),
    after: countSeverity(afterSource, report?.metrics?.afterTotal),
  };

  const score = computeAuditScore({
    report,
    wcagBefore: beforeSource,
    wcagAfter: afterSource,
  });

  const issues = normalizeIssues({
    report,
    wcagBefore: beforeSource,
    wcagAfter: afterSource,
    issueBoundingBoxes,
    aceViolations,
  });

  const regulations = buildRegulationsSummary(issues);

  return { score, severity, regulations, issues };
}
