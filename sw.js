/* Keuangan Nativan — Service Worker
   Aset aplikasi di-cache agar bisa dibuka offline. Data (Firestore) punya cache offline sendiri.
   Naikkan VERSION setiap kali ada perubahan file supaya pengguna mendapat versi baru. */
const VERSION = "kn-v2.4.0";
const SHELL = [
  "./", "./index.html", "./privacy.html", "./manifest.json",
  "./css/app.css",
  "./js/app.js", "./js/data.js", "./js/ui.js", "./js/util.js", "./js/insights.js", "./js/config.js",
  "./vendor/firebase.js", "./vendor/xlsx.js",
  "./assets/fonts/plus-jakarta-sans-latin-wght-normal.woff2", "./assets/fonts/plus-jakarta-sans-latin-ext-wght-normal.woff2",
  "./assets/icons/icon-192.png", "./assets/icons/icon-512.png", "./assets/icons/maskable-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Firebase/Google: biarkan lewat jaringan langsung

  // Halaman: jaringan dulu (agar update cepat), fallback cache saat offline
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(res => { const c = res.clone(); caches.open(VERSION).then(x => x.put("./index.html", c)); return res; })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }
  // Aset: cache dulu, perbarui di belakang (stale-while-revalidate)
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res.ok) { const c = res.clone(); caches.open(VERSION).then(x => x.put(req, c)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    }),
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    }),
  );
});
