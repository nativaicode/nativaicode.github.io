/* Isi pesan pengingat harian — fungsi murni, dipakai oleh skrip GitHub Actions (scripts/daily-reminder.mjs). */
import { periodOf, rupiah, rupiahShort, summarize, toDate } from "./util.js";
import { billStatus, billDueLabel, debtStatus } from "./plan-logic.js";

/**
 * @param {object} p
 * @param {object} p.household  dokumen rumah tangga
 * @param {Array}  p.trx        transaksi periode berjalan
 * @param {object} p.budgets    {periodKey: amount}
 * @param {Array}  p.bills, p.debts
 * @param {string} p.nick       nama panggilan penerima
 * @param {Date}   p.now
 */
export function buildDailyMessage({ household, trx = [], budgets = {}, bills = [], debts = [], nick = "", now = new Date() }) {
  const pd = household?.settings?.paydayDay || 25;
  const period = periodOf(now, pd);
  const list = trx.map(t => ({ ...t, amount: Number(t.amount) || 0, date: toDate(t.date) }));
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today = list.filter(t => t.date >= todayStart && t.type !== "adjust");
  const todayOut = today.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);
  const s = summarize(list);
  const lines = [];
  let urgent = false;

  // 1. Catatan hari ini
  if (!today.length) lines.push("📝 Belum ada transaksi tercatat hari ini — yuk catat sebelum lupa.");
  else lines.push(`📝 Hari ini keluar ${rupiah(todayOut)} (${today.length} transaksi).`);

  // 2. Budget
  let budget = budgets[period.key];
  if (budget == null) { const k = Object.keys(budgets).filter(x => x < period.key).sort().pop(); budget = k ? budgets[k] : 0; }
  if (budget > 0) {
    const sisa = budget - s.rutin;
    const daysLeft = Math.max(1, Math.ceil((period.end - todayStart) / 864e5) - 1);
    if (sisa < 0) { lines.push(`🚨 Budget terlampaui ${rupiah(-sisa)}.`); urgent = true; }
    else lines.push(`🎯 Sisa budget ${rupiah(sisa)} (${Math.round(s.rutin / budget * 100)}%), ±Rp ${rupiahShort(Math.floor(sisa / daysLeft))}/hari.`);
  }

  // 3. Tagihan terlambat / ≤ 3 hari (atau sesuai pengingat tiap tagihan)
  const due = bills.filter(b => b.active !== false).map(b => ({ b, st: billStatus(b, now) }))
    .filter(x => x.st.state === "overdue" || x.st.state === "today" || (x.st.state === "soon" && x.st.days <= (x.b.remind ?? 3)))
    .sort((a, b) => a.st.days - b.st.days);
  if (due.length) {
    urgent = true;
    lines.push("🧾 " + due.slice(0, 3).map(x => `${x.b.name} Rp ${rupiahShort(x.b.amount)} (${billDueLabel(x.st).toLowerCase()})`).join("; ") + (due.length > 3 ? `; +${due.length - 3} lainnya` : ""));
  }

  // 4. Utang-piutang jatuh tempo
  const dd = debts.map(d => ({ d, st: debtStatus(d, now) })).filter(x => !x.st.settled && x.st.days != null && x.st.days <= 1);
  if (dd.length) lines.push("🤝 " + dd.slice(0, 2).map(x => `${x.d.kind === "utang" ? "Utang ke" : "Piutang"} ${x.d.person} Rp ${rupiahShort(x.st.remaining)} ${x.st.overdue ? "lewat jatuh tempo" : x.st.days === 0 ? "jatuh tempo hari ini" : "besok"}`).join("; "));

  const title = due.length ? `🧾 ${nick ? nick + ", ada" : "Ada"} tagihan jatuh tempo` : urgent ? `🚨 Cek budget${nick ? ", " + nick : ""}` : `📊 Ringkasan hari ini${nick ? ", " + nick : ""}`;
  return { title, body: lines.join("\n"), urgent };
}
