/* Lapisan data: Firebase Auth + Firestore + state aplikasi */
import {
  initializeApp, getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut, connectAuthEmulator, signInWithCredential,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  doc, getDoc, collection, query, where, orderBy, onSnapshot, getDocs, writeBatch,
  serverTimestamp, increment, arrayUnion, arrayRemove, deleteField, Timestamp,
} from "../vendor/firebase.js";
import { firebaseConfig } from "./config.js";
import { periodSummary } from "./insights.js";
import { periodOf, diffEffects, balanceEffects, inviteCode, uid as makeId, DEFAULT_CATEGORIES, clampPayday, toDate } from "./util.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = "id";
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Mode pengujian lokal: http://localhost:xxxx/?emu=1
export const USE_EMU = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emu");
if (USE_EMU) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

/* ─── State & pub/sub sederhana ─────────────────────────────── */
export const state = {
  authReady: false,
  user: null,
  householdId: undefined,   // undefined = belum diketahui, null = belum punya
  household: null,
  budgets: {},              // periodKey -> amount
  current: { period: null, list: [], ready: false },   // periode berjalan
  view: { offset: 0, period: null, list: [], ready: false }, // periode yang dipilih (riwayat/statistik)
  prev: { key: "", list: [] }, // ringkasan 3 periode sebelumnya (pembanding insight)
};
const subs = new Set();
export const subscribe = fn => (subs.add(fn), () => subs.delete(fn));
let emitQueued = false;
function emit() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; subs.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); });
}
export const errorBus = new Set();
function reportError(err, ctx) {
  console.error(ctx, err);
  errorBus.forEach(fn => fn(err, ctx));
}

/* ─── Listener management ──────────────────────────────────── */
let unsub = { user: null, hh: null, cur: null, view: null, budgets: null };
function stop(k) { if (unsub[k]) { unsub[k](); unsub[k] = null; } }
function stopAll() { Object.keys(unsub).forEach(stop); }

export const payday = () => clampPayday(state.household?.settings?.paydayDay ?? 25);

function mapTrx(d) {
  const x = d.data();
  return { id: d.id, ...x, amount: Number(x.amount) || 0, date: toDate(x.date) };
}

function listenPeriod(slot, offset) {
  stop(slot);
  const hid = state.householdId;
  const period = periodOf(new Date(), payday(), offset);
  state[slot] = { ...state[slot], offset, period, list: slot === "view" && state.view.period?.key === period.key ? state.view.list : [], ready: false };
  const q = query(
    collection(db, "households", hid, "transactions"),
    where("date", ">=", Timestamp.fromDate(period.start)),
    where("date", "<", Timestamp.fromDate(period.end)),
    orderBy("date", "desc"),
  );
  unsub[slot] = onSnapshot(q, { includeMetadataChanges: false }, snap => {
    state[slot].list = snap.docs.map(mapTrx);
    state[slot].pending = snap.metadata.hasPendingWrites;
    state[slot].ready = true;
    emit();
  }, err => reportError(err, "listen " + slot));
}

export function setViewOffset(offset) {
  if (!state.householdId) return;
  if (offset > 0) offset = 0;
  state.view.offset = offset;
  listenPeriod("view", offset);
  emit();
}

let lastPayday = null;
function onHousehold(hid) {
  lastPayday = null;
  stop("hh"); stop("cur"); stop("view"); stop("budgets");
  state.household = null; state.budgets = {};
  if (!hid) { emit(); return; }
  unsub.hh = onSnapshot(doc(db, "households", hid), snap => {
    if (!snap.exists()) { state.household = null; state.householdId = null; emit(); return; }
    const data = snap.data();
    if (!data.members?.includes(state.user?.uid)) { state.household = null; emit(); return; }
    state.household = { id: snap.id, ...data };
    const pd = payday();
    if (pd !== lastPayday) { // pertama kali / tanggal gajian berubah → pasang ulang query periode
      lastPayday = pd;
      listenPeriod("current", 0);
      listenPeriod("view", state.view.offset || 0);
    }
    emit();
  }, err => {
    // permission-denied = sudah bukan anggota
    reportError(err, "listen household");
    state.household = null; state.householdId = null; emit();
  });
  unsub.budgets = onSnapshot(collection(db, "households", hid, "budgets"), snap => {
    const b = {};
    snap.forEach(d => { b[d.id] = Number(d.data().amount) || 0; });
    state.budgets = b; emit();
  }, err => reportError(err, "listen budgets"));
}

/* ─── Auth ─────────────────────────────────────────────────── */
onAuthStateChanged(auth, user => {
  stopAll(); lastPayday = null;
  state.user = user; state.authReady = true;
  state.householdId = undefined; state.household = null;
  if (user) {
    unsub.user = onSnapshot(doc(db, "users", user.uid), snap => {
      const hid = snap.exists() ? (snap.data().householdId || null) : null;
      if (hid !== state.householdId) { state.householdId = hid; onHousehold(hid); }
      emit();
    }, err => { reportError(err, "listen user"); state.householdId = null; emit(); });
  }
  emit();
});
getRedirectResult(auth).catch(err => reportError(err, "redirect"));

export async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(err.code)) {
      await signInWithRedirect(auth, provider);
    } else if (err.code !== "auth/popup-closed-by-user") throw err;
  }
}
/** Hanya untuk emulator (pengujian) */
export function loginEmulator(sub, email, name) {
  return signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub, email, name, email_verified: true })));
}
export const logout = () => signOut(auth);

/* ─── Helper commit (mendukung offline) ────────────────────── */
async function commit(batch, ctx) {
  const p = batch.commit();
  p.catch(err => reportError(err, ctx));
  const r = await Promise.race([p.then(() => "ok"), new Promise(res => setTimeout(() => res("pending"), 2500))]);
  return { offline: r === "pending" };
}

function memberInfo(user) {
  return { name: user.displayName || user.email?.split("@")[0] || "Anggota", email: user.email || "", photo: user.photoURL || "" };
}

/* ─── Rumah tangga ─────────────────────────────────────────── */
export async function createHousehold({ name, paydayDay, ownerName }) {
  const u = state.user;
  const ref = doc(collection(db, "households"));
  const code = inviteCode();
  const walletCash = { id: makeId("w_"), type: "Cash", name: "Dompet Tunai", archived: false };
  const b = writeBatch(db);
  b.set(ref, {
    name: name || "Keluarga",
    ownerId: u.uid,
    members: [u.uid],
    memberInfo: { [u.uid]: { ...memberInfo(u), nick: (ownerName || memberInfo(u).name.split(" ")[0]).slice(0, 20) } },
    inviteCode: code,
    settings: {
      paydayDay: clampPayday(paydayDay),
      owners: [ownerName || memberInfo(u).name.split(" ")[0]],
      wallets: [walletCash],
      categories: DEFAULT_CATEGORIES,
    },
    balances: {},
    createdAt: serverTimestamp(),
  });
  b.set(doc(db, "invites", code), { householdId: ref.id, createdBy: u.uid, createdAt: serverTimestamp() });
  b.set(doc(db, "users", u.uid), { householdId: ref.id, updatedAt: serverTimestamp() }, { merge: true });
  await b.commit();
}

export async function joinHousehold(codeRaw, nick = "") {
  const code = String(codeRaw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8) throw new Error("Kode undangan harus 8 karakter.");
  const inv = await getDoc(doc(db, "invites", code));
  if (!inv.exists()) throw new Error("Kode undangan tidak ditemukan atau sudah diganti.");
  const hid = inv.data().householdId;
  const u = state.user;
  const b = writeBatch(db);
  b.update(doc(db, "households", hid), {
    members: arrayUnion(u.uid),
    [`memberInfo.${u.uid}`]: memberInfo(u),
    joinedWith: code,
  });
  b.set(doc(db, "users", u.uid), { householdId: hid, updatedAt: serverTimestamp() }, { merge: true });
  await b.commit();
  // Setelah resmi jadi anggota: daftarkan nama panggilan ke kepemilikan
  const n = (nick || memberInfo(u).name.split(" ")[0]).trim().slice(0, 20);
  if (n) {
    const b2 = writeBatch(db);
    b2.update(doc(db, "households", hid), { [`memberInfo.${u.uid}.nick`]: n, "settings.owners": arrayUnion(n) });
    await b2.commit().catch(err => console.warn("nick", err));
  }
}

/** Ubah nama panggilan sendiri (juga ditambahkan ke daftar kepemilikan) */
export async function setMyNick(nick) {
  const n = String(nick || "").trim().slice(0, 20);
  if (!n) throw new Error("Nama panggilan tidak boleh kosong.");
  const b = writeBatch(db);
  b.update(doc(db, "households", state.householdId), { [`memberInfo.${state.user.uid}.nick`]: n, "settings.owners": arrayUnion(n) });
  return commit(b, "nama panggilan");
}

export async function regenerateInvite() {
  const h = state.household;
  const code = inviteCode();
  const b = writeBatch(db);
  if (h.inviteCode) b.delete(doc(db, "invites", h.inviteCode));
  b.set(doc(db, "invites", code), { householdId: h.id, createdBy: state.user.uid, createdAt: serverTimestamp() });
  b.update(doc(db, "households", h.id), { inviteCode: code });
  await b.commit();
  return code;
}

export async function leaveHousehold() {
  const h = state.household, me = state.user.uid;
  if (h.ownerId === me && h.members.length > 1) throw new Error("Pemilik tidak bisa keluar selama masih ada anggota lain. Keluarkan anggota lain terlebih dahulu.");
  const b = writeBatch(db);
  b.update(doc(db, "households", h.id), { members: arrayRemove(me), [`memberInfo.${me}`]: deleteField() });
  b.set(doc(db, "users", me), { householdId: null, updatedAt: serverTimestamp() }, { merge: true });
  await b.commit();
}

export async function removeMember(memberUid) {
  const h = state.household;
  const b = writeBatch(db);
  b.update(doc(db, "households", h.id), { members: arrayRemove(memberUid), [`memberInfo.${memberUid}`]: deleteField() });
  await b.commit();
}

export async function updateHousehold(patch) {
  const b = writeBatch(db);
  b.update(doc(db, "households", state.householdId), patch);
  return commit(b, "update household");
}
export const updateSettings = (key, value) => updateHousehold({ [`settings.${key}`]: value });

/* ─── Transaksi ────────────────────────────────────────────── */
/** Transaksi bertanggal sebelum periode berjalan → ringkasan pembanding perlu dihitung ulang */
function touchPast(...dates) {
  const start = state.current.period?.start;
  if (!start || !dates.some(d => d && toDate(d) < start)) return;
  try { Object.keys(localStorage).filter(k => k.startsWith("kn_prev_" + state.householdId)).forEach(k => localStorage.removeItem(k)); } catch { /* abaikan */ }
  state.prev = { key: "", list: [] };
}
function applyBalances(b, fx) {
  const patch = {};
  for (const [w, v] of Object.entries(fx)) patch[`balances.${w}`] = increment(v);
  if (Object.keys(patch).length) b.update(doc(db, "households", state.householdId), patch);
}

function cleanTrx(t) {
  const out = {
    type: t.type,
    amount: Math.round(Number(t.amount) || 0),
    walletId: t.walletId || "",
    note: (t.note || "").trim().slice(0, 300),
    date: Timestamp.fromDate(toDate(t.date)),
  };
  if (t.type === "income" || t.type === "expense") {
    out.category = t.category || "Lainnya";
    out.owner = t.owner || "";
  }
  if (t.type === "expense") out.expenseType = t.expenseType === "Tetap" ? "Tetap" : "Rutin";
  if (t.type === "transfer") { out.toWalletId = t.toWalletId; out.owner = t.owner || ""; out.toOwner = t.toOwner || t.owner || ""; }
  if (t.type === "adjust") out.category = "Penyesuaian Saldo";
  return out;
}

export async function addTransaction(t) {
  const data = cleanTrx(t);
  const ref = doc(collection(db, "households", state.householdId, "transactions"));
  const b = writeBatch(db);
  b.set(ref, { ...data, createdBy: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  applyBalances(b, balanceEffects(data));
  touchPast(t.date);
  return commit(b, "tambah transaksi");
}

export async function updateTransaction(oldT, t) {
  const data = cleanTrx(t);
  const b = writeBatch(db);
  b.update(doc(db, "households", state.householdId, "transactions", oldT.id), { ...data, updatedBy: state.user.uid, updatedAt: serverTimestamp() });
  applyBalances(b, diffEffects(oldT, data));
  touchPast(oldT.date, t.date);
  return commit(b, "ubah transaksi");
}

export async function deleteTransaction(oldT) {
  const b = writeBatch(db);
  b.delete(doc(db, "households", state.householdId, "transactions", oldT.id));
  applyBalances(b, diffEffects(oldT, null));
  touchPast(oldT.date);
  return commit(b, "hapus transaksi");
}

/** Sesuaikan saldo dompet ke angka sebenarnya → buat transaksi 'adjust' */
export async function adjustBalance(walletId, actual) {
  const cur = Number(state.household?.balances?.[walletId]) || 0;
  const delta = Math.round(actual - cur);
  if (!delta) return { offline: false, noop: true };
  return addTransaction({ type: "adjust", amount: delta, walletId, date: new Date(), note: "Penyesuaian saldo" });
}

export async function fetchRange(start, end) {
  const cons = [];
  if (start) cons.push(where("date", ">=", Timestamp.fromDate(start)));
  if (end) cons.push(where("date", "<", Timestamp.fromDate(end)));
  const snap = await getDocs(query(collection(db, "households", state.householdId, "transactions"), ...cons, orderBy("date", "desc")));
  return snap.docs.map(mapTrx);
}

/** Hitung ulang saldo semua dompet dari seluruh transaksi (perbaikan) */
export async function recalcBalances() {
  const all = await fetchRange(null, null);
  const bal = {};
  for (const t of all) for (const [w, v] of Object.entries(balanceEffects(t))) bal[w] = (bal[w] || 0) + v;
  const b = writeBatch(db);
  b.update(doc(db, "households", state.householdId), { balances: bal });
  await b.commit();
  return { count: all.length, balances: bal };
}

/* ─── Budget ───────────────────────────────────────────────── */
export async function setBudget(periodKey, amount) {
  const b = writeBatch(db);
  const ref = doc(db, "households", state.householdId, "budgets", periodKey);
  if (amount > 0) b.set(ref, { amount: Math.round(amount), updatedBy: state.user.uid, updatedAt: serverTimestamp() });
  else b.delete(ref);
  return commit(b, "set budget");
}

/** Budget yang berlaku: periode itu, atau periode sebelumnya yang terakhir diisi */
export function budgetFor(periodKey) {
  if (state.budgets[periodKey] != null) return { amount: state.budgets[periodKey], inherited: false };
  const keys = Object.keys(state.budgets).filter(k => k < periodKey).sort();
  const last = keys[keys.length - 1];
  return last ? { amount: state.budgets[last], inherited: true, from: last } : { amount: 0, inherited: false };
}

/* ─── Ringkasan periode sebelumnya (untuk insight), di-cache 6 jam per perangkat ─── */
let prevLoading = "";
export async function loadPrevSummaries() {
  if (!state.householdId || !state.current.period) return;
  const cur = state.current.period;
  const key = `${state.householdId}|${cur.key}`;
  if (state.prev.key === key || prevLoading === key) return;
  const cacheKey = "kn_prev_" + key;
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (c && Date.now() - c.at < 6 * 3600e3) { state.prev = { key, list: c.list }; emit(); return; }
  } catch { /* abaikan */ }
  prevLoading = key;
  try {
    const periods = [-3, -2, -1].map(o => periodOf(new Date(), payday(), o));
    const all = await fetchRange(periods[0].start, cur.start);
    const list = periods.map(p => periodSummary(all.filter(t => t.date >= p.start && t.date < p.end)));
    state.prev = { key, list };
    try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), list })); } catch { /* penuh */ }
    emit();
  } catch (err) { console.warn("prev summaries", err); }
  finally { prevLoading = ""; }
}

export { periodOf };
