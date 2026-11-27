import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const WCAG_22_TAGS = Object.freeze([
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
]);

const VALID_IMPACTS = new Set(["critical", "serious", "moderate", "minor"]);

function normalizeAceImpact(impact, toolkitLevel) {
  const raw = String(impact || "").toLowerCase();
  if (VALID_IMPACTS.has(raw)) return raw;

  switch (String(toolkitLevel || "")) {
    case "1":
      return "serious";
    case "2":
      return "serious";
    case "3":
      return "moderate";
    case "4":
      return "minor";
    default:
      return "moderate";
  }
}

/**
 * Runs axe-core with WCAG 2.2 A/AA tags and ensures target-size is enabled
 * without wiping out tag-based runOnly filtering.
 */
export async function analyzeWcagWithAxe(page, AxeBuilder, tags = WCAG_22_TAGS) {
  let builder = new AxeBuilder({ page });
  let usedOptions = false;

  if (typeof builder.options === "function") {
    try {
      builder = builder.options({ rules: { "target-size": { enabled: true } } });
      usedOptions = true;
    } catch {
      builder = new AxeBuilder({ page });
    }
  }

  try {
    return await builder.withTags(tags).analyze();
  } catch (error) {
    if (
      usedOptions &&
      /target-size|unknown rule|invalid option/i.test(error?.message || "")
    ) {
      return new AxeBuilder({ page }).withTags(tags).analyze();
    }
    throw error;
  }
}

/**
 * Injects IBM accessibility-checker-engine once and runs WCAG_2_2 checks.
 * Mock pages lacking addScriptTag/evaluate return { available: false, violations: [] }.
 */
export async function runIbmAce(page) {
  if (
    !page ||
    typeof page.addScriptTag !== "function" ||
    typeof page.evaluate !== "function"
  ) {
    return { available: false, violations: [] };
  }

  let aceWindowPath;
  try {
    aceWindowPath = require.resolve("accessibility-checker-engine/ace-window.js");
  } catch (error) {
    return { available: false, violations: [], error: error?.message || "ace-not-found" };
  }

  try {
    const alreadyLoaded = await page
      .evaluate(() => Boolean(window.ace && typeof window.ace.Checker === "function"))
      .catch(() => false);

    if (!alreadyLoaded) {
      await page.addScriptTag({ path: aceWindowPath });
    }

    const raw = await page.evaluate(async () => {
      if (!window.ace || typeof window.ace.Checker !== "function") {
        return { available: false, results: [], ruleMeta: {}, nls: {} };
      }

      const buildCssSelector = (node) => {
        if (!node || node.nodeType !== 1) return "";
        if (node === document.documentElement) return "html";
        if (node === document.body) return "body";

        const id = node.getAttribute?.("id");
        if (id) {
          try {
            return `#${CSS.escape(id)}`;
          } catch {
            return `#${id}`;
          }
        }

        const parts = [];
        let curr = node;
        for (let depth = 0; depth < 5 && curr && curr.nodeType === 1; depth += 1) {
          const tag = curr.tagName.toLowerCase();
          if (tag === "html" || tag === "body") {
            parts.unshift(tag);
            break;
          }
          const currId = curr.getAttribute?.("id");
          if (currId) {
            try {
              parts.unshift(`#${CSS.escape(currId)}`);
            } catch {
              parts.unshift(`#${currId}`);
            }
            break;
          }
          const parent = curr.parentElement;
          if (!parent) {
            parts.unshift(tag);
            break;
          }
          const sameTagSiblings = Array.from(parent.children).filter(
            (child) => child.tagName === curr.tagName,
          );
          if (sameTagSiblings.length > 1) {
            parts.unshift(`${tag}:nth-of-type(${sameTagSiblings.indexOf(curr) + 1})`);
          } else {
            parts.unshift(tag);
          }
          curr = parent;
        }
        return parts.join(" > ");
      };

      const checker = new window.ace.Checker();
      const ruleMeta = {};
      const wcag22Ruleset = Array.isArray(checker.rulesets)
        ? checker.rulesets.find((rs) => rs.id === "WCAG_2_2")
        : null;

      for (const cp of wcag22Ruleset?.checkpoints ?? []) {
        for (const rule of cp?.rules ?? []) {
          if (!rule?.id) continue;
          if (!ruleMeta[rule.id]) {
            ruleMeta[rule.id] = {
              wcagSc: [],
              toolkitLevel: rule.toolkitLevel ?? null,
            };
          }
          if (cp.num && !ruleMeta[rule.id].wcagSc.includes(cp.num)) {
            ruleMeta[rule.id].wcagSc.push(cp.num);
          }
        }
      }

      const report = await checker.check(document, ["WCAG_2_2"]);
      const entries = [];

      for (const item of report?.results ?? []) {
        const isViolation =
          item?.level === "violation" ||
          (Array.isArray(item?.value) &&
            item.value[0] === "VIOLATION" &&
            item.value[1] === "FAIL");
        if (!isViolation) continue;

        const selector =
          buildCssSelector(item.node) ||
          (typeof item.selector === "string" ? item.selector : "") ||
          (typeof item.path?.dom === "string" ? item.path.dom : "");

        entries.push({
          ruleId: String(item.ruleId || "unknown-ace-rule"),
          impact: item.impact || null,
          reasonId: item.reasonId || null,
          wcagSc: Array.isArray(item.wcagSc) ? item.wcagSc : null,
          selector,
          html: typeof item.snippet === "string" ? item.snippet : item.html || null,
          help:
            typeof item.message === "string" && item.message.trim()
              ? item.message.trim()
              : "",
        });
      }

      return {
        available: true,
        results: entries,
        ruleMeta,
        nls: report?.nls || {},
      };
    });

    if (!raw?.available) {
      return { available: false, violations: [] };
    }

    const violations = (raw.results ?? []).map((item) => {
      const meta = raw.ruleMeta?.[item.ruleId] || { wcagSc: [], toolkitLevel: null };
      const wcagSc = Array.isArray(item.wcagSc) && item.wcagSc.length > 0
        ? item.wcagSc.map(String)
        : meta.wcagSc || [];
      const fallbackHelp =
        (item.reasonId && raw.nls?.[item.ruleId]?.[item.reasonId]) ||
        raw.nls?.[item.ruleId]?.[0] ||
        "";

      return {
        ruleId: item.ruleId,
        impact: normalizeAceImpact(item.impact, meta.toolkitLevel),
        wcagSc,
        selector: item.selector,
        html: item.html || null,
        help: item.help || String(fallbackHelp || ""),
        source: "ibm-ace",
      };
    });

    return { available: true, violations };
  } catch (error) {
    return {
      available: false,
      violations: [],
      error: error?.message || "ibm-ace-failed",
    };
  }
}
