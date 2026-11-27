const MAX_PDF_URLS = 10;
const MAX_INTERNAL_URLS = 20;

function emptyDetectorsAndDiscovery() {
  return {
    detectors: {
      overlay: {
        detected: false,
        vendors: [],
        summaryId: null,
      },
      captcha: {
        detected: false,
        types: [],
        inaccessibleCount: 0,
        summaryId: null,
      },
    },
    discoveredPdfUrls: [],
    discoveredInternalUrls: [],
  };
}

/**
 * Detects accessibility overlay theater widgets, inaccessible visual CAPTCHAs,
 * paste-blocked auth inputs, and collects same-origin PDF + internal HTML links.
 */
export async function runDetectorsAndDiscovery(page, baseUrl = "") {
  if (!page || typeof page.evaluate !== "function") {
    return emptyDetectorsAndDiscovery();
  }

  const pageUrl = typeof page.url === "function" ? page.url() : "";
  const effectiveBaseUrl =
    baseUrl || (pageUrl && pageUrl !== "about:blank" ? pageUrl : "");

  try {
    const raw = await page.evaluate(
      ({ baseHref, maxPdfs, maxInternals }) => {
        const VENDOR_RULES = [
          { name: "UserWay", pattern: /userway|cdn\.userway\.org/i },
          { name: "accessiBe", pattern: /accessibe|acsbapp|acsb[-_]/i },
          { name: "EqualWeb", pattern: /equalweb|nagishli/i },
          { name: "AudioEye", pattern: /audioeye/i },
          { name: "OneTap", pattern: /onetap/i },
          { name: "MaxAccess", pattern: /maxaccess/i },
          { name: "ResponsiveVoice", pattern: /responsivevoice/i },
        ];

        const vendors = new Set();
        for (const script of document.querySelectorAll("script[src]")) {
          const src = script.getAttribute("src") || "";
          for (const rule of VENDOR_RULES) {
            if (rule.pattern.test(src)) {
              vendors.add(rule.name);
            }
          }
        }

        const OVERLAY_CANDIDATE_SELECTOR = [
          '[id*="userway" i]',
          '[class*="userway" i]',
          '[id*="accessibe" i]',
          '[class*="accessibe" i]',
          '[id*="acsb" i]',
          '[class*="acsb" i]',
          '[id*="equalweb" i]',
          '[class*="equalweb" i]',
          '[id*="audioeye" i]',
          '[class*="audioeye" i]',
          '[id*="onetap" i]',
          '[class*="onetap" i]',
          '[id*="maxaccess" i]',
          '[class*="maxaccess" i]',
          '[id*="responsivevoice" i]',
          '[class*="responsivevoice" i]',
          '[id*="accessibility-widget" i]',
          '[class*="accessibility-widget" i]',
          '[id*="a11y-widget" i]',
          '[class*="a11y-widget" i]',
        ].join(", ");

        for (const el of document.querySelectorAll(OVERLAY_CANDIDATE_SELECTOR)) {
          const sig = `${el.id || ""} ${el.getAttribute("class") || ""} ${el.getAttribute("aria-label") || ""}`;
          let matchedVendor = false;
          for (const rule of VENDOR_RULES) {
            if (rule.pattern.test(sig)) {
              vendors.add(rule.name);
              matchedVendor = true;
            }
          }
          if (!matchedVendor) {
            vendors.add("Generic Accessibility Toolbar");
          }
        }

        // Visual / interaction CAPTCHA & auth barrier detection
        const captchaTypes = new Set();
        let inaccessibleCount = 0;

        const imgCaptchas = document.querySelectorAll(
          'img[src*="captcha" i], img[alt*="captcha" i]',
        );
        if (imgCaptchas.length > 0) {
          captchaTypes.add("image-captcha");
          inaccessibleCount += imgCaptchas.length;
        }

        const recaptchaNodes = document.querySelectorAll(
          '.g-recaptcha, iframe[src*="recaptcha" i], script[src*="recaptcha" i]',
        );
        if (recaptchaNodes.length > 0) {
          captchaTypes.add("recaptcha-v2");
          const visibleRecaptcha = document.querySelectorAll(
            '.g-recaptcha, iframe[src*="recaptcha" i]',
          ).length;
          inaccessibleCount += Math.max(1, visibleRecaptcha);
        }

        const hcaptchaNodes = document.querySelectorAll(
          '.h-captcha, iframe[src*="hcaptcha.com" i], script[src*="hcaptcha.com" i]',
        );
        if (hcaptchaNodes.length > 0) {
          captchaTypes.add("hcaptcha");
          const visibleHcaptcha = document.querySelectorAll(
            '.h-captcha, iframe[src*="hcaptcha.com" i]',
          ).length;
          inaccessibleCount += Math.max(1, visibleHcaptcha);
        }

        for (const input of document.querySelectorAll("input[onpaste], textarea[onpaste]")) {
          const onpaste = input.getAttribute("onpaste") || "";
          if (/return\s+false|preventDefault/i.test(onpaste)) {
            captchaTypes.add("paste-blocked-auth");
            inaccessibleCount += 1;
          }
        }

        // Same-origin PDF and internal HTML link discovery
        const pdfUrls = [];
        const seenPdfs = new Set();
        const internalUrls = [];
        const seenInternals = new Set();

        let base = null;
        try {
          if (baseHref) base = new URL(baseHref);
        } catch {
          base = null;
        }
        if (!base && document.baseURI && /^https?:/i.test(document.baseURI)) {
          try {
            base = new URL(document.baseURI);
          } catch {
            base = null;
          }
        }

        if (base && (base.protocol === "http:" || base.protocol === "https:")) {
          const normalizedBase = `${base.origin}${base.pathname}${base.search}`;
          const BINARY_EXT =
            /\.(pdf|zip|rar|7z|tar|gz|jpg|jpeg|png|gif|webp|svg|ico|mp4|mp3|avi|mov|webm|doc|docx|xls|xlsx|ppt|pptx)$/i;
          const AUTH_PATH =
            /\/(login|signin|sign-in|logout|signout|sign-out|sso|oauth|auth)\b/i;

          for (const anchor of document.querySelectorAll("a[href]")) {
            const rawHref = (anchor.getAttribute("href") || "").trim();
            if (
              !rawHref ||
              rawHref.startsWith("#") ||
              /^(mailto|tel|javascript|data):/i.test(rawHref)
            ) {
              continue;
            }

            let resolved;
            try {
              resolved = new URL(rawHref, base);
            } catch {
              continue;
            }

            if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
              continue;
            }
            if (resolved.origin !== base.origin) {
              continue;
            }

            resolved.hash = "";
            const cleanUrl = resolved.toString();

            if (/\.pdf$/i.test(resolved.pathname)) {
              if (!seenPdfs.has(cleanUrl) && pdfUrls.length < maxPdfs) {
                seenPdfs.add(cleanUrl);
                pdfUrls.push(cleanUrl);
              }
              continue;
            }

            const targetKey = `${resolved.origin}${resolved.pathname}${resolved.search}`;
            if (targetKey === normalizedBase) continue;
            if (BINARY_EXT.test(resolved.pathname)) continue;
            if (AUTH_PATH.test(resolved.pathname)) continue;

            if (!seenInternals.has(cleanUrl) && internalUrls.length < maxInternals) {
              seenInternals.add(cleanUrl);
              internalUrls.push(cleanUrl);
            }
          }
        }

        return {
          vendorList: Array.from(vendors),
          captchaList: Array.from(captchaTypes),
          inaccessibleCount,
          pdfUrls,
          internalUrls,
        };
      },
      {
        baseHref: effectiveBaseUrl,
        maxPdfs: MAX_PDF_URLS,
        maxInternals: MAX_INTERNAL_URLS,
      },
    );

    const vendorList = raw?.vendorList ?? [];
    const captchaList = raw?.captchaList ?? [];
    const inaccessibleCount = Number(raw?.inaccessibleCount) || 0;

    return {
      detectors: {
        overlay: {
          detected: vendorList.length > 0,
          vendors: vendorList,
          summaryId:
            vendorList.length > 0
              ? `Terdeteksi widget overlay aksesibilitas (${vendorList.join(", ")}) yang tidak menggantikan perbaikan aksesibilitas pada kode sumber.`
              : null,
        },
        captcha: {
          detected: captchaList.length > 0,
          types: captchaList,
          inaccessibleCount,
          summaryId:
            captchaList.length > 0
              ? `Terdeteksi mekanisme CAPTCHA atau pembatasan tempel (${captchaList.join(", ")}) yang berisiko menghalangi pembaca layar dan pengelola kata sandi.`
              : null,
        },
      },
      discoveredPdfUrls: raw?.pdfUrls ?? [],
      discoveredInternalUrls: raw?.internalUrls ?? [],
    };
  } catch {
    return emptyDetectorsAndDiscovery();
  }
}
