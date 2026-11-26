# Keuangan Nativan v2

Aplikasi pencatat keuangan keluarga berupa PWA. Bisa dipakai di web (desktop) dan HP, dan bisa dibungkus jadi APK. Semua layanan yang dipakai gratis: GitHub Pages dan Firebase paket Spark.

## Fitur
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
