# Firmware pengujian 2.0.1 — 6 Oktober 2026

Dibangun ulang dari program dasar pengguna yang sudah berhasil diuji di Arduino IDE.
Menggunakan ESP32 core 3.3.11, HX711 Rob Tillaart 0.6.5, dan MFRC522 1.4.12 (SPI 4 MHz).

Pin: IR 14/26/27 Active LOW; Relay 1 GPIO15 dan Relay 2 GPIO33 Active LOW;
TB6600 PUL2/DIR4/ENA25; HX711 DT34/SCK32; RC522 SS16/RST17/SCK22/MISO13/MOSI21.

## Hasil perangkat

Upload 2.0.1 selesai dengan hash data terverifikasi. Rekaman akhir menerima
118 telemetry, 117 di antaranya HX711 ready. RFID versi 0x82 membaca
UID B3CD1B39 dua kali. RAW HX711 pada rekaman ready berkisar
-644111 sampai -632677;
rentang 10 sampel terakhir 143 ADC count dan tidak saturasi. Faktor kalibrasi
masih 0; belum ada kalibrasi berat baru selama verifikasi.

GPIO relay 15/33 HIGH, telemetry kedua relay OFF, dan pengguna mengonfirmasi
kedua relay secara fisik mati. Pada build 2.0.0 digitalWrite sebelum pinMode
terabaikan oleh core 3.3.11. Revisi 2.0.1 menyiapkan latch melalui gpio_set_level
sebelum mengaktifkan output, lalu menulis level lagi. Status relay dibaca dari GPIO.

Data: rebuilt-test-2.0.1-interaction.json. Rekaman idle sebelumnya:
rebuilt-test-2.0.1-live.json. Motor dan relay ON tidak dipicu otomatis dalam
verifikasi firmware gabungan. Program dasar keduanya sudah diuji pengguna.

## Perilaku dan pemeriksaan software

Stepper memakai micros dan pulsa 10 us; posisi merupakan hitungan pulsa,
bukan pembacaan encoder. RFID/HX711 dijeda selama motor bergerak dan kembali
aktif setelah Stop. RAW dibaca tiap 500 ms. Heartbeat app terputus lebih dari
3 detik menghentikan motor dan mematikan relay. Serial Monitor menyediakan
f/b/s, 1/2/3/4, dan 0 untuk stop serta kedua relay OFF.

Compile, pemeriksaan fungsi firmware asli, backend, renderer, dan browser
lulus. Pemeriksaan meliputi mapping relay, inisialisasi latch OFF pada core 3,
Active LOW IR, arah/stop/target motor, batas hitungan dan rollover micros,
profil compile/upload, tiga kanal IR, UID terakhir, RAW, dan sinkronisasi relay.

## Paket dan cadangan

Source/binary 2.0.1 serta manifest dikemas dalam app terpasang di
release/linux-unpacked/resources/app.asar. Tutup dan buka app untuk memakai
paket baru; Hubungkan & siapkan memakai firmware ini. Draft editor lama tetap
dipertahankan; impor source terbaru bila mengompilasi dari editor.

Cadangan app/source dan binary stepper dasar ada di backups/rebuilt-test-20261006/.
Pembacaan flash asli terputus dua kali; cadangan flash bit-for-bit tidak tersedia.
