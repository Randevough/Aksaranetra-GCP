/**
 * Resolver html-has-lang & html-lang-valid.
 *
 * Prinsip: setiap dokumen web wajib mendeklarasikan bahasa utama agar
 * pembaca layar (NVDA, JAWS, TalkBack) melafalkan teks dengan dialek dan fonem
 * yang tepat.
 *
 * Sinyal yang dibaca:
 * 1. Bahasa terkonfigurasi di site config (config.lang atau config.defaultLang)
 * 2. Tag meta http-equiv="content-language"
 * 3. Domain TLD (.id / .go.id mengindikasikan bahasa Indonesia "id")
 * 4. Fallback default ke bahasa Indonesia ("id")
 */
export async function resolveHtmlLangCandidates(
  page,
  selectors = [],
  config = {},
) {
  // Only honor defaultLang when explicitly configured or supplied outside unconfigured site defaults
  const configuredLang =
    config.lang ||
    (config.configured !== false && config.defaultLang ? config.defaultLang : "");

  return page.evaluate(
    ({ selectors, configuredLang }) => {
      const clean = (value = "") => String(value || "").trim().toLowerCase();

      const BCP47_LANG_REGEX = /^[a-z]{2,3}(-[a-z0-9]+)*$/i;

      const ID_STOPWORDS = new Set([
        "yang", "dan", "di", "ke", "dari", "untuk", "dengan", "pada", "ini",
        "itu", "adalah", "atau", "sebagai", "dalam", "tidak", "akan", "oleh",
        "pemerintah", "informasi", "layanan", "publik", "berita", "tentang",
        "halaman", "resmi", "provinsi", "kabupaten", "kota", "kementerian",
        "selamat", "datang", "daftar", "pengumuman", "pegawai",
      ]);

      const EN_STOPWORDS = new Set([
        "the", "and", "of", "to", "in", "is", "for", "that", "with", "on",
        "are", "this", "from", "by", "as", "was", "or", "an", "be", "about",
        "home", "services", "news", "page", "welcome", "contact", "privacy",
        "terms", "policy", "information", "public", "government",
      ]);

      const detectPageLanguage = () => {
        const host = window.location.hostname.toLowerCase();
        const isIndonesianTLD =
          host === "id" ||
          host.endsWith(".id") ||
          host.endsWith(".go.id") ||
          host.endsWith(".ac.id");

        const sample = (
          document.body?.innerText ||
          document.body?.textContent ||
          ""
        )
          .slice(0, 3000)
          .toLowerCase();
        const words = sample.match(/[a-z]+/g) || [];

        let idScore = 0;
        let enScore = 0;
        for (const word of words) {
          if (ID_STOPWORDS.has(word)) idScore += 1;
          if (EN_STOPWORDS.has(word)) enScore += 1;
        }

        if (isIndonesianTLD && enScore <= idScore * 1.5) {
          return {
            lang: "id",
            confidence: 0.9,
            source: "tld-language-heuristic",
            reason: `Indonesian TLD "${host}" with ${idScore} ID vs ${enScore} EN stopword hits`,
          };
        }

        if (idScore >= 2 && idScore > enScore * 1.5) {
          return {
            lang: "id",
            confidence: 0.85,
            source: "text-stopword-heuristic",
            reason: `Indonesian stopwords dominate (${idScore} ID vs ${enScore} EN)`,
          };
        }

        if (enScore >= 2 && enScore > idScore * 1.5) {
          return {
            lang: "en",
            confidence: 0.85,
            source: "text-stopword-heuristic",
            reason: `English stopwords dominate (${enScore} EN vs ${idScore} ID)`,
          };
        }

        const guessed = isIndonesianTLD || idScore > enScore ? "id" : "en";
        return {
          lang: guessed,
          confidence: 0.65,
          source: "ambiguous-language-heuristic",
          reason: `Insufficient or mixed language signals (${idScore} ID vs ${enScore} EN); requires human review`,
        };
      };

      const skip = (selector, source, reason) => ({
        rule: "html-has-lang",
        selector,
        confidence: 0,
        source,
        reason,
        patches: [],
      });

      return selectors.map((selector) => {
        let element;
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length !== 1) {
            return skip(
              selector,
              "selector-not-unique",
              `Selector matched ${matches.length} elements`,
            );
          }
          element = matches[0];
        } catch {
          return skip(
            selector,
            "invalid-selector",
            "Selector could not be evaluated",
          );
        }

        if (element.tagName.toLowerCase() !== "html") {
          return skip(
            selector,
            "not-html-element",
            "Target element is not <html>",
          );
        }

        const currentLang = clean(element.getAttribute("lang") || "");
        if (currentLang && BCP47_LANG_REGEX.test(currentLang)) {
          return skip(
            selector,
            "existing-name",
            "Document element already has a valid lang attribute",
          );
        }

        // Sinyal 1: Konfigurasi situs
        if (configuredLang && BCP47_LANG_REGEX.test(configuredLang)) {
          return {
            rule: "html-has-lang",
            selector,
            confidence: 0.95,
            source: "site-config-lang",
            reason: `Configured site language "${configuredLang}" declared on root <html>`,
            patches: [{ attribute: "lang", value: configuredLang }],
          };
        }

        // Sinyal 2: Meta content-language
        const metaContentLang = document.querySelector(
          "meta[http-equiv='content-language' i]",
        );
        if (metaContentLang) {
          const rawMeta = clean(metaContentLang.getAttribute("content") || "");
          const langCode = rawMeta.split(",")[0].trim();
          if (BCP47_LANG_REGEX.test(langCode)) {
            return {
              rule: "html-has-lang",
              selector,
              confidence: 0.9,
              source: "meta-content-language",
              reason: `Language "${langCode}" extracted from meta content-language header`,
              patches: [{ attribute: "lang", value: langCode }],
            };
          }
        }

        // Sinyal 3: Heuristik TLD + stopword teks dokumen
        const detected = detectPageLanguage();
        return {
          rule: "html-has-lang",
          selector,
          confidence: detected.confidence,
          source: detected.source,
          reason: detected.reason,
          patches: [{ attribute: "lang", value: detected.lang }],
        };
      });
    },
    { selectors, configuredLang },
  );
}
