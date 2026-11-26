/* ═══════════ Halaman Rencana: Tagihan rutin · Target tabungan · Utang-piutang ═══════════ */
import { billStatus, billDueLabel, billsMonthSummary, goalProgress, debtStatus, fmtShort } from "./plan-logic.js";
import { BULAN } from "./util.js";

let C; // konteks helper dari app.js
const STATE_PILL = { overdue: "bad", today: "bad", soon: "warn", upcoming: "info" };
const GOAL_ICONS = ["🛡️", "🎓", "🕋", "🏠", "🚗", "✈️", "🎁", "💍", "📱", "👶", "🏥", "💰"];

export function installPlan(VIEWS, ctx) {
  C = ctx;
  VIEWS.plan = {
    mount(el) {
      const tab = C.pref.get("planTab", "bills");
      el.innerHTML = `
        <div class="topbar"><div><h1>Rencana</h1><div class="sub">Tagihan rutin, target tabungan, dan utang-piutang</div></div>
          <div class="topbar-actions">${C.avatarLink()}</div></div>
        <div class="seg" id="plTabs">
          <button data-tab="bills" class="${tab === "bills" ? "active" : ""}">🧾 Tagihan</button>
          <button data-tab="goals" class="${tab === "goals" ? "active" : ""}">🎯 Target</button>
          <button data-tab="debts" class="${tab === "debts" ? "active" : ""}">🤝 Utang</button>
        </div>
        <div id="plBody"></div>`;
      el.querySelector("#plTabs").onclick = e => {
        const b = e.target.closest("[data-tab]"); if (!b) return;
        C.pref.set("planTab", b.dataset.tab);
        el.querySelectorAll("#plTabs button").forEach(x => x.classList.toggle("active", x === b));
        this.update(el);
      };
      el.addEventListener("click", e => {
        const a = e.target.closest("[data-pl]"); if (!a) return;
        e.stopPropagation();
        const { pl, id } = a.dataset;
        const bill = C.state.bills.find(x => x.id === id), goal = C.state.goals.find(x => x.id === id), debt = C.state.debts.find(x => x.id === id);
        ({
          addBill: () => billSheet(), bill: () => billDetail(bill), pay: () => paySheet(bill),
          addGoal: () => goalSheet(), goal: () => goalSheet(goal), dep: () => depositSheet(goal, 1), wd: () => depositSheet(goal, -1),
          addDebt: () => debtSheet(), debt: () => debtDetail(debt),
        })[pl]?.();
      });
    },
    update(el) {
      const tab = C.pref.get("planTab", "bills");
      const body = el.querySelector("#plBody");
      if (C.state.planRulesMissing) {
        body.innerHTML = `<section class="card"><div class="insight lv-warn"><div class="in-ico">🔐</div><div>
          <div class="in-title">Aturan database perlu diperbarui</div>
          <div class="in-text">Fitur Rencana butuh aturan keamanan Firestore versi baru. Pemilik akun: buka <b>Firebase Console → Firestore Database → Rules</b>, ganti isinya dengan file <b>firestore.rules</b> terbaru dari repo, lalu klik <b>Publish</b>. Setelah itu tutup & buka lagi aplikasi.</div>
        </div></div></section>`;
        return;
      }
      body.innerHTML = tab === "goals" ? goalsHtml() : tab === "debts" ? debtsHtml() : billsHtml();
    },
  };
}

/* ═══════════ TAGIHAN ═══════════ */
export function openBillPay(id) { paySheet(C.state.bills.find(x => x.id === id)); }
const ORDER = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
export function sortedBills(now = new Date()) {
  return C.state.bills.filter(b => b.active !== false)
    .map(b => ({ b, st: billStatus(b, now) }))
    .sort((x, y) => (x.st.paidCurrent - y.st.paidCurrent) || (ORDER[x.st.state] - ORDER[y.st.state]) || (x.st.days - y.st.days));
}
function freqLabel(b) {
  return b.freq === "yearly" ? `Tiap ${b.day} ${BULAN[b.month || 0]}` : `Tiap tgl ${b.day}`;
}
export function billRow(b, st, { compact = false } = {}) {
  const pill = st.paidCurrent && st.state === "upcoming"
    ? `<span class="pill ok">✓ Lunas</span>`
    : `<span class="pill ${STATE_PILL[st.state]}">${C.esc(billDueLabel(st))}</span>`;
  const canPay = !(st.paidCurrent && st.state === "upcoming");
  return `<div class="plan-row" data-pl="bill" data-id="${C.esc(b.id)}">
    <div class="trx-ico expense">${C.catIcon(b.category || "Tagihan")}</div>
    <div class="trx-main"><div class="trx-title">${C.esc(b.name)}</div>
      <div class="trx-sub">${compact ? "" : C.esc(freqLabel(b)) + " · "}${C.esc(C.walletName(b.walletId))}</div>
      <div style="margin-top:4px">${pill}</div></div>
    <div class="plan-end"><b class="num">${C.money(b.amount)}</b>
      ${canPay ? `<button class="btn btn-primary btn-sm" data-pl="pay" data-id="${C.esc(b.id)}">Bayar</button>` : ""}</div>
  </div>`;
}
function billsHtml() {
  const bills = C.state.bills;
  const sum = billsMonthSummary(bills);
  const list = sortedBills();
  const inactive = bills.filter(b => b.active === false);
  return `
    <section class="card" style="margin-bottom:14px">
      <div class="card-head"><h2>Tagihan bulan ini</h2><button class="btn btn-primary btn-sm" data-pl="addBill">${C.icon("plus")} Tambah</button></div>
      ${sum.count ? `<div class="budget-top"><div><div class="muted" style="font-size:12.5px">Sudah dibayar</div><div class="big">${C.money(sum.paid)}</div></div>
        <div style="text-align:right"><div class="muted" style="font-size:12.5px">dari ${sum.count} tagihan</div><b>${C.money(sum.total)}</b></div></div>
        <div class="progress"><i style="width:${sum.total ? (sum.paid / sum.total * 100).toFixed(1) : 0}%"></i></div>
        <div class="budget-meta"><span>${sum.paidCount}/${sum.count} lunas</span><span>Sisa ${C.money(sum.total - sum.paid)}</span></div>`
        : `<p class="muted" style="margin:0">Daftarkan cicilan, listrik, air, wifi, SPP, asuransi, dll. Aplikasi akan mengingatkan sebelum jatuh tempo dan mencatat pembayarannya dengan 1 ketukan.</p>`}
    </section>
    ${list.length ? `<section class="card plan-list">${list.map(({ b, st }) => billRow(b, st)).join("")}</section>` : ""}
    ${inactive.length ? `<div class="set-group" style="margin-top:14px"><h3>Nonaktif</h3><section class="card plan-list">${inactive.map(b => `<div class="plan-row" data-pl="bill" data-id="${C.esc(b.id)}"><div class="trx-ico">${C.catIcon(b.category)}</div><div class="trx-main"><div class="trx-title">${C.esc(b.name)}</div><div class="trx-sub">${C.esc(freqLabel(b))}</div></div><div class="plan-end"><b class="num faint">${C.money(b.amount)}</b></div></div>`).join("")}</section></div>` : ""}`;
}

function billSheet(b = null) {
  const ws = C.activeWallets();
  const cats = C.cats("expense");
  const f = b ? { ...b } : { name: "", amount: 0, category: cats.find(c => /tagihan/i.test(c)) || cats[0], walletId: ws[0]?.id || "", freq: "monthly", day: new Date().getDate(), month: new Date().getMonth(), remind: 3, expenseType: "Tetap", active: true };
  const s = C.openSheet({
    title: b ? "Ubah tagihan" : "Tagihan rutin baru",
    body: `
      <div class="field"><label for="bnName">Nama tagihan</label><input class="input" id="bnName" maxlength="60" placeholder="Contoh: KPR BTN, Listrik PLN, Wifi, SPP" value="${C.esc(f.name)}" autofocus></div>
      <div class="field"><label for="bnAmt">Nominal</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="bnAmt" inputmode="numeric" placeholder="0" value="${f.amount ? C.formatNominalInput(f.amount) : ""}" style="font-size:22px;min-height:54px"></div><span class="hint">Untuk tagihan yang berubah-ubah (listrik, air), isi perkiraan — nominal bisa diubah saat membayar.</span></div>
      <div class="seg" id="bnFreq"><button data-f="monthly" class="${f.freq !== "yearly" ? "active" : ""}">Bulanan</button><button data-f="yearly" class="${f.freq === "yearly" ? "active" : ""}">Tahunan</button></div>
      <div class="row-2">
        <div class="field"><label for="bnDay">Jatuh tempo tanggal</label><select class="input select" id="bnDay">${Array.from({ length: 31 }, (_, i) => `<option ${i + 1 === +f.day ? "selected" : ""}>${i + 1}</option>`).join("")}</select></div>
        <div class="field" id="bnMonthWrap"><label for="bnMonth">Bulan</label><select class="input select" id="bnMonth">${BULAN.map((m, i) => `<option value="${i}" ${i === +f.month ? "selected" : ""}>${m}</option>`).join("")}</select></div>
      </div>
      <div class="row-2">
        <div class="field"><label for="bnCat">Kategori</label><select class="input select" id="bnCat">${[...new Set([...cats, f.category])].map(c => `<option ${c === f.category ? "selected" : ""}>${C.esc(c)}</option>`).join("")}</select></div>
        <div class="field"><label for="bnRemind">Ingatkan</label><select class="input select" id="bnRemind">${[1, 2, 3, 5, 7].map(d => `<option value="${d}" ${d === +f.remind ? "selected" : ""}>${d} hari sebelum</option>`).join("")}</select></div>
      </div>
      <div class="field"><label for="bnW">Dibayar dari</label><select class="input select" id="bnW">${ws.map(w => `<option value="${C.esc(w.id)}" ${w.id === f.walletId ? "selected" : ""}>${C.walletIcon(w.type)} ${C.esc(C.walletLabel(w))}</option>`).join("")}</select></div>
      <div class="field"><span class="field-label">Jenis pengeluaran</span><div class="toggle-row" id="bnET">
        <button type="button" data-et="Tetap" class="${f.expenseType !== "Rutin" ? "active" : ""}"><b>📌 Tetap</b><small>Di luar budget (cicilan, SPP)</small></button>
        <button type="button" data-et="Rutin" class="${f.expenseType === "Rutin" ? "active" : ""}"><b>🔄 Rutin</b><small>Masuk hitungan budget</small></button></div></div>
      ${b ? `<label class="set-item" style="border:1px solid var(--border);border-radius:12px;margin-bottom:14px;cursor:pointer"><input type="checkbox" id="bnActive" ${f.active !== false ? "checked" : ""}><div class="si-main"><b>Aktif</b><small>Matikan jika tagihan sudah selesai (mis. cicilan lunas)</small></div></label>` : ""}
      <div class="btn-row">${b ? `<button class="btn btn-danger" id="bnDel">${C.icon("trash")} Hapus</button>` : ""}<button class="btn btn-primary" id="bnSave">Simpan</button></div>`,
  });
  const syncFreq = () => { s.$("#bnMonthWrap").classList.toggle("hidden", f.freq !== "yearly"); s.$$("#bnFreq button").forEach(x => x.classList.toggle("active", x.dataset.f === f.freq)); };
  syncFreq();
  s.$("#bnFreq").onclick = e => { const x = e.target.closest("[data-f]"); if (x) { f.freq = x.dataset.f; syncFreq(); } };
  s.$("#bnET").onclick = e => { const x = e.target.closest("[data-et]"); if (!x) return; f.expenseType = x.dataset.et; s.$$("#bnET button").forEach(y => y.classList.toggle("active", y === x)); };
  s.$("#bnAmt").oninput = e => { e.target.value = C.formatNominalInput(e.target.value); };
  s.$("#bnDel")?.addEventListener("click", async () => {
    if (!(await C.confirmDialog({ title: "Hapus tagihan?", message: `${f.name} akan dihapus dari daftar. Transaksi pembayaran yang sudah tercatat tetap ada.`, okText: "Hapus", danger: true }))) return;
    await C.D.deleteItem("bills", b.id); s.close(); C.toast("Tagihan dihapus", "success");
  });
  s.$("#bnSave").onclick = e => C.busy(e.currentTarget, async () => {
    const data = {
      name: s.$("#bnName").value.trim(), amount: C.parseNominal(s.$("#bnAmt").value), category: s.$("#bnCat").value,
      walletId: s.$("#bnW").value, freq: f.freq, day: +s.$("#bnDay").value, month: +s.$("#bnMonth").value,
      remind: +s.$("#bnRemind").value, expenseType: f.expenseType, active: b ? s.$("#bnActive").checked : true,
    };
    if (!data.name) return C.toast("Isi nama tagihan.", "warn");
    if (!data.amount) return C.toast("Isi nominal tagihan.", "warn");
    if (!b) { data.since = new Date(new Date().setHours(0, 0, 0, 0)).getTime(); data.paid = {}; }
    try { await C.D.saveItem("bills", b ? { id: b.id, ...data } : data); s.close(); C.toast("Tagihan disimpan ✓", "success"); }
    catch (err) { C.toast(C.friendlyError(err), "error"); }
  });
}

function billDetail(b) {
  if (!b) return;
  const st = billStatus(b);
  const paidKeys = Object.keys(b.paid || {}).sort().reverse().slice(0, 6);
  const s = C.openSheet({
    title: b.name,
    body: `
      <div class="detail-amount"><div class="trx-ico expense" style="margin:0 auto 10px;width:56px;height:56px;font-size:26px">${C.catIcon(b.category)}</div>
        <div class="big">${C.money(b.amount)}</div><div style="margin-top:6px"><span class="pill ${st.paidCurrent && st.state === "upcoming" ? "ok" : STATE_PILL[st.state]}">${st.paidCurrent && st.state === "upcoming" ? "✓ Lunas siklus ini · berikutnya " + fmtShort(st.due) : C.esc(billDueLabel(st))}</span></div></div>
      <div class="kv">
        <div><span>Jadwal</span><b>${C.esc(freqLabel(b))}${b.freq === "yearly" ? "" : " tiap bulan"}</b></div>
        <div><span>Kategori</span><b>${C.esc(b.category || "-")} · ${C.esc(b.expenseType || "Tetap")}</b></div>
        <div><span>Dibayar dari</span><b>${C.esc(C.walletName(b.walletId))}</b></div>
        <div><span>Pengingat</span><b>${b.remind ?? 3} hari sebelum</b></div>
        ${paidKeys.length ? `<div><span>Riwayat lunas</span><b>${paidKeys.map(k => C.esc(k)).join(", ")}</b></div>` : ""}
      </div>
      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn btn-ghost" id="bdEdit">${C.icon("edit")} Ubah</button>
        ${!(st.paidCurrent && st.state === "upcoming") ? `<button class="btn btn-primary" id="bdPay">Bayar ${C.esc(st.key)}</button>` : ""}
      </div>
      ${!(st.paidCurrent && st.state === "upcoming") ? `<button class="btn btn-ghost btn-block btn-sm" id="bdMark">✓ Tandai lunas tanpa mencatat transaksi</button>` : ""}
      ${st.paidCurrent ? `<button class="btn btn-ghost btn-block btn-sm" id="bdUnmark" style="margin-top:8px">↩︎ Batalkan status lunas ${C.esc(st.curKey)}</button>` : ""}`,
  });
  s.$("#bdEdit").onclick = () => { s.close(); billSheet(b); };
  s.$("#bdPay")?.addEventListener("click", () => { s.close(); paySheet(b); });
  s.$("#bdMark")?.addEventListener("click", async () => { await C.D.markBillPaid(b, st.key, true); s.close(); C.toast(`${b.name} ditandai lunas`, "success"); });
  s.$("#bdUnmark")?.addEventListener("click", async () => {
    const info = b.paid?.[st.curKey];
    const msg = info?.trxId ? "Status lunas dibatalkan. Transaksi pembayarannya tidak ikut terhapus — hapus manual di Riwayat bila perlu." : "Status lunas dibatalkan.";
    if (!(await C.confirmDialog({ title: "Batalkan status lunas?", message: msg, okText: "Batalkan lunas" }))) return;
    await C.D.markBillPaid(b, st.curKey, false); s.close(); C.toast("Status lunas dibatalkan", "success");
  });
}

function paySheet(b) {
  if (!b) return;
  const st = billStatus(b);
  const ws = C.activeWallets();
  const wid = ws.some(w => w.id === b.walletId) ? b.walletId : ws[0]?.id;
  const s = C.openSheet({
    title: `Bayar ${b.name}`,
    body: `<p class="muted" style="margin-top:0">Periode tagihan <b>${C.esc(st.key)}</b> · jatuh tempo ${fmtShort(st.due)}. Akan dicatat sebagai pengeluaran ${C.esc(b.expenseType || "Tetap")} kategori ${C.esc(b.category)}.</p>
      <div class="field"><label for="pyAmt">Nominal dibayar</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="pyAmt" inputmode="numeric" value="${C.formatNominalInput(b.amount)}" autofocus></div></div>
      <div class="row-2">
        <div class="field"><label for="pyW">Dari</label><select class="input select" id="pyW">${ws.map(w => `<option value="${C.esc(w.id)}" ${w.id === wid ? "selected" : ""}>${C.walletIcon(w.type)} ${C.esc(C.walletLabel(w))}</option>`).join("")}</select></div>
        <div class="field"><label for="pyDate">Tanggal</label><input class="input" type="datetime-local" id="pyDate" value="${C.toLocalInput(new Date())}"></div>
      </div>
      <button class="btn btn-primary btn-block" id="pySave">Bayar & catat</button>`,
  });
  s.$("#pyAmt").oninput = e => { e.target.value = C.formatNominalInput(e.target.value); };
  s.$("#pySave").onclick = e => C.busy(e.currentTarget, async () => {
    const amount = C.parseNominal(s.$("#pyAmt").value);
    if (!amount) return C.toast("Isi nominal.", "warn");
    const walletId = s.$("#pyW").value;
    try {
      const r = await C.D.payBill(b, st.key, { amount, walletId, date: new Date(s.$("#pyDate").value || Date.now()), owner: C.walletOwner(walletId) || C.myNick() });
      s.close(); C.toast(r.offline ? "Tersimpan offline — akan tersinkron" : `${b.name} ${C.rupiah(amount)} lunas ✓`, r.offline ? "warn" : "success");
    } catch (err) { C.toast(C.friendlyError(err), "error"); }
  });
}

/* ═══════════ TARGET TABUNGAN ═══════════ */
function goalsHtml() {
  const goals = [...C.state.goals].sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  const head = `<section class="card" style="margin-bottom:14px"><div class="card-head"><h2>Target tabungan</h2><button class="btn btn-primary btn-sm" data-pl="addGoal">${C.icon("plus")} Target baru</button></div>
    ${goals.length ? "" : `<p class="muted" style="margin:0">Contoh: Dana darurat, biaya sekolah anak, mudik, umroh, DP rumah. Pantau progresnya dan berapa yang perlu disisihkan tiap bulan.</p>`}</section>`;
  return head + `<div class="grid grid-2">${goals.map(g => {
    const p = goalProgress(g, C.balance(g.walletId));
    return `<section class="card goal-card" data-pl="goal" data-id="${C.esc(g.id)}">
      <div class="goal-top"><div class="goal-ico">${C.esc(g.icon || "🎯")}</div><div class="trx-main"><div class="trx-title">${C.esc(g.name)}</div>
        <div class="trx-sub">${g.walletId ? "Mengikuti saldo " + C.esc(C.walletName(g.walletId)) : "Dicatat manual"}${g.deadline ? " · target " + C.esc(C.fmtDate(new Date(g.deadline + "T00:00:00"))) : ""}</div></div>
        ${p.done ? `<span class="pill ok">🎉 Tercapai</span>` : p.late ? `<span class="pill bad">Lewat target</span>` : `<span class="pill info">${Math.round(p.pct)}%</span>`}</div>
      <div class="progress"><i style="width:${p.pct.toFixed(1)}%"></i></div>
      <div class="budget-meta"><span>${C.money(p.saved)} / ${C.money(p.target)}</span><span>Kurang ${C.money(p.remaining)}</span></div>
      ${p.perMonth && !p.done ? `<div class="hint" style="margin-top:6px">💡 Sisihkan ±${C.money(p.perMonth)}/bulan selama ${Math.max(1, p.monthsLeft)} bulan</div>` : ""}
      ${!g.walletId ? `<div class="btn-row" style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-pl="wd" data-id="${C.esc(g.id)}">− Tarik</button><button class="btn btn-primary btn-sm" data-pl="dep" data-id="${C.esc(g.id)}">+ Setor</button></div>` : ""}
    </section>`;
  }).join("")}</div>`;
}

function avgMonthlyExpense() {
  const hist = (C.state.prev?.list || []).filter(x => x.expense);
  if (hist.length) return hist.reduce((a, x) => a + x.expense, 0) / hist.length;
  return C.summarize(C.state.current.list).expense;
}

function goalSheet(g = null) {
  const f = g ? { ...g } : { name: "", icon: "🛡️", target: 0, saved: 0, walletId: "", deadline: "" };
  const ws = C.allWallets().filter(w => !w.archived || w.id === f.walletId);
  const s = C.openSheet({
    title: g ? "Ubah target" : "Target tabungan baru",
    body: `
      <div class="field"><span class="field-label">Ikon</span><div class="chips" id="glIcon" style="flex-wrap:wrap">${GOAL_ICONS.map(i => `<button type="button" class="chip ${i === f.icon ? "active" : ""}" data-i="${i}" style="font-size:18px;padding:6px 10px">${i}</button>`).join("")}</div></div>
      <div class="field"><label for="glName">Nama target</label><input class="input" id="glName" maxlength="60" placeholder="Contoh: Dana darurat, Sekolah anak 2028" value="${C.esc(f.name)}" autofocus></div>
      <div class="field"><label for="glTarget">Jumlah target</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="glTarget" inputmode="numeric" placeholder="0" value="${f.target ? C.formatNominalInput(f.target) : ""}" style="font-size:22px;min-height:54px"></div>
        <button type="button" class="link-btn" id="glEmergency" style="padding:6px 0;text-align:left">🛡️ Hitung dana darurat (6× rata-rata pengeluaran bulanan)</button></div>
      <div class="field"><label for="glW">Sumber dana</label><select class="input select" id="glW"><option value="">✍️ Catat manual (setor/tarik)</option>${ws.map(w => `<option value="${C.esc(w.id)}" ${w.id === f.walletId ? "selected" : ""}>Ikuti saldo ${C.esc(C.walletLabel(w))}</option>`).join("")}</select>
        <span class="hint">Pilih rekening khusus tabungan agar progres otomatis mengikuti saldonya.</span></div>
      <div class="field" id="glSavedWrap"><label for="glSaved">Sudah terkumpul</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="glSaved" inputmode="numeric" placeholder="0" value="${f.saved ? C.formatNominalInput(f.saved) : ""}" style="font-size:20px;min-height:50px"></div></div>
      <div class="field"><label for="glDl">Target tercapai pada (opsional)</label><input class="input" type="date" id="glDl" value="${C.esc(f.deadline || "")}"></div>
      <div class="btn-row">${g ? `<button class="btn btn-danger" id="glDel">${C.icon("trash")} Hapus</button>` : ""}<button class="btn btn-primary" id="glSave">Simpan</button></div>`,
  });
  const sync = () => s.$("#glSavedWrap").classList.toggle("hidden", !!s.$("#glW").value);
  sync(); s.$("#glW").onchange = sync;
  s.$("#glIcon").onclick = e => { const x = e.target.closest("[data-i]"); if (!x) return; f.icon = x.dataset.i; s.$$("#glIcon .chip").forEach(y => y.classList.toggle("active", y === x)); };
  ["#glTarget", "#glSaved"].forEach(id => s.$(id).oninput = e => { e.target.value = C.formatNominalInput(e.target.value); });
  s.$("#glEmergency").onclick = () => {
    const avg = avgMonthlyExpense();
    if (!avg) return C.toast("Belum ada data pengeluaran untuk dihitung.", "warn");
    s.$("#glTarget").value = C.formatNominalInput(Math.ceil(avg * 6 / 100000) * 100000);
    if (!s.$("#glName").value) s.$("#glName").value = "Dana darurat";
    C.toast(`Rata-rata pengeluaran ${C.rupiah(avg)}/bulan × 6`, "info");
  };
  s.$("#glDel")?.addEventListener("click", async () => {
    if (!(await C.confirmDialog({ title: "Hapus target?", message: `Target "${f.name}" akan dihapus. Saldo rekening tidak berubah.`, okText: "Hapus", danger: true }))) return;
    await C.D.deleteItem("goals", g.id); s.close(); C.toast("Target dihapus", "success");
  });
  s.$("#glSave").onclick = e => C.busy(e.currentTarget, async () => {
    const data = { name: s.$("#glName").value.trim(), icon: f.icon, target: C.parseNominal(s.$("#glTarget").value), walletId: s.$("#glW").value, deadline: s.$("#glDl").value || "" };
    if (!data.walletId) data.saved = C.parseNominal(s.$("#glSaved").value);
    if (!data.name) return C.toast("Isi nama target.", "warn");
    if (!data.target) return C.toast("Isi jumlah target.", "warn");
    try { await C.D.saveItem("goals", g ? { id: g.id, ...data } : data); s.close(); C.toast("Target disimpan ✓", "success"); }
    catch (err) { C.toast(C.friendlyError(err), "error"); }
  });
}

function depositSheet(g, sign) {
  if (!g) return;
  const s = C.openSheet({
    title: sign > 0 ? `Setor ke ${g.name}` : `Tarik dari ${g.name}`,
    body: `<div class="field"><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="dpAmt" inputmode="numeric" placeholder="0" autofocus></div>
      <span class="hint">Hanya mencatat progres target. Jika uangnya berpindah rekening, catat juga lewat "Pindah Dana".</span></div>
      <button class="btn btn-primary btn-block" id="dpSave">${sign > 0 ? "Setor" : "Tarik"}</button>`,
  });
  s.$("#dpAmt").oninput = e => { e.target.value = C.formatNominalInput(e.target.value); };
  s.$("#dpSave").onclick = e => C.busy(e.currentTarget, async () => {
    const v = C.parseNominal(s.$("#dpAmt").value);
    if (!v) return C.toast("Isi nominal.", "warn");
    if (sign < 0 && v > (Number(g.saved) || 0)) return C.toast("Melebihi jumlah yang terkumpul.", "warn");
    await C.D.goalDeposit(g, sign * v); s.close();
    const p = goalProgress({ ...g, saved: (Number(g.saved) || 0) + sign * v });
    C.toast(p.done ? `🎉 Target ${g.name} tercapai!` : `${sign > 0 ? "Setor" : "Tarik"} ${C.rupiah(v)} ✓`, "success");
  });
}

/* ═══════════ UTANG-PIUTANG ═══════════ */
function debtsHtml() {
  const all = C.state.debts.map(d => ({ d, st: debtStatus(d) }));
  const open = all.filter(x => !x.st.settled).sort((a, b) => (a.st.days ?? 9999) - (b.st.days ?? 9999));
  const done = all.filter(x => x.st.settled);
  const tot = k => open.filter(x => x.d.kind === k).reduce((a, x) => a + x.st.remaining, 0);
  const row = ({ d, st }) => `<div class="plan-row" data-pl="debt" data-id="${C.esc(d.id)}">
    <div class="trx-ico ${d.kind === "utang" ? "expense" : "income"}">${d.kind === "utang" ? "💸" : "🤝"}</div>
    <div class="trx-main"><div class="trx-title">${C.esc(d.person)}</div>
      <div class="trx-sub">${d.kind === "utang" ? "Kita berutang" : "Meminjam ke kita"}${d.note ? " · " + C.esc(d.note) : ""}</div>
      <div style="margin-top:4px">${st.settled ? `<span class="pill ok">✓ Lunas</span>` : st.overdue ? `<span class="pill bad">Lewat ${-st.days} hari</span>` : st.days != null ? `<span class="pill ${st.days <= 3 ? "warn" : "info"}">${st.days === 0 ? "Hari ini" : st.days + " hari lagi"}</span>` : ""}</div></div>
    <div class="plan-end"><b class="num" style="color:var(--${d.kind === "utang" ? "expense" : "income"})">${C.money(st.settled ? st.amount : st.remaining)}</b>${st.paid && !st.settled ? `<small class="faint">dari ${C.money(st.amount)}</small>` : ""}</div>
  </div>`;
  return `
    <section class="card" style="margin-bottom:14px">
      <div class="card-head"><h2>Utang & piutang</h2><button class="btn btn-primary btn-sm" data-pl="addDebt">${C.icon("plus")} Catat</button></div>
      <div class="sum-row" style="grid-template-columns:1fr 1fr;margin:0">
        <div class="sum-box"><small>💸 Kita berutang</small><b style="color:var(--expense)">${C.money(tot("utang"))}</b></div>
        <div class="sum-box"><small>🤝 Dipinjam orang</small><b style="color:var(--income)">${C.money(tot("piutang"))}</b></div>
      </div>
    </section>
    ${open.length ? `<section class="card plan-list">${open.map(row).join("")}</section>` : `<div class="empty"><div class="e-ico">🕊️</div>Tidak ada utang-piutang berjalan.</div>`}
    ${done.length ? `<div class="set-group" style="margin-top:14px"><h3>Sudah lunas (${done.length})</h3><section class="card plan-list">${done.slice(0, 10).map(row).join("")}</section></div>` : ""}`;
}

function debtSheet() {
  const ws = C.activeWallets();
  let kind = "piutang";
  const s = C.openSheet({
    title: "Catat utang / piutang",
    body: `
      <div class="seg" id="dbKind"><button data-k="piutang" class="active">🤝 Kita meminjamkan</button><button data-k="utang">💸 Kita meminjam</button></div>
      <div class="field"><label for="dbPerson" id="dbPersonLbl">Dipinjam oleh</label><input class="input" id="dbPerson" maxlength="60" placeholder="Nama orang" autofocus></div>
      <div class="field"><label for="dbAmt">Jumlah</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="dbAmt" inputmode="numeric" placeholder="0" style="font-size:22px;min-height:54px"></div></div>
      <div class="row-2">
        <div class="field"><label for="dbDue">Jatuh tempo (opsional)</label><input class="input" type="date" id="dbDue"></div>
        <div class="field"><label for="dbW" id="dbWLbl">Uang keluar dari</label><select class="input select" id="dbW"><option value="">— Tidak ubah saldo —</option>${ws.map(w => `<option value="${C.esc(w.id)}">${C.walletIcon(w.type)} ${C.esc(C.walletLabel(w))}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label for="dbNote">Catatan (opsional)</label><input class="input" id="dbNote" maxlength="120" placeholder="Contoh: untuk biaya servis motor"></div>
      <p class="hint" style="margin-top:-4px">Jika dompet dipilih, saldonya ikut disesuaikan — tidak dihitung sebagai pemasukan/pengeluaran.</p>
      <button class="btn btn-primary btn-block" id="dbSave">Simpan</button>`,
  });
  s.$("#dbKind").onclick = e => {
    const x = e.target.closest("[data-k]"); if (!x) return; kind = x.dataset.k;
    s.$$("#dbKind button").forEach(y => y.classList.toggle("active", y === x));
    s.$("#dbPersonLbl").textContent = kind === "utang" ? "Meminjam dari" : "Dipinjam oleh";
    s.$("#dbWLbl").textContent = kind === "utang" ? "Uang masuk ke" : "Uang keluar dari";
  };
  s.$("#dbAmt").oninput = e => { e.target.value = C.formatNominalInput(e.target.value); };
  s.$("#dbSave").onclick = e => C.busy(e.currentTarget, async () => {
    const d = { kind, person: s.$("#dbPerson").value.trim(), amount: C.parseNominal(s.$("#dbAmt").value), due: s.$("#dbDue").value || "", note: s.$("#dbNote").value.trim() };
    if (!d.person) return C.toast("Isi nama orang.", "warn");
    if (!d.amount) return C.toast("Isi jumlah.", "warn");
    try { await C.D.createDebt(d, s.$("#dbW").value); s.close(); C.toast("Tercatat ✓", "success"); }
    catch (err) { C.toast(C.friendlyError(err), "error"); }
  });
}

function debtDetail(d) {
  if (!d) return;
  const st = debtStatus(d);
  const ws = C.activeWallets();
  const pays = [...(d.payments || [])].sort((a, b) => b.at - a.at);
  const s = C.openSheet({
    title: d.kind === "utang" ? `Utang ke ${d.person}` : `Piutang ${d.person}`,
    body: `
      <div class="detail-amount"><div class="muted">${st.settled ? "Lunas" : "Sisa"}</div><div class="big">${C.money(st.settled ? st.amount : st.remaining)}</div>
        ${!st.settled && st.paid ? `<div class="hint">Sudah dibayar ${C.money(st.paid)} dari ${C.money(st.amount)}</div>` : ""}</div>
      <div class="progress"><i style="width:${st.pct.toFixed(1)}%"></i></div>
      <div class="kv" style="margin-top:12px">
        <div><span>Jenis</span><b>${d.kind === "utang" ? "Kita meminjam" : "Kita meminjamkan"}</b></div>
        ${d.due ? `<div><span>Jatuh tempo</span><b>${C.esc(C.fmtDate(new Date(d.due + "T00:00:00")))}</b></div>` : ""}
        ${d.note ? `<div><span>Catatan</span><b>${C.esc(d.note)}</b></div>` : ""}
        ${pays.map(p => `<div><span>${C.esc(C.fmtDate(new Date(p.at)))}</span><b class="num">${C.money(p.amount)}</b></div>`).join("")}
      </div>
      ${!st.settled ? `
        <div class="field"><label for="ddAmt">${d.kind === "utang" ? "Bayar cicilan/pelunasan" : "Terima pembayaran"}</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="ddAmt" inputmode="numeric" value="${C.formatNominalInput(st.remaining)}" style="font-size:22px;min-height:54px"></div></div>
        <div class="field"><label for="ddW">${d.kind === "utang" ? "Dibayar dari" : "Masuk ke"}</label><select class="input select" id="ddW"><option value="">— Tidak ubah saldo —</option>${ws.map(w => `<option value="${C.esc(w.id)}">${C.walletIcon(w.type)} ${C.esc(C.walletLabel(w))}</option>`).join("")}</select></div>
        <button class="btn btn-primary btn-block" id="ddPay" style="margin-bottom:10px">Catat pembayaran</button>` : ""}
      <button class="btn btn-danger btn-block btn-sm" id="ddDel">${C.icon("trash")} Hapus catatan</button>`,
  });
  s.$("#ddAmt")?.addEventListener("input", e => { e.target.value = C.formatNominalInput(e.target.value); });
  s.$("#ddPay")?.addEventListener("click", e => C.busy(e.currentTarget, async () => {
    const v = C.parseNominal(s.$("#ddAmt").value);
    if (!v) return C.toast("Isi nominal.", "warn");
    if (v > st.remaining) return C.toast(`Melebihi sisa ${C.rupiah(st.remaining)}.`, "warn");
    await C.D.debtPayment(d, v, s.$("#ddW").value); s.close();
    C.toast(v >= st.remaining ? "🎉 Lunas!" : `Pembayaran ${C.rupiah(v)} tercatat`, "success");
  }));
  s.$("#ddDel").onclick = async () => {
    if (!(await C.confirmDialog({ title: "Hapus catatan?", message: "Catatan utang-piutang dihapus. Penyesuaian saldo yang sudah tercatat tetap ada di Riwayat.", okText: "Hapus", danger: true }))) return;
    await C.D.deleteItem("debts", d.id); s.close(); C.toast("Dihapus", "success");
  };
}
