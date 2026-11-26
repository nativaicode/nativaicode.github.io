/* Pengingat harian (pukul 20.00 WIB) via Firebase Cloud Messaging.
   Pengirimnya GitHub Actions (.github/workflows/daily-reminder.yml) — gratis, tanpa server. */
import { getMessaging, getToken, deleteToken, messagingSupported } from "../vendor/firebase.js";
import { app, saveReminderToken, saveUserPrefs, memberNotifPref } from "./data.js";
import { VAPID_KEY } from "./config.js";

const K = "kn_daily";
const get = () => { try { return JSON.parse(localStorage.getItem(K) || "null"); } catch { return null; } };
const set = v => { try { localStorage.setItem(K, JSON.stringify(v)); } catch { /* abaikan */ } };

export const dailyReminderOn = () => !!get()?.on;
export const pushSupported = async () => !!VAPID_KEY && "serviceWorker" in navigator && "Notification" in window && await messagingSupported().catch(() => false);

/** Daftarkan perangkat untuk push (izin + token FCM). Dipakai pengingat harian & notifikasi anggota. */
export async function registerPushToken() {
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
  set({ ...(get() || {}), token });
  return token;
}
export const currentPushToken = () => get()?.token || "";

export async function enableDailyReminder() {
  const token = await registerPushToken();
  await saveReminderToken(token, true);
  set({ ...(get() || {}), on: true, token });
}

/** Simpan preferensi notifikasi transaksi anggota; daftarkan push bila perlu (untuk saat aplikasi tertutup) */
export async function saveMemberNotif(pref) {
  const keep = pref.mode !== "off" || dailyReminderOn();
  const token = currentPushToken();
  await saveUserPrefs({ memberNotif: pref }, token, keep); // simpan dulu → notifikasi realtime langsung berlaku
  if (pref.mode === "off" || token) return { pushOk: true };
  try { await saveUserPrefs({}, await registerPushToken(), true); return { pushOk: true }; }
  catch { return { pushOk: false }; }
}

export async function disableDailyReminder() {
  const cur = get();
  const keep = memberNotifPref().mode !== "off";
  try { await saveReminderToken(cur?.token, false); } catch { /* tetap matikan lokal */ }
  if (!keep) { try { await deleteToken(getMessaging(app)); } catch { /* abaikan */ } set({ on: false }); }
  else set({ ...(cur || {}), on: false });
}
