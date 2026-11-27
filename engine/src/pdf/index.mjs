import dns from "node:dns/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  checkResolvedAddresses,
  checkUrl,
  MAX_REDIRECTS,
} from "../fetcher/url-policy.mjs";
import { isSameHostOrWww } from "../guard/index.mjs";
import { isTransientNetworkError, withExponentialBackoff } from "../shared/retry.mjs";

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
).href;

const MAX_SAMPLE_PAGES = 5;
const DEFAULT_MAX_PDFS = 5;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const PDF_USER_AGENT = "AksaraNetra-Accessibility/0.3";

async function defaultResolveHost(hostname, { sleep } = {}) {
  return withExponentialBackoff(
    async () => {
      const records = await dns.lookup(hostname, { all: true });
      return records.map((record) => record.address);
    },
    { sleep, isRetryable: isTransientNetworkError },
  );
}

function filenameFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const segment = parsed.pathname.split("/").filter(Boolean).pop() || "document.pdf";
    return decodeURIComponent(segment);
  } catch {
    return "document.pdf";
  }
}

function normalizePdfUrls(pdfUrls = [], baseUrl = null) {
  const seen = new Set();
  const normalized = [];

  for (const raw of Array.isArray(pdfUrls) ? pdfUrls : []) {
    const candidate = String(raw ?? "").trim();
    if (!candidate) continue;

    let resolved = candidate;
    try {
      const parsed = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
      parsed.hash = "";
      resolved = parsed.toString();
    } catch {
      resolved = candidate;
    }

    if (seen.has(resolved)) continue;
    seen.add(resolved);
    normalized.push(resolved);
  }

  return normalized;
}

function combineSignals(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  return signal;
}

async function readBoundedBody(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`PDF exceeds maxBytes limit (${contentLength} > ${maxBytes})`);
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(`PDF exceeds maxBytes limit (${buffer.byteLength} > ${maxBytes})`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`PDF exceeds maxBytes limit (${total} > ${maxBytes})`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function verifyPdfTarget({
  url,
  baseHostname = null,
  resolveHost,
}) {
  const urlVerdict = checkUrl(url);
  if (!urlVerdict.ok) {
    return {
      ok: false,
      reason: `SSRF check rejected URL (${urlVerdict.code}): ${urlVerdict.message}`,
    };
  }

  if (baseHostname && !isSameHostOrWww(urlVerdict.hostname, baseHostname)) {
    return {
      ok: false,
      reason: `Cross-origin PDF URL rejected (${urlVerdict.hostname} != ${baseHostname})`,
    };
  }

  let addresses;
  try {
    addresses = await resolveHost(urlVerdict.hostname);
  } catch (error) {
    return {
      ok: false,
      reason: `DNS lookup failed for PDF host ${urlVerdict.hostname}: ${error?.message || error}`,
    };
  }

  const resolvedVerdict = checkResolvedAddresses(addresses);
  if (!resolvedVerdict.ok) {
    return {
      ok: false,
      reason: `SSRF DNS check rejected IP (${resolvedVerdict.code}): ${resolvedVerdict.message}`,
    };
  }

  return { ok: true, url: urlVerdict.url, hostname: urlVerdict.hostname };
}

async function defaultFetchPdf({
  url,
  baseHostname = null,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal = null,
  resolveHost = defaultResolveHost,
}) {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const verdict = await verifyPdfTarget({
      url: current,
      baseHostname,
      resolveHost,
    });
    if (!verdict.ok) {
      throw new Error(verdict.reason);
    }

    const response = await fetch(verdict.url, {
      headers: { "user-agent": PDF_USER_AGENT },
      redirect: "manual",
      signal: combineSignals(signal, timeoutMs),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`HTTP ${response.status} redirect missing Location`);
      }
      if (hop === MAX_REDIRECTS) {
        throw new Error(`PDF redirect exceeded ${MAX_REDIRECTS} hops`);
      }
      current = new URL(location, verdict.url).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return readBoundedBody(response, maxBytes);
  }

  throw new Error("PDF fetch did not complete");
}

function toUint8Array(payload) {
  if (!payload) return new Uint8Array(0);
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  if (payload.data) return toUint8Array(payload.data);
  throw new Error("Unsupported PDF payload type");
}

function errorItem(url, message) {
  return {
    url,
    filename: filenameFromUrl(url),
    sizeBytes: 0,
    pageCount: 0,
    isTagged: false,
    hasTextLayer: false,
    hasTitle: false,
    hasLang: false,
    status: "error",
    error: String(message || "PDF audit failed"),
  };
}

/**
 * Pure-JS PDF accessibility pre-auditor.
 *
 * Verifies every URL and resolved DNS IP against SSRF rules before fetching,
 * bounds payload bytes and timeout, samples up to 5 pages for text/tags, and
 * always destroys the PDF document handle in finally.
 */
export async function auditDiscoveredPdfs({
  pdfUrls = [],
  baseUrl = null,
  deps = {},
  signal = null,
  maxPdfs = DEFAULT_MAX_PDFS,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const uniqueUrls = normalizePdfUrls(pdfUrls, baseUrl);
  const discoveredCount = uniqueUrls.length;
  const boundedMax = Math.max(0, Math.min(Number(maxPdfs) || DEFAULT_MAX_PDFS, 20));
  const targetUrls = uniqueUrls.slice(0, boundedMax);

  if (targetUrls.length === 0) {
    return {
      discoveredCount,
      auditedCount: 0,
      scannedImageCount: 0,
      untaggedCount: 0,
      items: [],
    };
  }

  let baseHostname = null;
  if (baseUrl) {
    const baseCheck = checkUrl(baseUrl);
    if (!baseCheck.ok) {
      return {
        discoveredCount,
        auditedCount: 0,
        scannedImageCount: 0,
        untaggedCount: 0,
        items: targetUrls.map((url) =>
          errorItem(url, `Invalid baseUrl (${baseCheck.code}): ${baseCheck.message}`),
        ),
      };
    }
    baseHostname = baseCheck.hostname;
  }

  const resolveHost = deps.resolveHost || defaultResolveHost;
  const fetchPdf = deps.fetchPdf || defaultFetchPdf;
  const getDoc = deps.getDocument || getDocument;

  const items = [];

  for (const targetUrl of targetUrls) {
    signal?.throwIfAborted();

    const preflight = await verifyPdfTarget({
      url: targetUrl,
      baseHostname,
      resolveHost,
    });
    if (!preflight.ok) {
      items.push(errorItem(targetUrl, preflight.reason));
      continue;
    }

    let rawData;
    try {
      const fetched = await fetchPdf({
        url: preflight.url,
        baseHostname,
        maxBytes,
        timeoutMs,
        signal,
        resolveHost,
      });
      rawData = toUint8Array(fetched);
      if (rawData.byteLength === 0) {
        throw new Error("Empty PDF response");
      }
      if (rawData.byteLength > maxBytes) {
        throw new Error(`PDF exceeds maxBytes limit (${rawData.byteLength} > ${maxBytes})`);
      }
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      items.push(errorItem(targetUrl, error?.message || String(error)));
      continue;
    }

    let loadingTask = null;
    let pdfDoc = null;
    try {
      loadingTask = getDoc({
        data: rawData,
        verbosity: 0,
        isEvalSupported: false,
        disableFontFace: true,
      });
      pdfDoc = await loadingTask.promise;

      const pageCount = Number(pdfDoc?.numPages) || 0;
      const markInfo = await pdfDoc.getMarkInfo?.().catch(() => null);
      const metaResult = await pdfDoc.getMetadata?.().catch(() => null);

      const info = metaResult?.info || {};
      const xmp = metaResult?.metadata || null;

      const title = String(
        info.Title || (typeof xmp?.get === "function" ? xmp.get("dc:title") : "") || "",
      ).trim();
      const lang = String(
        info.Language || (typeof xmp?.get === "function" ? xmp.get("dc:language") : "") || "",
      ).trim();

      let hasStructTree = false;
      let textChars = 0;
      const sampleCount = Math.min(pageCount, MAX_SAMPLE_PAGES);

      for (let pageNumber = 1; pageNumber <= sampleCount; pageNumber += 1) {
        signal?.throwIfAborted();
        const page = await pdfDoc.getPage(pageNumber);
        try {
          if (!hasStructTree && typeof page?.getStructTree === "function") {
            const tree = await page.getStructTree().catch(() => null);
            if (
              tree &&
              (Array.isArray(tree.children) ? tree.children.length > 0 : Boolean(tree.role))
            ) {
              hasStructTree = true;
            }
          }

          const textContent = await page?.getTextContent?.().catch(() => null);
          for (const textItem of textContent?.items || []) {
            const snippet = String(textItem?.str || "").trim();
            if (snippet) textChars += snippet.length;
          }
        } finally {
          page?.cleanup?.();
        }
      }

      const isTagged = Boolean(markInfo?.Marked) || hasStructTree;
      const hasTextLayer = textChars > 0;
      const status = !hasTextLayer
        ? "scanned-image-only"
        : isTagged
          ? "accessible-basics"
          : "untagged";

      items.push({
        url: targetUrl,
        filename: filenameFromUrl(targetUrl),
        sizeBytes: rawData.byteLength,
        pageCount,
        isTagged,
        hasTextLayer,
        hasTitle: title.length > 0,
        hasLang: lang.length > 0,
        status,
        error: null,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      items.push(errorItem(targetUrl, error?.message || String(error)));
    } finally {
      await pdfDoc?.destroy?.().catch(() => {});
      await loadingTask?.destroy?.().catch(() => {});
    }
  }

  const auditedItems = items.filter((item) => item.status !== "error");
  return {
    discoveredCount,
    auditedCount: auditedItems.length,
    scannedImageCount: auditedItems.filter((item) => item.status === "scanned-image-only").length,
    untaggedCount: auditedItems.filter((item) => !item.isTagged).length,
    items,
  };
}
