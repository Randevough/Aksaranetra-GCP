"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import styles from "./WebReaderPanel.module.css";

const emptySubscribe = () => () => {};
function getTtsSupportedSnapshot() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
function getTtsSupportedServerSnapshot() {
  return false;
}

type ThemeMode = "light" | "sepia" | "dark";
type SpacingMode = "normal" | "relaxed";
type WidthMode = "comfortable" | "wide";

const FONT_SIZES = [100, 115, 130, 145, 160] as const;
const SPEEDS = [0.85, 1.0, 1.25, 1.5] as const;

interface OutlineItem {
  id: string;
  level: number;
  text: string;
}

interface SpeechBlock {
  index: number;
  id: string;
  text: string;
}

interface ParsedReaderDocument {
  title: string;
  blocks: ReactNode[];
  outline: OutlineItem[];
  speechBlocks: SpeechBlock[];
}

function isSafeUrl(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

function parseReaderHtml(
  html: string,
  fallbackTitle: string,
  renderNodeWrapper: (
    speechIdx: number | null,
    nodeId: string | undefined,
    element: ReactNode,
  ) => ReactNode,
): ParsedReaderDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const headerHeading =
    doc.querySelector("header h1")?.textContent?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.querySelector("title")?.textContent?.trim() ||
    fallbackTitle;

  const root = doc.querySelector("main") ?? doc.body;
  const outline: OutlineItem[] = [];
  const speechBlocks: SpeechBlock[] = [];
  let headingCounter = 0;
  let speechCounter = 0;
  let keyCounter = 0;

  const nextKey = () => `r-${keyCounter++}`;

  const renderInline = (node: ChildNode): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(renderInline);

    switch (tag) {
      case "a": {
        const safeHref = isSafeUrl(el.getAttribute("href"));
        if (!safeHref) return <span key={nextKey()}>{children}</span>;
        const isHash = safeHref.startsWith("#");
        return (
          <a
            key={nextKey()}
            href={safeHref}
            target={isHash ? undefined : "_blank"}
            rel={isHash ? undefined : "noopener noreferrer"}
          >
            {children}
          </a>
        );
      }
      case "strong":
      case "b":
        return <strong key={nextKey()}>{children}</strong>;
      case "em":
      case "i":
        return <em key={nextKey()}>{children}</em>;
      case "code":
        return <code key={nextKey()}>{children}</code>;
      case "br":
        return <br key={nextKey()} />;
      case "img": {
        const safeSrc = isSafeUrl(el.getAttribute("src"));
        if (!safeSrc) return null;
        const alt = el.getAttribute("alt") ?? "";
        return (
          <img
            key={nextKey()}
            src={safeSrc}
            alt={alt}
            className={styles.articleImg}
            loading="lazy"
          />
        );
      }
      default:
        return <span key={nextKey()}>{children}</span>;
    }
  };

  const renderBlockNode = (node: ChildNode): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      return text ? text : null;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const text = el.textContent?.trim() ?? "";
      if (!text) return null;
      const rawLevel = Number(tag.slice(1));
      const level = Math.max(2, Math.min(6, rawLevel === 1 ? 2 : rawLevel));
      const id = `reader-h-${headingCounter++}`;
      const speechIdx = speechCounter++;
      outline.push({ id, level, text });
      speechBlocks.push({ index: speechIdx, id, text });

      const children = Array.from(el.childNodes).map(renderInline);
      const headingEl = (() => {
        switch (level) {
          case 2:
            return <h2>{children}</h2>;
          case 3:
            return <h3>{children}</h3>;
          case 4:
            return <h4>{children}</h4>;
          case 5:
            return <h5>{children}</h5>;
          default:
            return <h6>{children}</h6>;
        }
      })();
      return (
        <div key={nextKey()}>
          {renderNodeWrapper(speechIdx, id, headingEl)}
        </div>
      );
    }

    switch (tag) {
      case "p": {
        const text = el.textContent?.trim() ?? "";
        const hasImg = Boolean(el.querySelector("img"));
        if (!text && !hasImg) return null;
        const children = Array.from(el.childNodes).map(renderInline);
        if (text) {
          const speechIdx = speechCounter++;
          const blockId = `reader-b-${speechIdx}`;
          speechBlocks.push({ index: speechIdx, id: blockId, text });
          return (
            <div key={nextKey()}>
              {renderNodeWrapper(speechIdx, blockId, <p>{children}</p>)}
            </div>
          );
        }
        return <p key={nextKey()}>{children}</p>;
      }

      case "blockquote": {
        const text = el.textContent?.trim() ?? "";
        if (!text) return null;
        const speechIdx = speechCounter++;
        const blockId = `reader-b-${speechIdx}`;
        speechBlocks.push({ index: speechIdx, id: blockId, text });
        const children = Array.from(el.childNodes).map(renderInline);
        return (
          <div key={nextKey()}>
            {renderNodeWrapper(
              speechIdx,
              blockId,
              <blockquote>{children}</blockquote>,
            )}
          </div>
        );
      }

      case "ul":
      case "ol": {
        const listItems = Array.from(el.children)
          .filter((child) => child.tagName.toLowerCase() === "li")
          .map((li) => {
            const liText = li.textContent?.trim() ?? "";
            if (!liText) return null;
            const speechIdx = speechCounter++;
            const blockId = `reader-b-${speechIdx}`;
            speechBlocks.push({ index: speechIdx, id: blockId, text: liText });
            const children = Array.from(li.childNodes).map(renderInline);
            return (
              <li key={nextKey()}>
                {renderNodeWrapper(speechIdx, blockId, <span>{children}</span>)}
              </li>
            );
          })
          .filter(Boolean);

        if (listItems.length === 0) return null;
        return tag === "ol" ? (
          <ol key={nextKey()}>{listItems}</ol>
        ) : (
          <ul key={nextKey()}>{listItems}</ul>
        );
      }

      case "img": {
        const safeSrc = isSafeUrl(el.getAttribute("src"));
        if (!safeSrc) return null;
        const alt = el.getAttribute("alt") ?? "";
        return (
          <figure key={nextKey()} className={styles.articleFigure}>
            <img
              src={safeSrc}
              alt={alt}
              className={styles.articleImg}
              loading="lazy"
            />
            {alt && <figcaption>{alt}</figcaption>}
          </figure>
        );
      }

      case "table": {
        const caption = el.querySelector("caption")?.textContent?.trim();
        const theadRows = Array.from(el.querySelectorAll("thead tr"));
        const tbodyRows = Array.from(el.querySelectorAll("tbody tr"));
        const directRows =
          theadRows.length === 0 && tbodyRows.length === 0
            ? Array.from(el.querySelectorAll("tr"))
            : [];

        const renderRow = (tr: Element) => (
          <tr key={nextKey()}>
            {Array.from(tr.children).map((cell) => {
              const cellTag = cell.tagName.toLowerCase();
              const scope = cell.getAttribute("scope") || undefined;
              const children = Array.from(cell.childNodes).map(renderInline);
              return cellTag === "th" ? (
                <th key={nextKey()} scope={scope}>
                  {children}
                </th>
              ) : (
                <td key={nextKey()}>{children}</td>
              );
            })}
          </tr>
        );

        return (
          <div key={nextKey()} className={styles.tableWrap} tabIndex={0}>
            <table className={styles.articleTable}>
              {caption && <caption>{caption}</caption>}
              {theadRows.length > 0 && <thead>{theadRows.map(renderRow)}</thead>}
              {tbodyRows.length > 0 && <tbody>{tbodyRows.map(renderRow)}</tbody>}
              {directRows.length > 0 && <tbody>{directRows.map(renderRow)}</tbody>}
            </table>
          </div>
        );
      }

      case "section":
      case "article":
      case "div": {
        const inner = Array.from(el.childNodes)
          .map(renderBlockNode)
          .filter(Boolean);
        if (inner.length === 0) return null;
        return tag === "article" ? (
          <article key={nextKey()} className={styles.articleSection}>
            {inner}
          </article>
        ) : (
          <section key={nextKey()} className={styles.articleSection}>
            {inner}
          </section>
        );
      }

      default:
        return null;
    }
  };

  const blocks = Array.from(root.childNodes)
    .map(renderBlockNode)
    .filter(Boolean);

  return {
    title: headerHeading,
    blocks,
    outline,
    speechBlocks,
  };
}

export default function WebReaderPanel({
  readerHref,
  sourceUrl,
  title = "Tampilan Web Reader",
  active = false,
}: {
  readerHref: string;
  sourceUrl?: string;
  title?: string;
  active?: boolean;
}) {
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [fontIdx, setFontIdx] = useState(0);
  const [spacing, setSpacing] = useState<SpacingMode>("normal");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [widthMode, setWidthMode] = useState<WidthMode>("comfortable");
  const [tocOpen, setTocOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const ttsSupported = useSyncExternalStore(
    emptySubscribe,
    getTtsSupportedSnapshot,
    getTtsSupportedServerSnapshot,
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsState, setTtsState] = useState<"idle" | "playing" | "paused">("idle");
  const [activeSpeechIdx, setActiveSpeechIdx] = useState<number | null>(null);
  const [speechRate, setSpeechRate] = useState<number>(1.0);

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const speechSessionRef = useRef(0);

  useEffect(() => {
    if (!ttsSupported) return;
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length > 0) setVoices(list);
    };
    queueMicrotask(loadVoices);
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      window.speechSynthesis.cancel();
    };
  }, [ttsSupported]);

  useEffect(() => {
    if (!active && !isFullscreen) return;
    if (!readerHref) return;
    if (fetchedUrl === readerHref && rawHtml !== null && reloadNonce === 0) return;

    const controller = new AbortController();
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    fetch(readerHref, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.text();
      })
      .then((html) => {
        if (cancelled) return;
        setRawHtml(html);
        setFetchedUrl(readerHref);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return;
        setError(
          err instanceof Error
            ? "Gagal memuat konten Web Reader dari server."
            : "Konten Web Reader tidak dapat dimuat.",
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [active, isFullscreen, readerHref, fetchedUrl, rawHtml, reloadNonce]);

  const stopSpeech = useCallback(() => {
    speechSessionRef.current += 1;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setTtsState("idle");
    setActiveSpeechIdx(null);
  }, []);

  useEffect(() => {
    return () => {
      speechSessionRef.current += 1;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [readerHref]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isFullscreen && !dialog.open) {
      dialog.showModal();
    } else if (!isFullscreen && dialog.open) {
      dialog.close();
    }
  }, [isFullscreen]);

  const parsedDoc = useMemo(() => {
    if (!rawHtml) return null;
    return parseReaderHtml(rawHtml, title, (speechIdx, nodeId, element) => (
      <div
        id={nodeId}
        className={`${styles.speechBlock} ${
          speechIdx !== null && activeSpeechIdx === speechIdx
            ? styles.speakingActive
            : ""
        }`}
      >
        {element}
      </div>
    ));
  }, [activeSpeechIdx, rawHtml, title]);

  const selectedVoice = useMemo(() => {
    if (voices.length === 0) return null;
    return (
      voices.find((v) => v.lang.toLowerCase() === "id-id") ??
      voices.find((v) => v.lang.toLowerCase().startsWith("id")) ??
      voices.find((v) => v.default) ??
      voices[0]
    );
  }, [voices]);

  const speakFrom = useCallback(
    (startIndex: number, rateOverride?: number) => {
      if (
        !ttsSupported ||
        !parsedDoc ||
        parsedDoc.speechBlocks.length === 0 ||
        typeof window === "undefined"
      ) {
        return;
      }

      const synth = window.speechSynthesis;
      synth.cancel();
      const sessionId = ++speechSessionRef.current;
      const rateToUse = rateOverride ?? speechRate;
      const queue = parsedDoc.speechBlocks;

      const speakIndex = (idx: number) => {
        if (speechSessionRef.current !== sessionId) return;
        if (idx >= queue.length) {
          setTtsState("idle");
          setActiveSpeechIdx(null);
          return;
        }

        const item = queue[idx];
        const utterance = new SpeechSynthesisUtterance(item.text);
        utterance.lang = selectedVoice?.lang || "id-ID";
        if (selectedVoice) utterance.voice = selectedVoice;
        utterance.rate = rateToUse;

        utterance.onstart = () => {
          if (speechSessionRef.current !== sessionId) return;
          setTtsState("playing");
          setActiveSpeechIdx(item.index);
          const el = document.getElementById(item.id);
          if (el) {
            const reduced = window.matchMedia(
              "(prefers-reduced-motion: reduce)",
            ).matches;
            el.scrollIntoView({
              behavior: reduced ? "auto" : "smooth",
              block: "nearest",
            });
          }
        };

        utterance.onend = () => {
          if (speechSessionRef.current !== sessionId) return;
          speakIndex(idx + 1);
        };

        utterance.onerror = () => {
          if (speechSessionRef.current !== sessionId) return;
          setTtsState("idle");
          setActiveSpeechIdx(null);
        };

        synth.speak(utterance);
      };

      speakIndex(startIndex);
    },
    [parsedDoc, selectedVoice, speechRate, ttsSupported],
  );

  const handleTogglePlayPause = () => {
    if (!ttsSupported || !parsedDoc || parsedDoc.speechBlocks.length === 0) return;
    const synth = window.speechSynthesis;

    if (ttsState === "playing") {
      synth.pause();
      setTtsState("paused");
      return;
    }

    if (ttsState === "paused") {
      synth.resume();
      setTtsState("playing");
      return;
    }

    speakFrom(0);
  };

  const handleSpeedChange = (nextRate: number) => {
    setSpeechRate(nextRate);
    if (ttsState === "playing" && activeSpeechIdx !== null && parsedDoc) {
      const queueIdx = parsedDoc.speechBlocks.findIndex(
        (b) => b.index === activeSpeechIdx,
      );
      speakFrom(queueIdx >= 0 ? queueIdx : 0, nextRate);
    }
  };

  const jumpToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  const fontSizePct = FONT_SIZES[fontIdx];

  const renderReaderBody = (inDialog: boolean) => (
    <div
      className={`${styles.readerShell} ${styles[`theme_${theme}`]} ${
        inDialog ? styles.readerShellFullscreen : ""
      }`}
    >
      <div className={styles.controlsBar} role="region" aria-label="Pengaturan tampilan dan suara Web Reader">
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Ukuran teks</span>
          <div className={styles.segmented}>
            <button
              type="button"
              className={styles.ctrlBtn}
              disabled={fontIdx <= 0}
              aria-label="Perkecil ukuran teks"
              onClick={() => setFontIdx((i) => Math.max(0, i - 1))}
            >
              A-
            </button>
            <span className={styles.ctrlValue} aria-live="polite">
              {fontSizePct}%
            </span>
            <button
              type="button"
              className={styles.ctrlBtn}
              disabled={fontIdx >= FONT_SIZES.length - 1}
              aria-label="Perbesar ukuran teks"
              onClick={() =>
                setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))
              }
            >
              A+
            </button>
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Spasi WCAG 1.4.12</span>
          <div className={styles.segmented}>
            <button
              type="button"
              className={`${styles.ctrlBtn} ${
                spacing === "normal" ? styles.ctrlBtnActive : ""
              }`}
              aria-pressed={spacing === "normal"}
              onClick={() => setSpacing("normal")}
            >
              Normal
            </button>
            <button
              type="button"
              className={`${styles.ctrlBtn} ${
                spacing === "relaxed" ? styles.ctrlBtnActive : ""
              }`}
              aria-pressed={spacing === "relaxed"}
              onClick={() => setSpacing("relaxed")}
            >
              Lega WCAG 1.4.12
            </button>
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Tema AAA</span>
          <div className={styles.segmented}>
            {(
              [
                ["light", "Terang"],
                ["sepia", "Sepia"],
                ["dark", "Gelap Kontras Tinggi"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`${styles.ctrlBtn} ${
                  theme === key ? styles.ctrlBtnActive : ""
                }`}
                aria-pressed={theme === key}
                onClick={() => setTheme(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Kolom</span>
          <div className={styles.segmented}>
            <button
              type="button"
              className={`${styles.ctrlBtn} ${
                widthMode === "comfortable" ? styles.ctrlBtnActive : ""
              }`}
              aria-pressed={widthMode === "comfortable"}
              onClick={() => setWidthMode("comfortable")}
            >
              Nyaman
            </button>
            <button
              type="button"
              className={`${styles.ctrlBtn} ${
                widthMode === "wide" ? styles.ctrlBtnActive : ""
              }`}
              aria-pressed={widthMode === "wide"}
              onClick={() => setWidthMode("wide")}
            >
              Lebar
            </button>
          </div>
        </div>

        <div className={styles.controlActions}>
          {parsedDoc && parsedDoc.outline.length > 0 && (
            <button
              type="button"
              className={`${styles.ctrlBtn} ${tocOpen ? styles.ctrlBtnActive : ""}`}
              aria-expanded={tocOpen}
              onClick={() => setTocOpen((v) => !v)}
            >
              Daftar Isi ({parsedDoc.outline.length})
            </button>
          )}
          <button
            type="button"
            className={`${styles.ctrlBtn} ${styles.fullscreenBtn}`}
            onClick={() => setIsFullscreen((v) => !v)}
          >
            {inDialog ? "Tutup Layar Penuh" : "Mode Layar Penuh"}
          </button>
        </div>
      </div>

      {/* Audio Reader / TTS Bahasa Indonesia */}
      <div className={styles.ttsBar} aria-label="Pembaca suara Bahasa Indonesia">
        {ttsSupported ? (
          <>
            <div className={styles.ttsControls}>
              <button
                type="button"
                className={`${styles.ctrlBtn} ${styles.ttsPlayBtn}`}
                disabled={!parsedDoc || parsedDoc.speechBlocks.length === 0}
                onClick={handleTogglePlayPause}
              >
                {ttsState === "playing"
                  ? "Jeda Suara"
                  : ttsState === "paused"
                    ? "Lanjutkan Suara"
                    : "Putar Suara (TTS)"}
              </button>
              <button
                type="button"
                className={styles.ctrlBtn}
                disabled={ttsState === "idle"}
                onClick={stopSpeech}
              >
                Hentikan
              </button>
            </div>

            <div className={styles.segmented} role="group" aria-label="Kecepatan suara">
              {SPEEDS.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={`${styles.ctrlBtn} ${
                    speechRate === rate ? styles.ctrlBtnActive : ""
                  }`}
                  aria-pressed={speechRate === rate}
                  onClick={() => handleSpeedChange(rate)}
                >
                  {rate.toFixed(rate === 1 || rate === 1.5 ? 1 : 2)}x
                </button>
              ))}
            </div>

            <p className={styles.ttsStatus} aria-live="polite">
              {ttsState !== "idle" && activeSpeechIdx !== null && parsedDoc
                ? `Membacakan bagian ${activeSpeechIdx + 1} dari ${parsedDoc.speechBlocks.length}`
                : selectedVoice
                  ? `Suara: ${selectedVoice.name} (${selectedVoice.lang})`
                  : "Suara browser bawaan siap"}
            </p>
          </>
        ) : (
          <p className={styles.ttsStatus}>
            Pemutar suara bawaan tidak tersedia di peramban ini.
          </p>
        )}
      </div>

      <div className={styles.readerBodyLayout}>
        {tocOpen && parsedDoc && parsedDoc.outline.length > 0 && (
          <nav className={styles.tocPanel} aria-label="Daftar isi halaman">
            <p className={styles.tocTitle}>Daftar Isi</p>
            <ol className={styles.tocList}>
              {parsedDoc.outline.map((item) => (
                <li
                  key={item.id}
                  style={{ paddingLeft: `${Math.max(0, item.level - 2) * 12}px` }}
                >
                  <button
                    type="button"
                    className={styles.tocLink}
                    onClick={() => jumpToHeading(item.id)}
                  >
                    {item.text}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className={styles.canvasArea}>
          {loading && (
            <div className={styles.stateBox} role="status">
              <p>Memuat konten ramah akses...</p>
            </div>
          )}

          {!loading && error && (
            <div className={styles.stateBox} role="alert">
              <p>{error}</p>
              <div className={styles.stateActions}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReloadNonce((n) => n + 1)}
                >
                  Coba muat ulang
                </button>
                <a
                  href={readerHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                >
                  Buka di tab baru
                  <span className="sr-only"> (buka di tab baru)</span>
                </a>
              </div>
            </div>
          )}

          {!loading && !error && parsedDoc && parsedDoc.blocks.length === 0 && (
            <div className={styles.stateBox}>
              <p>Konten utama bacaan tidak ditemukan pada dokumen ini.</p>
              <a
                href={readerHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                Buka di tab baru
                <span className="sr-only"> (buka di tab baru)</span>
              </a>
            </div>
          )}

          {!loading && !error && parsedDoc && parsedDoc.blocks.length > 0 && (
            <article
              className={`${styles.article} ${
                spacing === "relaxed" ? styles.spacingRelaxed : styles.spacingNormal
              } ${widthMode === "wide" ? styles.widthWide : styles.widthComfortable}`}
              style={{ fontSize: `${fontSizePct}%` }}
            >
              <header className={styles.articleHeader}>
                {inDialog ? (
                  <h1 id="web-reader-dialog-title">{parsedDoc.title}</h1>
                ) : (
                  <h2>{parsedDoc.title}</h2>
                )}
                {sourceUrl && (
                  <p className={styles.articleSource}>
                    Sumber:{" "}
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {sourceUrl}
                      <span className="sr-only"> (buka di tab baru)</span>
                    </a>
                  </p>
                )}
              </header>

              <div className={styles.articleContent}>{parsedDoc.blocks}</div>
            </article>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <section className={styles.wrapper} aria-label="Web Reader Ramah Akses">
      {!isFullscreen && renderReaderBody(false)}

      <dialog
        ref={dialogRef}
        className={styles.fullscreenDialog}
        aria-labelledby="web-reader-dialog-title"
        onCancel={() => {
          setIsFullscreen(false);
        }}
        onClose={() => {
          setIsFullscreen(false);
        }}
      >
        {isFullscreen && renderReaderBody(true)}
      </dialog>
    </section>
  );
}
