# Revisi uji komponen — 3 Oktober 2026

Firmware diagnostik `almufti-diag-1.1.0` dan tampilan aplikasi terpasang.
Production template dan alur produksi tidak diubah. Arsip cadangan aplikasi,
source dan binary diagnostik 1.0.5 berada di `backups/component-test-20261003/`.

## Perubahan

- IR: HIGH/LOW kini berasal dari level GPIO asli, terpisah dari status objek.
  Polaritas dapat disimpan untuk masing-masing sensor; pengaturan semua sensor
  tetap tersedia. Default mengikuti pengaturan lama. Active LOW berarti level
  LOW memicu objek. Perilaku ini sendiri tidak membuktikan sensor rusak.
- RFID: clock SPI library dan sketch sama-sama 100 kHz, dengan compile guard.
  Status modul dan kartu dipisahkan. Hanya UID 4/7/10 byte yang diterima.
  UID terakhir dipertahankan setelah kartu diangkat; kehadiran kartu tetap
  memiliki timeout. Modul tidak lagi dianggap offline karena satu register
  gagal dibaca; tiga pembacaan invalid berturut-turut tetap menandai gangguan.
  Timeout tanpa kartu tidak memicu idle reset. Kesalahan pembacaan tetap terlihat.
- Stepper: Forward terus, Reverse terus, Stop. Stop diperlukan sebelum ganti
  arah. Meninggalkan tab Stepper menghentikan motor. Firmware menghentikan
  output saat heartbeat hilang 3 detik. Kontrol posisi lama tetap tersedia;
  posisi adalah jumlah pulsa, tanpa sensor homing atau limit switch.
- HX711: membaca saat data tersedia (poll 20 ms), clock 3 µs dalam critical
  section, median 5 + perataan. Rentang ADC asli dari 20 sampel dilaporkan agar
  filter tidak menyembunyikan gangguan. Status stabil memakai batas 2 gram
  atau 200 ADC, mana yang lebih besar, setelah 20 sampel valid.
- Zero/kalibrasi mengumpulkan 20 sampel berjarak minimal 100 ms. Rentang seluruh
  sampel diperiksa sebelum menyimpan rata-rata yang telah dipangkas ekstremnya.
  Data tidak stabil, saturasi, timeout dan beban tanpa perubahan memadai ditolak;
  parameter lama dipertahankan. Tidak ada otomatis zero atau pemaksaan angka 186.

## Verifikasi dan temuan perangkat

- Compile ESP32 core 2.0.17 berhasil (304677 byte flash, 21992 byte RAM).
  Upload final lolos seluruh hash verification.
- 25 ping final dijawab; 169 telemetry valid selama sekitar 25 detik.
- UID terakhir `9DC2FC06` dilaporkan perangkat. Pada pengukuran final status
  modul tetap siap, SPI 100 kHz, reset count tetap 4 selama jendela pengamatan.
  Masih ada kegagalan transaksi RFID dan timeout. Ini bukan bukti bahwa kartu
  terus terbaca: UID terakhir memang dipertahankan. Pembacaan kartu berulang
  secara fisik masih perlu diperiksa.
- Pengguna mengonfirmasi timbangan kosong pada pengukuran final; perangkat
  memakai daya 3,3 V dan kabel solder. Data setelah pengukuran awal tidak boleh
  dianggap masih mewakili HP 186 gram.
- Saat kosong, raw HX711 berkisar -4194305 sampai 8388607 (termasuk saturasi).
  Angka hasil faktor lama sekitar 610–1221 gram dan semua telemetry berstatus
  tidak stabil. Ini masih masalah pembacaan fisik yang belum terselesaikan;
  data tidak cukup untuk memastikan apakah HX711, loadcell, jalur sinyal,
  mekanik, atau kestabilan catu yang menjadi sumbernya. Perlu pemeriksaan
  per bagian, bukan mengulang kalibrasi pada data yang berubah jutaan ADC.
- Zero -553741 dan faktor 439.580658 tetap sama sebelum/sesudah revisi.
- IR pada pengukuran final seluruh pin HIGH. Belum ada uji objek terkontrol
  pada setiap sensor untuk menyatakan IR4 baik/rusak.
- Motor fisik tidak dijalankan otomatis. ISR, arah, hitungan, batas integer,
  Stop dan penolakan kalibrasi bising diuji dengan kode firmware aktual pada host.
- Alur layar diuji dengan ESP tiruan: raw IR, pengaturan individual, pemisahan
  modul/UID, UID terakhir, Forward/Reverse, Stop saat pindah tab, status timbangan.
  Tes regresi picker dan koneksi LED lulus.

Ringkasan data: `component-test-measurements.json`.

## Pemakaian

Tutup dan buka kembali aplikasi melalui `run-rvm.sh`, sambungkan ESP, buka
Admin → Uji komponen. Uji IR satu per satu, pilih Active LOW jika kosong HIGH
lalu objek LOW. Untuk motor, gunakan kecepatan rendah terlebih dahulu dan Stop
sebelum mengubah arah. Untuk loadcell, pastikan kosong dan stabil sebelum Zero,
lalu beban referensi stabil sebelum Kalibrasi; selama raw masih melonjak,
jangan memakai angka gram sebagai hasil timbangan yang sah.

## Pengujian ulang

```bash
python3 scripts/connection-fix/firmware-check.py
python3 scripts/connection-fix/patch_bundle.py /tmp/rvm-app-components-v4.asar
RVM_STAGED_ARCHIVE=/tmp/rvm-app-components-v4.asar node --test scripts/connection-fix/device-selection.test.cjs scripts/connection-fix/renderer.test.cjs
RVM_STAGED_ARCHIVE=/tmp/rvm-app-components-v4.asar node scripts/connection-fix/components-visual.cjs
```

Compile firmware harus memakai flag pada `firmware/README.md`. Implementasi
clock diperiksa terhadap [source MFRC522](https://github.com/miguelbalboa/rfid/blob/master/src/MFRC522.cpp)
dan timing pembacaan dibandingkan dengan [source HX711](https://github.com/bogde/HX711/blob/master/src/HX711.cpp).

## Tindak lanjut 1.1.1

Keluhan tombol tidak bisa ditekan direproduksi pada telemetry HX711 belum siap
atau saturasi. UI kini membolehkan percobaan Zero/Kalibrasi ketika ESP terhubung;
firmware tetap memvalidasi sampel sebelum menyimpan. Pesan hasil/penolakan
menetap di layar. Saat offline, motor aktif, atau perintah lain diproses, alasan
penundaan ditampilkan. Ini memperbaiki interaksi tombol, bukan kestabilan ADC.

RFID memiliki tombol `Scan kartu baru / pulihkan`: kosongkan UID sebelumnya,
reset reader, lalu tunggu UID valid baru. Parser kini menerima UID kosong untuk
menghapus hasil lama. Uji UI memverifikasi UID 4 byte diganti UID 7 byte dan
penghapusan hasil lama. Sebelum upload 1.1.1 perangkat melaporkan UID terakhir
`C73C2C07`, berbeda dari `9DC2FC06`, namun masih disertai kegagalan transaksi.
Pengguna memastikan kartu kedua juga kartu bawaan. Belum ada bukti bahwa
pembacaan kedua kartu sudah konsisten.

Build 1.1.1: 304893 byte flash / 21992 byte RAM; hash upload berhasil.
Cadangan 1.1.0: `backups/component-followup-20261003/`.
Arsip aplikasi harus dibuka ulang agar kode layar terbaru dimuat.

Verifikasi pasca-upload 1.1.1: 25 ACK ping, 169 telemetry; UID terakhir C73C2C07, tetapi kehadiran kartu false sepanjang jendela pengamatan dan masih terdapat error/status timeout. Loadcell sempat saturasi. Keduanya belum dinyatakan pulih secara fisik.

## Revisi live 1.2.0 dan diagnosis terpisah

- UID telemetry kini kosong jika tidak ada kartu. Kehadiran kedaluwarsa setelah
  500 ms timeout normal / maksimal 800 ms tanpa pembacaan valid. Tampilan juga
  memeriksa status kehadiran dan koneksi, bukan menampilkan UID lama sebagai UID
  live. Tes layar meliputi kartu A, lepas, kartu B, lepas, kembali ke A.
- Recovery RF field sesudah kegagalan berulang membantu mengeluarkan PICC yang
  tertinggal ACTIVE karena seleksi/halt tidak lengkap. Belum diklaim menyelesaikan
  semua kegagalan pembacaan fisik.
- LEDDMX-01: pengguna mengonfirmasi uji PC kedua benar-benar merah lalu hijau
  satu warna. Urutannya: power 03, brightness mode 00, kemudian static RGB diulang
  3 kali, masing-masing diberi jeda 150 ms. Paket alternatif power 01 / brightness
  mode 01 menghasilkan warna-warni dan tidak dipakai. Implementasi aplikasi
  menggunakan urutan yang telah dikonfirmasi, dengan antrean agar dua pengiriman
  tidak saling menyisipkan paket. UUID tetap FFE0/FFE1.
- `diagnostic_mode` mendukung all/loadcell/rfid dan pulseUs 3/10 untuk diagnosis.
  Tidak menyimpan setting atau tare. Script isolate-sensors selalu mengembalikan
  mode all/pulse 3 di blok finally. Jangan gunakan perubahan timing sebagai
  pengganti pemeriksaan level tegangan.
- Data `component-isolation-results.json`: HX711 tetap melonjak saat RFID
  antennanya dimatikan. Timing 10 µs juga tidak memperbaiki raw. RFID juga gagal
  membaca selama uji tersendiri. Mode all dikembalikan setelah tes.
- Self-test RC522 PASSED, uji register baca/tulis 0 mismatch / 32, versi 0 mismatch
  / 32. Chip tidak bisa dinyatakan rusak; diagnosis suplai/level sinyal/link RF
  masih diperlukan. Sebelumnya satu sampel versi 0x97 muncul di tengah nilai 0x92.
- Pengguna memastikan HX711 DT35/SCK32, loadcell 5 kg, kabel sudah tersolder.
  Pengukuran suplai terbaru: **5,1 V**, menggantikan asumsi awal 3,3 V. Sedang
  dikonfirmasi apakah modul memiliki DVDD terpisah dan berapa suplai RC522.

Build final: 307257 byte flash, 22008 byte RAM; seluruh hash upload verified.
Cadangan sebelumnya ada di `backups/component-live-20261003/`.

Referensi pengukuran suplai: datasheet [HX711](https://cdn.sparkfun.com/datasheets/Sensors/ForceFlex/hx711_english.pdf)
bagian Power Supply Options menyatakan DVDD harus sesuai suplai MCU. VSUP/AVDD
boleh berbeda dari DVDD pada rancangan yang memisahkannya. Datasheet
[ESP32](https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf)
Tabel 5-3 memberi batas input HIGH sampai VDD + 0,3 V. Karena layout modul belum
diketahui, hasil VCC 5,1 V tidak dengan sendirinya membuktikan tegangan DOUT;
perlu identifikasi jalur suplai digital sebelum mengubah sambungan.

Pengguna mengonfirmasi modul HX711 hanya 4 pin (VCC/GND/DT/SCK). Disarankan
mematikan semua daya termasuk USB, lalu memindahkan VCC ke 3V3 ESP32 tanpa
mengubah DT35/SCK32/GND. Menunggu konfirmasi perubahan dan hasil ukur baru,
serta tegangan RC522. Belum dilakukan tare/kalibrasi ulang atau verifikasi
perangkat setelah perubahan suplai. Aplikasi v6 dan firmware 1.2.0 terpasang.

Hasil ukur lanjutan pengguna: pin 3.3V–GND RC522 juga **5,1 V**. Pengguna belum
bisa memindahkan suplai karena memerlukan solder. Pengujian perangkat dihentikan;
disarankan mematikan seluruh daya/USB dan memperbaiki jalur suplai sebelum uji
lanjut. NXP MFRC522 Table 1 memberi suplai nominal 3,3 V dan maksimum 3,6 V:
https://www.nxp.com/docs/en/data-sheet/MFRC522.pdf . Tegangan yang terukur berada
di luar spesifikasi tersebut. Self-test PASS sebelumnya tidak membuktikan
ketahanan terhadap overvoltage atau kestabilan RF. Belum ada vonis modul rusak.
Setelah suplai dibetulkan dan diukur, ulangi uji empty loadcell, kemudian tare,
referensi beban, dan pergantian kartu. Jangan mengulang kalibrasi pada raw yang
masih melonjak. Ini memerlukan tindakan fisik pengguna, bukan perubahan kode lagi.
