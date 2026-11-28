<div align="center">
  <img src="./public/AN%20-%20Nav%20Icon.png" alt="Logo AksaraNetra" width="84" height="84" />
  <h1>AksaraNetra</h1>
  <p>
    <strong>Periksa hambatan aksesibilitas halaman web publik, lalu baca isinya dalam tampilan yang lebih jelas.</strong>
  </p>
  <p>
    <a href="#mengapa-aksaranetra-dibuat">Mengapa Dibuat</a> ·
    <a href="#cara-kerja-5-tahap">Cara Kerja</a> ·
    <a href="#tampilan-di-dalam-aplikasi">Tampilan Aplikasi</a> ·
    <a href="#apa-yang-dikerjakan-dan-batasannya">Batasan</a> ·
    <a href="./docs/README.md">Dokumentasi Teknis</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Standar-WCAG_2.1_Level_AA-1e40af?style=flat-square" alt="Standar WCAG 2.1 Level AA" />
    <img src="https://img.shields.io/badge/Frontend-Next.js_16-0f172a?style=flat-square" alt="Next.js 16" />
    <img src="https://img.shields.io/badge/Backend-Laravel_11-991b1b?style=flat-square" alt="Laravel 11" />
    <img src="https://img.shields.io/badge/Engine-Playwright-166534?style=flat-square" alt="Playwright" />
    <img src="https://img.shields.io/badge/Lisensi-MIT-475569?style=flat-square" alt="Lisensi MIT" />
  </p>
</div>

---

## Mengapa AksaraNetra Dibuat

Banyak situs web layanan publik di Indonesia menyimpan informasi penting, tetapi sulit dipakai oleh penyandang disabilitas dan pembaca layar.

Masalahnya sering terlihat sepele saat dilihat dengan mata biasa:

- Tombol hanya berbentuk gambar ikon tanpa nama teks, sehingga pembaca layar membacakannya sebagai tombol kosong tanpa fungsi.
- Tulisan berwarna abu-abu tipis di atas latar terang membuat pengguna dengan gangguan penglihatan kesulitan membaca.
- Menu atau kotak gulir hanya bisa digerakkan dengan mouse, sehingga pengguna yang hanya memakai keyboard terjebak di tengah halaman.

AksaraNetra hadir untuk memeriksa hambatan seperti itu secara terbuka, mencoba perbaikan yang aman pada salinan halaman, lalu menyajikan versi baca satu kolom yang lebih mudah ditelusuri.

---

## Cara Kerja (5 Tahap)

Saat Anda memasukkan alamat situs web di halaman `/periksa`, AksaraNetra menjalankan lima tahap berikut secara berurutan:

| Tahap | Proses yang Terjadi | Penjelasan Singkat |
| :---: | :--- | :--- |
| **1** | **Memeriksa izin dan keamanan alamat** | Sistem memastikan halaman terbuka untuk umum dan pemilik situs tidak melarang pemeriksaan otomatis. Halaman pribadi atau yang memakai login ditolak di awal. |
| **2** | **Membuka halaman dan mencatat hambatan** | AksaraNetra membuka salinan halaman seperti pengunjung biasa, lalu mencari elemen yang menyulitkan (tombol tanpa nama, kontras warna rendah, gambar tanpa teks alternatif, hingga alur fokus keyboard). |
| **3** | **Menjalankan perbaikan yang aman saja** | Perbaikan hanya dipasang bila petunjuk pada halaman sudah jelas. Jika masih meragukan, sistem tidak menebak dan membiarkannya untuk ditinjau manusia. |
| **4** | **Menilai ulang sebelum dan sesudah** | Halaman yang sudah ditambal diukur kembali dengan metode yang sama. Jika sebuah perubahan justru memicu masalah baru, perubahan itu dibatalkan. |
| **5** | **Menyajikan Mode Baca dan laporan** | Isi utama halaman dirapikan menjadi satu kolom dengan urutan judul yang jelas, lengkap dengan tautan balik ke situs aslinya dan berkas laporan siap unduh. |

---

## Tampilan di Dalam Aplikasi

Setiap hasil pemeriksaan dapat dilihat langsung di halaman hasil (`/result`), atau dicoba langsung lewat mode demo bawaan tanpa harus menjalankan server audit.

<table>
  <tr>
    <td width="33%" valign="top">
      <img src="./public/preview-ringkasan.png" alt="Ringkasan skor aksesibilitas dan pembagian keparahan pada situs Pemprov Sulsel" />
      <p align="center"><sub><strong>1. Ringkasan Skor dan Keparahan</strong><br />Menampilkan skor sebelum dan sesudah perbaikan, prinsip POUR, serta pemetaan ke regulasi Indonesia.</sub></p>
    </td>
    <td width="33%" valign="top">
      <img src="./public/preview-perbandingan.png" alt="Grafik perbandingan jumlah hambatan sebelum dan sesudah perbaikan" />
      <p align="center"><sub><strong>2. Perbandingan Sebelum & Sesudah</strong><br />Memperlihatkan berapa hambatan yang berhasil diperbaiki, dibatalkan, atau masih butuh tinjauan manusia.</sub></p>
    </td>
    <td width="33%" valign="top">
      <img src="./public/preview-pemeriksaan.png" alt="Rincian pemeriksaan ulang per elemen beserta saran perbaikan" />
      <p align="center"><sub><strong>3. Pemeriksaan Rinci per Elemen</strong><br />Menandai letak masalah di tangkapan layar, alur fokus keyboard, serta potongan kode perbaikan yang bisa disalin.</sub></p>
    </td>
  </tr>
</table>

Selain tiga tampilan di atas, pengguna juga bisa beralih ke **Mode Baca** satu kolom untuk membaca isi halaman tanpa gangguan elemen yang tumpang tindih, atau mengunduh hasil audit dalam format HTML, PDF, CSV, dan JSON.

---

## Apa yang Dikerjakan dan Batasannya

AksaraNetra menyatakan batasannya secara terbuka agar hasil pemeriksaan tidak ditafsirkan melebihi apa yang benar-benar diuji.

| Yang Dikerjakan | Yang Tidak Dilakukan |
| :--- | :--- |
| Memberi nama pada tombol dan tautan bila petunjuk konteksnya cukup jelas. | Tidak mengubah, merusak, atau mewakili website aslinya. Semua proses berjalan di salinan halaman. |
| Membuka jalur navigasi keyboard pada bagian halaman yang bisa digulir. | Tidak memeriksa halaman yang membutuhkan login, akun, pembayaran, atau data pribadi. |
| Menyusun ulang isi halaman ke Mode Baca satu kolom dengan kontras warna yang lebih jelas. | Tidak mengarang keterangan gambar (teks alternatif) bila sumber halamannya tidak menyediakan petunjuk. |
| Memverifikasi setiap perbaikan dan membatalkan perubahan jika muncul masalah baru. | Tidak menggantikan pengujian manusia. Pemeriksaan otomatis hanya mencakup sekitar 30 sampai 40 persen kriteria WCAG; uji langsung dengan pembaca layar seperti NVDA tetap dibutuhkan. |

---

## Standar dan Regulasi Acuan

<details>
<summary>Klik untuk melihat standar internasional dan regulasi Indonesia yang dipetakan di laporan</summary>

1. **WCAG 2.1 Level A dan AA** serta adopsi nasionalnya **SNI ISO/IEC 40500** (prinsip *Perceivable, Operable, Understandable, Robust*).
2. **UU No. 8 Tahun 2016** tentang Penyandang Disabilitas (Pasal 19, Pasal 24, dan Pasal 105).
3. **PP No. 42 Tahun 2020** tentang Aksesibilitas terhadap Permukiman, Pelayanan Publik, dan Pelindungan dari Bencana bagi Penyandang Disabilitas (Pasal 17 dan 18).
4. **PermenPANRB No. 11 Tahun 2024** tentang Penyelenggaraan Pelayanan Publik Ramah Kelompok Rentan.
5. **Perpres No. 95 Tahun 2018** tentang Sistem Pemerintahan Berbasis Elektronik (SPBE).
6. **UU No. 14 Tahun 2008** tentang Keterbukaan Informasi Publik (KIP) dan **PerKI No. 1 Tahun 2021** tentang Standar Layanan Informasi Publik.

</details>

---

## Untuk Pengembang

Ingin memasang AksaraNetra di komputer lokal, menjalankan test suite, atau melihat arsitektur teknis Next.js, Laravel, dan Playwright?

Baca panduan lengkapnya di [Dokumentasi Teknis (`docs/README.md`)](./docs/README.md).

Proyek ini dirilis dengan [Lisensi MIT](./LICENSE).
