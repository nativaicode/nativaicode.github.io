/* Keuangan Nativan — Service Worker
   Aset aplikasi di-cache agar bisa dibuka offline. Data (Firestore) punya cache offline sendiri.
   Naikkan VERSION setiap kali ada perubahan file supaya pengguna mendapat versi baru. */
const VERSION = "kn-v2.7.0";
const SHELL = [
  "./", "./index.html", "./privacy.html", "./manifest.json",
  "./css/app.css",
  "./js/app.js", "./js/data.js", "./js/ui.js", "./js/util.js", "./js/insights.js", "./js/plan.js", "./js/plan-logic.js", "./js/lock.js", "./js/report.js", "./js/push.js", "./js/reminder-logic.js", "./js/nlp.js", "./js/voice.js", "./js/ocr.js", "./js/image.js", "./js/config.js",
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

/* Notifikasi push dari pengingat harian (FCM, pesan data) */
self.addEventListener("push", e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { data: { body: e.data?.text() } }; }
  const d = p.data || {}, n = p.notification || {};
  const title = d.title || n.title || "Keuangan Nativan";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || n.body || "", icon: "assets/icons/icon-192.png", badge: "assets/icons/icon-192.png",
    tag: d.tag || "daily", renotify: true, data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) if ("focus" in c) { c.navigate?.(url).catch(() => {}); return c.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
