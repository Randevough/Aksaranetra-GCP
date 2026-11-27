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
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    const prefill = new URLSearchParams(window.location.search).get("url");
    if (prefill) queueMicrotask(() => setUrl(prefill));
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
    router.push(`/result?url=${encodeURIComponent(normalized)}`);
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
