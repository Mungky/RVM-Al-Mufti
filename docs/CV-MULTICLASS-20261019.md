# Beberapa kelas diterima untuk satu model CV

Pengaturan kelas pada mode **Satu model** sekarang berupa checkbox. Satu atau beberapa kelas dapat dipilih di:

- Admin → Model YOLO → Gunakan dalam siklus → Kelas yang diterima → Gunakan untuk siklus.
- Admin → Performa → Production → Satu model → Kelas yang diterima → Simpan pengaturan production.

Kedua halaman memakai pengaturan yang sama. Buka ulang aplikasi untuk memuat pembaruan.

Contoh: model memiliki PET bening, PET berwarna, dan Bukan PET. Centang PET bening serta PET berwarna. Salah satu dari kedua kelas itu dapat diterima jika confidence mencapai minimum. Deteksi kelas yang tidak dipilih, confidence terlalu rendah, atau hasil kosong tidak memenuhi penerimaan CV.

Keputusan CV tetap dikirim ke ESP sebagai accepted true/false. Batas berat production 1.0.7 tetap berlaku: berat lebih dari 50 gram ditolak walaupun CV cocok. Tidak perlu upload firmware lagi untuk perubahan pilihan kelas ini.

Pengaturan baru menggunakan `productionSingleClasses` (array ID kelas). Pengaturan lama `productionSingleClass` dibaca sebagai satu kelas. Saat menyimpan, field lama tetap diisi kelas pertama untuk kompatibilitas. Array baru diutamakan; array kosong/invalid tidak dianggap menerima semua kelas. Mengganti model mengosongkan pilihan supaya ID kelas model sebelumnya tidak terbawa. Minimal satu kelas harus dipilih sebelum menyimpan/memulai sesi.

Pipeline tiga model tetap mengikuti pengaturan sebelumnya, sesuai lingkup permintaan satu model.

## Berkas

- Client dan pengaturan production: `scripts/production/production-client.mjs`.
- Halaman Model: `scripts/workbench/model-studio.mjs`.
- CSS: `scripts/production/multiclass.css`.
- Pengemas: `scripts/production/package-multiclass.py`.
- Paket diperbarui: `release/linux-unpacked/resources/app.asar`.
- Cadangan: `backups/cv-multiclass-20261019/app-before.asar`.

## Verifikasi

Tes client mencakup kedua kelas terpilih, kelas lain, ambang confidence, hasil kosong, kompatibilitas scalar lama, serta konfigurasi kosong/invalid yang tidak boleh memulai sesi.

Tes browser `scripts/production/multiclass-browser-test.cjs` mencakup migrasi, centang dua kelas, simpan/reload, sinkronisasi halaman Model/Production, pergantian model, validasi pilihan kosong, dan layout 1024×768/800×600.

Tes `scripts/workbench/import.visual.cjs` memeriksa alur impor .pt, penyimpanan kelas, uji kamera dan overlay hasil. Inferensi dalam tes memakai hasil simulasi terkontrol; model/hardware milik pengguna tidak dijalankan.
