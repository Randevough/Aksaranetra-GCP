# Roadmap Pengembangan AksaraNetra

Dokumen rencana strategis dan teknis untuk pengembangan fitur, UI/UX aksesibel, dan infrastruktur AksaraNetra.

---

## 1. Wave 1: Platform Upgrade (Core Audit, Transparansi & Dogfooding)

Fokus: Pengukuran kesiapan halaman yang stabil, pelacakan langsung proses audit, pemetaan regulasi Indonesia yang akurat, serta pengalaman hasil interaktif yang ramah pembaca layar dan keyboard.

- [x] **Smart Page-Readiness & Safe Hydration**:
  - Hidrasi first-party terbatas (`allowHydration`) dengan proteksi SSRF untuk sub-resource dan redirect domain `www.`.
  - Gerbang stabilitas DOM (`MutationObserver`), font siap pakai, gambar terlihat, dan deteksi empty-shell.
- [x] **Live Telemetry & Early Preview**:
  - Endpoint `GET /audits/{id}` menyertakan `telemetry.steps[]`, statistik pemindaian langsung, dan `previewUrl` (`before.png`) begitu tangkapan awal siap.
  - Panel *Engine X-Ray* di `/result`, progres tab browser, dan kuis mikro opsional "Uji Aksesibilitas 10 Detik".
- [x] **Skor Otomatis, POUR & Pemetaan Regulasi Indonesia**:
  - Skor 0–100 berbobot dampak WCAG 2.1 Level AA (`beforeScore` -> `afterScore`, grade A–F) disertai penafian cakupan otomatis (~30–57% kriteria WCAG).
  - Rincian 4 tingkat keparahan (Kritis, Serius, Sedang, Rendah) dan skor prinsip POUR.
  - Pemetaan aturan ke regulasi terverifikasi:
    - **UU No. 8 Tahun 2016** (Pasal 19, 24, 105 — Hak Aksesibilitas Informasi & Komunikasi Penyandang Disabilitas)
    - **PP No. 42 Tahun 2020** (Pasal 17–18 — Aksesibilitas Pelayanan Publik Elektronik)
    - **PermenPANRB No. 11 Tahun 2024** (Penyelenggaraan Pelayanan Publik Ramah Kelompok Rentan)
    - **Perpres No. 95 Tahun 2018 (SPBE)** (Tata Kelola Pemerintahan Berbasis Elektronik)
    - **UU No. 14 Tahun 2008 (KIP) & PerKI No. 1 Tahun 2021** (Standar Layanan Informasi Publik / PPID)
    - **SNI ISO/IEC 40500** (Adopsi Standar Nasional WCAG)
- [x] **Inspeksi Visual & Daftar Temuan Bahasa Indonesia**:
  - Tab **Pin Temuan** (`before.png` + pin koordinat elemen), **Alur Fokus Keyboard** (pemeriksaan WCAG 2.4.7 & 2.4.11), dan **Perbandingan Sebelum & Sesudah** berbasis CSS `clip-path`.
  - Eksplorasi temuan per elemen dengan filter Keparahan, Status, POUR, Regulasi, pencarian teks, diff HTML Before/After, serta tombol salin perbaikan.
- [x] **Ekspor Data & Mode Demo Instan**:
  - Ekspor `GET /audits/{id}/report.json` dan `GET /audits/{id}/report.csv` (`Rule_ID`, `Severity`, `Selector`, `Status`, `WCAG_SC`, `Regulations`, `Title_ID`).
  - Mode demo statis (`/result?demo=pemprov-sulsel-demo` dan `/result?demo=portal-akademik-demo`) untuk meninjau workspace tanpa backend.
- [x] **Dogfooding Aksesibilitas Internal**:
  - Dukungan penuh `prefers-reduced-motion` (`MotionConfig reducedMotion="user"`), fokus trap & pengembalian fokus pada dialog konfirmasi, manajemen fokus transisi fase, dan perbaikan kontras WCAG AA tanpa merusak identitas visual.

---

## 2. Wave 2: Ekspansi, Multi-Halaman & Skalabilitas

Fokus: Pemantauan berkelanjutan untuk instansi publik dan alur integrasi lintas tim.

- [ ] **Bounded Sub-route Audit (Multi-page crawl)**:
  - Audit hingga 3–5 sub-rute utama secara berantai (`depth: 1`) dengan agregasi skor dan ringkasan kepatuhan domain.
- [ ] **Dynamic Compliance Badge (`.svg`)**:
  - Endpoint `GET /badges/{domain}.svg` untuk menampilkan skor pemeriksaan terakhir yang terverifikasi.
  - Cuplikan embed HTML/Markdown untuk dipasang di portal instansi.
- [ ] **Notifikasi Webhook & Email**:
  - Opsi callback webhook atau email opsional saat pemeriksaan multi-halaman dan penyusunan PDF tuntas.
- [ ] **Penyempurnaan Tipografi Reader Mode**:
  - Opsi jarak baris (`line-height` 1.5–2.0), lebar kolom baca, dan font keterbacaan tinggi berbasis riset tipografi (*Atkinson Hyperlegible* dan font sistem) dengan dukungan `@media (forced-colors: active)`.

---

## 3. Roadmap Infrastruktur & Cloudflare (DevOps)

Fokus: Keamanan jaringan, domain kustom, HTTPS otomatis, dan efisiensi biaya operasional.

- [ ] **Cloudflare Tunnel (`cloudflared`)**:
  - Menghubungkan VM Compute Engine ke Cloudflare Edge melalui koneksi outbound tanpa membuka port publik langsung di firewall GCP.
  - Pemisahan rute subdomain frontend (`aksaranetra.id`) dan API (`api.aksaranetra.id`).
- [ ] **Keamanan & CDN Caching**:
  - Cloudflare Universal SSL (Full Strict Mode) dan perlindungan bot formulir `/periksa` dengan Cloudflare Turnstile yang ramah akses.
  - Cache statis aset `/_next/static/*` sambil memastikan rute dinamis `/audits/*` tetap `no-store`.
- [ ] **Pemeliharaan Sumber Daya VM**:
  - Menjaga efisiensi memori pada target infrastruktur GCP dengan mode rendah sumber daya Chromium dan pembersihan rutin build cache.
