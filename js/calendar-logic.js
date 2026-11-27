/* Kalender pengeluaran — logika murni (tanpa DOM), mudah diuji */
import { dayKey } from "./util.js";
import { billOccurrences, debtStatus, startOfDay } from "./plan-logic.js";

const median = arr => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * Susun kalender satu periode.
 * @param {object} o
 * @param {Date} o.start  awal periode (inklusif)
 * @param {Date} o.end    akhir periode (eksklusif)
 * @param {Array} o.list  transaksi (sudah difilter)
 * @param {(t)=>number} o.value  nilai yang dihitung per transaksi (default: pengeluaran)
 * @param {Array} o.bills tagihan rutin, @param {Array} o.debts utang-piutang
 * @param {number} o.budget budget periode (0 = tidak ada) → jatah harian = budget / jumlah hari
 * @param {number} o.weekStart 0 = Minggu, 1 = Senin
 */
export function buildCalendar({ start, end, list = [], value, bills = [], debts = [], budget = 0, now = new Date(), weekStart = 0 }) {
  const val = value || (t => (t.type === "expense" ? Number(t.amount) || 0 : 0));
  const today = startOfDay(now);
  const days = new Map();
  const cells = [];
  for (let i = 0; ; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (d >= end) break;
    const c = { key: dayKey(d), date: d, day: d.getDate(), dow: d.getDay(), amount: 0, income: 0, count: 0, tetap: 0,
      bills: [], debts: [], isToday: +d === +today, future: d > today, level: 0, firstOfMonth: d.getDate() === 1 || i === 0 };
    days.set(c.key, c); cells.push(c);
  }
  for (const t of list) {
    const c = days.get(dayKey(t.date));
    if (!c) continue;
    const v = val(t);
    if (v) { c.amount += v; c.count++; if (t.type === "expense" && t.expenseType === "Tetap") c.tetap += v; }
    if (t.type === "income") c.income += Number(t.amount) || 0;
  }
  for (const b of bills) {
    for (const o of billOccurrences(b, start, end)) days.get(dayKey(o.due))?.bills.push({ id: b.id, name: b.name, amount: Number(b.amount) || 0, paid: o.paid });
  }
  for (const d of debts) {
    if (!d.due) continue;
    const st = debtStatus(d, now);
    if (st.settled) continue;
    days.get(d.due)?.debts.push({ id: d.id, person: d.person, kind: d.kind, remaining: st.remaining });
  }

  // ── statistik (hanya hari yang sudah dilalui) ──
  // Pengeluaran Tetap (cicilan, sewa, tagihan tetap) bukan cerminan kebiasaan belanja harian,
  // jadi warna & statistik memakai bagian Rutin; Tetap ditandai tersendiri di sel.
  for (const c of cells) c.rutin = c.amount - c.tetap;
  const past = cells.filter(c => !c.future);
  const total = cells.reduce((a, c) => a + c.amount, 0);
  const spent = past.filter(c => c.rutin > 0);
  // Warna: ada budget → dibanding jatah harian (budget ÷ jumlah hari); tanpa budget → dibanding
  // hari belanja biasa (median), supaya satu hari besar tidak merusak skala.
  const allowance = budget > 0 ? budget / cells.length : 0;
  const ref = allowance || median(spent.map(c => c.rutin));
  for (const c of cells) {
    if (!c.rutin) continue;
    const r = ref ? c.rutin / ref : 1;
    c.level = r < 0.5 ? 1 : r <= 1 ? 2 : r < 2 ? 3 : 4;
  }
  const dowSum = Array(7).fill(0), dowN = Array(7).fill(0);
  for (const c of past) { dowSum[c.dow] += c.rutin; dowN[c.dow]++; }
  const byWeekday = dowSum.map((v, i) => (dowN[i] ? v / dowN[i] : 0));
  const topDow = byWeekday.some(v => v > 0) ? byWeekday.indexOf(Math.max(...byWeekday)) : -1;
  const avgOf = arr => (arr.length ? arr.reduce((a, c) => a + c.rutin, 0) / arr.length : 0);
  const weekend = past.filter(c => c.dow === 0 || c.dow === 6), weekday = past.filter(c => c.dow > 0 && c.dow < 6);
  const maxDay = spent.length ? spent.reduce((a, c) => (c.rutin > a.rutin ? c : a)) : null;
  const overAllowance = allowance ? past.filter(c => c.rutin > allowance).length : 0;
  const rutinSoFar = past.reduce((a, c) => a + c.rutin, 0);
  // sisa jatah per hari untuk hari tersisa (termasuk hari ini)
  const left = cells.filter(c => c.future || c.isToday).length;
  const perDayLeft = budget > 0 && left ? Math.max(0, (budget - rutinSoFar) / left) : 0;
  const tetapTotal = cells.reduce((a, c) => a + c.tetap, 0);

  // ── susun minggu ──
  const lead = cells.length ? (cells[0].dow - weekStart + 7) % 7 : 0;
  const flat = [...Array(lead).fill(null), ...cells];
  while (flat.length % 7) flat.push(null);
  const weeks = [];
  for (let i = 0; i < flat.length; i += 7) weeks.push(flat.slice(i, i + 7));

  return {
    weeks, days, cells,
    stats: {
      total, tetapTotal, elapsed: past.length, avg: avgOf(past),
      noSpend: past.filter(c => !c.rutin).length, spendDays: spent.length,
      maxDay, byWeekday, topDow, allowance, ref, overAllowance, perDayLeft, daysLeft: left,
      weekendAvg: avgOf(weekend), weekdayAvg: avgOf(weekday), weekendDays: weekend.length, weekdayDays: weekday.length,
    },
  };
}

/** Hari default yang dipilih: hari ini bila dalam periode, kalau tidak hari terakhir yang ada transaksinya */
export function defaultSelectedDay(cal) {
  const t = cal.cells.find(c => c.isToday);
  if (t) return t.key;
  const withTrx = cal.cells.filter(c => c.count || c.bills.length);
  return (withTrx[withTrx.length - 1] || cal.cells[cal.cells.length - 1])?.key || "";
}

export const WEEKDAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
