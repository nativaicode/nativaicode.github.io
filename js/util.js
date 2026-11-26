/* Utilitas murni (tanpa DOM / Firebase) — mudah diuji */

export const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

/** Escape teks sebelum masuk innerHTML (cegah XSS) */
export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function rupiah(n, { sign = false } = {}) {
  const v = Math.round(Number(n) || 0);
  const s = "Rp " + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (v < 0) return "−" + s;
  return sign && v > 0 ? "+" + s : s;
}

/** Versi ringkas untuk grafik: 1,2 jt / 850 rb */
export function rupiahShort(n) {
  const v = Math.abs(Number(n) || 0);
  const neg = Number(n) < 0 ? "−" : "";
  if (v >= 1e9) return neg + (v / 1e9).toFixed(1).replace(".0", "").replace(".", ",") + " M";
  if (v >= 1e6) return neg + (v / 1e6).toFixed(1).replace(".0", "").replace(".", ",") + " jt";
  if (v >= 1e3) return neg + Math.round(v / 1e3) + " rb";
  return neg + v;
}

export function parseNominal(str) {
  const n = parseInt(String(str ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function formatNominalInput(str) {
  const n = String(str ?? "").replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/* ─── Periode budget berdasarkan tanggal gajian ─────────────
   paydayDay 1..28. Periode = [tgl gajian bulan ini, tgl gajian bulan depan) */
export function clampPayday(d) {
  const n = parseInt(d, 10);
  return Number.isFinite(n) ? Math.min(28, Math.max(1, n)) : 25;
}

export function periodOf(date, paydayDay = 25, offset = 0) {
  const d = new Date(date);
  const pd = clampPayday(paydayDay);
  let y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() < pd) m -= 1;
  m += offset;
  const start = new Date(y, m, pd, 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, pd, 0, 0, 0, 0); // eksklusif
  const last = new Date(end.getTime() - 1);
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(pd).padStart(2, "0")}`;
  const label = pd === 1
    ? `${BULAN[start.getMonth()]} ${start.getFullYear()}`
    : `${start.getDate()} ${BULAN[start.getMonth()]} – ${last.getDate()} ${BULAN[last.getMonth()]} ${last.getFullYear()}`;
  const shortLabel = pd === 1 ? `${BULAN[start.getMonth()]} ${String(start.getFullYear()).slice(2)}` : `${BULAN[start.getMonth()]}→${BULAN[last.getMonth()]}`;
  return { start, end, key, label, shortLabel, offset };
}

/** Hari tersisa di periode (termasuk hari ini) */
export function daysLeft(period, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (today >= period.end) return 0;
  if (today < period.start) return Math.round((period.end - period.start) / 864e5);
  return Math.max(1, Math.round((period.end - today) / 864e5));
}

/* ─── Efek transaksi ke saldo dompet ───────────────────────── */
export function balanceEffects(t) {
  const fx = {};
  if (!t) return fx;
  const a = Number(t.amount) || 0;
  const add = (w, v) => { if (!w || !v) return; fx[w] = (fx[w] || 0) + v; };
  switch (t.type) {
    case "income": add(t.walletId, a); break;
    case "expense": add(t.walletId, -a); break;
    case "transfer": add(t.walletId, -a); add(t.toWalletId, a); break;
    case "adjust": add(t.walletId, a); break; // a boleh negatif
  }
  return fx;
}

/** Gabungan: batalkan efek lama + terapkan efek baru (untuk edit/hapus) */
export function diffEffects(oldT, newT) {
  const out = {};
  for (const [w, v] of Object.entries(balanceEffects(oldT))) out[w] = (out[w] || 0) - v;
  for (const [w, v] of Object.entries(balanceEffects(newT))) out[w] = (out[w] || 0) + v;
  for (const w of Object.keys(out)) if (!out[w]) delete out[w];
  return out;
}

/** Ringkasan periode */
export function summarize(list) {
  const s = { income: 0, expense: 0, rutin: 0, tetap: 0, byCategory: {}, byOwner: {}, count: 0 };
  for (const t of list) {
    if (t.type === "income") { s.income += t.amount; s.count++; }
    else if (t.type === "expense") {
      s.expense += t.amount; s.count++;
      if (t.expenseType === "Tetap") s.tetap += t.amount; else s.rutin += t.amount;
      s.byCategory[t.category || "Lainnya"] = (s.byCategory[t.category || "Lainnya"] || 0) + t.amount;
      const o = t.owner || "-";
      s.byOwner[o] = (s.byOwner[o] || 0) + t.amount;
    }
  }
  return s;
}

export function toDate(v) {
  if (!v) return new Date(NaN);
  if (v instanceof Date) return v;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  return new Date(v);
}

export function fmtDate(d, withTime = false) {
  d = toDate(d);
  if (isNaN(d)) return "-";
  const base = `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
  return withTime ? `${base}, ${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}` : base;
}

export function fmtTime(d) {
  d = toDate(d);
  return `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
}

export function dayKey(d) {
  d = toDate(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayLabel(key, now = new Date()) {
  const [y, m, dd] = key.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((t - d) / 864e5);
  if (diff === 0) return "Hari ini";
  if (diff === 1) return "Kemarin";
  return `${HARI[d.getDay()]}, ${dd} ${BULAN[m - 1]} ${y}`;
}

/** Nilai untuk <input type="datetime-local"> */
export function toLocalInput(d) {
  d = toDate(d);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function uid(prefix = "") {
  const a = new Uint8Array(8);
  globalThis.crypto.getRandomValues(a);
  return prefix + Array.from(a, b => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

/** Kode undangan 8 karakter, tanpa huruf yang mirip (0/O, 1/I/L) */
export function inviteCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const a = new Uint8Array(8);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, b => chars[b % chars.length]).join("");
}

export const DEFAULT_CATEGORIES = {
  expense: [
    "Makan & Minum", "Belanja Dapur", "Transportasi", "Tagihan & Utilitas", "Cicilan",
    "Pendidikan", "Kesehatan", "Anak", "Rumah Tangga", "Hiburan", "Sedekah & Donasi", "Lainnya",
  ],
  income: ["Gaji", "Bonus", "Usaha", "Hadiah", "Lainnya"],
};

const ICONS = {
  "makan": "🍜", "minum": "🍜", "dapur": "🛒", "belanja": "🛍️", "transport": "🚗", "bensin": "⛽",
  "tagihan": "💡", "listrik": "💡", "utilitas": "💡", "internet": "📶", "pulsa": "📶", "cicilan": "🏠",
  "kpr": "🏠", "pendidikan": "🎓", "sekolah": "🎓", "kesehatan": "🩺", "obat": "💊", "anak": "🧸",
  "rumah": "🏡", "hiburan": "🎬", "sedekah": "🤲", "donasi": "🤲", "zakat": "🤲", "gaji": "💼",
  "bonus": "🎁", "usaha": "🏪", "hadiah": "🎁", "investasi": "📈", "pakaian": "👕", "liburan": "✈️",
  "olahraga": "🏃", "asuransi": "🛡️", "arisan": "👥", "saldo": "⚖️",
};
export function catIcon(name = "") {
  const n = name.toLowerCase();
  for (const [k, v] of Object.entries(ICONS)) if (n.includes(k)) return v;
  return "🏷️";
}

export const WALLET_TYPES = {
  "Cash": "💵", "Bank": "🏦", "E-Wallet": "📱", "Investasi": "📈", "Lainnya": "👛",
};
export const walletIcon = t => WALLET_TYPES[t] || "👛";

export const TYPE_LABEL = { income: "Pemasukan", expense: "Pengeluaran", transfer: "Pindah Dana", adjust: "Penyesuaian Saldo" };
