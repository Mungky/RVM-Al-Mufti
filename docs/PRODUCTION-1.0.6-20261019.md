# Production 1.0.6 — LED dan penghitung tutup

- Standby: hijau berkedip, brightness 30%.
- Sesi aktif, termasuk zero, intake, inspeksi dan siap botol: biru solid 60%.
- Ditolak / menunggu pengambilan / fault: merah solid 60%.
- Diterima: kuning berkedip 60% selama state accept_move. Relay 2 tetap 12 detik.
- Kedipan dibuat aplikasi: 500 ms ON, 500 ms OFF melalui API solid BLE yang sudah tersedia. Memerlukan aplikasi dan BLE terhubung.
- IR3 menghitung selama seluruh sesi aktif, termasuk motor bergerak, inspeksi, pengembalian dan release relay 2. Tidak menghitung saat standby/fault.
- IR3 harus bebas 100 ms untuk siap, lalu aktif 30 ms untuk satu hitungan. Sensor tertahan tidak dihitung berulang; pergantian tahap botol tidak mereset pengunci tutup.
- IR1 dan IR3 independen: memasukkan tutup tidak menunda botol; keduanya dapat terpicu bersamaan.
- Total tutup dipertahankan saat reset/selesai dan direset pada sesi baru.

Source dan binary production diperbarui; template firmware dan production-client dalam app.asar diperbarui. Buka ulang aplikasi agar modul baru dimuat. Cadangan sebelum perubahan: backups/production-20261019/.

Belum diupload atau diuji di hardware pada perubahan ini: /dev/ttyUSB* tidak tersedia. Upload source/binary production 1.0.6 setelah ESP terhubung. Firmware dan binary diagnostik tidak diubah.
