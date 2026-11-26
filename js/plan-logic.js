/* Logika murni untuk Tagihan rutin, Target tabungan, Utang-piutang (mudah diuji) */
import { BULAN } from "./util.js";

const pad = n => String(n).padStart(2, "0");
const dim = (y, m) => new Date(y, m + 1, 0).getDate();
export const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const fmtShort = d => `${d.getDate()} ${BULAN[d.getMonth()]}`;

/* ─── Tagihan rutin ───────────────────────────────────────────
   bill = { name, amount, freq: "monthly"|"yearly", day: 1..31, month: 0..11 (tahunan),
            remind: hari, since: ms, paid: { "YYYY-MM" | "YYYY": {trxId, amount} }, active } */
function occ(bill, y, m) {
  if (bill.freq === "yearly") {
    const mm = Number(bill.month) || 0;
    return { key: String(y), due: new Date(y, mm, Math.min(bill.day || 1, dim(y, mm))) };
  }
  const d = new Date(y, m, 1); // normalisasi bulan -1 / 12
  const yy = d.getFullYear(), mm = d.getMonth();
  return { key: `${yy}-${pad(mm + 1)}`, due: new Date(yy, mm, Math.min(bill.day || 1, dim(yy, mm))) };
}

/** Status tagihan pada siklus berjalan */
export function billStatus(bill, now = new Date()) {
  const today = startOfDay(now);
  const y = today.getFullYear(), m = today.getMonth();
  const yearly = bill.freq === "yearly";
  const list = yearly ? [occ(bill, y - 1), occ(bill, y), occ(bill, y + 1)] : [occ(bill, y, m - 1), occ(bill, y, m), occ(bill, y, m + 1)];
  const cur = list[1];
  const since = bill.since ? startOfDay(new Date(bill.since)) : null;
  const valid = list.filter(o => !since || o.due >= since);
  const paid = bill.paid || {};
  // siklus sebelumnya hanya dihitung bila tanggalnya sudah lewat & belum dibayar
  const target = valid.find(o => !paid[o.key]) || list[2];
  const days = Math.round((startOfDay(target.due) - today) / 864e5);
  const remind = Number.isFinite(+bill.remind) ? +bill.remind : 3;
  const state = days < 0 ? "overdue" : days === 0 ? "today" : days <= remind ? "soon" : "upcoming";
  return { key: target.key, due: target.due, days, state, paidCurrent: !!paid[cur.key], curKey: cur.key };
}

export function billDueLabel(st) {
  if (st.state === "overdue") return `Terlambat ${-st.days} hari`;
  if (st.state === "today") return "Jatuh tempo hari ini";
  if (st.days === 1) return "Besok";
  if (st.days <= 31) return `${st.days} hari lagi · ${fmtShort(st.due)}`;
  return fmtShort(st.due) + " " + st.due.getFullYear();
}

/** Ringkasan tagihan bulanan untuk bulan kalender berjalan */
export function billsMonthSummary(bills, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  let total = 0, paid = 0, count = 0, paidCount = 0;
  for (const b of bills) {
    if (b.active === false) continue;
    const o = b.freq === "yearly" ? (Number(b.month) === m ? occ(b, y) : null) : occ(b, y, m);
    if (!o) continue;
    if (b.since && o.due < startOfDay(new Date(b.since))) continue;
    count++; total += Number(b.amount) || 0;
    if (b.paid?.[o.key]) { paidCount++; paid += Number(b.paid[o.key].amount ?? b.amount) || 0; }
  }
  return { total, paid, count, paidCount };
}

/* ─── Target tabungan ─────────────────────────────────────── */
export function goalProgress(goal, balance = 0, now = new Date()) {
  const saved = goal.walletId ? Math.max(0, balance) : Math.max(0, Number(goal.saved) || 0);
  const target = Math.max(1, Number(goal.target) || 1);
  const pct = Math.min(100, saved / target * 100);
  const remaining = Math.max(0, target - saved);
  let monthsLeft = null, perMonth = null, late = false;
  if (goal.deadline) {
    const dl = new Date(goal.deadline + "T00:00:00");
    monthsLeft = (dl.getFullYear() - now.getFullYear()) * 12 + (dl.getMonth() - now.getMonth()) + (dl.getDate() >= now.getDate() ? 0 : -1);
    if (dl < startOfDay(now)) late = remaining > 0;
    perMonth = remaining > 0 ? Math.ceil(remaining / Math.max(1, monthsLeft)) : 0;
  }
  return { saved, target, pct, remaining, monthsLeft, perMonth, done: remaining <= 0, late };
}

/* ─── Utang-piutang ───────────────────────────────────────── */
export function debtStatus(debt, now = new Date()) {
  const amount = Number(debt.amount) || 0, paid = Number(debt.paid) || 0;
  const remaining = Math.max(0, amount - paid);
  const settled = debt.settled || remaining <= 0;
  let days = null, overdue = false;
  if (debt.due && !settled) {
    days = Math.round((new Date(debt.due + "T00:00:00") - startOfDay(now)) / 864e5);
    overdue = days < 0;
  }
  return { amount, paid, remaining, settled, days, overdue, pct: amount ? Math.min(100, paid / amount * 100) : 0 };
}
