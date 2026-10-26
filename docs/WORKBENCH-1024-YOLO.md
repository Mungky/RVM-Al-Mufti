# Pengujian ESP dan studio model kamera — 5 Oktober 2026

## Tampilan

Kanvas aplikasi dan ukuran isi jendela adalah 1024×768. Aplikasi mulai fullscreen; F11 berganti antara fullscreen dan jendela. Fullscreen mengikuti layar yang dipakai dan kanvas diskalakan dengan rasio tetap. Pada desktop yang ruang kerjanya lebih kecil, ukuran jendela dapat dibatasi window manager. `./run-rvm.sh --windowed` membuka jendela sejak awal.

## ESP baru / firmware pengujian

Di **Uji komponen**, matikan Mode demo untuk kontrol perangkat, lalu tekan **ESP32 — Hubungkan & siapkan**. Pilih port ESP. Aplikasi memeriksa respons firmware diagnostic versi 1.2.1 pada 115200 baud. Bila sesuai, langsung terhubung. Bila belum sesuai, aplikasi mengunggah binary template pengujian yang telah diverifikasi checksum, memeriksa respons, lalu membuka koneksi pengujian. Pesan proses tampil pada panel. Jangan cabut USB saat upload. Firmware sebelumnya pada ESP akan diganti oleh firmware pengujian.

Target template adalah **ESP32 Dev Module / ESP32 klasik** (`esp32:esp32:esp32`), dengan pemetaan pin di template. ESP pengganti harus kompatibel dan memakai pemetaan kabel yang sama. Zero/kalibrasi loadcell pada ESP pengganti perlu dilakukan ulang karena disimpan di ESP. Ini tidak memperbaiki gangguan catu daya/kabel sensor yang sudah tercatat di COMPONENT-TEST-REVISION.md.

Untuk membuka kode manual: **Script → Firmware pengujian siap upload → Compile → Upload**. Draft pengujian dan produksi disimpan terpisah; berpindah draft menyimpan isi editor saat ini. Template bawaan berada di `firmware/arduino/rvm_diag/rvm_diag.ino` dan juga di paket aplikasi, sehingga perubahan draft tidak menimpa template. Upload otomatis memakai template bawaan beserta binary terverifikasi, bukan draft yang sedang diedit. Firmware produksi tetap belum dikembangkan.

Toolchain Arduino dan binary tersedia di folder aplikasi ini. Pertahankan `.tools` saat memindahkan folder aplikasi. Jika toolchain perlu dipasang ulang, gunakan `setup-esp-tools.sh`. Build manual pengujian membutuhkan `compiler.cpp.extra_flags=-DMFRC522_SPICLOCK=4000000UL`; editor aplikasi memasangnya otomatis.

## Model kamera: beberapa objek sekaligus

1. Buka **Model YOLO**, isi nama, pilih YOLO26 Nano / YOLO11 Nano / YOLOv8 Nano, lalu **Buat model**.
2. Tambahkan nama objek, misalnya botol plastik dan tutup botol.
3. Nyalakan kamera dan ambil gambar. Pilih label, lalu tarik kotak mengelilingi tiap objek. Dalam satu gambar boleh ada beberapa objek dan beberapa kelas. Tandai semua objek sasaran yang terlihat, kemudian **Simpan ke dataset**.
4. Ulangi dengan variasi posisi, jarak, pencahayaan, dan latar. Batas minimum untuk menjalankan training: 10 gambar total dan 5 gambar berbeda per kelas. Minimum ini hanya syarat menjalankan proses, bukan jaminan akurasi. Gambar identik ditolak.
5. Pilih epoch, lalu **Mulai training**. Training sungguhan berjalan lokal di CPU, gambar 320 px, batch 2, dua thread. Sekitar 20% foto dipisahkan untuk evaluasi; setiap kelas harus ada di kedua bagian. Log, progres epoch, dan mAP hasil evaluasi tersedia. Pembatalan mempertahankan model selesai sebelumnya.
6. Setelah selesai, nyalakan kamera dan tekan **Uji kamera langsung**. Hasil berupa kotak, label, dan confidence pada frame yang diproses. Model ini belum menjalankan sortir mesin produksi.

Karena beberapa objek dapat muncul sekaligus, sistem memakai **object detection** dan membutuhkan kotak per objek. Foto berlabel satu kelas saja tidak memberi informasi lokasi beberapa objek. Referensi: [Ultralytics object detection](https://docs.ultralytics.com/tasks/detect/), [YOLO26](https://docs.ultralytics.com/models/yolo26/), [training](https://docs.ultralytics.com/modes/train/).

Dataset dan model tersimpan di direktori userData aplikasi, subfolder `vision/<id-model>/`: `project.json`, `captures/`, dataset train/val, dan `model.pt`. Dataset tetap tersedia setelah aplikasi ditutup. Model impor lama tetap dapat diakses melalui bagian lipat di bawah studio.

Runtime sudah dipasang di komputer ini: Ultralytics 8.4.173, PyTorch 2.14.1 CPU. Ketiga model Nano dasar sudah disimpan di `.tools/vision-models`. Untuk memasang ulang gunakan `./setup-vision-tools.sh` dengan internet; dependensi terkunci dalam `.tools/vision-requirements.lock`. Sumber bobot resmi: repositori Hugging Face Ultralytics YOLO26, YOLO11, YOLOv8.

## Validasi

- Unit/integration koneksi: firmware sesuai tidak di-flash ulang, firmware tidak sesuai menjalankan upload dan verifikasi pada port sama, port sibuk tidak memicu upload; draft produksi/pengujian tidak saling menimpa.
- Training CPU YOLO26 satu epoch pada 12 gambar sintetis dua kelas menghasilkan bobot tersimpan; inferensi dengan bobot tersebut berhasil. Ini menguji alur software, bukan kualitas deteksi benda asli.
- Ketiga arsitektur Nano diuji pemuatan bobot dan inferensi CPU.
- Browser dengan kamera simulasi: mengambil gambar, menggambar dua kotak dengan kelas berbeda, menyimpan dataset; tampilan 1024×768 dan 800×600 tanpa overflow horizontal.
- Pengujian Electron terisolasi mencakup fullscreen/F11 dan API preload. Pengujian tidak meng-upload ESP fisik atau mengubah database utama.

Patcher: `python3 scripts/connection-fix/patch_bundle.py /tmp/rvm-app-workbench.asar`. Salinan paket sebelum perubahan: `backups/workbench-20261005/app.asar`.
