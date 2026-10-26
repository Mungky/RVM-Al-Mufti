# Firmware pengujian komponen 2.0.1

Source: `arduino/rvm_diag/rvm_diag.ino`. Dibangun ulang dari sketch yang pengguna
berhasil uji di `Desktop/Basic Program`, termasuk RFID yang tersimpan dengan nama
`stepper_tester/stepper_tester.ino`. Sketch motor yang dipakai adalah `stepper_basic`.
Label relay mengikuti koreksi hasil tes pengguna, bukan label terbalik di sketch awal.

| Komponen | GPIO / logika |
|---|---|
| IR 1 / 2 / 3 | 14 / 26 / 27, Active LOW |
| Relay 1 / 2 | 15 / 33, Active LOW |
| TB6600 PUL / DIR / ENA | 2 / 4 / 25; ENA LOW saat berjalan |
| HX711 DT / SCK | 34 / 32 |
| RC522 SDA/SS / RST | 16 / 17 |
| RC522 SCK / MISO / MOSI | 22 / 13 / 21 |

Toolchain sesuai Arduino IDE lokal: ESP32 **3.3.11**, HX711 **Rob Tillaart 0.6.5**,
MFRC522 **1.4.12**, ArduinoJson **6.21.5**. SPI mengikuti default library 4 MHz.
Konfigurasi `.tools/arduino-tested.yaml` membaca core yang sudah terpasang di
`/home/rvm-prodesk/.arduino15` dan memakai salinan library di `.tools/arduino-tested-user`.
Profil produksi lama terpisah; produksi otomatis belum diimplementasikan.

## Perilaku pengujian

- Relay OFF dan pulsa motor LOW sejak setup. Core 3.x memerlukan pinMode sebelum
  digitalWrite; firmware menyiapkan latch lewat gpio_set_level, lalu pinMode dan
  digitalWrite. Status relay dibaca langsung dari GPIO, bukan variabel perintah. Kondisi pin selama bootloader/upload
  terjadi sebelum sketch berjalan dan tidak dapat dijamin oleh kode setup.
- IR melaporkan HIGH/LOW asli dan trigger LOW, tanpa debounce/filter tambahan.
- HX711 menggunakan `read()` library yang sama dengan tes dasar. RAW dibaca setiap
  500 ms, tanpa median/perataan. Sensor tidak ready tidak memblokir loop.
- Zero/kalibrasi mengambil rata-rata 10 sampel; konfigurasi disimpan hanya setelah
  sampel tidak saturasi dan faktor valid. Nilai RAW tetap terlihat sebelum kalibrasi.
- RFID menggunakan `PICC_IsNewCardPresent`, `PICC_ReadCardSerial`, Halt dan StopCrypto.
  Versi 0x82 diterima. Tidak ada reset otomatis atau siklus wake/self-test.
  UID terakhir tersimpan sampai scan berikutnya atau reset reader. Lepas lalu
  tempel kartu lagi untuk scan ulang.
- Stepper mengikuti sketch dasar `micros()` + pulsa 10 us. Forward menambah posisi,
  backward mengurangi, Stop mempertahankan posisi. Posisi adalah hitungan pulsa
  sejak boot, bukan encoder. Speed adalah interval pulsa yang diminta, bukan
  kecepatan mekanis terukur; serial dapat menambah jeda singkat.
- Untuk pengujian per modul, transaksi HX711/RFID dijeda saat motor berjalan dan
  otomatis dilanjutkan setelah Stop. IR dan komunikasi app tetap berjalan.
- Mode app: heartbeat terputus >3 detik menghentikan motor dan mematikan relay.

## Arduino IDE / Serial Monitor

Buka source di atas, pilih ESP32 Dev Module dan Serial Monitor 115200 baud.
Tidak perlu Wi-Fi atau library timer. Perintah manual:

| Perintah | Aksi |
|---|---|
| f / b / s | Forward / backward / stop |
| 1 / 2 | Relay 1 ON / OFF |
| 3 / 4 | Relay 2 ON / OFF |
| 0 | Kedua relay OFF dan motor Stop |

Mode manual mengikuti tes dasar: motor berjalan sampai Stop, tanpa heartbeat app.
Telemetri JSON otomatis memperlihatkan IR, RAW, UID, relay dan posisi pulsa. Perintah
JSON app mengaktifkan kembali aturan heartbeat.

## Compile lewat CLI

```bash
env PATH="$PWD/.tools/venv/bin:$PATH" .tools/arduino-cli --config-file .tools/arduino-tested.yaml compile --fqbn esp32:esp32:esp32 --jobs 2 --build-path /tmp/rvm-diag-basic-v2-build --output-dir firmware/builds/rvm_diag firmware/arduino/rvm_diag
```

App mengemas source dan binary dengan checksum. Buka ulang app, masuk Uji komponen,
lalu `Hubungkan & siapkan`; installer memakai firmware 2.0.1 dan profil core yang
sama. Draft Script yang sudah diedit tetap dipertahankan; impor source terbaru
untuk mengompilasi manual jika draft masih berisi versi lama.

Cadangan sebelum rebuild: `../backups/rebuilt-test-20261006/`.
Hasil verifikasi tersedia di `builds/rvm_diag/verification.json`.
