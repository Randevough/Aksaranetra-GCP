"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AuditIssue, PageReadiness, TabStop } from "@/lib/audit-api";
import styles from "./VisualInspector.module.css";

type ModeKey = "pins" | "focus" | "compare";

const IMPACT_LABEL: Record<AuditIssue["impact"], string> = {
  critical: "Kritis",
  serious: "Serius",
  moderate: "Sedang",
  minor: "Rendah",
};

export default function VisualInspector({
  beforeUrl,
  afterUrl,
  issues = [],
  tabStops = [],
  readiness,
  selectedIssueId,
  onSelectIssue,
  onJumpToIssue,
}: {
  beforeUrl?: string | null;
  afterUrl?: string | null;
  issues?: AuditIssue[];
  tabStops?: TabStop[];
  readiness?: PageReadiness;
  selectedIssueId?: string | null;
  onSelectIssue?: (issueId: string) => void;
  onJumpToIssue?: (issueId: string) => void;
}) {
  const [activeMode, setActiveMode] = useState<ModeKey>("pins");
  const [sliderPos, setSliderPos] = useState(50);
  const [beforeBroken, setBeforeBroken] = useState(false);
  const [afterBroken, setAfterBroken] = useState(false);

  const tabRefs = useRef<Record<ModeKey, HTMLButtonElement | null>>({
    pins: null,
    focus: null,
    compare: null,
  });

  const stageWidth = readiness?.viewport?.width || 1280;
  const stageHeight = readiness?.pageHeight || readiness?.viewport?.height || 800;

  const pinnedIssues = useMemo(
    () => issues.filter((item) => item.boundingBox !== null),
    [issues],
  );

  const selectedIssue = useMemo(
    () =>
      pinnedIssues.find((item) => item.id === selectedIssueId) ??
      pinnedIssues[0] ??
      null,
    [pinnedIssues, selectedIssueId],
  );

  const focusFlags = useMemo(() => {
    const obscuredCount = tabStops.filter((s) => s.obscured).length;
    const noFocusCount = tabStops.filter((s) => !s.hasVisibleFocus).length;
    return { obscuredCount, noFocusCount };
  }, [tabStops]);

  const tabOrder: ModeKey[] = ["pins", "focus", "compare"];
  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, current: ModeKey) => {
    const idx = tabOrder.indexOf(current);
    let nextIdx = -1;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabOrder.length;
    else if (e.key === "ArrowLeft")
      nextIdx = (idx - 1 + tabOrder.length) % tabOrder.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = tabOrder.length - 1;

    if (nextIdx !== -1) {
      e.preventDefault();
      const nextTab = tabOrder[nextIdx];
      setActiveMode(nextTab);
      tabRefs.current[nextTab]?.focus();
    }
  };

  const hasBefore = Boolean(beforeUrl) && !beforeBroken;
  const hasAfter = Boolean(afterUrl) && !afterBroken;
  const fullImageHref = activeMode === "compare" ? afterUrl || beforeUrl : beforeUrl || afterUrl;

  const toPercentX = (x: number) =>
    Math.max(2, Math.min(97, (x / stageWidth) * 100));
  const toPercentY = (y: number) =>
    Math.max(2, Math.min(96, (y / stageHeight) * 100));

  return (
    <section className={styles.wrapper} aria-label="Inspeksi visual halaman">
      <div className={styles.toolbarRow}>
        <div
          role="tablist"
          aria-label="Mode inspeksi visual halaman"
          className={styles.tabList}
        >
          <button
            ref={(el) => {
              tabRefs.current.pins = el;
            }}
            id="inspector-tab-pins"
            type="button"
            role="tab"
            aria-selected={activeMode === "pins"}
            tabIndex={activeMode === "pins" ? 0 : -1}
            className={styles.tabBtn}
            onClick={() => setActiveMode("pins")}
            onKeyDown={(e) => handleTabKeyDown(e, "pins")}
          >
            Pin Temuan ({pinnedIssues.length})
          </button>
          <button
            ref={(el) => {
              tabRefs.current.focus = el;
            }}
            id="inspector-tab-focus"
            type="button"
            role="tab"
            aria-selected={activeMode === "focus"}
            tabIndex={activeMode === "focus" ? 0 : -1}
            className={styles.tabBtn}
            onClick={() => setActiveMode("focus")}
            onKeyDown={(e) => handleTabKeyDown(e, "focus")}
          >
            Alur Fokus Keyboard ({tabStops.length})
          </button>
          <button
            ref={(el) => {
              tabRefs.current.compare = el;
            }}
            id="inspector-tab-compare"
            type="button"
            role="tab"
            aria-selected={activeMode === "compare"}
            tabIndex={activeMode === "compare" ? 0 : -1}
            className={styles.tabBtn}
            onClick={() => setActiveMode("compare")}
            onKeyDown={(e) => handleTabKeyDown(e, "compare")}
          >
            Slider Sebelum &amp; Sesudah
          </button>
        </div>

        {fullImageHref && (
          <a
            href={fullImageHref}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.fullImageLink}
          >
            Buka gambar penuh
            <span className="sr-only"> (buka di tab baru)</span>
          </a>
        )}
      </div>

      {/* Mode 1: Pin Temuan */}
      <div
        role="tabpanel"
        aria-labelledby="inspector-tab-pins"
        hidden={activeMode !== "pins"}
      >
        <div className={styles.panelBox}>
          {hasBefore ? (
            <div
              className={styles.canvasWrap}
              style={{ aspectRatio: `${stageWidth} / ${stageHeight}` }}
            >
              <img
                src={beforeUrl!}
                alt="Tangkapan layar halaman sebelum perbaikan dengan penanda lokasi temuan"
                className={styles.canvasImg}
                onError={() => setBeforeBroken(true)}
              />
              {pinnedIssues.map((issue, idx) => {
                const box = issue.boundingBox!;
                const left = toPercentX(box.x);
                const top = toPercentY(box.y);
                const active = selectedIssue?.id === issue.id;
                return (
                  <button
                    key={issue.id}
                    type="button"
                    className={`${styles.pin} ${styles[`pin_${issue.impact}`]} ${
                      active ? styles.pinActive : ""
                    }`}
                    style={{ left: `${left}%`, top: `${top}%` }}
                    aria-label={`Pin ${idx + 1}: ${IMPACT_LABEL[issue.impact]}, ${issue.titleId}`}
                    aria-pressed={active}
                    onClick={() => onSelectIssue?.(issue.id)}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyNotice}>
              <p>
                Tangkapan layar awal belum tersedia untuk halaman ini. Gunakan
                tab Daftar Temuan untuk meninjau setiap elemen.
              </p>
            </div>
          )}

          {selectedIssue && (
            <div className={styles.pinDetailBar} aria-live="polite">
              <div className={styles.pinDetailText}>
                <span
                  className={`${styles.badge} ${styles[`badge_${selectedIssue.impact}`]}`}
                >
                  {IMPACT_LABEL[selectedIssue.impact]}
                </span>
                <strong>{selectedIssue.titleId}</strong>
                <code>{selectedIssue.selector}</code>
              </div>
              {onJumpToIssue && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onJumpToIssue(selectedIssue.id)}
                >
                  Lihat detail temuan
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mode 2: Alur Fokus Keyboard */}
      <div
        role="tabpanel"
        aria-labelledby="inspector-tab-focus"
        hidden={activeMode !== "focus"}
      >
        <div className={styles.panelBox}>
          <div className={styles.focusSummaryRow}>
            <span>
              Total titik Tab: <strong>{tabStops.length}</strong>
            </span>
            <span className={focusFlags.obscuredCount > 0 ? styles.flagWarn : styles.flagOk}>
              Tertutup elemen (WCAG 2.4.11):{" "}
              <strong>{focusFlags.obscuredCount}</strong>
            </span>
            <span className={focusFlags.noFocusCount > 0 ? styles.flagWarn : styles.flagOk}>
              Tanpa indikator fokus (WCAG 2.4.7):{" "}
              <strong>{focusFlags.noFocusCount}</strong>
            </span>
          </div>

          {hasBefore && tabStops.length > 0 ? (
            <div
              className={styles.canvasWrap}
              style={{ aspectRatio: `${stageWidth} / ${stageHeight}` }}
            >
              <img
                src={beforeUrl!}
                alt="Visualisasi urutan fokus keyboard pada halaman sebelum perbaikan"
                className={styles.canvasImg}
                onError={() => setBeforeBroken(true)}
              />
              <svg
                className={styles.focusSvg}
                viewBox={`0 0 ${stageWidth} ${stageHeight}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline
                  fill="none"
                  stroke="#1d4ed8"
                  strokeWidth="3"
                  strokeDasharray="8 6"
                  points={tabStops
                    .map(
                      (s) =>
                        `${s.rect.x + s.rect.width / 2},${s.rect.y + s.rect.height / 2}`,
                    )
                    .join(" ")}
                />
              </svg>
              {tabStops.map((stop) => {
                const hasIssue = stop.obscured || !stop.hasVisibleFocus;
                return (
                  <span
                    key={`${stop.index}-${stop.selector}`}
                    className={`${styles.tabMarker} ${
                      hasIssue ? styles.tabMarkerWarn : styles.tabMarkerOk
                    }`}
                    style={{
                      left: `${toPercentX(stop.rect.x)}%`,
                      top: `${toPercentY(stop.rect.y)}%`,
                    }}
                    title={`#${stop.index} ${stop.label || stop.tag}`}
                  >
                    {stop.index}
                  </span>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyNotice}>
              <p>Data jejak urutan Tab belum tersedia pada pemeriksaan ini.</p>
            </div>
          )}

          {tabStops.length > 0 && (
            <div
              className={styles.tableWrap}
              tabIndex={0}
              role="region"
              aria-label="Daftar urutan fokus keyboard"
            >
              <table className={styles.focusTable}>
                <thead>
                  <tr>
                    <th scope="col">Urutan</th>
                    <th scope="col">Elemen &amp; Label</th>
                    <th scope="col">Fokus Terlihat (2.4.7)</th>
                    <th scope="col">Tidak Tertutup (2.4.11)</th>
                  </tr>
                </thead>
                <tbody>
                  {tabStops.map((stop) => (
                    <tr key={`${stop.index}-${stop.selector}`}>
                      <td>#{stop.index}</td>
                      <td>
                        <strong>{stop.label || "(tanpa label)"}</strong>{" "}
                        <code>{stop.tag}</code>
                      </td>
                      <td>
                        {stop.hasVisibleFocus
                          ? "Terlihat"
                          : "Tidak terlihat (perlu perbaikan)"}
                      </td>
                      <td>
                        {stop.obscured
                          ? "Tertutup elemen lain (perlu perbaikan)"
                          : "Aman"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Mode 3: Slider Sebelum & Sesudah */}
      <div
        role="tabpanel"
        aria-labelledby="inspector-tab-compare"
        hidden={activeMode !== "compare"}
      >
        <div className={styles.panelBox}>
          {hasBefore && hasAfter ? (
            <div className={styles.compareWrap}>
              <div className={styles.compareControls}>
                <label htmlFor="compare-slider" className={styles.compareLabel}>
                  Geser pembanding Sebelum ({sliderPos}%) vs Sesudah ({100 - sliderPos}%)
                </label>
                <input
                  id="compare-slider"
                  type="range"
                  min={0}
                  max={100}
                  value={sliderPos}
                  onChange={(e) => setSliderPos(Number(e.target.value))}
                  className={styles.rangeInput}
                />
              </div>

              <div
                className={styles.compareStage}
                style={{ aspectRatio: `${stageWidth} / ${stageHeight}` }}
              >
                <img
                  src={afterUrl!}
                  alt="Tampilan halaman setelah perbaikan aksesibilitas"
                  className={styles.compareImgBase}
                  onError={() => setAfterBroken(true)}
                />
                <div
                  className={styles.compareOverlay}
                  style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                >
                  <img
                    src={beforeUrl!}
                    alt="Tampilan halaman sebelum perbaikan aksesibilitas"
                    className={styles.compareImgTop}
                    onError={() => setBeforeBroken(true)}
                  />
                </div>
                <div
                  className={styles.compareDivider}
                  style={{ left: `${sliderPos}%` }}
                  aria-hidden="true"
                >
                  <span className={styles.compareHandle}>&lt;|&gt;</span>
                </div>
                <span className={styles.compareTagBefore}>Sebelum</span>
                <span className={styles.compareTagAfter}>Sesudah</span>
              </div>
            </div>
          ) : (
            <div className={styles.emptyNotice}>
              <p>
                Perbandingan visual membutuhkan gambar sebelum dan sesudah
                perbaikan. Salah satu tangkapan layar tidak tersedia pada audit ini.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
