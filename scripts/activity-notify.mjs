/* Notifikasi transaksi anggota (saat aplikasi tertutup) — GitHub Actions tiap ±15 menit.
   Mengirim ringkasan transaksi baru yang dicatat anggota LAIN sejak pengecekan terakhir.
   Log hanya angka hitungan (repo publik → log Actions bisa dilihat publik). */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { passesMemberPref, buildActivityMessage } from "../js/reminder-logic.js";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log("Secret FIREBASE_SERVICE_ACCOUNT belum diisi — dilewati."); process.exit(0); }
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const fcm = getMessaging();
const MAX_AGE = 6 * 3600e3; // transaksi lebih lama dari 6 jam tidak dikirim (mis. setelah jeda panjang)

const users = (await db.collection("users").get()).docs
  .map(d => ({ uid: d.id, ...d.data() }))
  .filter(u => u.householdId && Array.isArray(u.fcmTokens) && u.fcmTokens.length && (u.memberNotif?.mode || "all") !== "off");

const byHh = new Map();
for (const u of users) byHh.set(u.householdId, [...(byHh.get(u.householdId) || []), u]);

let households = 0, sent = 0, failed = 0, removed = 0, items = 0;
for (const [hid, members] of byHh) {
  const ref = db.collection("households").doc(hid);
  const snap = await ref.get();
  if (!snap.exists) continue;
  const hh = snap.data();
  const since = hh.notifState?.lastActivityAt;
  const now = Timestamp.now();
  if (!since) { await ref.update({ "notifState.lastActivityAt": now }); continue; } // jalan pertama: hanya tandai
  const trxSnap = await ref.collection("transactions").where("createdAt", ">", since).orderBy("createdAt").get();
  if (trxSnap.empty) continue;
  households++;
  const all = trxSnap.docs.map(d => d.data()).filter(t => Date.now() - t.createdAt.toMillis() < MAX_AGE);
  const last = trxSnap.docs[trxSnap.docs.length - 1].data().createdAt;
  await ref.update({ "notifState.lastActivityAt": last });
  items += all.length;
  const wallets = hh.settings?.wallets || [];
  const walletName = id => { const w = wallets.find(x => x.id === id); return w ? (w.owner ? `${w.name} (${w.owner})` : w.name) : ""; };

  for (const u of members) {
    if (!hh.members?.includes(u.uid)) continue;
    const mine = all.filter(t => t.createdBy !== u.uid && passesMemberPref({ ...t, amount: Number(t.amount) }, u.memberNotif || {}));
    if (!mine.length) continue;
    const msg = buildActivityMessage(mine.map(t => ({ ...t, amount: Number(t.amount) })), hh.memberInfo || {}, walletName);
    const res = await fcm.sendEachForMulticast({
      tokens: u.fcmTokens,
      data: { title: "👥 " + msg.title, body: msg.body, url: "./#/history", tag: "activity" },
      webpush: { headers: { Urgency: "high", TTL: "21600" } },
    });
    const bad = [];
    res.responses.forEach((r, i) => {
      if (r.success) sent++;
      else { failed++; if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"].includes(r.error?.code)) bad.push(u.fcmTokens[i]); }
    });
    if (bad.length) { removed += bad.length; await db.collection("users").doc(u.uid).update({ fcmTokens: FieldValue.arrayRemove(...bad) }); }
  }
}
console.log(`Rumah tangga aktif: ${households} · transaksi baru: ${items} · terkirim: ${sent} · gagal: ${failed} · token dibersihkan: ${removed}`);
