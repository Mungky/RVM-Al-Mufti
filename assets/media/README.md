# Video beranda

`recycling-12s.webm` adalah montase lokal 12 detik, 1280×720, 25 fps, VP8 tanpa audio:

1. 6 detik adegan pemilahan botol plastik dari video beranda yang sebelumnya sudah ada dalam paket aplikasi. Salinan sebelum perubahan tersimpan dalam `backups/app-profile-media-20261019/app-before.asar` (`dist/media/recycling.mp4`).
2. 6 detik adegan fasilitas daur ulang dari Pressmaster, “Workers Sorting Out Trash In A Conveyor In A Recycling Plant”, Pexels:
   https://www.pexels.com/video/workers-sorting-out-trash-in-a-conveyor-in-a-recycling-plant-3195440/
   Lisensi: https://www.pexels.com/license/ (diakses 19 Oktober 2026).

Dikemas sebagai `dist/media/recycling-12s.webm` di app.asar. Pemutaran autoplay, muted, loop; tidak memerlukan internet.

Pembuatan ulang: `prepare-video.py INTRO_VIDEO PLANT_VIDEO` di `scripts/app-profile-media/`, memakai Python environment `.tools/vision/bin/python` dengan OpenCV. Pengambilan footage plant dimulai pada detik 2 dari input plant.
