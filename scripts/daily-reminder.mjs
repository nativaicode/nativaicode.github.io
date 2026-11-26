/* Pengingat harian Keuangan Nativan — dijalankan GitHub Actions setiap 20.00 WIB.
   Membaca data via Firebase Admin (service account di GitHub Secrets) lalu mengirim notifikasi FCM.
   Log sengaja hanya berisi angka hitungan (repo publik → log Actions bisa dilihat publik). */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { buildDailyMessage } from "../js/reminder-logic.js";
import { periodOf } from "../js/util.js";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log("Secret FIREBASE_SERVICE_ACCOUNT belum diisi — pengingat dilewati."); process.exit(0); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const fcm = getMessaging();
const now = new Date(); // TZ=Asia/Jakarta diset di workflow

const users = (await db.collection("users").get()).docs
  .map(d => ({ uid: d.id, ...d.data() }))
  .filter(u => u.dailyReminder && u.householdId && Array.isArray(u.fcmTokens) && u.fcmTokens.length);

const byHh = new Map();
for (const u of users) byHh.set(u.householdId, [...(byHh.get(u.householdId) || []), u]);

let sent = 0, failed = 0, removed = 0;
for (const [hid, members] of byHh) {
  const ref = db.collection("households").doc(hid);
  const snap = await ref.get();
  if (!snap.exists) continue;
  const household = snap.data();
  const period = periodOf(now, household.settings?.paydayDay || 25);
  const [trxSnap, budSnap, billSnap, debtSnap] = await Promise.all([
    ref.collection("transactions").where("date", ">=", Timestamp.fromDate(period.start)).get(),
    ref.collection("budgets").get(),
    ref.collection("bills").get(),
    ref.collection("debts").get(),
  ]);
  const trx = trxSnap.docs.map(d => ({ ...d.data(), date: d.data().date.toDate() }));
  const budgets = Object.fromEntries(budSnap.docs.map(d => [d.id, Number(d.data().amount) || 0]));
  const bills = billSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const debts = debtSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  for (const u of members) {
    if (!household.members?.includes(u.uid)) continue; // sudah bukan anggota
    const nick = household.memberInfo?.[u.uid]?.nick || "";
    const msg = buildDailyMessage({ household, trx, budgets, bills, debts, nick, now });
    const res = await fcm.sendEachForMulticast({
      tokens: u.fcmTokens,
      data: { title: msg.title, body: msg.body, url: "./#/home", tag: "daily" },
      webpush: { headers: { Urgency: msg.urgent ? "high" : "normal", TTL: "43200" } },
    });
    const bad = [];
    res.responses.forEach((r, i) => {
      if (r.success) sent++;
      else {
        failed++;
        if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"].includes(r.error?.code)) bad.push(u.fcmTokens[i]);
      }
    });
    if (bad.length) { removed += bad.length; await db.collection("users").doc(u.uid).update({ fcmTokens: FieldValue.arrayRemove(...bad) }); }
  }
}
console.log(`Rumah tangga: ${byHh.size} · terkirim: ${sent} · gagal: ${failed} · token dibersihkan: ${removed}`);
