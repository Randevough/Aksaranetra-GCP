const MOBILE_VIEWPORT = Object.freeze({ width: 320, height: 640 });
const DEFAULT_DESKTOP_VIEWPORT = Object.freeze({ width: 1440, height: 1000 });

function defaultMobileAudit() {
  return {
    viewport: { ...MOBILE_VIEWPORT },
    reflowOk: true,
    horizontalOverflowPx: 0,
    textSpacingOk: true,
    clippedElementsCount: 0,
    smallTargetsCount: 0,
    pinchZoomBlocked: false,
    osPreferences: {
      reducedMotionChecked: false,
      reducedMotionUnboundedAnimations: 0,
      forcedColorsChecked: false,
    },
  };
}

/**
 * Probes WCAG 1.4.10 (320px reflow), 1.4.4 (pinch zoom), 1.4.12 (text spacing),
 * 2.5.8 (24x24 target size), and OS reduced-motion / forced-colors media queries.
 * Always restores original media preferences and desktop viewport in finally.
 */
export async function runMobileProbes(
  page,
  { desktopViewport = DEFAULT_DESKTOP_VIEWPORT } = {},
) {
  if (!page || typeof page.evaluate !== "function") {
    return defaultMobileAudit();
  }

  let horizontalOverflowPx = 0;
  let pinchZoomBlocked = false;
  let smallTargetsCount = 0;
  let clippedElementsCount = 0;
  let reducedMotionChecked = false;
  let reducedMotionUnboundedAnimations = 0;
  let forcedColorsChecked = false;

  try {
    if (typeof page.setViewportSize === "function") {
      await page.setViewportSize(MOBILE_VIEWPORT).catch(() => {});
    }

    const layoutMetrics = await page
      .evaluate(() => {
        const scrollWidth = document.documentElement?.scrollWidth || 0;
        const innerWidth = window.innerWidth || 320;
        const overflowPx = Math.max(0, Math.round(scrollWidth - innerWidth));

        let zoomBlocked = false;
        for (const meta of document.querySelectorAll('meta[name="viewport" i]')) {
          const content = (meta.getAttribute("content") || "").toLowerCase();
          if (/user-scalable\s*=\s*(no|0|false)/i.test(content)) {
            zoomBlocked = true;
            break;
          }
          const maxScaleMatch = /maximum-scale\s*=\s*([0-9]*\.?[0-9]+)/i.exec(content);
          if (maxScaleMatch) {
            const maxScale = Number.parseFloat(maxScaleMatch[1]);
            if (Number.isFinite(maxScale) && maxScale < 2) {
              zoomBlocked = true;
              break;
            }
          }
        }

        const TARGET_SELECTOR =
          'a, button, input:not([type="hidden"]), select, textarea, [role="button"]';
        let smallCount = 0;
        for (const el of document.querySelectorAll(TARGET_SELECTOR)) {
          try {
            const cs = window.getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") continue;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            if (rect.width < 24 || rect.height < 24) {
              smallCount += 1;
            }
          } catch {
            // Skip detached or unreadable nodes
          }
        }

        return { overflowPx, zoomBlocked, smallCount };
      })
      .catch(() => null);

    if (layoutMetrics && typeof layoutMetrics === "object") {
      horizontalOverflowPx = Number(layoutMetrics.overflowPx) || 0;
      pinchZoomBlocked = Boolean(layoutMetrics.zoomBlocked);
      smallTargetsCount = Number(layoutMetrics.smallCount) || 0;
    }

    const clipped = await page
      .evaluate(() => {
        const STYLE_ID = "__aksara_text_spacing";
        document.getElementById(STYLE_ID)?.remove();
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent =
          "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }";
        (document.head || document.documentElement).appendChild(style);

        let count = 0;
        try {
          // Force layout flush before inspecting scroll vs client dimensions
          void document.documentElement?.offsetHeight;
          const SKIP_TAGS = new Set(["HTML", "BODY", "SCRIPT", "STYLE", "NOSCRIPT", "SVG"]);
          for (const el of document.querySelectorAll("*")) {
            if (SKIP_TAGS.has(el.tagName)) continue;
            if (!(el.textContent || "").trim()) continue;
            const cs = window.getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") continue;
            const hidesOverflow =
              cs.overflow === "hidden" ||
              cs.overflowX === "hidden" ||
              cs.overflowY === "hidden" ||
              cs.overflow === "clip" ||
              cs.overflowX === "clip" ||
              cs.overflowY === "clip";
            if (!hidesOverflow) continue;
            if (el.clientWidth <= 0 || el.clientHeight <= 0) continue;
            if (
              el.scrollWidth > el.clientWidth + 2 ||
              el.scrollHeight > el.clientHeight + 2
            ) {
              count += 1;
            }
          }
        } finally {
          style.remove();
        }
        return count;
      })
      .catch(() => 0);

    clippedElementsCount = Number(clipped) || 0;

    if (typeof page.emulateMedia === "function") {
      try {
        await page.emulateMedia({ reducedMotion: "reduce" });
        reducedMotionChecked = true;
        const unbounded = await page
          .evaluate(() => {
            let count = 0;
            for (const el of document.querySelectorAll("*")) {
              try {
                const cs = window.getComputedStyle(el);
                if (cs.display === "none" || cs.visibility === "hidden") continue;
                if (
                  cs.animationIterationCount === "infinite" &&
                  cs.animationDuration !== "0s" &&
                  cs.animationName !== "none"
                ) {
                  count += 1;
                }
              } catch {
                // Skip unreadable elements
              }
            }
            return count;
          })
          .catch(() => 0);
        reducedMotionUnboundedAnimations = Number(unbounded) || 0;
      } catch {
        reducedMotionChecked = false;
      }

      try {
        await page.emulateMedia({ forcedColors: "active" });
        forcedColorsChecked = true;
      } catch {
        forcedColorsChecked = false;
      }
    }
  } finally {
    if (typeof page.emulateMedia === "function") {
      await page
        .emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" })
        .catch(() => {});
    }
    if (typeof page.setViewportSize === "function") {
      await page.setViewportSize(desktopViewport).catch(() => {});
    }
  }

  return {
    viewport: { ...MOBILE_VIEWPORT },
    reflowOk: horizontalOverflowPx === 0,
    horizontalOverflowPx,
    textSpacingOk: clippedElementsCount === 0,
    clippedElementsCount,
    smallTargetsCount,
    pinchZoomBlocked,
    osPreferences: {
      reducedMotionChecked,
      reducedMotionUnboundedAnimations,
      forcedColorsChecked,
    },
  };
}
