import {
  WCAG_22_TAGS,
  analyzeWcagWithAxe,
  runIbmAce,
} from "./dual-engine.mjs";
import { runMobileProbes } from "./mobile-probes.mjs";
import { runDetectorsAndDiscovery } from "./detectors.mjs";

export {
  WCAG_22_TAGS,
  analyzeWcagWithAxe,
  runIbmAce,
  runMobileProbes,
  runDetectorsAndDiscovery,
};

/**
 * Runs Wave 2 page analyzers (IBM ACE, 320px mobile/OS probes, and overlay/CAPTCHA
 * detectors + link discovery) on the untouched target page prior to remediation.
 */
export async function runWave2Analyzers(
  page,
  { baseUrl = "", desktopViewport = { width: 1440, height: 1000 } } = {},
) {
  const aceResult = await runIbmAce(page);
  const mobileAudit = await runMobileProbes(page, { desktopViewport });
  const discovery = await runDetectorsAndDiscovery(page, baseUrl);

  const enginesUsed = aceResult.available ? ["axe-core", "ibm-ace"] : ["axe-core"];

  return {
    enginesUsed,
    aceAvailable: aceResult.available,
    aceViolations: aceResult.violations,
    mobileAudit,
    detectors: discovery.detectors,
    discoveredPdfUrls: discovery.discoveredPdfUrls,
    discoveredInternalUrls: discovery.discoveredInternalUrls,
  };
}
