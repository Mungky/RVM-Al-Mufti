# Production 1.0.7 — batas berat, pengembalian IR1, dan Reset

## Penerimaan dan penolakan

Berat botol tetap memakai rata-rata sampel selama jendela penimbangan 2 detik. Berat valid lebih dari 50 gram langsung ditolak tanpa menunggu AI; tidak menambah gram atau jumlah botol diterima. Berat tepat 50 gram masih boleh diterima jika AI menyetujui. Berat nol/negatif atau sampel invalid tetap masuk fault.

Penolakan AI maupun berat berlebih menggerakkan conveyor forward secara kontinu sampai IR1 tertrigger. Tidak ada batas gerakan 12000 step untuk penolakan. Saat IR1 aktif, motor langsung berhenti. Jika IR1 sudah aktif ketika keputusan penolakan dibuat, motor tetap berhenti dan langsung menunggu pengambilan.

Relay 1 ON, relay 2 OFF, dan LED merah solid selama pengembalian, menunggu pengambilan, serta 300 ms pertama sensor bebas. IR1 harus bebas terus 300 ms setelah botol terdeteksi; trigger ulang membatalkan timer. Setelah itu masuk siap botol dengan LED hijau blinking, sesi tetap aktif dan relay 1 tetap ON.

Batas waktu pengembalian 30 detik: jika IR1 tidak mendeteksi botol, motor dan relay dimatikan dan masuk fault `return_ir_timeout`.

Hasil AI yang selesai setelah penolakan berat diabaikan. ID siklus lama tidak boleh mengubah gerakan atau memicu motor_stop pada pengembalian normal.

## LED

| Kondisi | Target LED |
|---|---|
| Home / standby | Hijau blinking, 30% |
| Masuk halaman perhitungan / zero / siap botol / rearm | Hijau blinking, 30% |
| Intake dan inspeksi | Biru solid, 60% |
| Diterima / release relay 2 | Kuning blinking, 60% |
| Ditolak / menunggu pengambilan / fault | Merah solid, 60% |

Blinking tetap 500 ms ON dan 500 ms OFF melalui aplikasi dan BLE.

## Reset di halaman perhitungan

Reset dapat digunakan pada kondisi sesi normal dan fault, termasuk saat motor bergerak atau relay 2 sedang aktif. Perintah dikirim sebelum menunggu persiapan kamera/model.

- Conveyor berhenti langsung, tanpa gerakan pengembalian otomatis.
- Relay 1 ON, relay 2 OFF.
- LED hijau blinking.
- Zero dari 10 sampel baru; titik nol mengikuti beban yang ada ketika Reset dilakukan.
- Total gram, botol diterima dan tutup yang sudah tercatat dipertahankan.
- ID siklus berubah supaya hasil AI sebelum Reset tidak dipakai lagi.
- Setelah zero, IR1 perlu terlihat bebas sebelum menerima pemicu botol berikutnya.

Kalibrasi harus valid. Zero timeout tetap 9 detik; sampel saturasi tetap menghasilkan fault. Tombol Reset dinonaktifkan selama proses reset berlangsung atau serial terputus.

## Berkas dan pemasangan

Source: `firmware/arduino/rvm_production/rvm_production.ino`.
Binary: `firmware/builds/rvm_production/`.
Template dan production-client sudah dikemas di `release/linux-unpacked/resources/app.asar`.
Buka ulang aplikasi dan gunakan source/template 1.0.7 saat upload. Draft lama yang diedit pengguna perlu diimpor ulang secara manual.
Cadangan: `backups/production-107-20261019/`.
Video 12 detik, Scan now profil, dan firmware diagnostik dipertahankan.

Pengujian: host state machine dan rutin timer/motor aktual dengan GPIO simulasi; tes client termasuk hasil AI terlambat dan urutan Reset; compile ESP32 core 3.3.11; browser workflow paket aplikasi dengan serial/BLE/kamera simulasi. Hasil akhir dicatat di `firmware/builds/rvm_production/verification.json`.

Belum diupload atau diuji pada mesin fisik pada perubahan ini; port /dev/ttyUSB* dan /dev/ttyACM* tidak tersedia saat pemeriksaan.
