/* Pengingat harian (pukul 20.00 WIB) via Firebase Cloud Messaging.
   Pengirimnya GitHub Actions (.github/workflows/daily-reminder.yml) — gratis, tanpa server. */
import { getMessaging, getToken, deleteToken, messagingSupported } from "../vendor/firebase.js";
import { app, saveReminderToken } from "./data.js";
import { VAPID_KEY } from "./config.js";

const K = "kn_daily";
const get = () => { try { return JSON.parse(localStorage.getItem(K) || "null"); } catch { return null; } };
const set = v => { try { localStorage.setItem(K, JSON.stringify(v)); } catch { /* abaikan */ } };

export const dailyReminderOn = () => !!get()?.on;
export const pushSupported = async () => !!VAPID_KEY && "serviceWorker" in navigator && "Notification" in window && await messagingSupported().catch(() => false);

export async function enableDailyReminder() {
  if (!VAPID_KEY) throw new Error("Pengingat harian belum disetel. Pemilik akun perlu membuat Web Push key di Firebase (Project settings → Cloud Messaging) — lihat README.");
  if (!(await messagingSupported().catch(() => false)) || !("Notification" in window))
    throw new Error("Perangkat ini belum mendukung notifikasi push. Di iPhone: pasang aplikasi ke Layar Utama dulu (iOS 16.4+) lalu buka dari ikonnya.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Izin notifikasi ditolak. Aktifkan di pengaturan browser/HP untuk situs ini.");
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Service worker belum aktif. Tutup lalu buka lagi aplikasinya, kemudian coba lagi.")), 10000)),
  ]);
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error("Gagal mendaftarkan perangkat untuk notifikasi.");
  await saveReminderToken(token, true);
  set({ on: true, token });
}

export async function disableDailyReminder() {
  const cur = get();
  try { await saveReminderToken(cur?.token, false); } catch { /* tetap matikan lokal */ }
  try { await deleteToken(getMessaging(app)); } catch { /* abaikan */ }
  set({ on: false });
}
