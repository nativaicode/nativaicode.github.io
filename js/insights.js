/* Mesin insight keuangan keluarga — aturan sederhana, dihitung di perangkat (tanpa server).
   Input murni → output daftar insight, supaya mudah diuji dan diubah. */
import { rupiah, summarize, catIcon } from "./util.js";
import { billStatus, billDueLabel, debtStatus } from "./plan-logic.js";

const LV = { bad: 0, warn: 1, info: 2, good: 3 }; // urutan prioritas

/**
 * @param {object} p
 * @param {{start:Date,end:Date,key:string}} p.period  periode berjalan
 * @param {Array}  p.list       transaksi periode berjalan
 * @param {number} p.budget     budget pengeluaran rutin (0 = belum ada)
 * @param {Array}  p.prev       ringkasan periode-periode sebelumnya [{income, expense, rutin, tetap, byCategory}]
 * @param {Array}  p.wallets    [{id, name, archived}]
 * @param {object} p.balances   {walletId: saldo}
 * @param {Date}   p.now
 */
export function computeInsights({ period, list, budget = 0, prev = [], wallets = [], balances = {}, now = new Date(), bills = [], debts = [], catBudgets = {} }) {
  const out = [];
  const add = (id, level, icon, title, text) => out.push({ id: `${period.key}:${id}`, level, icon, title, text });
  const s = summarize(list);
  const total = period.end - period.start;
  const elapsed = Math.min(1, Math.max(0.02, (now - period.start) / total));
  const daysTotal = Math.round(total / 864e5);
  const daysLeft = Math.max(1, Math.ceil((period.end - now) / 864e5));
  const pctTime = Math.round(elapsed * 100);
  const hist = prev.filter(x => x && (x.income || x.expense));
  const avg = k => hist.length ? hist.reduce((a, x) => a + (x[k] || 0), 0) / hist.length : 0;

  /* 1. Laju budget (pengeluaran rutin vs waktu berjalan) */
  if (budget > 0) {
    const pctBudget = s.rutin / budget * 100;
    const projected = s.rutin / elapsed;
    const sisa = budget - s.rutin;
    if (pctBudget >= 100) {
      add("budget-over", "bad", "🚨", "Budget sudah terlampaui",
        `Pengeluaran rutin ${rupiah(s.rutin)}, lebih ${rupiah(-sisa)} dari budget, padahal periode masih ${daysLeft} hari lagi. Tahan pengeluaran yang tidak mendesak.`);
    } else if (elapsed >= 0.15 && pctBudget > pctTime + 15) {
      add("budget-pace", "warn", "🏃", "Pengeluaran lebih cepat dari jadwal",
        `Budget sudah terpakai ${Math.round(pctBudget)}% padahal periode baru berjalan ${pctTime}%. Kalau polanya sama, perkiraan akhir periode ${rupiah(projected)} (lebih ${rupiah(projected - budget)}). Agar aman, batasi ±${rupiah(Math.floor(sisa / daysLeft))}/hari.`);
    } else if (elapsed >= 0.5 && pctBudget < pctTime - 15) {
      add("budget-good", "good", "👍", "Budget terkendali",
        `Periode sudah berjalan ${pctTime}% dan budget baru terpakai ${Math.round(pctBudget)}%. Sisa ${rupiah(sisa)} — pertahankan!`);
    }
  } else if (hist.length && avg("rutin") > 0) {
    add("budget-none", "info", "🎯", "Belum ada budget periode ini",
      `Rata-rata pengeluaran rutin ${hist.length} periode terakhir ${rupiah(avg("rutin"))}. Coba jadikan acuan budget, atau sedikit di bawahnya untuk mulai menabung.`);
  }

  /* 2. Defisit: pengeluaran > pemasukan */
  if (s.income > 0 && s.expense > s.income) {
    add("deficit", "bad", "📉", "Pengeluaran melebihi pemasukan",
      `Periode ini keluar ${rupiah(s.expense)}, masuk ${rupiah(s.income)} (defisit ${rupiah(s.expense - s.income)}). Selisihnya kemungkinan menggerus tabungan.`);
  }

  /* 3. Tingkat tabungan (dinilai setelah separuh periode, agar tidak menyesatkan di awal) */
  if (s.income > 0 && s.expense <= s.income && elapsed >= 0.5) {
    const rate = (s.income - s.expense) / s.income * 100;
    if (rate < 10) add("saving-low", "warn", "🐷", "Sisa untuk ditabung masih tipis",
      `Baru ${Math.round(rate)}% pemasukan yang tersisa (${rupiah(s.income - s.expense)}). Banyak perencana keuangan menyarankan menyisihkan minimal 10–20% di awal periode.`);
    else if (rate >= 20) add("saving-good", "good", "🌱", "Tabungan sehat",
      `${Math.round(rate)}% pemasukan masih tersisa (${rupiah(s.income - s.expense)}). Pertimbangkan langsung pindahkan ke rekening tabungan/dana darurat.`);
  }

  /* 4. Rasio cicilan / pengeluaran tetap terhadap pemasukan */
  const cicilan = list.filter(t => t.type === "expense" && /cicil|kpr|kredit|angsur|pinjam|paylater/i.test(t.category || "")).reduce((a, t) => a + t.amount, 0);
  if (s.income > 0 && cicilan / s.income > 0.35) {
    add("debt-ratio", "warn", "🏦", "Porsi cicilan cukup besar",
      `Cicilan ${rupiah(cicilan)} = ${Math.round(cicilan / s.income * 100)}% dari pemasukan periode ini. Batas yang umum dipakai sekitar 30–35%; hindari menambah cicilan baru dulu.`);
  }

  /* 5. Lonjakan per kategori dibanding rata-rata periode sebelumnya (hanya pengeluaran rutin) */
  if (hist.length) {
    const rutinByCat = {};
    for (const t of list) if (t.type === "expense" && t.expenseType !== "Tetap") rutinByCat[t.category || "Lainnya"] = (rutinByCat[t.category || "Lainnya"] || 0) + t.amount;
    const spikes = [];
    for (const [c, v] of Object.entries(rutinByCat)) {
      const a = hist.reduce((x, h) => x + (h.byCategory?.[c] || 0), 0) / hist.length;
      if (a <= 0) continue;
      if (v > a * 1.1 && v - a >= 50000) spikes.push({ c, v, a, kind: "over", score: v / a });
      else if (elapsed >= 0.4 && v / elapsed > a * 1.3 && v / elapsed - a >= 100000) spikes.push({ c, v, a, kind: "pace", score: (v / elapsed) / a });
    }
    spikes.sort((x, y) => y.score - x.score).slice(0, 2).forEach(k => {
      if (k.kind === "over") add(`cat-${k.c}`, "warn", catIcon(k.c), `${k.c} lebih boros dari biasanya`,
        `Sudah ${rupiah(k.v)} — ${Math.round((k.v / k.a - 1) * 100)}% di atas rata-rata satu periode penuh (${rupiah(k.a)}), padahal periode belum selesai.`);
      else add(`cat-${k.c}`, "info", catIcon(k.c), `${k.c} cenderung naik`,
        `Dengan laju sekarang, ${k.c} diperkirakan ${rupiah(k.v / elapsed)} sampai akhir periode, sekitar ${Math.round(((k.v / elapsed) / k.a - 1) * 100)}% di atas rata-rata (${rupiah(k.a)}).`);
    });

    /* 6. Total rutin dibanding rata-rata → boros / hemat */
    const avgRutin = avg("rutin");
    if (avgRutin > 0 && elapsed >= 0.3) {
      const proj = s.rutin / elapsed;
      if (proj > avgRutin * 1.2 && !out.some(x => x.id.endsWith("budget-over") || x.id.endsWith("budget-pace")))
        add("rutin-up", "warn", "📈", "Periode ini lebih boros",
          `Perkiraan pengeluaran rutin ${rupiah(proj)}, sekitar ${Math.round((proj / avgRutin - 1) * 100)}% di atas rata-rata ${hist.length} periode terakhir (${rupiah(avgRutin)}).`);
      else if (elapsed >= 0.5 && proj < avgRutin * 0.85)
        add("rutin-down", "good", "✨", "Lebih hemat dari biasanya",
          `Perkiraan pengeluaran rutin ${rupiah(proj)}, sekitar ${Math.round((1 - proj / avgRutin) * 100)}% lebih rendah dari rata-rata (${rupiah(avgRutin)}). Mantap!`);
    }
  }

  /* 7. Pengeluaran kecil yang sering (jajan, ongkir, kopi) */
  const small = list.filter(t => t.type === "expense" && t.expenseType !== "Tetap" && t.amount < 50000);
  const smallTotal = small.reduce((a, t) => a + t.amount, 0);
  if (small.length >= 15 && s.rutin > 0 && smallTotal / s.rutin >= 0.15) {
    add("small-spend", "info", "☕", "Pengeluaran kecil-kecil menumpuk",
      `${small.length} transaksi di bawah Rp50.000 dengan total ${rupiah(smallTotal)} (${Math.round(smallTotal / s.rutin * 100)}% pengeluaran rutin). Kecil satu-satu, tapi terasa kalau dijumlah.`);
  }

  /* 8. Saldo dompet minus → kemungkinan salah catat */
  for (const w of wallets) {
    if (!w.archived && (balances[w.id] || 0) < 0) add(`neg-${w.id}`, "warn", "⚠️", `Saldo ${w.name} minus`,
      `Tercatat ${rupiah(balances[w.id])}. Mungkin ada pemasukan yang belum dicatat — cek lalu gunakan "Sesuaikan saldo".`);
  }

  /* 10. Tagihan rutin: terlambat / jatuh tempo dekat */
  const bs = bills.filter(b => b.active !== false).map(b => ({ b, st: billStatus(b, now) }));
  const late = bs.filter(x => x.st.state === "overdue");
  const near = bs.filter(x => x.st.state === "today" || x.st.state === "soon").sort((a, b) => a.st.days - b.st.days);
  if (late.length) add(`bill-late-${late.map(x => x.b.id + x.st.key).join(",")}`, "bad", "⏰",
    late.length === 1 ? `Tagihan ${late[0].b.name} terlambat` : `${late.length} tagihan terlambat`,
    late.map(x => `${x.b.name} ${rupiah(x.b.amount)} (${billDueLabel(x.st).toLowerCase()})`).join(", ") + ". Segera bayar untuk menghindari denda.");
  if (near.length) add(`bill-near-${near.map(x => x.b.id + x.st.key).join(",")}`, near.some(x => x.st.days <= 1) ? "warn" : "info", "🧾",
    near.length === 1 ? `Tagihan ${near[0].b.name} ${billDueLabel(near[0].st).toLowerCase()}` : `${near.length} tagihan segera jatuh tempo`,
    near.map(x => `${x.b.name} ${rupiah(x.b.amount)} — ${billDueLabel(x.st).toLowerCase()}`).join("; ") + `. Total ${rupiah(near.reduce((a, x) => a + (Number(x.b.amount) || 0), 0))}.`);

  /* 11. Budget per kategori */
  const spentCat = {};
  for (const t of list) if (t.type === "expense") spentCat[t.category || "Lainnya"] = (spentCat[t.category || "Lainnya"] || 0) + t.amount;
  for (const [c, lim] of Object.entries(catBudgets || {})) {
    if (!(lim > 0)) continue;
    const v = spentCat[c] || 0, pct = v / lim * 100;
    if (pct >= 100) add(`catb-${c}-100`, "warn", catIcon(c), `Budget ${c} habis`, `Terpakai ${rupiah(v)} dari ${rupiah(lim)} (lebih ${rupiah(v - lim)}).`);
    else if (pct >= 80) add(`catb-${c}-80`, "info", catIcon(c), `Budget ${c} hampir habis`, `Sudah ${Math.round(pct)}% (${rupiah(v)} dari ${rupiah(lim)}), sisa ${rupiah(lim - v)} untuk ${daysLeft} hari.`);
  }

  /* 12. Utang-piutang lewat jatuh tempo / segera */
  for (const d of debts) {
    const st = debtStatus(d, now);
    if (st.settled || st.days == null) continue;
    if (st.overdue) add(`debt-${d.id}`, d.kind === "utang" ? "warn" : "info", d.kind === "utang" ? "💸" : "🤝",
      d.kind === "utang" ? `Utang ke ${d.person} lewat jatuh tempo` : `Piutang ${d.person} belum kembali`,
      `Sisa ${rupiah(st.remaining)}, jatuh tempo ${-st.days} hari lalu.`);
    else if (st.days <= 3) add(`debt-${d.id}-soon`, "info", d.kind === "utang" ? "💸" : "🤝",
      d.kind === "utang" ? `Utang ke ${d.person} jatuh tempo ${st.days === 0 ? "hari ini" : st.days + " hari lagi"}` : `Piutang ${d.person} jatuh tempo ${st.days === 0 ? "hari ini" : st.days + " hari lagi"}`,
      `Sisa ${rupiah(st.remaining)}.`);
  }

  /* 9. Pengingat mencatat: belum ada catatan 3 hari terakhir */
  const lastT = list.reduce((m, t) => Math.max(m, +t.date), 0);
  if (elapsed > 0.1 && (!lastT || now - lastT > 3 * 864e5)) {
    add("no-record", "info", "📝", "Jangan lupa mencatat",
      lastT ? `Transaksi terakhir dicatat ${Math.floor((now - lastT) / 864e5)} hari lalu. Catatan yang rutin membuat analisis lebih akurat.` : "Belum ada transaksi di periode ini. Yuk mulai catat pengeluaran hari ini.");
  }

  return out.sort((a, b) => LV[a.level] - LV[b.level]);
}

/** Ringkasan periode untuk disimpan sebagai pembanding */
export function periodSummary(list) {
  const s = summarize(list);
  const byCategory = {};
  for (const t of list) if (t.type === "expense" && t.expenseType !== "Tetap") byCategory[t.category || "Lainnya"] = (byCategory[t.category || "Lainnya"] || 0) + t.amount;
  return { income: s.income, expense: s.expense, rutin: s.rutin, tetap: s.tetap, byCategory };
}
