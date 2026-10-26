# Firmware production 1.0.0

Source standalone: `firmware/arduino/rvm_production/rvm_production.ino`.
Menggunakan core ESP32 3.3.11, ArduinoJson 6.21.5, HX711 Rob Tillaart 0.6.5,
dan MFRC522 1.4.12 yang sama dengan pengujian. Source dan binary pengujian tidak diubah.
Relay 1 = GPIO 15; Relay 2 = GPIO 33, Active LOW.
Motor maju = DIR HIGH, mundur = DIR LOW; 500 pulsa/detik mengikuti tes dasar.

## Urutan

1. Standby: keluaran motor/relay OFF; target LED breathing hijau 30%.
2. RFID mengirim UID ke app. Database profil berada di app. App menawarkan profil
   baru untuk UID belum terdaftar; hanya profil aktif yang boleh memulai sesi.
3. `session_start` dengan UID hasil scan: zero dari 10 sampel baru, lalu Relay 1 ON.
   Target LED breathing biru 60%. App membuka halaman perhitungan setelah ACK.
4. Setelah IR 1 bebas lalu tertrigger: conveyor mundur tepat 13000 pulsa.
5. Setelah motor berhenti: event `inspection_request` meminta CV. Sampel RAW baru
   dikonversi dengan faktor kalibrasi, lalu dirata-rata selama jendela 2000 ms.
   Sampel tepat/setelah batas 2000 ms tidak dimasukkan. Tidak memakai median/EMA.
6. Hasil CV diterima dan berat valid: gram kumulatif bertambah satu kali. App
   memakai konversi gram → poin yang sudah ada. Conveyor maju 15000 pulsa dan
   Relay 2 ON **bersamaan**; Relay 2 OFF setelah 5000 ms. Penghitungan tutup belum
   diminta, sehingga `caps` tetap 0.
7. Hasil CV ditolak: tidak menambah gram; LED merah; conveyor maju sampai IR 1
   bebas lalu tertrigger. Motor berhenti, kemudian menunggu IR 1 bebas lagi.
8. Siklus berulang. `session_stop` menghentikan motor dan kedua relay langsung,
   kembali standby, mengirim total final pada ACK. Total dipertahankan sampai
   sesi berikutnya. Jika Selesai ditekan saat siklus bergerak, siklus itu berhenti.

Kalibrasi production disimpan di namespace `rvm-prod`. Pada pemakaian pertama,
faktor dari `rvm-diag` dibaca sebagai fallback; nilai pengujian tidak ditulis ulang.
Zero per sesi berada di RAM. Timbangan harus kosong sebelum sesi dimulai.

## Protokol integrasi app

USB serial 115200; satu objek JSON per baris. `id` wajib untuk perintah.
Heartbeat `ping` setiap 1 detik; terputus >3 detik menghentikan motor/relay dan
masuk `fault`. `session_stop` mengembalikan controller ke standby.

```json
{"id":"start-1","cmd":"session_start","uid":"A1B2C3D4"}
{"type":"inspection_request","cycleId":1,"uid":"A1B2C3D4","windowMs":2000}
{"id":"cv-1","cmd":"cv_result","cycleId":1,"accepted":true}
{"id":"finish-1","cmd":"session_stop"}
```

`cycleId` bertambah sepanjang boot, termasuk lintas sesi. Keputusan CV hanya
boleh sekali pada state inspection dan untuk ID siklus yang sesuai.
Tidak ada asumsi label/model/confidence di firmware: app bertanggung jawab
menentukan `accepted` dari model visual. Jika belum ada keputusan selama 30
detik, masuk fault tanpa menambah gram. IR pengembalian juga dibatasi 30 detik.
HX711 timeout/saturasi atau berat tidak positif menyebabkan fault.

Telemetri memuat `productionState`, `sessionActive`, `sessionFinished`, `cycleId`,
`bottleGrams`, `acceptedBottles`, `productionError`, serta target `ledMode`,
`ledColor`, `ledBrightness`. LED dikendalikan lewat BLE oleh app, bukan pin ESP32.
Firmware hanya mengirim targetnya; aplikasi perlu menerapkan breathing tersebut.

App distribusi saat pekerjaan dimulai belum mengirim UID pada `session_start`,
belum menangani `inspection_request`/`cv_result` atau target LED, dan UID tidak
terdaftar masih ditampilkan sebagai pesan penolakan. Firmware ini belum dapat
menjalankan seluruh alur melalui app sebelum integrasi itu selesai. Pemilihan
model, label diterima, dan batas confidence harus ditetapkan untuk integrasi CV.

## Verifikasi

```bash
python3 scripts/production/test-flow.py
env PATH="$PWD/.tools/venv/bin:$PATH" .tools/arduino-cli --config-file .tools/arduino-tested.yaml compile --fqbn esp32:esp32:esp32 --jobs 2 --build-path /tmp/rvm-production-build --output-dir firmware/builds/rvm_production firmware/arduino/rvm_production
```

Tes host menjalankan class flow yang diekstrak langsung dari sketch: zero,
IR harus bebas sebelum botol baru, rata-rata 2 detik, CV duplikat/ID lama,
terima/tolak, relay 5 detik bersamaan dengan motor, stop, timeout dan saturasi.
Compile ESP32 memverifikasi API/library. Belum di-upload atau diuji pada mesin.

Template production di dalam app telah diperbarui, termasuk pemilihan core 3.3.11
untuk compile production 1.x. Buka ulang app, Admin → Script, impor template
production terbaru; draft yang sudah diedit tidak ditimpa otomatis. Profil CV yang
diminta pengguna: Botol + tutup. Di penyimpanan lokal, “Botol Plastik dan Tutup”
dan “Botol Dengan Tutup” masih belum trained dan kelasnya kosong pada pemeriksaan.
