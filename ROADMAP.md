# Roadmap Pengembangan AksaraNetra (Next Sessions)

Dokumen rencana strategis dan teknis untuk pengembangan fitur, UI/UX, dan infrastruktur AksaraNetra.

---

## 1. Roadmap Fitur (Product & Engineering)

Fokus: Memperkuat nilai kepatuhan regulasi Indonesia, kemudahan audit lanjutan, dan pelaporan institusional.

### Prioritas 1: Segera (Sprint 1)
- [ ] **Export Data Lengkap (JSON & CSV Checklist)**
  - Endpoint `GET /audits/{id}/report.json`: Ekspor struktur data audit mentah untuk integrasi CI/CD klien.
  - Endpoint `GET /audits/{id}/report.csv`: Format spreadsheet kepatuhan berisi kolom `Rule_ID`, `Severity`, `Selector`, `Status`, `WCAG_SC`, dan `Pasal_Kominfo`.
- [ ] **Preset Regulasi Indonesia**
  - Pemetaan statis aturan axe-core ke hukum Indonesia:
    - UU No. 8/2016 Pasal 19 (Hak Aksesibilitas Informasi & Komunikasi bagi Penyandang Disabilitas).
    - Permen Kominfo No. 8/2021 (Standar Teknis Aksesibilitas Situs Instansi Penyelenggara Publik).
    - Standar Internasional WCAG 2.1 Level AA / AAA.
  - Opsi filter preset saat mengajukan periksa URL baru.
- [ ] **Visual Before vs After Slider**
  - Engine Playwright mengambil tangkapan layar `before.png` (sebelum patch) dan `after.png` (setelah patch).
  - Komponen slider perbandingan visual interaktif di halaman `/result` menggunakan CSS `clip-path` native.

### Prioritas 2: Menengah (Sprint 2)
- [ ] **Dynamic Compliance Badge (.svg)**
  - Endpoint `GET /badges/{domain}.svg` untuk menampilkan skor kepatuhan terkini.
  - Snippet embed HTML/Markdown untuk dipasang di footer web klien.
- [ ] **Notifikasi Webhook & Email**
  - Opsi input email / webhook callback URL pada formulir periksa.
  - Notifikasi dikirim otomatis via queue worker Laravel setelah audit dan render PDF tuntas.
- [ ] **Bounded Sub-route Audit (Multi-page crawl)**
  - Audit hingga 3–5 sub-rute utama secara berantai (depth: 1) dengan agregasi skor domain.

---

## 2. Roadmap UI/UX & Kepatuhan WCAG 2.1 AAA (Frontend)

Fokus: Menjadikan AksaraNetra sebagai standar tertinggi antarmuka aksesibel (dogfooding WCAG AAA).

### A. Aksesibilitas Internal Platform
- [ ] **Floating A11y Toolbar**:
  - **High Contrast Toggle**: Standard Dark (kontras 7:1) dan Yellow-on-Black (kontras 21:1 untuk low vision).
  - **Font Scaler**: Pengatur ukuran teks (100%, 125%, 150%, 200%) via CSS custom property `--a11y-font-scale`.
  - **Focus Indicator AAA**: Outline fokus tebal 3px solid dual-ring (`:focus-visible`) di seluruh elemen interaktif.
  - **Dukungan `@media (forced-colors: active)`** untuk Windows High Contrast Mode.
- [ ] **Screen Reader Live Announcements**:
  - `aria-live="polite"` pada pembaruan progres audit dan status filtering.

### B. Visualisasi Hasil Audit (`/result`)
- [ ] **Severity Breakdown Card**:
  - Bar segmen interaktif membagi temuan ke 4 tingkatan:
    - **Kritis (Critical)**: Penghalang akses fatal (warna kontras tinggi AAA).
    - **Serius (Serious)**: Masalah fungsional berat.
    - **Sedang (Moderate)**: Ketidaksempurnaan navigasi/label.
    - **Rendah (Minor)**: Perbaikan semantik ringan.
  - Filter interaktif daftar temuan berdasarkan tingkatan keparahan.
- [ ] **Interactive DOM Inspector**:
  - Penampil cuplikan kode HTML *Before* vs *After* untuk tiap aturan yang diperbaiki.
  - Tombol salin kode perbaikan dengan feedback visual dan audio cue.

### C. Peningkatan Reader Mode
- [ ] **Tipografi Adaptif**:
  - Pilihan font: Font sistem, Atkinson Hyperlegible, dan OpenDyslexic (woff2 lokal).
  - Pengatur jarak baris (line-height 1.5 - 2.0) dan spasi kata.
  - **Bionic Reading Toggle**: Penebalan huruf awal tiap kata untuk pembaca disleksia & ADHD.

---

## 3. Roadmap Infrastruktur & Cloudflare (DevOps)

Fokus: Domain kustom, HTTPS otomatis, perlindungan bot/DDoS, dan efisiensi biaya (< $15/bulan).

### A. Cloudflare Tunnel (Zero Open Port & Bebas IP Statis)
- [ ] **Setup Cloudflare Tunnel (`cloudflared`)**:
  - Menghubungkan VM Compute Engine langsung ke Cloudflare Edge via outbound connection.
  - Tidak memerlukan IP statis GCP (menghemat biaya bulanan IP).
  - Menutup seluruh port publik di firewall GCP (port 3000 dan 8787 tidak diekspos langsung ke internet publik).
- [ ] **Subdomain Routing**:
  - `aksaranetra.id` / `www.aksaranetra.id` -> Container `frontend:3000`.
  - `api.aksaranetra.id` -> Container `backend-api:8787`.

### B. Keamanan & CDN Caching
- [ ] **Cloudflare Universal SSL (Full Strict Mode)**.
- [ ] **Cloudflare Turnstile CAPTCHA**:
  - Mengamankan formulir submit `/periksa` dari spam bot tanpa CAPTCHA gambar yang merusak aksesibilitas.
- [ ] **Cache Rules Agresif**:
  - Cache statis Next.js (`/_next/static/*`) di CDN selama 1 bulan (menghemat bandwidth egress GCP hingga 85%).
  - Bypass cache untuk seluruh API dinamis `/audits/*` dan `/api/*`.

### C. Monitoring & Penghematan Biaya
- [ ] Menjaga spesifikasi mesin `e2-small` + 3GB swap file (stabil di kisaran $14–$15/bulan).
- [ ] Cronjob harian di VM untuk pembersihan docker build cache: `docker system prune -af --filter "until=48h"`.
