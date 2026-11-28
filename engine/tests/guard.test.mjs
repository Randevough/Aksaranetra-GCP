import test from "node:test";
import assert from "node:assert/strict";

import {
  ALWAYS_BLOCKED,
  CHECKED_TYPES,
  TRACKER_HOSTS,
  attachGuard,
  createGuardStats,
  createHostDnsVerifier,
  decideRequest,
  isBlockedTrackerHost,
} from "../src/guard/index.mjs";

const TARGET = "https://sulselprov.go.id/";

test("opens the page the user actually asked for", () => {
  const verdict = decideRequest({
    resourceType: "document",
    url: "https://sulselprov.go.id/",
    allowedDocumentUrl: TARGET,
  });

  assert.equal(verdict.allow, true);
  assert.equal(verdict.reason, "document-is-the-target");
});

test("refuses to follow the page to somewhere else", () => {
  // Halaman yang membuka halaman lain sendiri adalah cara paling mudah
  // melewati pemeriksaan alamat, karena hanya alamat pertama yang diperiksa.
  const verdict = decideRequest({
    resourceType: "document",
    url: "https://situs-lain.go.id/",
    allowedDocumentUrl: TARGET,
  });

  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, "document-not-the-target");
});

test("lets a picture through but not a picture from inside our own network", () => {
  const luar = decideRequest({
    resourceType: "image",
    url: "https://apidev.sulselprov.go.id/storage/foto.jpg",
    allowedDocumentUrl: TARGET,
  });
  assert.equal(luar.allow, true);

  // Satu tag gambar yang menunjuk ke mesin sendiri sudah cukup untuk
  // melewati seluruh kerja src/fetcher kalau pencegat ini tidak ada.
  const dalam = decideRequest({
    resourceType: "image",
    url: "http://localhost/rahasia.png",
    allowedDocumentUrl: TARGET,
  });
  assert.equal(dalam.allow, false);
  assert.equal(dalam.reason, "asset-local-host-name");

  // Alamat lokal dengan port tidak standar tertahan lebih awal, di
  // pemeriksaan port. Alasannya berbeda, tetapi sama sama ditolak.
  const denganPort = decideRequest({
    resourceType: "image",
    url: "http://localhost:8080/rahasia.png",
    allowedDocumentUrl: TARGET,
  });
  assert.equal(denganPort.allow, false);
  assert.equal(denganPort.reason, "asset-port-not-allowed");

  const ipLangsung = decideRequest({
    resourceType: "image",
    url: "http://169.254.169.254/latest/meta-data/",
    allowedDocumentUrl: TARGET,
  });
  assert.equal(ipLangsung.allow, false);
  assert.equal(ipLangsung.reason, "asset-ip-literal-not-allowed");
});

test("never runs a script from the audited site", () => {
  for (const type of ALWAYS_BLOCKED) {
    const verdict = decideRequest({
      resourceType: type,
      url: "https://sulselprov.go.id/app.js",
      allowedDocumentUrl: TARGET,
    });

    assert.equal(verdict.allow, false, `${type} seharusnya ditolak`);
    assert.equal(verdict.reason, `blocked-type-${type}`);
  }

  // Sengaja diperiksa: script tetap ditolak walaupun alamatnya sah dan
  // berasal dari situs yang sedang kita audit sendiri.
  assert.equal(ALWAYS_BLOCKED.includes("script"), true);
});

test("refuses a kind of request it has never seen before", () => {
  // Daftar jenis milik Chromium bisa bertambah di versi berikutnya. Sikap
  // dasarnya harus menolak, supaya jenis baru tidak otomatis dapat izin.
  const verdict = decideRequest({
    resourceType: "webtransport",
    url: "https://sulselprov.go.id/apa-pun",
    allowedDocumentUrl: TARGET,
  });

  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, "resource-type-not-recognised");

  const kosong = decideRequest({ url: "https://sulselprov.go.id/" });
  assert.equal(kosong.allow, false);
  assert.equal(kosong.reason, "missing-resource-type");
});

test("treats a broken target address as a reason to stop, not to allow", () => {
  const verdict = decideRequest({
    resourceType: "document",
    url: "https://sulselprov.go.id/",
    allowedDocumentUrl: "bukan-alamat",
  });

  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, "document-target-invalid");
});

test("gives every refusal a sentence a person can read", () => {
  const contoh = [
    { resourceType: "script", url: "https://a.go.id/x.js" },
    { resourceType: "image", url: "http://127.0.0.1/x.png" },
    { resourceType: "beacon", url: "https://a.go.id/x" },
  ];

  for (const item of contoh) {
    const verdict = decideRequest({ ...item, allowedDocumentUrl: TARGET });
    assert.equal(verdict.allow, false);
    assert.equal(typeof verdict.message, "string");
    assert.ok(verdict.message.length > 10, "pesan terlalu pendek untuk dibaca");
  }
});

test("starts counting from zero and knows which types it checks", () => {
  const stats = createGuardStats();

  assert.deepEqual(stats, {
    allowed: 0,
    blocked: 0,
    byType: {},
    blockedHosts: [],
  });

  // Tiga jenis inilah yang boleh lewat setelah diperiksa. Sisanya ditolak.
  assert.deepEqual([...CHECKED_TYPES], ["image", "stylesheet", "font"]);
});

test("allows 1-hop redirect within the same host for document requests", () => {
  const verdict = decideRequest({
    resourceType: "document",
    url: "https://sulselprov.go.id/berita",
    allowedDocumentUrl: TARGET,
    redirectCount: 1,
  });

  assert.equal(verdict.allow, true);
  assert.equal(verdict.reason, "document-same-host-redirect-allowed");
});

test("strictly blocks cross-host redirects for document requests", () => {
  const verdict = decideRequest({
    resourceType: "document",
    url: "https://evil.com/berita",
    allowedDocumentUrl: TARGET,
    redirectCount: 1,
  });

  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, "document-redirect-cross-host-blocked");
});

test("blocks document redirects exceeding 1 hop", () => {
  const verdict = decideRequest({
    resourceType: "document",
    url: "https://sulselprov.go.id/berita/lagi",
    allowedDocumentUrl: TARGET,
    redirectCount: 2,
  });

  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, "document-redirect-limit-exceeded");
});

test("allows same-registrable www <-> apex document redirects", () => {
  const toWww = decideRequest({
    resourceType: "document",
    url: "https://www.sulselprov.go.id/",
    allowedDocumentUrl: "https://sulselprov.go.id/",
    redirectCount: 1,
  });
  assert.equal(toWww.allow, true);
  assert.equal(toWww.reason, "document-same-host-redirect-allowed");

  const toApex = decideRequest({
    resourceType: "document",
    url: "https://sulselprov.go.id/",
    allowedDocumentUrl: "https://www.sulselprov.go.id/",
    redirectCount: 1,
  });
  assert.equal(toApex.allow, true);

  const subDomain = decideRequest({
    resourceType: "document",
    url: "https://evil.sulselprov.go.id/",
    allowedDocumentUrl: "https://sulselprov.go.id/",
    redirectCount: 1,
  });
  assert.equal(subDomain.allow, false);
  assert.equal(subDomain.reason, "document-redirect-cross-host-blocked");
});

test("allows first-party and public CDN/API script, xhr, and fetch during hydration while blocking trackers and SSRF", () => {
  assert.equal(Object.isFrozen(TRACKER_HOSTS), true);
  assert.equal(isBlockedTrackerHost("googletagmanager.com"), true);
  assert.equal(isBlockedTrackerHost("WWW.GOOGLE-ANALYTICS.COM."), true);
  assert.equal(isBlockedTrackerHost("cdn.jsdelivr.net"), false);
  assert.equal(isBlockedTrackerHost("notgoogletagmanager.com"), false);

  for (const type of ["script", "xhr", "fetch"]) {
    const firstParty = decideRequest({
      resourceType: type,
      url: `https://www.sulselprov.go.id/api/${type}`,
      allowedDocumentUrl: TARGET,
      isHydrating: true,
    });
    assert.equal(firstParty.allow, true);
    assert.equal(firstParty.reason, `hydration-first-party-${type}-allowed`);

    const publicCdn = decideRequest({
      resourceType: type,
      url: `https://cdn.jsdelivr.net/npm/pkg/${type}`,
      allowedDocumentUrl: TARGET,
      isHydrating: true,
    });
    assert.equal(publicCdn.allow, true);
    assert.equal(publicCdn.reason, `hydration-public-${type}-allowed`);

    const subdomainApi = decideRequest({
      resourceType: type,
      url: `https://api.sulselprov.go.id/v1/${type}`,
      allowedDocumentUrl: TARGET,
      isHydrating: true,
    });
    assert.equal(subdomainApi.allow, true);
    assert.equal(subdomainApi.reason, `hydration-public-${type}-allowed`);

    const trackerApex = decideRequest({
      resourceType: type,
      url: "https://googletagmanager.com/gtag/js",
      allowedDocumentUrl: TARGET,
      isHydrating: true,
    });
    assert.equal(trackerApex.allow, false);
    assert.equal(trackerApex.reason, "hydration-tracker-blocked");

    const trackerSubdomain = decideRequest({
      resourceType: type,
      url: "https://www.google-analytics.com/g/collect",
      allowedDocumentUrl: TARGET,
      isHydrating: true,
    });
    assert.equal(trackerSubdomain.allow, false);
    assert.equal(trackerSubdomain.reason, "hydration-tracker-blocked");

    const invalidIp = decideRequest({
      resourceType: type,
      url: "http://127.0.0.1/internal",
      allowedDocumentUrl: TARGET,
      isHydrating: true,
    });
    assert.equal(invalidIp.allow, false);
    assert.equal(invalidIp.reason, "asset-ip-literal-not-allowed");

    const invalidLocal = decideRequest({
      resourceType: type,
      url: "http://localhost/internal",
      allowedDocumentUrl: TARGET,
      isHydrating: true,
    });
    assert.equal(invalidLocal.allow, false);
    assert.equal(invalidLocal.reason, "asset-local-host-name");
  }
});

test("verifies and caches non-main-host subresource DNS lookups to block SSRF", async () => {
  const lookups = [];
  const verifier = createHostDnsVerifier({
    mainHostname: "sulselprov.go.id",
    resolveHost: async (host) => {
      lookups.push(host);
      if (host === "rebind.evil.com") return ["127.0.0.1"];
      if (host === "cdn.public.test") return ["93.184.216.34"];
      throw new Error("ENOTFOUND");
    },
  });

  assert.equal(await verifier("sulselprov.go.id"), true);
  assert.equal(await verifier("cdn.public.test"), true);
  assert.equal(await verifier("cdn.public.test"), true);
  assert.equal(await verifier("rebind.evil.com"), false);
  assert.equal(await verifier("missing.invalid"), false);
  assert.deepEqual(lookups, ["cdn.public.test", "rebind.evil.com", "missing.invalid"]);

  let handler;
  const mockPage = {
    route: async (_pattern, fn) => {
      handler = fn;
    },
  };

  const stats = await attachGuard({
    page: mockPage,
    allowedDocumentUrl: TARGET,
    resolveHost: async (host) =>
      host === "rebind.evil.com" ? ["169.254.169.254"] : ["93.184.216.34"],
  });

  const actions = [];
  await handler({
    request: () => ({
      resourceType: () => "image",
      url: () => "https://rebind.evil.com/secret.png",
      redirectedFrom: () => null,
    }),
    continue: async () => actions.push("continue"),
    abort: async () => actions.push("abort"),
  });

  assert.deepEqual(actions, ["abort"]);
  assert.equal(stats.blocked, 1);
  assert.deepEqual(stats.blockedHosts, ["rebind.evil.com"]);
});

test("finishHydration locks hydration immediately, clears safety timer, stays non-enumerable, and still blocks DNS rebind", async () => {
  let handler;
  const mockPage = {
    route: async (_pattern, fn) => {
      handler = fn;
    },
  };

  let clearedCount = 0;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.clearTimeout = (id) => {
    clearedCount += 1;
    return originalClearTimeout(id);
  };

  try {
    const stats = await attachGuard({
      page: mockPage,
      allowedDocumentUrl: TARGET,
      allowHydration: true,
      hydrationTimeoutMs: 60_000,
      resolveHost: async (host) =>
        host === "rebind.evil.com" ? ["127.0.0.1"] : ["93.184.216.34"],
    });

    const descriptor = Object.getOwnPropertyDescriptor(stats, "finishHydration");
    assert.equal(descriptor?.enumerable, false);
    assert.equal(typeof stats.finishHydration, "function");
    assert.deepEqual(stats, {
      allowed: 0,
      blocked: 0,
      byType: {},
      blockedHosts: [],
    });

    const dispatch = async (resourceType, url) => {
      let outcome = null;
      await handler({
        request: () => ({
          resourceType: () => resourceType,
          url: () => url,
          redirectedFrom: () => null,
        }),
        continue: async () => {
          outcome = "continue";
        },
        abort: async () => {
          outcome = "abort";
        },
      });
      return outcome;
    };

    assert.equal(await dispatch("script", "https://cdn.jsdelivr.net/npm/app.js"), "continue");
    assert.equal(await dispatch("xhr", "https://www.google-analytics.com/g/collect"), "abort");
    assert.equal(await dispatch("script", "https://rebind.evil.com/evil.js"), "abort");

    stats.finishHydration();
    assert.equal(clearedCount, 1);

    // Calling finishHydration again is safe and does not double-clear.
    stats.finishHydration();
    assert.equal(clearedCount, 1);

    assert.equal(await dispatch("script", "https://cdn.jsdelivr.net/npm/after.js"), "abort");
    assert.equal(await dispatch("script", "https://sulselprov.go.id/after.js"), "abort");
    assert.equal(await dispatch("fetch", "https://sulselprov.go.id/api/after"), "abort");
  } finally {
    globalThis.clearTimeout = originalClearTimeout;
  }
});
