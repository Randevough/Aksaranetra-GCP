import { classifyConfidence } from "./confidence.mjs";
import { createSanitizedSnippet } from "../decisions/index.mjs";

export async function applyCandidates(page, candidates, policy) {
  const fixed = [];
  const review = [];
  const skipped = [];

  for (const candidate of candidates) {
    const classification = classifyConfidence(candidate.confidence, policy);

    if (
      classification === "review" ||
      (classification !== "apply" && candidate.status === "review")
    ) {
      review.push({ ...candidate, status: "review" });
      continue;
    }

    if (classification === "skip" || !candidate.patches?.length) {
      skipped.push({ ...candidate, status: "skipped" });
      continue;
    }

    const result = await page.evaluate((candidate) => {
      let element;
      try {
        let matches = Array.from(document.querySelectorAll(candidate.selector));
        if (matches.length === 1) {
          element = matches[0];
        } else if (matches.length === 0) {
          try {
            const sanitized = candidate.selector.replace(
              /([#\.])([0-9]|[^a-zA-Z0-9_\-\\])/g,
              "$1\\$2",
            );
            const sanitizedMatches = Array.from(
              document.querySelectorAll(sanitized),
            );
            if (sanitizedMatches.length === 1) {
              element = sanitizedMatches[0];
            }
          } catch {
            // Abaikan error sintaks pada sanitasi
          }
        } else if (matches.length > 1 && candidate.fingerprint) {
          const fp = candidate.fingerprint;
          const filtered = matches.filter((el) => {
            if (
              fp.tag &&
              el.tagName.toLowerCase() !== fp.tag.toLowerCase()
            ) {
              return false;
            }
            if (fp.id && el.getAttribute("id") !== fp.id) return false;
            if (fp.role && el.getAttribute("role") !== fp.role) return false;
            if (
              fp.parentTag &&
              el.parentElement?.tagName.toLowerCase() !==
                fp.parentTag.toLowerCase()
            ) {
              return false;
            }
            if (fp.classes?.length) {
              const elClasses = (el.getAttribute("class") || "")
                .split(/\s+/)
                .filter(Boolean);
              if (!fp.classes.some((c) => elClasses.includes(c))) return false;
            }
            return true;
          });

          if (filtered.length === 1) {
            element = filtered[0];
          }
        }

        if (!element) {
          if (
            matches.length === 0 &&
            candidate.rule === "document-title" &&
            candidate.selector === "head > title"
          ) {
            let head = document.head || document.querySelector("head");
            if (!head && document.documentElement) {
              head = document.createElement("head");
              document.documentElement.prepend(head);
            }
            if (head) {
              element = document.createElement("title");
              head.appendChild(element);
              element.__aksaraCreated = true;
            }
          }
        }

        if (!element) {
          return {
            applied: false,
            reason: `Selector matched ${matches.length} elements during apply`,
            appliedPatches: [],
          };
        }
      } catch {
        return {
          applied: false,
          reason: "Selector failed during apply",
          appliedPatches: [],
        };
      }

      // Snapshot atribut pra-patch komprehensif (Poin 2.5)
      const prePatchSnapshot = {
        tagName: element.tagName.toLowerCase(),
        attributes: {},
        textContent: element.textContent || "",
        outerHTML: element.outerHTML,
        createdElement: Boolean(element.__aksaraCreated),
      };
      delete element.__aksaraCreated;
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        prePatchSnapshot.attributes[attr.name] = attr.value;
      }

      const parseRgbSimple = (raw) => {
        if (typeof raw !== "string") return null;
        const s = raw.trim();
        if (s.startsWith("#")) {
          const hex = s.slice(1);
          if (/^[0-9a-f]{3}$/i.test(hex)) {
            return {
              r: Number.parseInt(hex[0] + hex[0], 16),
              g: Number.parseInt(hex[1] + hex[1], 16),
              b: Number.parseInt(hex[2] + hex[2], 16),
            };
          }
          if (/^[0-9a-f]{6}$/i.test(hex)) {
            return {
              r: Number.parseInt(hex.slice(0, 2), 16),
              g: Number.parseInt(hex.slice(2, 4), 16),
              b: Number.parseInt(hex.slice(4, 6), 16),
            };
          }
          return null;
        }
        const m = s.match(
          /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i,
        );
        if (!m) return null;
        return {
          r: Math.round(Number(m[1])),
          g: Math.round(Number(m[2])),
          b: Math.round(Number(m[3])),
        };
      };

      const preparedPatches = candidate.patches.map((patch) => {
        if (patch.styleProperty) {
          const prop = String(patch.styleProperty).trim();
          const patchId = `${candidate.rule}:${candidate.selector}:style:${prop}`;
          return {
            patchId,
            attribute: "style",
            styleProperty: prop,
            isText: false,
            isStyle: true,
            oldValue: element.hasAttribute("style")
              ? element.getAttribute("style")
              : null,
            oldStyleValue: element.style.getPropertyValue(prop) || "",
            newValue: patch.value,
          };
        }
        const patchId = `${candidate.rule}:${candidate.selector}:${patch.attribute}`;
        if (patch.attribute === "textContent") {
          return {
            patchId,
            attribute: "textContent",
            isText: true,
            isStyle: false,
            oldValue: element.textContent || null,
            newValue: patch.value,
          };
        }
        return {
          patchId,
          attribute: patch.attribute,
          isText: false,
          isStyle: false,
          oldValue: element.hasAttribute(patch.attribute)
            ? element.getAttribute(patch.attribute)
            : null,
          newValue: patch.value,
        };
      });

      const conflict = preparedPatches.find((patch) => {
        if (patch.isStyle) {
          const currentVal = (patch.oldStyleValue || "").trim();
          if (!currentVal) return false;
          const targetVal = String(patch.newValue || "").trim();
          if (currentVal.toLowerCase() === targetVal.toLowerCase()) {
            return true;
          }
          const curRgb = parseRgbSimple(currentVal);
          const tgtRgb = parseRgbSimple(targetVal);
          return Boolean(
            curRgb &&
              tgtRgb &&
              curRgb.r === tgtRgb.r &&
              curRgb.g === tgtRgb.g &&
              curRgb.b === tgtRgb.b,
          );
        }
        return (
          patch.oldValue !== null &&
          patch.oldValue !== "" &&
          patch.oldValue !== patch.newValue
        );
      });

      if (conflict) {
        return {
          applied: false,
          reason: conflict.isStyle
            ? `Existing style property ${conflict.styleProperty} already matches`
            : `Existing ${conflict.attribute} was preserved`,
          appliedPatches: [],
        };
      }

      const appliedPatches = [];
      for (const patch of preparedPatches) {
        if (patch.isText) {
          element.textContent = patch.newValue;
        } else if (patch.isStyle) {
          element.style.setProperty(patch.styleProperty, patch.newValue);
          const computedVal = window
            .getComputedStyle(element)
            .getPropertyValue(patch.styleProperty);
          const targetRgb = parseRgbSimple(patch.newValue);
          const computedRgb = parseRgbSimple(computedVal);
          const matchesComputed =
            targetRgb && computedRgb
              ? targetRgb.r === computedRgb.r &&
                targetRgb.g === computedRgb.g &&
                targetRgb.b === computedRgb.b
              : computedVal.trim().toLowerCase() ===
                String(patch.newValue).trim().toLowerCase();
          if (!matchesComputed) {
            element.style.setProperty(
              patch.styleProperty,
              patch.newValue,
              "important",
            );
          }
        } else {
          element.setAttribute(patch.attribute, patch.newValue);
        }
        appliedPatches.push(patch);
      }

      element.setAttribute("data-project-a-fixed", candidate.rule);
      element.setAttribute("data-project-a-source", candidate.source);
      element.setAttribute(
        "data-project-a-confidence",
        String(candidate.confidence),
      );

      return {
        applied: true,
        reason: "Patch applied",
        appliedPatches,
        prePatchSnapshot,
        postStyleAttr: element.getAttribute("style"),
        htmlAfter: element.outerHTML,
      };
    }, candidate);

    if (result.applied) {
      const fixedRecord = {
        ...candidate,
        status: "applied",
        appliedPatches: result.appliedPatches,
        prePatchSnapshot: result.prePatchSnapshot,
        htmlAfter: result.htmlAfter,
      };
      if (result.appliedPatches.some((p) => p.isStyle)) {
        const snippetPatches = result.appliedPatches.map((p) =>
          p.isStyle
            ? { attribute: "style", value: result.postStyleAttr ?? "" }
            : p,
        );
        fixedRecord.snippet = createSanitizedSnippet({
          ...fixedRecord,
          patches: snippetPatches,
        });
      } else {
        fixedRecord.snippet = createSanitizedSnippet(fixedRecord);
      }
      fixed.push(fixedRecord);
    } else {
      skipped.push({
        ...candidate,
        status: "skipped",
        reason: result.reason,
        appliedPatches: result.appliedPatches,
      });
    }
  }

  return { fixed, review, skipped };
}

export async function rollbackSingleRecord(page, record) {
  if (!page || !record) return;

  await page.evaluate((record) => {
    let element;
    try {
      const matches = document.querySelectorAll(record.selector);
      if (matches.length === 1) {
        element = matches[0];
      } else if (matches.length > 1 && record.fingerprint) {
        const fp = record.fingerprint;
        const filtered = Array.from(matches).filter((el) => {
          if (fp.tag && el.tagName.toLowerCase() !== fp.tag.toLowerCase()) {
            return false;
          }
          if (fp.id && el.getAttribute("id") !== fp.id) return false;
          return true;
        });
        if (filtered.length === 1) element = filtered[0];
      }
    } catch {
      return;
    }

    if (!element) return;

    if (record.prePatchSnapshot?.createdElement) {
      element.remove();
      return;
    }

    if (record.prePatchSnapshot && record.prePatchSnapshot.attributes) {
      const origAttrs = record.prePatchSnapshot.attributes;
      for (const patch of record.appliedPatches || []) {
        if (patch.isText) {
          element.textContent = record.prePatchSnapshot.textContent || "";
        } else if (!(patch.attribute in origAttrs) || origAttrs[patch.attribute] === null) {
          element.removeAttribute(patch.attribute);
        } else {
          element.setAttribute(patch.attribute, origAttrs[patch.attribute]);
        }
      }
    } else {
      for (const patch of [...(record.appliedPatches || [])].reverse()) {
        if (patch.isText) {
          element.textContent = patch.oldValue || "";
        } else if (patch.oldValue === null) {
          element.removeAttribute(patch.attribute);
        } else {
          element.setAttribute(patch.attribute, patch.oldValue);
        }
      }
    }

    element.removeAttribute("data-project-a-fixed");
    element.removeAttribute("data-project-a-source");
    element.removeAttribute("data-project-a-confidence");
  }, record);
}

export async function rollbackPatches(page, fixedRecords = []) {
  for (const record of [...fixedRecords].reverse()) {
    await rollbackSingleRecord(page, record);
  }
}

