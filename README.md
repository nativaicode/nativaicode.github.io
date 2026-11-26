# Keuangan Nativan v2

Aplikasi pencatat keuangan keluarga berupa PWA. Bisa dipakai di web (desktop) dan HP, dan bisa dibungkus jadi APK. Semua layanan yang dipakai gratis: GitHub Pages dan Firebase paket Spark.

## Fitur (v2.5)
- **Rencana**: tagihan rutin + pengingat jatuh tempo + bayar 1 ketukan · target tabungan / dana darurat · utang-piutang
- **Budget per kategori** + insight otomatis (boros/hemat, tagihan, cicilan, dll.)
- **Catat cepat** (template 1 ketukan, bisa dibatalkan) · **Laporan gambar** untuk dibagikan
- **Kunci aplikasi** PIN / sidik jari · **Pengingat harian 20.00** via notifikasi push

## Fitur dasar
- Login Google, tanpa password terpisah
- Rumah tangga bersama: undang anggota dengan kode 8 karakter, data terpisah antar keluarga
- Pemasukan, pengeluaran (Rutin / Tetap), dan pindah dana antar dompet
- Edit & hapus transaksi, saldo dompet ikut menyesuaikan otomatis
- Budget per periode gajian (tanggal bisa diatur) dengan peringatan 80/90/100%
- Statistik per kategori dan per kepemilikan, plus tren 6 periode
- Export ke Excel (.xlsx): sheet Transaksi, Ringkasan, dan Saldo Dompet
- Bisa dipakai offline: transaksi tetap tersimpan lalu tersinkron otomatis
- Data realtime antar perangkat, tema terang/gelap, mode sembunyikan nominal

## Struktur
```
index.html          Shell aplikasi (CSP ketat, tanpa inline script)
css/app.css         Tampilan responsif (bottom nav di HP, sidebar di desktop)
js/config.js        Konfigurasi Firebase
js/data.js          Auth, Firestore, state, transaksi (batch + saldo)
js/app.js           Halaman & form
js/ui.js            Toast, sheet, dialog, ikon
js/util.js          Logika murni (periode, saldo, format)
js/insights.js      Mesin insight keuangan
js/plan.js          Halaman Rencana (tagihan, target, utang)
js/plan-logic.js    Logika murni tagihan/target/utang
js/lock.js          Kunci aplikasi (PIN PBKDF2 + WebAuthn)
js/report.js        Laporan gambar (canvas)
js/push.js          Pendaftaran notifikasi harian (FCM)
js/reminder-logic.js Isi pesan pengingat harian
scripts/daily-reminder.mjs, .github/workflows/  Pengirim pengingat (GitHub Actions)
vendor/             Firebase SDK & SheetJS (dibundel lokal, tidak bergantung CDN)
firestore.rules     Aturan keamanan database → salin ke Firebase Console
sw.js, manifest.json  PWA
```

## Model data (Firestore)
```
users/{uid}                       → { householdId }
invites/{kode}                    → { householdId }           (hanya bisa dibaca per kode)
households/{id}                   → { name, ownerId, members[], memberInfo{}, inviteCode,
                                      settings{paydayDay, owners[], wallets[], categories{}},
                                      balances{walletId: saldo} }
households/{id}/transactions/{t}  → { type, amount, category, walletId, toWalletId, owner,
                                      expenseType, note, date, createdBy }
households/{id}/budgets/{periode} → { amount }
```
Saldo disimpan sebagai ringkasan (`balances`), jadi aplikasi cukup membaca transaksi periode berjalan, bukan seluruh riwayat. Ini menjaga pemakaian tetap jauh di bawah kuota gratis.

## Deploy
1. **Firestore → Rules**: salin isi `firestore.rules`, lalu **Publish**.
2. **Authentication → Settings → Authorized domains**: pastikan `nativaicode.github.io` sudah ada.
3. Upload semua file di folder ini ke repo `nativaicode.github.io` (root), lalu push. GitHub Pages akan update dalam 1–2 menit.
4. Setiap mengubah file, naikkan `VERSION` di `sw.js` supaya HP pengguna mengambil versi baru.

## Mengaktifkan pengingat harian 20.00 (sekali saja)
1. Firebase Console → ⚙️ Project settings → **Cloud Messaging** → *Web Push certificates* → **Generate key pair**.
   Salin "Key pair" (teks panjang) → isi `VAPID_KEY` di `js/config.js`.
2. Firebase Console → ⚙️ Project settings → **Service accounts** → **Generate new private key** → file JSON terunduh.
   ⚠️ File ini rahasia (akses penuh ke database). JANGAN di-upload ke repo dan jangan dibagikan.
3. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
   Name: `FIREBASE_SERVICE_ACCOUNT` · Secret: tempel SELURUH isi file JSON tadi → *Add secret*. Lalu hapus file JSON dari HP/laptop.
4. Pastikan file `.github/workflows/daily-reminder.yml` dan `scripts/daily-reminder.mjs` ada di repo.
5. Uji: repo → tab **Actions** → *Pengingat harian* → **Run workflow**. Di aplikasi: Akun → Pengingat harian → Aktif.
Notifikasi transaksi anggota (saat aplikasi tertutup) memakai secret yang sama lewat `.github/workflows/activity-notify.yml` (cek tiap ±15 menit). Atur per orang di Akun → Notifikasi transaksi anggota.
Catatan: GitHub menonaktifkan jadwal otomatis bila repo tidak ada aktivitas 60 hari — cukup klik "Enable workflow" lagi.

## Install di HP
- **Android (Chrome)**: buka situsnya → menu ⋮ → **Install app**.
- **iPhone (Safari)**: tombol Share → **Add to Home Screen**.

## Membuat APK ringkas (TWA, gratis)
1. Buka https://www.pwabuilder.com → masukkan `https://nativaicode.github.io`.
2. **Package for stores → Android** → pilih *Generate*. Package ID contoh: `io.github.nativaicode.keuangan`.
3. Download ZIP. Isinya: file `.apk` (untuk dibagikan/sideload), `.aab` (untuk Play Store), `signing.keystore` beserta password-nya (**simpan baik-baik**, dibutuhkan untuk update), dan `assetlinks.json`.
4. Taruh `assetlinks.json` di repo pada path `.well-known/assetlinks.json`, lalu push. Ini menghilangkan address bar di APK.
5. Bagikan file `.apk` ke anggota keluarga untuk di-install. APK hanya perlu dibuat sekali: setiap update web otomatis ikut ter-update di APK.

## Pengembangan lokal
```
python3 -m http.server 8000      # lalu buka http://localhost:8000
```
Tambahkan `localhost` di Authorized domains Firebase agar bisa login saat uji lokal.
