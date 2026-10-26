# Toggle pengujian stepper

Firmware diagnostik 2.0.2 dan app memiliki toggle **Stepper conveyor** pada Admin → Uji komponen → Stepper.

- Default OFF setelah boot. Forward, Reverse, dan gerak ke posisi hanya diizinkan setelah ON.
- OFF menghentikan pulsa dan mengubah ENA GPIO25 ke HIGH (nonaktif, sesuai mapping driver sebelumnya).
- Stop dan akhir gerak tetap melepas driver; izin pengujian tetap ON sampai toggle dimatikan.
- Keluar panel stepper mengirim OFF. Heartbeat hilang selama 3 detik juga mengembalikan izin ke OFF.
- Telemetry `motorEnabled` menunjukkan izin pengujian. Perintah JSON `motor_enable` memerlukan `on` boolean.
- Serial manual: `e` ON, `d` OFF; `f`/`b` ditolak saat OFF, `s` Stop, `0` mematikan motor dan relay.

Buka ulang app, kemudian pilih **Hubungkan & siapkan** untuk memasang firmware diagnostik yang baru. Firmware, binary, dan checksum bawaan diperbarui bersama. Cadangan app ada di `backups/stepper-toggle-20261012/app.asar`.

Validasi: harness C++ menjalankan fungsi motor aktual (OFF menolak gerak, ON mengizinkan, OFF saat bergerak menghentikan pulsa dan menonaktifkan ENA); tes browser lulus untuk tombol terkunci, ON/OFF, kedua arah, dan OFF saat keluar tab. Tampilan diverifikasi pada 1024×600. Compile ESP32 core 3.3.11 menggunakan SPI RFID 4 MHz. Belum upload/uji panas motor secara fisik karena tidak ada port USB ESP yang terdeteksi.
