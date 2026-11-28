/**
 * Resolver color-contrast berbasis OKLCH dengan konsistensi warna tingkat halaman.
 *
 * Prinsip:
 * - Hanya mengubah warna teks (foreground) pada latar belakang solid yang terverifikasi.
 * - Mengelompokkan elemen dengan warna teks asal dan polaritas latar yang sama
 *   (${fgHex}::light | ${fgHex}::dark) agar seluruh elemen dalam klaster mendapat
 *   satu warna target hex yang identik.
 * - Menggunakan ruang warna OKLCH (Björn Ottosson) untuk menjaga Hue (h) dan
 *   mempertahankan Chroma (c) semaksimal mungkin dalam gamut sRGB saat
 *   menyesuaikan Lightness (l).
 */

const LIGHT_SURFACE_LUMINANCE = 0.18;
const AXE_COMPLEX_BG_RE =
  /gradient|image|bgImage|bgGradient|overlap|pseudo|bgOverlap|pseudoContent/i;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampByte(value) {
  return Math.round(clamp(value, 0, 255));
}

function parseChannelValue(raw) {
  const token = String(raw || "").trim();
  if (!token) return null;
  if (token.endsWith("%")) {
    const pct = Number.parseFloat(token.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return clamp((pct / 100) * 255, 0, 255);
  }
  const num = Number.parseFloat(token);
  if (!Number.isFinite(num)) return null;
  return clamp(num, 0, 255);
}

function parseAlphaValue(raw) {
  if (raw === undefined || raw === null || raw === "") return 1;
  const token = String(raw).trim();
  if (token.endsWith("%")) {
    const pct = Number.parseFloat(token.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return clamp(pct / 100, 0, 1);
  }
  const num = Number.parseFloat(token);
  if (!Number.isFinite(num)) return null;
  return clamp(num, 0, 1);
}

/**
 * Parse a CSS color string (#rgb, #rgba, #rrggbb, #rrggbbaa, rgb(...), rgba(...)).
 * Returns { r, g, b, a } or null if unparseable.
 */
export function parseCssColor(str) {
  if (typeof str !== "string") return null;
  const input = str.trim();
  if (!input) return null;

  if (input.toLowerCase() === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  if (input.startsWith("#")) {
    const hex = input.slice(1);
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (/^[0-9a-f]{4}$/i.test(hex)) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
        a: Number.parseInt(hex[3] + hex[3], 16) / 255,
      };
    }
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    if (/^[0-9a-f]{8}$/i.test(hex)) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: Number.parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
    return null;
  }

  const rgbMatch = input.match(/^rgba?\(\s*([^)]+)\s*\)$/i);
  if (!rgbMatch) return null;

  const body = rgbMatch[1].trim();
  let parts;
  let alphaToken;

  if (body.includes(",")) {
    parts = body.split(",").map((p) => p.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    alphaToken = parts.length === 4 ? parts[3] : undefined;
  } else {
    const slashIdx = body.indexOf("/");
    const colorPart = slashIdx >= 0 ? body.slice(0, slashIdx).trim() : body;
    alphaToken = slashIdx >= 0 ? body.slice(slashIdx + 1).trim() : undefined;
    parts = colorPart.split(/\s+/).filter(Boolean);
    if (parts.length !== 3) return null;
  }

  const r = parseChannelValue(parts[0]);
  const g = parseChannelValue(parts[1]);
  const b = parseChannelValue(parts[2]);
  const a = parseAlphaValue(alphaToken);
  if (r === null || g === null || b === null || a === null) return null;

  return {
    r: clampByte(r),
    g: clampByte(g),
    b: clampByte(b),
    a,
  };
}

/**
 * Format an RGB object as lowercase #rrggbb hex string.
 */
export function rgbToHex({ r, g, b }) {
  const toHex = (v) => clampByte(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function srgbChannelToLinear(channel255) {
  const c = clamp(channel255, 0, 255) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgbChannel(cLin) {
  const c = clamp(cLin, 0, 1);
  const encoded =
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return clampByte(encoded * 255);
}

function normalizeRgbInput(color) {
  if (typeof color === "string") return parseCssColor(color);
  if (
    color &&
    typeof color === "object" &&
    Number.isFinite(color.r) &&
    Number.isFinite(color.g) &&
    Number.isFinite(color.b)
  ) {
    return color;
  }
  return null;
}

/**
 * WCAG 2.x relative luminance for an sRGB color ({ r, g, b } in 0..255).
 */
export function relativeLuminance(rgb) {
  const normalized = normalizeRgbInput(rgb);
  if (!normalized) return 0;
  const r = srgbChannelToLinear(normalized.r);
  const g = srgbChannelToLinear(normalized.g);
  const b = srgbChannelToLinear(normalized.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.x contrast ratio between foreground and background sRGB colors.
 */
export function contrastRatio(fgRgb, bgRgb) {
  const l1 = relativeLuminance(fgRgb);
  const l2 = relativeLuminance(bgRgb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Convert sRGB ({ r, g, b } in 0..255) to OKLCH ({ l, c, h }) using
 * Björn Ottosson's exact sRGB <-> OKLab matrices.
 */
export function srgbToOklch(rgb) {
  const normalized = normalizeRgbInput(rgb);
  if (!normalized) return { l: 0, c: 0, h: 0 };

  const r = srgbChannelToLinear(normalized.r);
  const g = srgbChannelToLinear(normalized.g);
  const b = srgbChannelToLinear(normalized.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.hypot(a, b_);
  let h = (Math.atan2(b_, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  if (c < 1e-7) h = 0;

  return { l: L, c, h };
}

function oklchToLinearSrgb(L, C, H) {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b_ = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b_;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b_;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b_;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function isInLinearSrgbGamut({ r, g, b }, eps = 1e-6) {
  return (
    r >= -eps &&
    r <= 1 + eps &&
    g >= -eps &&
    g <= 1 + eps &&
    b >= -eps &&
    b <= 1 + eps
  );
}

/**
 * Convert OKLCH ({ l, c, h }) to sRGB ({ r, g, b } in 0..255) with
 * gamut-safe chroma clamping (preserves Lightness and Hue).
 */
export function oklchToSrgb({ l, c, h }) {
  const L = clamp(Number.isFinite(l) ? l : 0, 0, 1);
  const C = Math.max(0, Number.isFinite(c) ? c : 0);
  const H = Number.isFinite(h) ? h : 0;

  if (L <= 0) return { r: 0, g: 0, b: 0 };
  if (L >= 1) return { r: 255, g: 255, b: 255 };

  let lin = oklchToLinearSrgb(L, C, H);
  if (!isInLinearSrgbGamut(lin)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const probe = oklchToLinearSrgb(L, mid, H);
      if (isInLinearSrgbGamut(probe)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    lin = oklchToLinearSrgb(L, lo, H);
  }

  return {
    r: linearToSrgbChannel(lin.r),
    g: linearToSrgbChannel(lin.g),
    b: linearToSrgbChannel(lin.b),
  };
}

/**
 * Find one canonical foreground hex color that preserves Hue (h) and keeps
 * Chroma (c) as close as possible while satisfying contrastRatio >= targetRatio
 * against EVERY background in bgHexList.
 */
export function findConsistentContrastColor(
  fgHex,
  bgHexList,
  targetRatio = 4.6,
) {
  const fgRgb = parseCssColor(fgHex);
  if (!fgRgb || !Array.isArray(bgHexList) || bgHexList.length === 0) {
    return null;
  }

  const bgRgbs = bgHexList.map(parseCssColor);
  if (bgRgbs.some((bg) => !bg)) {
    return null;
  }

  const minContrastFor = (rgb) => {
    let min = Infinity;
    for (const bg of bgRgbs) {
      const ratio = contrastRatio(rgb, bg);
      if (ratio < min) min = ratio;
    }
    return min;
  };

  const { l: origL, c: origC, h: origH } = srgbToOklch(fgRgb);
  const origRatio = minContrastFor(fgRgb);
  if (origRatio >= targetRatio) {
    return {
      hex: rgbToHex(fgRgb),
      minRatio: origRatio,
      deltaL: 0,
    };
  }

  const avgBgLum =
    bgRgbs.reduce((sum, bg) => sum + relativeLuminance(bg), 0) / bgRgbs.length;
  const goDarker = avgBgLum >= LIGHT_SURFACE_LUMINANCE;

  if (goDarker) {
    const blackRgb = { r: 0, g: 0, b: 0 };
    if (minContrastFor(blackRgb) < targetRatio) {
      return null;
    }

    let lo = 0;
    let hi = origL;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      const candRgb = oklchToSrgb({ l: mid, c: origC, h: origH });
      if (minContrastFor(candRgb) >= targetRatio) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const bestRgb = oklchToSrgb({ l: lo, c: origC, h: origH });
    const minRatio = minContrastFor(bestRgb);
    if (minRatio < targetRatio) return null;

    return {
      hex: rgbToHex(bestRgb),
      minRatio,
      deltaL: lo - origL,
    };
  }

  const whiteRgb = { r: 255, g: 255, b: 255 };
  if (minContrastFor(whiteRgb) < targetRatio) {
    return null;
  }

  let lo = origL;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const candRgb = oklchToSrgb({ l: mid, c: origC, h: origH });
    if (minContrastFor(candRgb) >= targetRatio) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const bestRgb = oklchToSrgb({ l: hi, c: origC, h: origH });
  const minRatio = minContrastFor(bestRgb);
  if (minRatio < targetRatio) return null;

  return {
    hex: rgbToHex(bestRgb),
    minRatio,
    deltaL: hi - origL,
  };
}

function parseExpectedRatio(expected) {
  if (typeof expected === "number" && Number.isFinite(expected)) {
    return expected;
  }
  const match = String(expected || "").match(/(\d+(?:\.\d+)?)/);
  if (match) {
    const parsed = Number.parseFloat(match[1]);
    if (Number.isFinite(parsed) && parsed > 1) return parsed;
  }
  return 4.5;
}

function safeTargetRatio(expected) {
  const parsed = parseExpectedRatio(expected);
  if (parsed <= 3.05) return 3.2;
  if (parsed <= 4.55) return 4.75;
  return Math.ceil((parsed + 0.25) * 10) / 10;
}

function buildAxeNodeMap(axeResult) {
  const map = new Map();
  const violation = axeResult?.violations?.find(
    (v) => v?.id === "color-contrast",
  );
  for (const node of violation?.nodes ?? []) {
    if (Array.isArray(node?.target) && node.target.length === 1) {
      const sel = String(node.target[0]);
      if (!map.has(sel)) {
        map.set(sel, node);
      }
    }
  }
  return map;
}

function makeReviewCandidate(selector, fingerprint, source, reason) {
  return {
    rule: "color-contrast",
    selector,
    fingerprint: fingerprint || null,
    confidence: 0.55,
    status: "review",
    source,
    reason,
    patches: [],
  };
}

function makeSkipCandidate(selector, source, reason) {
  return {
    rule: "color-contrast",
    selector,
    confidence: 0,
    source,
    reason,
    patches: [],
  };
}

/**
 * Resolve page-wide consistent OKLCH foreground color contrast candidates.
 */
export async function resolveColorContrastCandidates(
  page,
  selectors = [],
  config = {},
  axeResult = null,
) {
  if (!Array.isArray(selectors) || selectors.length === 0) {
    return [];
  }

  const axeNodeMap = buildAxeNodeMap(axeResult);
  const items = selectors.map((selector) => {
    const node = axeNodeMap.get(selector);
    const check =
      node?.any?.find((c) => c?.id === "color-contrast") ||
      node?.any?.[0] ||
      null;
    const data = check?.data || {};
    const axeMessage = [check?.message, node?.failureSummary, data?.messageKey]
      .filter(Boolean)
      .join(" ");

    return {
      selector,
      fgColor: data.fgColor ?? null,
      bgColor: data.bgColor ?? null,
      contrastRatio: data.contrastRatio ?? null,
      expectedContrastRatio: data.expectedContrastRatio ?? "4.5:1",
      fontSize: data.fontSize ?? null,
      fontWeight: data.fontWeight ?? null,
      axeMessage,
    };
  });

  const domInspections = await page.evaluate((selectorsToInspect) => {
    const parseColorAlpha = (raw) => {
      if (!raw || raw === "transparent") return 0;
      const m = raw.match(
        /rgba?\(\s*[\d.]+\s*[,\s]\s*[\d.]+\s*[,\s]\s*[\d.]+(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i,
      );
      if (!m) return 0;
      if (m[1] === undefined) return 1;
      return m[1].endsWith("%")
        ? Number.parseFloat(m[1]) / 100
        : Number.parseFloat(m[1]);
    };

    const queryUniqueElement = (selector) => {
      let matches = [];
      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch {
        try {
          const sanitized = selector.replace(
            /([#.])([0-9]|[^a-zA-Z0-9_\-\\])/g,
            "$1\\$2",
          );
          matches = Array.from(document.querySelectorAll(sanitized));
        } catch {
          return { element: null, matchCount: 0, invalid: true };
        }
      }
      if (matches.length !== 1) {
        return { element: null, matchCount: matches.length, invalid: false };
      }
      return { element: matches[0], matchCount: 1, invalid: false };
    };

    const makeFingerprint = (element) => {
      const tag = element.tagName ? element.tagName.toLowerCase() : "";
      const role = element.getAttribute("role");
      const id = element.getAttribute("id");
      const className = element.getAttribute("class") || "";
      const classes = className.split(/\s+/).filter(Boolean);
      const parent = element.parentElement;
      const parentTag = parent?.tagName ? parent.tagName.toLowerCase() : null;
      const parentClass = parent?.getAttribute
        ? parent.getAttribute("class") || null
        : null;
      const textSnippet = (element.textContent || "").trim().slice(0, 30);
      return {
        tag,
        role,
        id,
        classes,
        parentTag,
        parentClass,
        textSnippet,
      };
    };

    return selectorsToInspect.map((selector) => {
      const { element, matchCount, invalid } = queryUniqueElement(selector);
      if (!element) {
        return {
          selector,
          found: false,
          matchCount,
          invalid,
        };
      }

      const fingerprint = makeFingerprint(element);
      const insideGraphics = Boolean(element.closest("svg, canvas"));

      let hasTranslucentOpacity = false;
      let opCur = element;
      while (opCur && opCur.nodeType === 1) {
        const op = Number.parseFloat(
          window.getComputedStyle(opCur).opacity || "1",
        );
        if (Number.isFinite(op) && op < 0.99) {
          hasTranslucentOpacity = true;
          break;
        }
        opCur = opCur.parentElement;
      }

      let hasBgImage = false;
      let bgImageKind = "";
      let hasTranslucentBgLayer = false;
      let liveOpaqueBgColor = null;
      let cur = element;
      while (cur && cur.nodeType === 1) {
        const cs = window.getComputedStyle(cur);
        const bgImage = cs.backgroundImage || "none";
        if (bgImage !== "none") {
          hasBgImage = true;
          bgImageKind = bgImage.includes("gradient") ? "gradient" : "image";
          break;
        }
        const bgCol = cs.backgroundColor || "";
        const bgAlpha = parseColorAlpha(bgCol);
        const opacity = Number.parseFloat(cs.opacity || "1");
        if (bgAlpha > 0.01 && bgAlpha < 0.99) {
          hasTranslucentBgLayer = true;
        }
        if (bgAlpha >= 0.99 && opacity >= 0.99) {
          if (!hasTranslucentBgLayer) {
            liveOpaqueBgColor = bgCol;
          }
          break;
        }
        cur = cur.parentElement;
      }

      return {
        selector,
        found: true,
        fingerprint,
        insideGraphics,
        hasTranslucentOpacity,
        hasBgImage,
        bgImageKind,
        liveOpaqueBgColor,
      };
    });
  }, selectors);

  const inspectionBySelector = new Map(
    domInspections.map((entry) => [entry.selector, entry]),
  );

  const candidatesByIndex = new Array(items.length);
  const clusters = new Map();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const dom = inspectionBySelector.get(item.selector);

    if (!dom || !dom.found) {
      candidatesByIndex[i] = makeSkipCandidate(
        item.selector,
        dom?.invalid ? "invalid-selector" : "selector-not-unique",
        dom?.invalid
          ? "Selector tidak dapat dievaluasi"
          : `Selector cocok dengan ${dom?.matchCount ?? 0} elemen`,
      );
      continue;
    }

    if (AXE_COMPLEX_BG_RE.test(item.axeMessage)) {
      candidatesByIndex[i] = makeReviewCandidate(
        item.selector,
        dom.fingerprint,
        "complex-background-axe",
        "Kontras warna tidak diperbaiki otomatis karena latar belakang terdeteksi menggunakan gradien, gambar, tumpukan elemen, atau pseudo-element; perlu verifikasi manual.",
      );
      continue;
    }

    if (dom.insideGraphics) {
      candidatesByIndex[i] = makeReviewCandidate(
        item.selector,
        dom.fingerprint,
        "graphics-element",
        "Elemen berada di dalam <svg> atau <canvas> sehingga penyesuaian kontras perlu diperiksa secara manual.",
      );
      continue;
    }

    if (dom.hasTranslucentOpacity) {
      candidatesByIndex[i] = makeReviewCandidate(
        item.selector,
        dom.fingerprint,
        "translucent-opacity",
        "Elemen atau leluhurnya memiliki opacity < 1 (transparan/sedang transisi), sehingga kontras tidak diubah otomatis dan perlu tinjauan manual.",
      );
      continue;
    }

    if (dom.hasBgImage) {
      candidatesByIndex[i] = makeReviewCandidate(
        item.selector,
        dom.fingerprint,
        "non-solid-background",
        "Latar belakang elemen atau leluhurnya memakai gradien atau gambar (non-solid), sehingga kontras tidak diubah otomatis dan perlu tinjauan manual.",
      );
      continue;
    }

    const fgRgb = parseCssColor(item.fgColor);
    const bgRgb = parseCssColor(item.bgColor);
    if (
      !fgRgb ||
      !bgRgb ||
      fgRgb.a <= 0.01 ||
      bgRgb.a <= 0.01 ||
      bgRgb.a < 0.99
    ) {
      candidatesByIndex[i] = makeReviewCandidate(
        item.selector,
        dom.fingerprint,
        "missing-or-transparent-color",
        "Warna teks atau latar belakang tidak solid atau tidak terbaca lengkap oleh axe, sehingga perlu verifikasi kontras manual.",
      );
      continue;
    }

    const fgHex = rgbToHex(fgRgb);
    const bgHex = rgbToHex(bgRgb);
    const bgLum = relativeLuminance(bgRgb);
    const surfacePolarity =
      bgLum >= LIGHT_SURFACE_LUMINANCE ? "light" : "dark";
    const clusterKey = `${fgHex}::${surfacePolarity}`;
    const targetRatio = safeTargetRatio(item.expectedContrastRatio);

    const extraBgs = [bgHex];
    if (dom.liveOpaqueBgColor) {
      const liveBgRgb = parseCssColor(dom.liveOpaqueBgColor);
      if (liveBgRgb && liveBgRgb.a >= 0.99) {
        const liveBgPolarity =
          relativeLuminance(liveBgRgb) >= LIGHT_SURFACE_LUMINANCE
            ? "light"
            : "dark";
        if (liveBgPolarity === surfacePolarity) {
          extraBgs.push(rgbToHex(liveBgRgb));
        }
      }
    }

    if (!clusters.has(clusterKey)) {
      clusters.set(clusterKey, {
        fgHex,
        surfacePolarity,
        nodes: [],
      });
    }

    clusters.get(clusterKey).nodes.push({
      index: i,
      selector: item.selector,
      fingerprint: dom.fingerprint,
      bgHex,
      extraBgs,
      targetRatio,
    });
  }

  for (const cluster of clusters.values()) {
    const uniqueClusterBgs = [
      ...new Set(cluster.nodes.flatMap((n) => n.extraBgs || [n.bgHex])),
    ];
    const maxClusterTargetRatio = Math.max(
      ...cluster.nodes.map((n) => n.targetRatio),
    );

    const solved = findConsistentContrastColor(
      cluster.fgHex,
      uniqueClusterBgs,
      maxClusterTargetRatio,
    );

    for (const node of cluster.nodes) {
      if (solved) {
        candidatesByIndex[node.index] = {
          rule: "color-contrast",
          selector: node.selector,
          fingerprint: node.fingerprint,
          confidence: 0.9,
          source: "oklch-contrast-cluster",
          reason: `Menyesuaikan warna teks ${cluster.fgHex} -> ${solved.hex} (rasio minimum ${solved.minRatio.toFixed(2)}:1, target ${maxClusterTargetRatio}:1)`,
          patches: [{ styleProperty: "color", value: solved.hex }],
        };
      } else {
        candidatesByIndex[node.index] = makeReviewCandidate(
          node.selector,
          node.fingerprint,
          "contrast-unsolvable-cluster",
          `Tidak ditemukan warna teks dari ${cluster.fgHex} yang memenuhi rasio kontras ${maxClusterTargetRatio}:1 pada latar belakang klaster ini; perlu penyesuaian manual.`,
        );
      }
    }
  }

  return candidatesByIndex.filter(Boolean);
}
