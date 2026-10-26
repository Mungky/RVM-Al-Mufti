# Perbaikan pemilihan perangkat — 3 Oktober 2026

Paket di folder ini diperbarui; instalasi lain di `~/.local/opt/` tidak diubah.
Tutup aplikasi yang lama lalu jalankan `./run-rvm.sh` dari folder ini.

## Menggunakan koneksi

1. Masuk ke Admin → Uji komponen dan matikan Mode demo.
2. Sambungkan ESP32 dengan kabel USB data.
3. Klik **Scan port**, pilih port ESP32, lalu tekan **Hubungkan**.
   Daftar tampil vertikal dan dapat digulir. **Scan ulang** memperbarui daftar,
   termasuk ketika daftar awal kosong. Port tidak langsung dibuka sebelum dipilih.
4. Jika izin Linux ditolak atau port sedang digunakan aplikasi lain, detail
   kegagalan ditampilkan. Kesalahan koneksi juga dicatat di Log aktivitas.
5. Untuk controller LED, nyalakan Bluetooth pada Linux lalu klik **Scan BLE**.
   Pilih perangkat lalu tekan **Hubungkan**. Nama dan ID ditampilkan dalam
   daftar vertikal, dengan hasil baru masuk selama pemindaian berjalan.
   Tombol **Scan ulang** memperbarui hasil. Pencarian khusus Bluetooth Low Energy.

ESP32 masih harus menjalankan firmware yang memahami protokol JSON RVM dan
merespons `ping`. Pemilihan port saja tidak menjamin firmware cocok. Tidak ada
firmware yang diunggah oleh perbaikan ini.

## Batas dukungan controller LED LAMP / DMX

Perangkat bernama **LEDDMX-00/01/03** (termasuk variasi spasi/tanda hubung)
menggunakan profil otomatis: layanan FFE0 dan characteristic FFE1. UUID tidak
perlu diisi. Aplikasi memeriksa layanan tersebut dan kemampuan menulis sebelum
menampilkan status terhubung. Tidak ada perintah lampu yang dikirim saat connect.

Untuk profil ini, tombol **Terapkan efek LED** mengirim paket biner yang sesuai:
warna solid, brightness, dan preset running/rainbow. Brightness nol mematikan
lampu. Kecepatan mengikuti pengaturan controller; slider kecepatan custom
tidak ditampilkan untuk profil ini. Efek fisik belum diverifikasi pada perangkat
pengguna; beberapa controller mungkin memiliki varian firmware berbeda.

Profil otomatis dibatasi pada keluarga tersebut. Perangkat lain tidak dianggap
kompatibel hanya karena menggunakan aplikasi HP LED LAMP. Pengaturan UUID
dan template teks tetap tersedia pada **Pengaturan manual (opsional)** untuk
controller custom yang sudah dikonfigurasi. Bluetooth klasik/SPP belum didukung.

Sumber profil dan format paket: https://github.com/user154lt/LEDDMX-00
Perilaku pemindaian Electron:
https://www.electronjs.org/docs/latest/api/web-contents#event-select-bluetooth-device

## Cadangan dan pemulihan

Arsip asli disimpan di `backups/connection-fix-20261003/app.asar`.
Versi sebelum daftar vertikal juga dicadangkan sebagai
`backups/connection-fix-20261003/app-before-vertical-picker.asar`.
SHA-256 asli:
`57cd33360c09f1a961a393b747ad81e3facc790a4f0398cefc2a0f0168b603ef`.

Untuk memulihkan, tutup aplikasi dan jalankan dari folder paket:

```bash
cp backups/connection-fix-20261003/app.asar release/linux-unpacked/resources/app.asar
```

Database pengguna, firmware, installer, dan konfigurasi sistem tidak diubah.

## Validasi

- 9 pengujian pemilih perangkat: scan kosong, refresh, pilihan eksplisit,
  perangkat USB dicabut, batal, error scan/izin, pembaruan BLE, penutupan jendela,
  dan validasi pemilih melalui IPC.
- 9 pengujian transport dari bundle: profil otomatis tanpa UUID, profil custom,
  characteristic yang tidak mendukung penulisan, disconnect, format paket LED,
  validasi nilai, dan pembersihan koneksi USB gagal.
- Pemeriksaan visual dengan 30 perangkat dan nama panjang pada 1024×600,
  800×480, serta 480×320; daftar bergulir vertikal dan footer tetap terlihat.
- Tes browser terhadap aplikasi lengkap dengan controller simulasi: tombol
  koneksi berhasil tanpa pengisian UUID, pengaturan manual tersembunyi,
  cancel/rescan/empty state bekerja, dan nama perangkat dirender sebagai teks.
- Pemeriksaan sintaks semua JavaScript yang berubah.
- Verifikasi isi arsip: hanya file koneksi, UI terkait, dan helper yang berubah;
  isi file lain tetap.
- Runtime Electron berhasil membaca ASAR dan memuat modul pemilih perangkat.
- Koneksi hardware fisik dan respons lampu belum diuji.

Kode patch dan pengujian ada di `scripts/connection-fix/`.
`patch_bundle.py` membangun ulang dari cadangan arsip asli versi ini, sehingga
tidak menumpuk patch pada bundle yang sudah diubah.

## Pemeriksaan hardware lanjutan

- Controller pengguna adalah **LEDDMX-01-1F00**, alamat `25:07:27:00:00:1F`.
  Koneksi diagnostik BlueZ berhasil, `ServicesResolved=true`, layanan FFE0 dan
  characteristic FFE1 tersedia dengan `write-without-response`.
  Koneksi ditutup setelah inspeksi; tidak ada perintah lampu yang dikirim.
  Varian 01 kini dikenali otomatis. Sebelumnya pencocokan nama hanya 00/03.
- ESP pada `/dev/ttyUSB0` (USB serial CH340) dapat dibaca pada 115200 baud.
  Pemeriksaan menerima 4840 byte / 64 baris, termasuk
  `{"type":"hx-only","raw":-393217,"complete":true}`. Enam ping JSON RVM
  tidak mendapat ACK. Ini firmware tes HX711, bukan firmware protokol RVM.
- Aplikasi kini mengenali `hx-only` dan menjelaskan ketidakcocokan firmware,
  alih-alih hanya timeout generik. Aplikasi tidak menganggap data timbangan
  mentah sebagai tanda bahwa perintah motor/relay RVM sudah didukung.
- Firmware bawaan diekstrak ke `firmware/arduino/` untuk persiapan compile.
  Template produksi masih `PRODUCTION_CONFIGURED=false`; untuk koneksi dan
  uji komponen gunakan `rvm_diag`.
- Cadangan sebelum perbaikan varian 01: `backups/connection-fix-20261003/app-before-dmx01.asar`.
- Setelah persetujuan upload, `almufti-diag-1.0.5` berhasil diunggah ke ESP32
  MAC `70:4b:ca:69:42:00`. Semua segmen flash yang ditulis lolos verifikasi hash.
  Firmware merespons ping pertama dengan ACK `ok=true`, `protocol=1`,
  `firmware=almufti-diag-1.0.5`; telemetry JSON juga diterima.
- Build memakai 301133 byte flash (22%) dan 21848 byte RAM statis (6%).
  Hasil `.bin` tervalidasi dengan esptool; output tersedia di `firmware/builds/rvm_diag/`.
- Flash lama 4194304 byte tersimpan di `backups/connection-fix-20261003/esp32-hx-only-original.bin`,
  SHA-256 `a8bc86adb01cd25f509ecdc44a7c396e7060174ffe552d7bbc0f1c7cc2636ffb`.
- Telemetry menunjukkan HX711 menghasilkan sampel tetapi belum terkalibrasi
  (`loadcellCalibrated=false`); RC522 memiliki pesan pemulihan dan perlu uji kartu
  tersendiri. Pemeriksaan koneksi ini tidak memvalidasi motor, relay, sortir,
  ketepatan berat, atau respons warna LED fisik.
