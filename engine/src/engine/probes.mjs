/**
 * Browser geometry and keyboard focus probes executed before remediation.
 *
 * Collects full-document bounding boxes for violating selectors and walks
 * keyboard Tab stops to evaluate WCAG 2.4.7 (Focus Visible) and 2.4.11
 * (Focus Not Obscured).
 */

export const MAX_ISSUE_BOUNDING_BOXES = 120;
export const MAX_TAB_STOPS = 40;

/**
 * Resets focus off the active element and scrolls the viewport back to (0, 0).
 */
export async function resetFocusAndScroll(page) {
  if (!page || typeof page.evaluate !== "function") return;
  await page
    .evaluate(() => {
      try {
        const active = document.activeElement;
        if (
          active &&
          active !== document.body &&
          active !== document.documentElement &&
          typeof active.blur === "function"
        ) {
          active.blur();
        }
        window.scrollTo(0, 0);
      } catch {
        // Ignore cleanup failures on closed or restricted documents
      }
    })
    .catch(() => {});
}

/**
 * Collects full-document BoundingBox rectangles for unique violating selectors.
 */
export async function collectIssueBoundingBoxes(
  page,
  wcagBefore,
  maxSelectors = MAX_ISSUE_BOUNDING_BOXES,
) {
  if (!page || typeof page.evaluate !== "function" || !wcagBefore) {
    return {};
  }

  const unique = [];
  const seen = new Set();
  for (const violation of wcagBefore?.violations ?? []) {
    for (const node of violation?.nodes ?? []) {
      const target = node?.target;
      if (!Array.isArray(target) || target.length !== 1 || typeof target[0] !== "string") {
        continue;
      }
      const selector = target[0];
      if (seen.has(selector)) continue;
      seen.add(selector);
      unique.push(selector);
      if (unique.length >= maxSelectors) break;
    }
    if (unique.length >= maxSelectors) break;
  }

  if (unique.length === 0) return {};

  try {
    const boxes = await page.evaluate((selectors) => {
      const result = {};
      for (const selector of selectors) {
        try {
          let el = document.querySelector(selector);
          if (!el) {
            const escaped = selector.replace(/([#.])([0-9]|[^a-zA-Z0-9_\-\\])/g, "$1\\$2");
            el = document.querySelector(escaped);
          }
          if (!el) continue;

          const r = el.getBoundingClientRect();
          if (!r || (r.width <= 0 && r.height <= 0)) continue;

          result[selector] = {
            x: Math.round(r.left + window.scrollX),
            y: Math.round(r.top + window.scrollY),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        } catch {
          // Skip invalid or detached selectors
        }
      }
      return result;
    }, unique);

    return boxes && typeof boxes === "object" ? boxes : {};
  } catch {
    return {};
  }
}

/**
 * Runs a bounded Tab key walk capturing up to maxStops TabStop items.
 * Evaluates WCAG 2.4.11 obscured status via elementsFromPoint and WCAG 2.4.7
 * visible focus via getComputedStyle pre/post diff.
 */
export async function collectTabStops(page, maxStops = MAX_TAB_STOPS) {
  if (
    !page ||
    typeof page.evaluate !== "function" ||
    typeof page.keyboard?.press !== "function"
  ) {
    return [];
  }

  const stops = [];
  const seenKeys = new Set();

  try {
    await resetFocusAndScroll(page);

    // Snapshot baseline focus-relevant computed styles before Tab presses trigger :focus/:focus-visible
    await page.evaluate(() => {
      const FOCUSABLE =
        "a[href], button, input, select, textarea, summary, details, [tabindex], [role='button'], [role='link'], [role='menuitem'], [role='tab']";
      const styleMap = new WeakMap();
      for (const el of document.querySelectorAll(FOCUSABLE)) {
        try {
          const cs = window.getComputedStyle(el);
          styleMap.set(el, {
            outlineColor: cs.outlineColor,
            outlineStyle: cs.outlineStyle,
            outlineWidth: cs.outlineWidth,
            boxShadow: cs.boxShadow,
            borderColor: cs.borderColor,
            borderWidth: cs.borderWidth,
            backgroundColor: cs.backgroundColor,
            textDecorationLine: cs.textDecorationLine,
          });
        } catch {
          // Ignore elements without computed styles
        }
      }
      window.__aksaraPreFocusStyles = styleMap;
    });

    for (let step = 0; step < maxStops; step += 1) {
      await page.keyboard.press("Tab").catch(() => {});

      const probe = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) {
          return { done: true };
        }

        const buildSelector = (node) => {
          const id = node.getAttribute("id");
          if (id) return `#${CSS.escape(id)}`;

          const parts = [];
          let curr = node;
          for (let depth = 0; depth < 4 && curr && curr.nodeType === 1; depth += 1) {
            const tag = curr.tagName.toLowerCase();
            if (tag === "html" || tag === "body") {
              parts.unshift(tag);
              break;
            }
            const parent = curr.parentElement;
            if (!parent) {
              parts.unshift(tag);
              break;
            }
            const siblings = Array.from(parent.children).filter(
              (child) => child.tagName === curr.tagName,
            );
            if (siblings.length > 1) {
              const idx = siblings.indexOf(curr) + 1;
              parts.unshift(`${tag}:nth-of-type(${idx})`);
            } else {
              parts.unshift(tag);
            }
            if (parent.getAttribute("id")) {
              parts.unshift(`#${CSS.escape(parent.getAttribute("id"))}`);
              break;
            }
            curr = parent;
          }
          return parts.join(" > ");
        };

        const implicitRole = (node) => {
          const explicit = node.getAttribute("role");
          if (explicit) return explicit;
          const tag = node.tagName.toLowerCase();
          if (tag === "a" && node.hasAttribute("href")) return "link";
          if (tag === "button") return "button";
          if (tag === "select") return "combobox";
          if (tag === "textarea") return "textbox";
          if (tag === "input") {
            const t = (node.getAttribute("type") || "text").toLowerCase();
            if (t === "checkbox") return "checkbox";
            if (t === "radio") return "radio";
            if (t === "submit" || t === "button" || t === "reset") return "button";
            return "textbox";
          }
          return "";
        };

        const r = el.getBoundingClientRect();
        const rect = {
          x: Math.round(r.left + window.scrollX),
          y: Math.round(r.top + window.scrollY),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };

        // WCAG 2.4.11: check if another unrelated element sits on top of the focus target center
        let obscured = false;
        if (r.width > 0 && r.height > 0) {
          const vw = window.innerWidth || 1440;
          const vh = window.innerHeight || 1000;
          const cx = Math.max(0, Math.min(vw - 1, r.left + r.width / 2));
          const cy = Math.max(0, Math.min(vh - 1, r.top + r.height / 2));
          if (r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh) {
            const stack = document.elementsFromPoint(cx, cy);
            if (stack && stack.length > 0) {
              const top = stack[0];
              const isSelfOrDescendant = top === el || el.contains(top);
              const isOwnLabel =
                top.tagName === "LABEL" && top.control === el;
              if (!isSelfOrDescendant && !isOwnLabel) {
                obscured = true;
              }
            }
          }
        }

        // WCAG 2.4.7: compare computed style against pre-focus snapshot
        const post = window.getComputedStyle(el);
        const pre = window.__aksaraPreFocusStyles?.get(el) || null;
        let hasVisibleFocus = false;

        const hasActiveOutline =
          post.outlineStyle !== "none" &&
          Number.parseFloat(post.outlineWidth || "0") > 0;
        const hasBoxShadow = Boolean(post.boxShadow && post.boxShadow !== "none");

        if (pre) {
          const outlineChanged =
            hasActiveOutline &&
            (post.outlineStyle !== pre.outlineStyle ||
              post.outlineWidth !== pre.outlineWidth ||
              post.outlineColor !== pre.outlineColor);
          const shadowChanged = hasBoxShadow && post.boxShadow !== pre.boxShadow;
          const borderChanged =
            post.borderColor !== pre.borderColor ||
            post.borderWidth !== pre.borderWidth;
          const bgChanged = post.backgroundColor !== pre.backgroundColor;
          const textDecoChanged =
            post.textDecorationLine !== pre.textDecorationLine;

          hasVisibleFocus =
            outlineChanged ||
            shadowChanged ||
            borderChanged ||
            bgChanged ||
            textDecoChanged;
        } else {
          hasVisibleFocus = hasActiveOutline || hasBoxShadow;
        }

        const label = (
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.innerText ||
          el.textContent ||
          el.getAttribute("alt") ||
          el.getAttribute("placeholder") ||
          el.getAttribute("value") ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);

        const selector = buildSelector(el);
        const tag = el.tagName.toLowerCase();

        return {
          done: false,
          stop: {
            selector,
            tag,
            role: implicitRole(el),
            label,
            rect,
            obscured,
            hasVisibleFocus,
          },
        };
      });

      if (!probe || probe.done || !probe.stop) break;

      const key = `${probe.stop.selector}|${probe.stop.rect.x}|${probe.stop.rect.y}`;
      if (seenKeys.has(key)) break;
      seenKeys.add(key);

      stops.push({
        index: stops.length + 1,
        ...probe.stop,
      });
    }
  } catch {
    // Best-effort walk: return whatever stops were captured before failure
  } finally {
    await page
      .evaluate(() => {
        delete window.__aksaraPreFocusStyles;
      })
      .catch(() => {});
    await resetFocusAndScroll(page);
  }

  return stops;
}
