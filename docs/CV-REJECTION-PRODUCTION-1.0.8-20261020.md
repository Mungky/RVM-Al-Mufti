# Prioritas penolakan CV dan production 1.0.8

## Penyebab dan aturan baru

Aturan sebelumnya hanya mencari salah satu kelas diterima. Ketika botol dan tutup muncul bersamaan, botol yang cocok sudah membuat hasil diterima. Sekarang kelas ditolak diperiksa lebih dahulu.

Untuk model terbaru pengguna, metadata menunjukkan task `detect`, dengan kelas:

| Kelas | Pilihan |
|---|---|
| Leminerale 600ml | Diterima |
| tutup botol | Ditolak |
| Aqua 330ml | Diterima |

Atur di Admin → Model YOLO → Gunakan dalam siklus, atau Performa → Production. Setiap kelompok dapat memiliki beberapa kelas. Satu kelas tidak boleh masuk kedua kelompok; memilihnya di kelompok lain otomatis memindahkannya.

1. Jika kelas ditolak (tutup) mencapai confidence penolakan, hasil CV ditolak meskipun botol juga terdeteksi.
2. Jika tidak ada kelas botol diterima yang mencapai confidence botol, hasil ditolak, termasuk frame kosong atau tutup saja.
3. Jika botol memenuhi ambang dan tidak ada deteksi tutup yang memenuhi ambang penolakan, CV menerima.
4. ESP tetap menolak berat rata-rata >50 gram walaupun CV menerima. Tepat 50 gram masih boleh diterima.

Confidence botol (`productionConfidence`) dan penolakan (`productionRejectConfidence`) terpisah, rentang 25–100%. Nilai awal confidence penolakan mengikuti confidence botol. Deteksi tutup di bawah ambangnya belum dianggap sebagai deteksi yang cukup yakin; kualitas pendeteksian tetap bergantung pada model, pencahayaan, posisi objek dan gambar kamera. Tidak ada perubahan atau training ulang bobot model pada revisi ini.

`productionRejectedClasses` menyimpan ID kelas penolakan. Pengaturan lama kelas diterima dipertahankan, tetapi kelas penolakan harus dipilih dan disimpan sebelum memulai sesi. Aplikasi tidak menebak kelas tutup dari nama kelas secara otomatis. Konfigurasi kosong/invalid atau kelas diterima dan ditolak bertumpang tindih memblokir sesi.

Uji kamera pada halaman Model sekarang menampilkan keputusan DITERIMA/DITOLAK berdasarkan aturan yang dipilih. Log aktivitas sesi mencatat alasan, nama kelas, confidence deteksi, dan ambang yang digunakan. Uji kamera tidak menimbang; penolakan >50 gram tetap dilakukan ESP saat sesi mesin.

## Firmware 1.0.8

Relay 2 ON selama 20000 ms sejak botol diterima, termasuk setelah conveyor selesai bergerak. LED kuning blinking dan penahanan penerimaan botol berikutnya mengikuti masa release ini. Jumlah gerakan intake/accept tetap 12000 pulsa; penolakan tetap forward hingga IR1, pengambilan tetap 300 ms bebas, dan perilaku Reset tetap seperti 1.0.7.

Source dan binary: `firmware/arduino/rvm_production/rvm_production.ino` dan `firmware/builds/rvm_production/`. Paket aplikasi diperbarui di `release/linux-unpacked/resources/app.asar`. Buka ulang aplikasi, atur kelas dan confidence, simpan; upload firmware 1.0.8 untuk durasi relay 20 detik. Draft firmware lama yang pernah diedit perlu diimpor ulang dari source/template terbaru.

Cadangan sebelum perubahan: `backups/cv-rejection-production108-20261020/`.

## Verifikasi

- 23 tes client: prioritas tutup terhadap Aqua/Le Minerale, tidak ada botol, confidence terpisah dan batas tepat, konfigurasi invalid, hasil AI terlambat, Reset dan LED.
- Tes state machine dan rutin motor aktual memakai GPIO simulasi: batas berat 50 gram, release 20 detik (tetap ON pada batas lama 12 detik, ON pada 19999 ms dan OFF pada 20000 ms), wrap millis, IR1 return, Reset dan tutup independen.
- Compile ESP32 core 3.3.11 berhasil.
- Tes browser paket aplikasi: kelas diterima/ditolak, confidence penolakan, simpan/reload, pergantian model, impor dan kamera, botol+tutup ditolak, tampilan 20 detik, serta Reset.

Belum diupload atau diuji pada mesin fisik dalam revisi ini; port USB ESP tidak tersedia saat pemeriksaan. Hasil CV uji berupa respons terkontrol; metadata model pengguna dibaca untuk memastikan jenis dan kelas, tetapi akurasi model di kamera nyata belum diverifikasi.
