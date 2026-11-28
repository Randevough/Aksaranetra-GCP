# Dokumentasi Teknis AksaraNetra

Panduan ini ditujukan bagi pengembang yang ingin menjalankan, menguji, atau men-deploy AksaraNetra. Untuk gambaran umum non-teknis bagi pembaca umum, lihat [README utama](../README.md).

---

## 1. Arsitektur Sistem

AksaraNetra menggunakan arsitektur monorepo dengan tiga komponen utama:

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, CSS Modules, Lucide React, Framer Motion.
- **Backend**: PHP 8.2+ / Laravel 11 (API-only) dengan SQLite (WAL mode) dan background queue worker (`php artisan audit:work`). Backend Node.js lama masih tersedia di `backend/` sebagai legacy fallback.
- **Engine Audit**: Node.js 22+ dan Playwright Chromium headless (`engine/`) untuk inspeksi DOM nyata, rendering visual, komputasi kontras warna, pembuatan Mode Baca, serta ekspor laporan.

```text
 +--------------------------------------------------------------------------+
 |                       Next.js Frontend (Port 3000)                       |
 +--------------------------------------------------------------------------+
             |                                              ^
             | POST /audits (Mulai Audit)                   | Polling status &
             | GET  /audits/cache (Cek Cache)               | Ambil hasil
             v                                              |
 +--------------------------------------------------------------------------+
 |                     PHP Backend / Laravel (Port 8787)                    |
 | - RESTful API (CORS, Rate Limiting, Validasi Request)                    |
 | - SQLite DB (/data/jobs.sqlite dengan Write-Ahead Logging)               |
 | - Token HMAC-SHA256 & Proteksi Akses Artefak                             |
 +--------------------------------------------------------------------------+
             |                                              ^
             | Antrean Tugas (Queue Job)                    | Update progress &
             v                                              | Simpan artefak
 +--------------------------------------------------------------------------+
 |                   Audit Worker (php artisan audit:work)                  |
 | - Memproses antrean satu per satu secara sekuensial (Concurrency: 1)     |
 | - Manajemen timeout, recovery saat crash, dan pembersihan artefak        |
 +--------------------------------------------------------------------------+
             |
             | Memanggil via CLI Bridge (bridge/audit-cli.mjs)
             v
 +--------------------------------------------------------------------------+
 |                      Engine Audit (engine/src)                           |
 | - Playwright + Headless Chromium                                         |
 | - Penilaian WCAG 2.1 AA, Reader View, Screenshot, & Report Renderer      |
 +--------------------------------------------------------------------------+
```

---

## 2. Prasyarat Sistem

Sebelum menjalankan proyek secara lokal, pastikan perangkat Anda sudah terpasang:

1. **Node.js**: Versi `20.x` atau `22.x+` (disarankan `v22+`) dan **npm**.
2. **PHP**: Versi `8.2+` atau `8.3+` dengan ekstensi aktif:
   - `pdo_sqlite`
   - `sqlite3`
   - `mbstring`
   - `openssl`
   - `curl`
3. **Composer**: Versi `2.x+`.
4. *(Opsional)* **Docker & Docker Compose**: Jika ingin menjalankan backend di dalam container.

---

## 3. Setup Awal (Instalasi)

### Langkah 1: Setup Engine & Browser Chromium

Audit membutuhkan Chromium headless dari Playwright:

```bash
cd engine
npm install
npx playwright install chromium
cd ..
```

### Langkah 2: Setup Backend PHP

Buka folder `php-backend`, pasang dependensi PHP, salin template environment, lalu jalankan migrasi SQLite:

```bash
cd php-backend
composer install
cp .env.example .env
php artisan migrate
cd ..
```

*(Di Windows PowerShell, gunakan `copy .env.example .env` jika `cp` tidak tersedia.)*

### Langkah 3: Setup Frontend Next.js

Pasang dependensi frontend di root proyek dan buat file `.env.local`:

```bash
npm install
```

Isi `.env.local` di root proyek dengan konfigurasi berikut:

```env
NEXT_PUBLIC_AUDIT_API_URL=http://localhost:8787
NEXT_PUBLIC_BACKEND_URL=http://localhost:8787
```

---

## 4. Menjalankan Aplikasi

AksaraNetra membutuhkan tiga layanan aktif secara bersamaan: Frontend, Backend HTTP API, dan Backend Audit Worker.

### Cara 1: Terminal Lokal (Pengembangan)

Buka 3 terminal terpisah dari root proyek:

1. **Terminal 1: Backend HTTP API Server**
   ```bash
   cd php-backend
   php artisan serve --port=8787
   ```
   API aktif di `http://127.0.0.1:8787`.

2. **Terminal 2: Backend Audit Worker**
   ```bash
   cd php-backend
   php artisan audit:work
   ```
   Worker ini mengeksekusi antrean audit dan browser Playwright saat pengguna memulai pemeriksaan.

3. **Terminal 3: Frontend Next.js**
   ```bash
   npm run dev
   ```
   Web UI aktif di `http://localhost:3000` dan halaman pemeriksaan di `http://localhost:3000/periksa`.

### Cara 2: Backend via Docker

```bash
cd php-backend
docker compose up --build -d
```

Lalu jalankan frontend di root proyek:

```bash
npm run dev
```

Untuk menghentikan container Docker:

```bash
cd php-backend
docker compose down
```

### Verifikasi Health Check Backend

```bash
curl http://localhost:8787/health
```

---

## 5. Variabel Lingkungan (Environment Variables)

### Frontend (`.env.local` di root)

| Variabel | Default | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_AUDIT_API_URL` | `http://localhost:8787` | URL endpoint backend PHP yang dipanggil browser |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:8787` | URL backend fallback untuk kompatibilitas tautan |

### Backend (`php-backend/.env`)

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `8787` | Port server HTTP backend |
| `FRONTEND_ORIGINS` | `http://localhost:3000` | Domain asal yang diizinkan oleh CORS (pisahkan koma) |
| `BACKEND_SECRET` | *(string rahasia)* | Kunci HMAC SHA-256 untuk token audit (min. 32 karakter di produksi) |
| `BACKEND_DATA_DIR` | `./data` | Lokasi database SQLite dan artefak hasil audit |
| `AUDIT_RATE_LIMIT` | `10` | Batas maksimum audit per IP per jam |
| `AUDIT_TIMEOUT_MS` | `180000` | Batas waktu eksekusi Playwright dalam milidetik |
| `CHROMIUM_LOW_RESOURCE_MODE` | `1` | Nilai `1` untuk hemat RAM di environment terbatas |

---

## 6. Pengujian & Quality Checks

```bash
# 1. Unit & feature test Backend PHP
cd php-backend
composer test
cd ..

# 2. Pengujian engine audit
npm run engine:test

# 3. Kontrak frontend, aksesibilitas internal, dan kepatuhan regulasi
npm run test:frontend

# 4. Uji paritas Node vs PHP (42 skenario HTTP)
node php-backend/scripts/parity-check.mjs

# 5. Uji alur end-to-end frontend ke backend PHP (membutuhkan server & worker aktif)
node php-backend/scripts/test-frontend-flow.mjs
```

---

## 7. Struktur Direktori & Dokumentasi Modul

```text
├── src/                  # Frontend Next.js 16 (App Router, komponen UI)
├── php-backend/          # Backend Laravel 11 API-only + bridge + worker
├── engine/               # Engine Playwright + axe-core + remediasi + reader
├── backend/              # Legacy Node.js backend
├── infra/                # Terraform IaC & konfigurasi HA GCP
├── public/               # Aset statis frontend & sampel data demo
├── tests/                # Contract tests frontend & deploy checks
├── docs/                 # Dokumentasi teknis pengembang
└── README.md             # Penjelasan umum untuk pembaca non-teknis
```

Dokumentasi teknis lanjutan per modul:

- [Dokumentasi PHP Backend](../php-backend/README.md)
- [Dokumentasi Engine Audit](../engine/README.md)
- [Panduan Penggunaan Engine](../engine/PANDUAN.md)
- [Dokumentasi Legacy Node Backend](../backend/README.md)
- [Dokumentasi Terraform GCP](../infra/terraform/README.md)
- [Checklist Rilis High Availability](../infra/ha/README.md)

---

## 8. Masalah Umum (Troubleshooting)

1. **Chromium Executable Not Found**: Browser Chromium Playwright belum terpasang. Jalankan `cd engine && npx playwright install chromium`.
2. **Audit berstatus "Sedang Mengantre" terus-menerus**: Worker belum dijalankan. Pastikan `php artisan audit:work` berjalan di terminal terpisah.
3. **CORS Blocked saat Frontend memanggil Backend**: URL frontend berbeda dengan `FRONTEND_ORIGINS` di `php-backend/.env`. Pastikan nilainya sesuai (misal `http://localhost:3000`).

---

## 9. Lisensi

Proyek ini menggunakan lisensi MIT. Lihat berkas [LICENSE](../LICENSE) dan [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
