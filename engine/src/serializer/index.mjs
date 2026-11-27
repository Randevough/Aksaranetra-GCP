/**
 * Mengubah halaman yang sudah ditambal jadi dua berkas HTML yang aman.
 *
 * Bagian yang butuh browser hanya satu: membaca DOM. Sisanya murni dan diuji
 * terpisah di src/serializer/sanitize.mjs dan src/serializer/reader.mjs.
 */

import {
  DANGEROUS_ATTRIBUTES,
  SAFE_SCHEMES,
  SNAPSHOT_CSP,
  STRIPPED_TAGS,
  UNSAFE_STYLE_PATTERN,
  absolutizeUrl,
  escapeHtml,
  isDangerousAttribute,
  sanitizeInlineStyle,
} from "./sanitize.mjs";
import { renderReaderDocument } from "./reader.mjs";
import { MAX_CARD_LEVELS, attachCardLinks } from "./blocks.mjs";

export function sanitizeExtractedAttributes(attrs = {}) {
  const cleaned = {};
  for (const [name, value] of Object.entries(attrs || {})) {
    if (isDangerousAttribute(name)) continue;
    const lower = name.toLowerCase();
    if (lower === "style") {
      const safeStyle = sanitizeInlineStyle(value);
      if (safeStyle) cleaned[name] = safeStyle;
      continue;
    }
    if (lower === "href" || lower === "src") {
      const safeUrl = absolutizeUrl(value);
      if (safeUrl) cleaned[name] = safeUrl;
      continue;
    }
    cleaned[name] = value;
  }
  return cleaned;
}

/**
 * Membaca isi halaman dari browser.
 *
 * Seluruh isi fungsi evaluate dijalankan di dalam halaman, jadi tidak boleh
 * memanggil apa pun dari luar. Itu sebabnya daftar aturan dikirim sebagai argumen.
 */
async function extract(page, strippedTags, maxCardLevels) {
  return page.evaluate(
    ({
      tags,
      maxCardLevels: levelLimit,
      dangerousAttrs,
      safeSchemes,
      unsafeStyleSource,
    }) => {
      const doc = document.cloneNode(true);
      const dangerousSet = new Set(dangerousAttrs);
      const safeSchemeSet = new Set(safeSchemes);
      const unsafeStyleRegex = new RegExp(unsafeStyleSource, "i");
      const safeImageData = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i;

      for (const tag of tags) {
        for (const node of doc.querySelectorAll(tag)) node.remove();
      }

      // Semua penangan kejadian, atribut berbahaya, dan style berbahaya dibuang.
      for (const node of doc.querySelectorAll("*")) {
        for (const attribute of [...node.attributes]) {
          const name = attribute.name.toLowerCase();
          if (name.startsWith("on") || dangerousSet.has(name)) {
            node.removeAttribute(attribute.name);
            continue;
          }
          if (name === "style" && unsafeStyleRegex.test(attribute.value || "")) {
            node.removeAttribute(attribute.name);
          }
        }
      }

      // Form dinetralkan, tidak dihapus. Tombol dan labelnya tetap terlihat
      // sebagai bukti hasil patch, tetapi tidak bisa mengirim apa pun.
      for (const form of doc.querySelectorAll("form")) {
        form.removeAttribute("action");
        form.removeAttribute("method");
        form.setAttribute("data-aksara-dinonaktifkan", "true");
      }

      // Alamat relatif diubah jadi penuh dan skema berbahaya (javascript:, vbscript:, data:text/html) dibuang.
      for (const node of doc.querySelectorAll("[href], [src], [srcset]")) {
        for (const name of ["href", "src"]) {
          const value = node.getAttribute(name);
          if (value === null) continue;
          const trimmed = value.trim();
          if (!trimmed) {
            node.removeAttribute(name);
            continue;
          }
          if (trimmed.startsWith("#")) continue;
          if (trimmed.toLowerCase().startsWith("data:")) {
            if (name === "src" && safeImageData.test(trimmed)) continue;
            node.removeAttribute(name);
            continue;
          }
          try {
            const resolved = new URL(trimmed, document.baseURI);
            if (!safeSchemeSet.has(resolved.protocol)) {
              node.removeAttribute(name);
            } else {
              node.setAttribute(name, resolved.toString());
            }
          } catch {
            node.removeAttribute(name);
          }
        }
        node.removeAttribute("srcset");
      }

    const HEADINGS = "h1, h2, h3, h4, h5, h6";

    /**
     * Mengumpulkan tautan di setiap tingkat kartu yang membungkus sebuah judul,
     * dari yang terdekat ke yang terjauh. Tautan jangkar dalam halaman dibuang
     * karena tidak menuju ke mana mana.
     */
    function collectCardLinks(element) {
      const levels = [];
      let parent = element.parentElement;

      for (let depth = 0; depth < levelLimit; depth += 1) {
        if (!parent || parent === doc.body) break;

        levels.push(
          [...parent.querySelectorAll("a[href]")]
            .map((anchor) => ({
              href: anchor.getAttribute("href") || "",
              text: anchor.textContent.trim(),
            }))
            .filter((item) => item.href && !item.href.startsWith("#")),
        );

        parent = parent.parentElement;
      }

      return levels;
    }

    const seenText = new Set();
    const seenLink = new Set();
    const blocks = [];
    const main =
      doc.querySelector("main, [role='main']") || doc.body;

    for (const node of main.querySelectorAll(
      `${HEADINGS}, p, ul, ol, img, a[href]`,
    )) {
      const tag = node.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        const text = node.textContent.trim();
        if (!text) continue;

        // Judul bisa dibungkus tautan, atau justru membungkus tautannya.
        // Dua duanya harus tetap bisa dibuka.
        const anchor = node.closest("a[href]") || node.querySelector("a[href]");
        const href = anchor ? anchor.getAttribute("href") : null;

        seenText.add(text);
        if (href) seenLink.add(`${href}|${text}`);

        // Judul yang tidak punya tautan sendiri sering berada di dalam kartu
        // yang seluruhnya bisa diklik. Di sini kita hanya MENGUMPULKAN
        // kandidatnya. Keputusan memilih ada di src/serializer/blocks.mjs,
        // supaya aturannya bisa diuji tanpa browser.
        const cardLinks = href ? null : collectCardLinks(node);

        blocks.push({
          type: "heading",
          level: Number(tag[1]),
          text,
          href,
          cardLinks,
        });
        continue;
      }

      if (tag === "a") {
        // Tautan yang membungkus sebuah judul dilewati di sini, karena
        // judulnya sudah membawa alamat yang sama.
        if (node.querySelector(HEADINGS)) continue;

        const text = node.textContent.trim();
        const href = node.getAttribute("href");
        if (!href || text.length < 2) continue;

        const key = `${href}|${text}`;
        if (seenText.has(text) || seenLink.has(key)) continue;

        seenLink.add(key);
        seenText.add(text);
        blocks.push({ type: "link", text, href });
        continue;
      }

      if (tag === "p") {
        const text = node.textContent.trim();
        // Banyak kartu berita mengulang judulnya sebagai paragraf. Sekali
        // baca sudah cukup.
        if (text.length > 1 && !seenText.has(text)) {
          seenText.add(text);
          blocks.push({ type: "paragraph", text });
        }
        continue;
      }

      if (tag === "img") {
        const src = node.getAttribute("src");
        if (!src) continue;

        // Jangan ekstrak ikon media sosial, tombol tutup, ikon bahasa, atau gambar duplikat sebagai blok gambar artikel
        const isIconOrSocial = node.closest("button, [class*='icon'], [class*='social'], [class*='widget'], [aria-hidden='true']");
        const altText = node.getAttribute("alt")?.trim() || "";
        const srcLower = src.toLowerCase();
        const isDecorativeIcon = /twitter|facebook|instagram|youtube|close|lang|flag|search|arrow|icon|social|\bx\b/i.test(srcLower) || /twitter|facebook|instagram|youtube|tutup|icon|sosial/i.test(altText);

        if (isIconOrSocial && isDecorativeIcon) continue;
        if (seenLink.has(src)) continue;
        seenLink.add(src);

        blocks.push({ type: "image", src, alt: altText });
        continue;
      }

      const items = [...node.children]
        .filter((child) => child.tagName.toLowerCase() === "li")
        .map((child) => child.textContent.trim())
        .filter(Boolean);
      if (items.length) {
        blocks.push({ type: "list", ordered: tag === "ol", items });
      }
    }

    return {
      html: doc.documentElement.outerHTML,
      lang: doc.documentElement.getAttribute("lang") || "id",
      title: doc.title || "",
      blocks,
    };
  }, {
    tags: strippedTags,
    maxCardLevels,
    dangerousAttrs: DANGEROUS_ATTRIBUTES,
    safeSchemes: SAFE_SCHEMES,
    unsafeStyleSource: UNSAFE_STYLE_PATTERN.source,
  });
}

/**
 * Menempelkan CSP dan pemberitahuan ke halaman tertambal secara tahan banting.
 *
 * Menjamin keberadaan CSP dan banner meskipun dokumen asli tidak memiliki
 * tag <head> atau <body> eksplisit (HTML5 mengizinkan tag implisit), atau
 * memiliki variasi huruf kapital dan atribut kompleks.
 */
export function wrapPatchedPage({ html, disclaimer, sourceUrl }) {
  const banner =
    `<div style="background:#ffffff;color:#1a1a1a;border-bottom:3px solid #767676;` +
    `padding:12px 16px;font:16px/1.6 system-ui,sans-serif">` +
    `${escapeHtml(disclaimer)} ` +
    `<a href="${escapeHtml(sourceUrl)}" style="color:#0b3d91">Buka halaman aslinya</a>` +
    `</div>`;

  const headContent =
    `<meta http-equiv="Content-Security-Policy" content="${SNAPSHOT_CSP}"><style>img,svg,video{max-width:100%;height:auto;}body{margin:0;font-family:system-ui,-apple-system,sans-serif;}</style>`;

  // Bersihkan doctype yang sudah ada agar tidak terjadi duplikasi DOCTYPE ganda
  let cleanHtml = String(html || "").replace(/^\s*<!DOCTYPE[^>]*>\s*/i, "");

  const hasHead = /<head\b[^>]*>/i.test(cleanHtml);
  const hasBody = /<body\b[^>]*>/i.test(cleanHtml);
  const hasHtml = /<html\b[^>]*>/i.test(cleanHtml);

  let output = cleanHtml;

  if (hasHead) {
    output = output.replace(/(<head\b[^>]*>)/i, `$1${headContent}`);
  }

  if (hasBody) {
    output = output.replace(/(<body\b[^>]*>)/i, `$1${banner}`);
  }

  if (!hasHead && !hasBody && !hasHtml) {
    output = `<html><head>${headContent}</head><body>${banner}${cleanHtml}</body></html>`;
  } else {
    if (!hasHead) {
      if (hasHtml) {
        output = output.replace(/(<html\b[^>]*>)/i, `$1<head>${headContent}</head>`);
      } else {
        output = `<head>${headContent}</head>${output}`;
      }
    }
    if (!hasBody) {
      if (hasHtml) {
        if (/<\/head>/i.test(output)) {
          output = output.replace(/(<\/head>)/i, `$1<body>${banner}`) + "</body>";
        } else {
          output = output.replace(/(<html\b[^>]*>)/i, `$1<body>${banner}`) + "</body>";
        }
      } else {
        output = `<body>${banner}${output}</body>`;
      }
    }
    if (!hasHtml) {
      output = `<html>${output}</html>`;
    }
  }

  return `<!DOCTYPE html>\n${output}`;
}

/**
 * Menghasilkan halaman tertambal dan reader view dari satu halaman hidup.
 */
export async function serializePage({ page, sourceUrl, siteLabel = null, disclaimer }) {
  const extracted = await extract(page, STRIPPED_TAGS, MAX_CARD_LEVELS);

  // Kandidat tautan kartu diputuskan di sisi Node, bukan di dalam browser.
  const blocks = attachCardLinks(extracted.blocks);

  const patchedPage = wrapPatchedPage({
    html: extracted.html,
    disclaimer,
    sourceUrl,
  });

  const readerView = renderReaderDocument({
    title: extracted.title,
    lang: extracted.lang,
    sourceUrl,
    siteLabel,
    disclaimer,
    blocks,
  });

  return { patchedPage, readerView, blockCount: blocks.length };
}
