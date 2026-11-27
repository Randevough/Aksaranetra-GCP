"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuditMode } from "@/lib/audit-api";
import { DEMO_AUDITS } from "@/lib/demo-audits";
import styles from "./page.module.css";

const EXAMPLE_SITES = [
  { url: "https://sulselprov.go.id", label: "sulselprov.go.id" },
  { url: "https://kepriprov.go.id", label: "kepriprov.go.id" },
];

function normalizePublicUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export default function PeriksaPage() {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<AuditMode>("single");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const prefill = search.get("url");
    const prefillMode = search.get("mode");
    if (prefill) queueMicrotask(() => setUrl(prefill));
    if (prefillMode === "multi") queueMicrotask(() => setMode("multi"));
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Masukkan alamat halaman terlebih dahulu.");
      inputRef.current?.focus();
      return;
    }
    const normalized = normalizePublicUrl(trimmed);
    if (!normalized) {
      setError(
        "Format alamat belum valid. Contoh: https://contoh.go.id atau contoh.go.id.",
      );
      inputRef.current?.focus();
      return;
    }
    setError("");
    const query =
      mode === "multi"
        ? `url=${encodeURIComponent(normalized)}&mode=multi&pages=3`
        : `url=${encodeURIComponent(normalized)}`;
    router.push(`/result?${query}`);
  };

  return (
    <main className={styles.main}>
      <div className="container">
        <section
          className={styles.formPanel}
          aria-labelledby="audit-title"
        >
          <div className={styles.formIntro}>
            <h1 id="audit-title">Periksa satu halaman</h1>
            <p>Tempel alamat halaman yang ingin diperiksa.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.inputGroup}>
              <label htmlFor="url-input" className="label">
                Alamat halaman
              </label>
              <input
                ref={inputRef}
                id="url-input"
                type="text"
                inputMode="url"
                className={`input ${styles.urlInput}`}
                placeholder="https://contoh.go.id/layanan"
                value={url}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setUrl(event.target.value);
                  if (error) setError("");
                }}
                aria-invalid={error ? "true" : "false"}
                aria-describedby={error ? "url-hint url-error" : "url-hint"}
                required
                autoComplete="url"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
              <p id="url-hint" className="hint">
                Gunakan halaman yang bisa dibuka siapa saja, tanpa perlu masuk
                akun. Protokol https:// otomatis ditambahkan jika belum ditulis.
              </p>
              {error && (
                <p id="url-error" className={styles.errorText} role="alert">
                  {error}
                </p>
              )}
            </div>

            <fieldset className={styles.modeFieldset}>
              <legend className="label">Cakupan pemeriksaan</legend>
              <div className={styles.modeSegmented}>
                <input
                  type="radio"
                  id="mode-single"
                  name="audit-mode"
                  value="single"
                  checked={mode === "single"}
                  onChange={() => setMode("single")}
                  className={styles.modeRadio}
                  aria-describedby="mode-helper"
                />
                <label htmlFor="mode-single" className={styles.modeOption}>
                  1 Halaman (Cepat)
                </label>

                <input
                  type="radio"
                  id="mode-multi"
                  name="audit-mode"
                  value="multi"
                  checked={mode === "multi"}
                  onChange={() => setMode("multi")}
                  className={styles.modeRadio}
                  aria-describedby="mode-helper"
                />
                <label htmlFor="mode-multi" className={styles.modeOption}>
                  Multi-Halaman (3 Halaman)
                </label>
              </div>
              <p id="mode-helper" className="hint">
                Pilih 1 halaman untuk pemeriksaan cepat, atau Multi-Halaman
                untuk menelusuri hingga 3 halaman pada domain yang sama.
              </p>
            </fieldset>

            <button
              type="submit"
              className={`btn btn-primary ${styles.submitBtn}`}
            >
              Mulai pemeriksaan
            </button>
          </form>

          <div className={styles.examples}>
            <span className={styles.examplesLabel}>Coba contoh</span>
            <div className={styles.exampleButtons}>
              {EXAMPLE_SITES.map((site) => (
                <button
                  key={site.url}
                  type="button"
                  className={styles.exampleButton}
                  onClick={() => {
                    setUrl(site.url);
                    setError("");
                    inputRef.current?.focus();
                  }}
                >
                  {site.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.demoRow}>
            <span className={styles.examplesLabel}>Lihat Demo Interaktif</span>
            <div className={styles.exampleButtons}>
              {DEMO_AUDITS.map((preset) => (
                <Link
                  key={preset.slug}
                  href={`/result?demo=${encodeURIComponent(preset.slug)}`}
                  className={styles.demoLink}
                >
                  {preset.domain}
                </Link>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
