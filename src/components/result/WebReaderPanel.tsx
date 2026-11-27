"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
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
type SpeechLang = "id" | "en";
type TtsState = "idle" | "playing" | "paused";

const FONT_SIZES = [100, 115, 130, 145, 160] as const;
const SPEEDS = [0.85, 1.0, 1.25, 1.5] as const;

const SPEECH_LANG_TAGS: Record<SpeechLang, string> = {
  id: "id-ID",
  en: "en-US",
};

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

interface ReaderPlaybackContextValue {
  ttsSupported: boolean;
  ttsState: TtsState;
  activeSpeechIdx: number | null;
  onActivateBlock: (speechIdx: number) => void;
}

const ReaderPlaybackContext = createContext<ReaderPlaybackContextValue>({
  ttsSupported: false,
  ttsState: "idle",
  activeSpeechIdx: null,
  onActivateBlock: () => {},
});

function PlayIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5.5v13l10-6.5-10-6.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h4" />
      <path d="M12 17h8" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

function FullscreenIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
    </svg>
  ) : (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  );
}

function BlockListenButton({
  speechIdx,
  previewText,
}: {
  speechIdx: number;
  previewText: string;
}) {
  const { ttsSupported, ttsState, activeSpeechIdx, onActivateBlock } =
    useContext(ReaderPlaybackContext);

  if (!ttsSupported) return null;

  const isCurrent = activeSpeechIdx === speechIdx;
  const isPlayingCurrent = isCurrent && ttsState === "playing";
  const isPausedCurrent = isCurrent && ttsState === "paused";
  const shortSnippet =
    previewText.length > 48
      ? `${previewText.slice(0, 48).trim()}...`
      : previewText;

  const label = isPlayingCurrent
    ? `Jeda pembacaan bagian: ${shortSnippet}`
    : isPausedCurrent
      ? `Lanjutkan pembacaan bagian: ${shortSnippet}`
      : `Dengarkan mulai dari bagian ini: ${shortSnippet}`;

  return (
    <button
      type="button"
      className={`${styles.blockListenBtn} ${
        isCurrent ? styles.blockListenBtnActive : ""
      }`}
      aria-label={label}
      aria-pressed={isCurrent && ttsState !== "idle"}
      onClick={() => onActivateBlock(speechIdx)}
    >
      {isPlayingCurrent ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}

function SpeechBlockNode({
  speechIdx,
  nodeId,
  previewText,
  children,
}: {
  speechIdx: number | null;
  nodeId: string;
  previewText: string;
  children: ReactNode;
}) {
  const { ttsSupported, ttsState, activeSpeechIdx } =
    useContext(ReaderPlaybackContext);
  const isActive =
    speechIdx !== null && activeSpeechIdx === speechIdx && ttsState !== "idle";

  return (
    <div
      id={nodeId}
      className={`${styles.speechBlock} ${
        !ttsSupported || speechIdx === null ? styles.speechBlockNoTrigger : ""
      } ${isActive ? styles.speakingActive : ""}`}
    >
      {speechIdx !== null && (
        <BlockListenButton speechIdx={speechIdx} previewText={previewText} />
      )}
      <div className={styles.speechBlockContent}>{children}</div>
    </div>
  );
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

function matchesSpeechLang(
  voice: SpeechSynthesisVoice,
  lang: SpeechLang,
): boolean {
  const normalized = voice.lang.trim().toLowerCase().replace("_", "-");
  return normalized === lang || normalized.startsWith(`${lang}-`);
}

function pickPreferredVoice(
  langVoices: SpeechSynthesisVoice[],
  lang: SpeechLang,
  preferredUri: string,
): SpeechSynthesisVoice | null {
  if (langVoices.length === 0) return null;
  if (preferredUri) {
    const chosen = langVoices.find((v) => v.voiceURI === preferredUri);
    if (chosen) return chosen;
  }
  const exactTag = lang === "id" ? "id-id" : "en-us";
  return (
    langVoices.find(
      (v) => v.lang.trim().toLowerCase().replace("_", "-") === exactTag,
    ) ??
    langVoices.find((v) => v.default) ??
    langVoices[0]
  );
}

function parseReaderHtml(
  html: string,
  fallbackTitle: string,
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
        <SpeechBlockNode
          key={nextKey()}
          speechIdx={speechIdx}
          nodeId={id}
          previewText={text}
        >
          {headingEl}
        </SpeechBlockNode>
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
            <SpeechBlockNode
              key={nextKey()}
              speechIdx={speechIdx}
              nodeId={blockId}
              previewText={text}
            >
              <p>{children}</p>
            </SpeechBlockNode>
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
          <SpeechBlockNode
            key={nextKey()}
            speechIdx={speechIdx}
            nodeId={blockId}
            previewText={text}
          >
            <blockquote>{children}</blockquote>
          </SpeechBlockNode>
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
                <SpeechBlockNode
                  speechIdx={speechIdx}
                  nodeId={blockId}
                  previewText={liText}
                >
                  <span>{children}</span>
                </SpeechBlockNode>
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
  const settingsTrayId = useId();
  const voiceSelectId = useId();
  const dialogTitleId = useId();
  const tocPanelId = useId();

  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [fontIdx, setFontIdx] = useState(0);
  const [spacing, setSpacing] = useState<SpacingMode>("normal");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [widthMode, setWidthMode] = useState<WidthMode>("comfortable");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const ttsSupported = useSyncExternalStore(
    emptySubscribe,
    getTtsSupportedSnapshot,
    getTtsSupportedServerSnapshot,
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speechLang, setSpeechLang] = useState<SpeechLang>("id");
  const [selectedVoiceUris, setSelectedVoiceUris] = useState<
    Record<SpeechLang, string>
  >({
    id: "",
    en: "",
  });
  const [ttsState, setTtsState] = useState<TtsState>("idle");
  const [activeSpeechIdx, setActiveSpeechIdx] = useState<number | null>(null);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [pausedNeedsRestart, setPausedNeedsRestart] = useState(false);

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
    setPausedNeedsRestart(false);
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
    return parseReaderHtml(rawHtml, title);
  }, [rawHtml, title]);

  const groupedVoices = useMemo(
    () => ({
      id: voices.filter((v) => matchesSpeechLang(v, "id")),
      en: voices.filter((v) => matchesSpeechLang(v, "en")),
    }),
    [voices],
  );

  const filteredVoices = groupedVoices[speechLang];
  const activeVoice = useMemo(
    () =>
      pickPreferredVoice(
        filteredVoices,
        speechLang,
        selectedVoiceUris[speechLang],
      ),
    [filteredVoices, speechLang, selectedVoiceUris],
  );

  const speakFrom = useCallback(
    (
      startIndex: number,
      overrides?: {
        lang?: SpeechLang;
        voice?: SpeechSynthesisVoice | null;
        rate?: number;
      },
    ) => {
      if (
        !ttsSupported ||
        !parsedDoc ||
        parsedDoc.speechBlocks.length === 0 ||
        typeof window === "undefined"
      ) {
        return;
      }

      const synth = window.speechSynthesis;
      const sessionId = ++speechSessionRef.current;
      setPausedNeedsRestart(false);
      synth.cancel();

      const langToUse = overrides?.lang ?? speechLang;
      const voiceToUse =
        overrides && "voice" in overrides ? overrides.voice : activeVoice;
      const rateToUse = overrides?.rate ?? speechRate;
      const queue = parsedDoc.speechBlocks;
      const safeStart = Math.max(0, Math.min(startIndex, queue.length - 1));

      const speakIndex = (idx: number) => {
        if (speechSessionRef.current !== sessionId) return;
        if (idx >= queue.length) {
          setTtsState("idle");
          setActiveSpeechIdx(null);
          return;
        }

        const item = queue[idx];
        const utterance = new SpeechSynthesisUtterance(item.text);
        utterance.lang = voiceToUse?.lang || SPEECH_LANG_TAGS[langToUse];
        if (voiceToUse) {
          utterance.voice = voiceToUse;
        }
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

        utterance.onerror = (event) => {
          if (speechSessionRef.current !== sessionId) return;
          if (event.error === "canceled" || event.error === "interrupted") {
            return;
          }
          setTtsState("idle");
          setActiveSpeechIdx(null);
        };

        synth.speak(utterance);
      };

      speakIndex(safeStart);
    },
    [activeVoice, parsedDoc, speechLang, speechRate, ttsSupported],
  );

  const getActiveQueueIndex = useCallback(() => {
    if (!parsedDoc || activeSpeechIdx === null) return 0;
    const idx = parsedDoc.speechBlocks.findIndex(
      (b) => b.index === activeSpeechIdx,
    );
    return idx >= 0 ? idx : 0;
  }, [activeSpeechIdx, parsedDoc]);

  const handleTogglePlayPause = useCallback(() => {
    if (!ttsSupported || !parsedDoc || parsedDoc.speechBlocks.length === 0) return;
    const synth = window.speechSynthesis;

    if (ttsState === "playing") {
      synth.pause();
      setTtsState("paused");
      return;
    }

    if (ttsState === "paused") {
      if (pausedNeedsRestart) {
        speakFrom(getActiveQueueIndex());
        return;
      }
      synth.resume();
      setTtsState("playing");
      return;
    }

    speakFrom(0);
  }, [getActiveQueueIndex, parsedDoc, pausedNeedsRestart, speakFrom, ttsState, ttsSupported]);

  const handleActivateBlock = useCallback(
    (speechIdx: number) => {
      if (!ttsSupported || !parsedDoc || parsedDoc.speechBlocks.length === 0) {
        return;
      }
      const synth = window.speechSynthesis;
      const queueIdx = parsedDoc.speechBlocks.findIndex(
        (b) => b.index === speechIdx,
      );
      const targetIdx = queueIdx >= 0 ? queueIdx : 0;

      if (activeSpeechIdx === speechIdx && ttsState === "playing") {
        synth.pause();
        setTtsState("paused");
        return;
      }

      if (activeSpeechIdx === speechIdx && ttsState === "paused") {
        if (pausedNeedsRestart) {
          speakFrom(targetIdx);
          return;
        }
        synth.resume();
        setTtsState("playing");
        return;
      }

      speakFrom(targetIdx);
    },
    [
      activeSpeechIdx,
      parsedDoc,
      pausedNeedsRestart,
      speakFrom,
      ttsState,
      ttsSupported,
    ],
  );

  const handleSpeechLangChange = useCallback(
    (nextLang: SpeechLang) => {
      if (nextLang === speechLang) return;
      setSpeechLang(nextLang);
      const nextVoices = groupedVoices[nextLang];
      const nextVoice = pickPreferredVoice(
        nextVoices,
        nextLang,
        selectedVoiceUris[nextLang],
      );

      if (ttsState === "playing") {
        speakFrom(getActiveQueueIndex(), { lang: nextLang, voice: nextVoice });
      } else if (ttsState === "paused") {
        speechSessionRef.current += 1;
        setPausedNeedsRestart(true);
        window.speechSynthesis.cancel();
      }
    },
    [
      getActiveQueueIndex,
      groupedVoices,
      selectedVoiceUris,
      speakFrom,
      speechLang,
      ttsState,
    ],
  );

  const handleVoiceSelectChange = useCallback(
    (nextUri: string) => {
      setSelectedVoiceUris((prev) => ({ ...prev, [speechLang]: nextUri }));
      const nextVoice = pickPreferredVoice(filteredVoices, speechLang, nextUri);

      if (ttsState === "playing") {
        speakFrom(getActiveQueueIndex(), { lang: speechLang, voice: nextVoice });
      } else if (ttsState === "paused") {
        speechSessionRef.current += 1;
        setPausedNeedsRestart(true);
        window.speechSynthesis.cancel();
      }
    },
    [filteredVoices, getActiveQueueIndex, speakFrom, speechLang, ttsState],
  );

  const handleSpeedChange = useCallback(
    (nextRate: number) => {
      setSpeechRate(nextRate);
      if (ttsState === "playing") {
        speakFrom(getActiveQueueIndex(), { rate: nextRate });
      } else if (ttsState === "paused") {
        speechSessionRef.current += 1;
        setPausedNeedsRestart(true);
        window.speechSynthesis.cancel();
      }
    },
    [getActiveQueueIndex, speakFrom, ttsState],
  );

  const jumpToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  const fontSizePct = FONT_SIZES[fontIdx];
  const hasContent = Boolean(
    !loading && !error && parsedDoc && parsedDoc.blocks.length > 0,
  );
  const canSpeak = Boolean(
    ttsSupported && parsedDoc && parsedDoc.speechBlocks.length > 0,
  );
  const activeQueuePos = getActiveQueueIndex();

  const playbackContextValue = useMemo<ReaderPlaybackContextValue>(
    () => ({
      ttsSupported,
      ttsState,
      activeSpeechIdx,
      onActivateBlock: handleActivateBlock,
    }),
    [activeSpeechIdx, handleActivateBlock, ttsState, ttsSupported],
  );

  const renderReaderBody = (inDialog: boolean) => (
    <div
      className={`${styles.readerShell} ${styles[`theme_${theme}`]} ${
        inDialog ? styles.readerShellFullscreen : ""
      }`}
    >
      <div
        className={styles.toolbarSticky}
        role="region"
        aria-label="Kontrol baca dan suara Web Reader"
      >
        <div className={styles.toolbarPrimary}>
          {/* Audio controls */}
          {ttsSupported ? (
            <div className={styles.toolbarCluster}>
              <button
                type="button"
                className={`${styles.ctrlBtn} ${styles.ttsPlayBtn}`}
                disabled={!canSpeak}
                onClick={handleTogglePlayPause}
              >
                {ttsState === "playing" ? <PauseIcon /> : <PlayIcon />}
                <span>
                  {ttsState === "playing"
                    ? "Jeda"
                    : ttsState === "paused"
                      ? "Lanjutkan"
                      : "Dengarkan"}
                </span>
              </button>

              {ttsState !== "idle" && (
                <button
                  type="button"
                  className={styles.ctrlBtn}
                  aria-label="Stop pembacaan suara"
                  onClick={stopSpeech}
                >
                  <StopIcon />
                  <span>Stop</span>
                </button>
              )}

              <div
                className={styles.segmented}
                role="group"
                aria-label="Bahasa suara"
              >
                {(
                  [
                    ["id", "ID", "Bahasa suara Indonesia"],
                    ["en", "EN", "Bahasa suara Inggris"],
                  ] as const
                ).map(([code, label, ariaLabel]) => (
                  <button
                    key={code}
                    type="button"
                    className={`${styles.ctrlBtn} ${
                      speechLang === code ? styles.ctrlBtnActive : ""
                    }`}
                    aria-label={ariaLabel}
                    aria-pressed={speechLang === code}
                    onClick={() => handleSpeechLangChange(code)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <span className={styles.ttsUnavailable}>
              Suara browser tidak tersedia
            </span>
          )}

          {/* Text size & 3 themes */}
          <div className={styles.toolbarCluster}>
            <div
              className={styles.segmented}
              role="group"
              aria-label="Ukuran teks"
            >
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

            <div
              className={styles.segmented}
              role="group"
              aria-label="Tema baca"
            >
              {(
                [
                  ["light", "Terang"],
                  ["sepia", "Sepia"],
                  ["dark", "Gelap"],
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

          {/* Secondary disclosure, fullscreen, external tab */}
          <div className={styles.toolbarActions}>
            <button
              type="button"
              className={`${styles.ctrlBtn} ${
                settingsOpen ? styles.ctrlBtnActive : ""
              }`}
              aria-expanded={settingsOpen}
              aria-controls={settingsTrayId}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <SettingsIcon />
              <span>Pengaturan</span>
            </button>

            <button
              type="button"
              className={`${styles.ctrlBtn} ${styles.fullscreenBtn}`}
              aria-label={
                inDialog ? "Tutup layar penuh" : "Buka mode layar penuh"
              }
              onClick={() => setIsFullscreen((v) => !v)}
            >
              <FullscreenIcon expanded={inDialog} />
              <span>{inDialog ? "Tutup" : "Layar Penuh"}</span>
            </button>

            <a
              href={readerHref}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.newTabLink}
            >
              Buka di tab baru
              <span className="sr-only"> (buka di tab baru)</span>
            </a>
          </div>
        </div>

        {ttsState !== "idle" && parsedDoc && activeSpeechIdx !== null && (
          <div className={styles.ttsLiveStrip} aria-live="polite">
            <span>
              {ttsState === "paused" ? "Dijeda pada" : "Membacakan"} bagian{" "}
              {activeQueuePos + 1} dari {parsedDoc.speechBlocks.length} (
              {SPEECH_LANG_TAGS[speechLang]}, {speechRate.toFixed(speechRate === 1 || speechRate === 1.5 ? 1 : 2)}x)
            </span>
          </div>
        )}
      </div>

      {/* Secondary settings tray */}
      {settingsOpen && (
        <div
          id={settingsTrayId}
          className={styles.settingsTray}
          role="region"
          aria-label="Pengaturan lanjutan Web Reader"
        >
          <div className={styles.settingsGrid}>
            <div className={styles.settingBlock}>
              <label htmlFor={voiceSelectId} className={styles.settingLabel}>
                Pilihan Suara ({speechLang === "id" ? "Indonesia" : "English"})
              </label>
              {ttsSupported ? (
                <>
                  <select
                    id={voiceSelectId}
                    className={styles.voiceSelect}
                    value={selectedVoiceUris[speechLang]}
                    disabled={filteredVoices.length === 0}
                    onChange={(e) => handleVoiceSelectChange(e.target.value)}
                  >
                    <option value="">
                      {filteredVoices.length > 0
                        ? `Otomatis (${activeVoice?.name ?? SPEECH_LANG_TAGS[speechLang]})`
                        : `Gunakan tag bahasa ${SPEECH_LANG_TAGS[speechLang]}`}
                    </option>
                    {filteredVoices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                  {filteredVoices.length === 0 && (
                    <p className={styles.settingNote}>
                      {speechLang === "id"
                        ? "OS/browser ini belum memiliki suara lokal Bahasa Indonesia. Pemutar tetap mengirim lang=\"id-ID\" agar mesin suara browser memakainya jika tersedia."
                        : "OS/browser ini belum memiliki suara lokal Bahasa Inggris. Pemutar tetap mengirim lang=\"en-US\"."}
                    </p>
                  )}
                </>
              ) : (
                <p className={styles.settingNote}>
                  Web Speech API tidak didukung di browser ini.
                </p>
              )}
            </div>

            <div className={styles.settingBlock}>
              <span className={styles.settingLabel}>Kecepatan Suara</span>
              <div
                className={styles.segmented}
                role="group"
                aria-label="Kecepatan suara"
              >
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
            </div>

            <div className={styles.settingBlock}>
              <span className={styles.settingLabel}>Spasi Lega (WCAG 1.4.12)</span>
              <div
                className={styles.segmented}
                role="group"
                aria-label="Spasi teks WCAG 1.4.12"
              >
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
                  Lega
                </button>
              </div>
            </div>

            <div className={styles.settingBlock}>
              <span className={styles.settingLabel}>Lebar Kolom</span>
              <div
                className={styles.segmented}
                role="group"
                aria-label="Lebar kolom baca"
              >
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

            <div className={styles.settingBlock}>
              <span className={styles.settingLabel}>Daftar Isi</span>
              {parsedDoc && parsedDoc.outline.length > 0 ? (
                <button
                  type="button"
                  className={`${styles.ctrlBtn} ${
                    tocOpen ? styles.ctrlBtnActive : ""
                  }`}
                  aria-expanded={tocOpen}
                  aria-controls={tocPanelId}
                  onClick={() => setTocOpen((v) => !v)}
                >
                  {tocOpen
                    ? `Sembunyikan Daftar Isi (${parsedDoc.outline.length})`
                    : `Tampilkan Daftar Isi (${parsedDoc.outline.length})`}
                </button>
              ) : (
                <p className={styles.settingNote}>
                  Tidak ada subjudul pada halaman ini.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={styles.readerBodyLayout}>
        {tocOpen && parsedDoc && parsedDoc.outline.length > 0 && (
          <nav
            id={tocPanelId}
            className={styles.tocPanel}
            aria-label="Daftar isi halaman"
          >
            <div className={styles.tocHeader}>
              <p className={styles.tocTitle}>Daftar Isi</p>
              <button
                type="button"
                className={styles.tocCloseBtn}
                aria-label="Tutup daftar isi"
                onClick={() => setTocOpen(false)}
              >
                Tutup
              </button>
            </div>
            <ol className={styles.tocList}>
              {parsedDoc.outline.map((item) => (
                <li
                  key={item.id}
                  style={{
                    paddingLeft: `${Math.max(0, item.level - 2) * 12}px`,
                  }}
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

          {hasContent && parsedDoc && (
            <article
              className={`${styles.article} ${
                spacing === "relaxed"
                  ? styles.spacingRelaxed
                  : styles.spacingNormal
              } ${widthMode === "wide" ? styles.widthWide : styles.widthComfortable}`}
              style={{ fontSize: `${fontSizePct}%` }}
            >
              <header className={styles.articleHeader}>
                {inDialog ? (
                  <h1 id={dialogTitleId}>{parsedDoc.title}</h1>
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

              <ReaderPlaybackContext.Provider value={playbackContextValue}>
                <div className={styles.articleContent}>{parsedDoc.blocks}</div>
              </ReaderPlaybackContext.Provider>
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
        aria-labelledby={hasContent && isFullscreen ? dialogTitleId : undefined}
        aria-label={hasContent && isFullscreen ? undefined : title}
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
