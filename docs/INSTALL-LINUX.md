# Instalasi RVM pada PC Linux

Paket portable **Linux x86_64** memakai binary Electron yang sudah dibangun. Tidak perlu memasang Node, npm, browser tambahan, Codex, atau seluruh folder proyek. Video/font tersedia offline. Paket diuji pada **Zorin OS 18.1 / basis Ubuntu 24.04**; distro lain perlu library desktop yang sesuai.

## Jalankan di komputer pengembangan ini

```bash
cd "/home/mushii/Documents/Project/RVM Al-Mufti"
./run-rvm.sh
```

Fullscreen sejak awal: `./run-rvm.sh --kiosk`. F11 mengubah mode kiosk, Escape keluar dari fullscreen. Membuka aplikasi dua kali mengaktifkan jendela yang sudah ada untuk menghindari proses ganda. `--source` digunakan untuk pengembangan dan melakukan build; gunakan launcher biasa untuk operasional.

## Pindahkan ke PC baru

1. Salin `release/RVM-Al-Mufti-Linux-x64.tar.gz` ke PC tujuan melalui flashdisk.
2. Ekstrak melalui file manager, atau terminal:

```bash
tar -xzf RVM-Al-Mufti-Linux-x64.tar.gz
cd RVM-Al-Mufti-Linux-x64
./install-linux.sh --autostart
```

Installer berjalan sebagai **pengguna biasa**, tanpa sudo. Aplikasi dipasang ke `~/.local/opt/rvm-al-mufti/`, ditambahkan ke menu aplikasi, dan startup fullscreen dibuat di `~/.config/autostart/id.almufti.rvm.desktop`. Pengaturan/data pribadi tidak ditimpa. Untuk lokasi lain, gunakan `--dest /lokasi/yang/diinginkan`. Tujuan tidak boleh folder paket sumber.

Setelah terpasang, buka **menu aplikasi → RVM Al-Mufti**, atau:

```bash
~/.local/opt/rvm-al-mufti/run-rvm.sh
```

Autostart terjadi **setelah pengguna masuk ke desktop**. Agar dari tombol power langsung ke RVM, aktifkan **login otomatis** untuk akun khusus mesin pada pengaturan login OS. Lokasi pengaturannya mengikuti distro/display manager. Installer tidak mengubah login komputer pengembangan atau konfigurasi sistem. Uji satu kali reboot di PC tujuan sebelum penggunaan mesin.

Menonaktifkan startup RVM:

```bash
rm ~/.config/autostart/id.almufti.rvm.desktop
```

Untuk memperbarui aplikasi, tutup RVM, ekstrak paket baru, lalu jalankan installer kembali. Toolchain `.tools` yang sudah dipasang dipertahankan. Database tetap berada di direktori data pengguna.

## Dependensi OS dan USB

Pada desktop Ubuntu 24.04+ / turunannya, bila installer melaporkan library belum ada:

```bash
sudo apt update
sudo apt install python3 libgtk-3-0t64 libnss3 libasound2t64 libgbm1
```

Installer memeriksa dependensi dengan `ldd` bila tersedia. Distro yang lebih lama/non-Ubuntu memiliki nama paket berbeda; pasang library yang ditunjukkan pesan error. Jangan menjalankan RVM sebagai root. Jika OS menolak sandbox Chromium, perbaiki kebijakan sandbox sesuai distro sebelum digunakan; paket ini mempertahankan sandbox Electron.

Untuk ESP32 pada Ubuntu/Debian:

```bash
sudo usermod -aG dialout "$USER"
```

Logout/login setelah perintah tersebut, sambungkan ESP, lalu hubungkan USB dari Uji komponen. Driver CH340 memakai modul kernel `ch341` bila tersedia pada distro. Tidak perlu driver vendor di mesin pengembangan yang sudah diuji. Startup aplikasi saat ini membuka layar awal; koneksi USB tetap dilakukan dari panel Admin. Koneksi otomatis dan pemulihan sesi produksi perlu integrasi berikutnya.

## Compile/upload pada PC baru (opsional)

Paket display tidak menyertakan compiler Arduino beberapa GB. Editor Script tetap tersedia; untuk Compile/Upload pasang toolchain pada PC tujuan satu kali dengan internet:

```bash
sudo apt install curl python3 python3-venv
~/.local/opt/rvm-al-mufti/setup-esp-tools.sh
```

Script mengunduh Arduino CLI **1.5.1** dengan verifikasi SHA-256, membuat Python virtual environment lokal, memasang esptool **5.4.0**, ESP32 Arduino core **2.0.17**, ArduinoJson **6.21.5**, MFRC522 **1.4.12**. Konfigurasi dibuat dengan path PC tujuan, tidak memakai path `/home/mushii`. Compiler berjalan dengan **satu job** untuk mengurangi RAM puncak. Tutup/buka lagi halaman Script sesudah setup. Instalasi toolchain tidak melakukan upload atau mereset ESP.

`setup-esp-tools.sh --check` menampilkan toolchain yang terpasang. Pada komputer pengembangan, toolchain yang sudah ada tetap dapat digunakan. Toolchain bisa berada di disk beberapa GB, tetapi tidak menjadi proses/RAM aktif ketika display biasa berjalan.

## Data anggota dan poin

Instalasi baru membuat database baru. Untuk memindahkan data, tutup aplikasi di kedua PC lalu salin folder `~/.config/rvm-al-mufti/` ke lokasi yang sama pada PC tujuan. Folder `firmware/builds/` adalah cache build dan bisa dilewatkan. UID, poin, transaksi, PIN serta draft Script tersimpan di folder data ini. Untuk model YOLO, impor kembali bila path file berubah. Jangan menyalin database saat aplikasi masih menulis.

## PC i3 generasi 4, RAM 4 GB dan HDD

- Pilihan awal: **Lubuntu LTS** dengan LXQt, desktop yang dirancang ringan. Pilih distro yang masih mendapat pembaruan; uji touchscreen, USB dan Bluetooth pada PC tujuan sebelum operasional.
- Jalankan paket prebuilt. Tidak ada server Vite/devtools/compiler yang dijalankan di background oleh launcher operasional.
- Pakai akun khusus mesin dengan aplikasi startup seperlunya. Fullscreen menyembunyikan desktop; desktop environment tetap memakai RAM.
- Pertahankan akselerasi GPU Intel/Mesa jika berfungsi. `--disable-gpu` hanya opsi troubleshooting untuk layar hitam/crash, bukan optimasi default. Video berhenti ketika halaman awal tidak ditampilkan.
- HDD dapat memperlambat boot dan load awal. RAM/CPU aktual perlu diukur di PC tujuan; spesifikasi itu belum diuji langsung di sana. Performa aplikasi tersedia pada Admin → Performa.
- Inferensi YOLO belum aktif. Beban kamera/model nantinya perlu pengujian tersendiri sebelum memastikan performa 4 GB.

Referensi: [Autostart freedesktop](https://specifications.freedesktop.org/autostart/latest/), [Lubuntu](https://lubuntu.me/), [Arduino CLI](https://docs.arduino.cc/arduino-cli/installation/).
