"use client";

import { useState } from "react";
import {
  FASTPASS_TOTAL_ITEMS,
  fastPassStorageKey,
  type FastPassStatus,
} from "./wave2-types";
import styles from "./GuidedFastPass.module.css";

interface FastPassItem {
  id: string;
  title: string;
  wcag: string;
  question: string;
}

const FASTPASS_ITEMS: FastPassItem[] = [
  {
    id: "alt-meaning",
    title: "Deskripsi gambar bermakna",
    wcag: "WCAG 1.1.1",
    question:
      "Pastikan gambar informatif punya teks alt jelas, dan gambar hiasan memakai alt=\"\".",
  },
  {
    id: "tab-order",
    title: "Urutan Tab logis",
    wcag: "WCAG 2.4.3 · 2.4.7",
    question:
      "Tekan Tab dari atas ke bawah. Pastikan fokus mengikuti alur baca dan indikator fokus terlihat.",
  },
  {
    id: "form-errors",
    title: "Pesan error formulir jelas",
    wcag: "WCAG 3.3.1 · 3.3.3",
    question:
      "Kirim formulir kosong atau salah. Pastikan pesan galat menyebut nama kolom dan saran perbaikan, bukan warna saja.",
  },
  {
    id: "media-captions",
    title: "Subtitle atau transkrip media",
    wcag: "WCAG 1.2.1 · 1.2.2",
    question:
      "Pastikan video atau audio penting punya takarir sinkron atau transkrip (tandai Lolos jika tidak ada media).",
  },
  {
    id: "overlay-contrast",
    title: "Teks di atas foto atau gradasi terbaca",
    wcag: "WCAG 1.4.3",
    question:
      "Pastikan judul atau tombol di atas foto dan gradasi tetap terbaca jelas di semua sisi.",
  },
  {
    id: "auth-captcha",
    title: "Autentikasi atau CAPTCHA tidak mengunci tunanetra",
    wcag: "WCAG 3.3.8",
    question:
      "Pastikan masuk atau kirim formulir tidak hanya mengandalkan CAPTCHA gambar tanpa alternatif non-visual.",
  },
];

type FastPassMap = Record<string, FastPassStatus>;

function loadFastPass(jobId: string): FastPassMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(fastPassStorageKey(jobId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as FastPassMap;
  } catch {
    return {};
  }
}

export default function GuidedFastPass({ jobId }: { jobId: string }) {
  const [statuses, setStatuses] = useState<FastPassMap>(() =>
    loadFastPass(jobId),
  );
  const [liveStatus, setLiveStatus] = useState("");

  const updateItem = (item: FastPassItem, next: FastPassStatus) => {
    setStatuses((prev) => {
      const updated = { ...prev, [item.id]: next };
      try {
        window.localStorage.setItem(
          fastPassStorageKey(jobId),
          JSON.stringify(updated),
        );
      } catch {
        // Ignore storage quota or private browsing errors
      }
      return updated;
    });
    const label =
      next === "pass" ? "Lolos" : next === "fail" ? "Bermasalah" : "Belum";
    setLiveStatus(`${item.title} ditandai ${label}.`);
  };

  const resetAll = () => {
    setStatuses({});
    try {
      window.localStorage.removeItem(fastPassStorageKey(jobId));
    } catch {
      // Ignore storage errors
    }
    setLiveStatus("Semua poin cek manual diatur ulang ke Belum.");
  };

  let passed = 0;
  let failed = 0;
  for (const item of FASTPASS_ITEMS) {
    const st = statuses[item.id] ?? "untested";
    if (st === "pass") passed += 1;
    else if (st === "fail") failed += 1;
  }
  const checked = passed + failed;
  const percent = Math.round((checked / FASTPASS_TOTAL_ITEMS) * 100);

  return (
    <section className={styles.section} aria-label="Daftar periksa manual 5 menit">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {liveStatus}
      </p>

      <div className={styles.introCard}>
        <div className={styles.introCopy}>
          <h2 className={styles.introTitle}>
            Cek Manual Cepat (5 Menit)
          </h2>
          <p className={styles.introDesc}>
            Uji otomatis hanya mencakup ~30–57% kriteria WCAG. Cek 6 poin ini
            untuk memastikan gambar, urutan Tab, dan formulir nyaman dipakai.
            Hasil tersimpan di peramban dan masuk ke Pernyataan Aksesibilitas.
          </p>
        </div>

        <div className={styles.progressPanel}>
          <div className={styles.progressCounts}>
            <span>
              {checked} dari {FASTPASS_TOTAL_ITEMS} diperiksa
            </span>
            <span className={styles.countPass}>· {passed} lolos</span>
            {failed > 0 && (
              <span className={styles.countFail}>· {failed} bermasalah</span>
            )}
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label="Progres cek manual"
            aria-valuenow={checked}
            aria-valuemin={0}
            aria-valuemax={FASTPASS_TOTAL_ITEMS}
          >
            <div
              className={styles.progressFill}
              style={{ width: `${percent}%` }}
            />
          </div>
          {checked > 0 && (
            <button
              type="button"
              className={styles.resetBtn}
              onClick={resetAll}
            >
              Atur ulang cek manual
            </button>
          )}
        </div>
      </div>

      <ol className={styles.checklist}>
        {FASTPASS_ITEMS.map((item, idx) => {
          const current = statuses[item.id] ?? "untested";
          const cardTone =
            current === "pass"
              ? styles.checkCardPass
              : current === "fail"
                ? styles.checkCardFail
                : "";
          return (
            <li key={item.id} className={`${styles.checkCard} ${cardTone}`}>
              <div className={styles.checkBody}>
                <div className={styles.checkTop}>
                  <span className={styles.checkIndex} aria-hidden="true">
                    {idx + 1}
                  </span>
                  <h3 className={styles.checkTitle}>{item.title}</h3>
                  <span className={styles.wcagBadge}>{item.wcag}</span>
                </div>
                <p className={styles.checkHint}>{item.question}</p>
              </div>

              <div
                className={styles.stateGroup}
                role="group"
                aria-label={`Status untuk ${item.title}`}
              >
                <button
                  type="button"
                  aria-pressed={current === "untested"}
                  className={`${styles.stateBtn} ${
                    current === "untested" ? styles.stateBtnActiveUntested : ""
                  }`}
                  onClick={() => updateItem(item, "untested")}
                >
                  Belum
                </button>
                <button
                  type="button"
                  aria-pressed={current === "pass"}
                  className={`${styles.stateBtn} ${
                    current === "pass" ? styles.stateBtnActivePass : ""
                  }`}
                  onClick={() => updateItem(item, "pass")}
                >
                  Lolos
                </button>
                <button
                  type="button"
                  aria-pressed={current === "fail"}
                  className={`${styles.stateBtn} ${
                    current === "fail" ? styles.stateBtnActiveFail : ""
                  }`}
                  onClick={() => updateItem(item, "fail")}
                >
                  Bermasalah
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
