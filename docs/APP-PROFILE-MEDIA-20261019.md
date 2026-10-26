# Video beranda dan Scan now profil

Paket yang diperbarui: `release/linux-unpacked/resources/app.asar`. Tutup dan buka ulang aplikasi untuk memuat pembaruan.

## Video

Video beranda berupa montase 12 detik: pemilahan botol dan fasilitas daur ulang. Asset lokal 1280×720, VP8/WebM, tanpa audio, autoplay dan loop. Sumber dicatat di `assets/media/README.md`.

## UID profil

Pada Database → UID baru / Edit anggota, tombol “UID terakhir” diganti “Scan now”. Klik tombol, lalu tempelkan kartu ke reader. Aplikasi mengirim `rfid_scan` pada firmware pengujian untuk menginisialisasi reader; UID diisi hanya dari event RFID baru, bukan UID lama yang tersimpan di telemetry.

- ESP perlu terhubung dan memakai firmware `almufti-diag-*`. Koneksi dapat disiapkan melalui Uji komponen.
- Selama menunggu scan, tombol scan dan simpan dinonaktifkan. Nama dan data lain tetap dipertahankan.
- Satu scan menangkap satu UID; event kartu berikutnya tidak mengganti hasil tanpa klik Scan now lagi.
- Scan ulang kartu yang sama didukung melalui reset reader.
- Menutup form atau mengedit UID manual membatalkan penantian. Waktu tunggu 15 detik; kegagalan perintah dan putus koneksi ditampilkan di form.
- Firmware production tidak diubah oleh form Database.
- Simpan anggota tetap tindakan terpisah dan validasi UID duplikat tetap berlaku.

## Verifikasi

`node scripts/app-profile-media/browser-test.cjs` menjalankan paket aplikasi dengan database dan serial simulasi terisolasi: video dapat diputar dan berdurasi 12 detik, UID lama diabaikan, fresh scan, scan ulang UID sama, capture satu kali, simpan profil, tutup/buka form, timeout, perintah ditolak, firmware guard dan koneksi putus. Layout ditinjau pada 1024×768 dan 1024×600.

Pengujian RFID fisik belum dilakukan pada perubahan ini. Cadangan paket sebelum perubahan ada di `backups/app-profile-media-20261019/app-before.asar`.
