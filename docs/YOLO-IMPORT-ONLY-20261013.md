# YOLO: impor, pengujian, dan siklus

App kini hanya menyediakan impor model YOLO PyTorch `.pt` (maksimal 500 MB). Kontrol pembuatan model, dataset, anotasi, crop dataset, dan training lokal serta endpoint IPC-nya dihapus. Model yang sudah selesai dilatih sebelumnya tetap tersedia; data lama tidak dihapus.

Impor memuat model melalui runtime Ultralytics lokal, membaca daftar kelas, dan mencoba inferensi CPU sebelum menyimpan metadata siap pakai. Model deteksi, segmentasi (hasil kotak), dan klasifikasi didukung. `.pt` harus merupakan model YOLO yang kompatibel dengan runtime; file PyTorch umum tidak otomatis menjadi model YOLO. File invalid ditolak dan salinan sementara dibersihkan.

Impor lama sebelumnya hanya menyalin file ke `userData/models`, sementara pengujian dan produksi membaca `userData/vision`. App kini memigrasikan file `.pt` dari lokasi lama melalui validasi yang sama saat daftar model dibuka. File sumber tetap disimpan. Impor yang gagal ditampilkan sebagai belum siap beserta pesan kesalahannya.

Penggunaan:

1. Buka ulang app → Admin → Model YOLO → **Impor model .pt**.
2. Pilih kamera → **Nyalakan kamera** → **Uji kamera langsung** untuk melihat hasil kelas dan confidence.
3. Pilih **Kelas yang diterima** dan confidence → **Gunakan untuk siklus**. Model, kelas, kamera, dan confidence disimpan ke pengaturan produksi untuk mode satu model.
4. Untuk tiga model, atur objek → PET → tutup melalui **Performa**. Model objek harus menghasilkan kotak deteksi; PET/tutup juga dapat memakai klasifikasi.
5. Kembali ke halaman utama dan mulai sesi menggunakan kartu terdaftar. Firmware produksi harus sedang berjalan untuk siklus mesin.

Validasi: file `best.pt` yang pernah diimpor berhasil divalidasi (kelas `botol`) dan dipakai untuk inferensi CPU serta preflight/keputusan `cv_result` pada transport simulasi. Gambar uji umum tidak menghasilkan deteksi botol; keputusan kosong ditolak. File invalid ditolak tanpa masuk daftar; migrasi impor lama tidak berulang. Tes client produksi 13/13 lulus. Tes worker pipeline dan klasifikasi 2/2 lulus; inferensi tiga model nyata juga lulus dan frame kosong ditolak. Tes browser memakai kamera simulasi, memverifikasi impor, kotak/label hasil, simpan pilihan siklus, pembatalan/error, dan layout 1024/800. Siklus fisik dengan motor/kamera mesin belum diuji.

App terpasang: `release/linux-unpacked/resources/app.asar`. Cadangan: `backups/yolo-import-20261013/app-before-import-only.asar`. Untuk memperbarui paket dari modul yang diedit, jalankan `python3 scripts/workbench/patch-training.py` (nama skrip historis; sekarang memasang modul impor saja). Semua firmware dalam paket dipertahankan byte-per-byte, termasuk toggle stepper.
