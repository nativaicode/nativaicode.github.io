/* ═══════════ Keuangan Nativan — app.js ═══════════ */
import * as D from "./data.js";
import { state, subscribe, errorBus, budgetFor, payday } from "./data.js";
import {
  esc, rupiah, rupiahShort, parseNominal, formatNominalInput, periodOf, daysLeft, summarize, fmtDate, fmtTime,
  dayKey, dayLabel, toLocalInput, catIcon, walletIcon, WALLET_TYPES, TYPE_LABEL, uid as makeId, DEFAULT_CATEGORIES,
} from "./util.js";
import { icon, GOOGLE_SVG, toast, openSheet, confirmDialog, busy, friendlyError } from "./ui.js";
import { APP_NAME, APP_VERSION, VAPID_KEY } from "./config.js";
import { computeInsights } from "./insights.js";
import { installPlan, sortedBills, billRow, openBillPay } from "./plan.js";
import { setupLock, lockSettingsSheet, lockConfigured } from "./lock.js";
import { shareReport } from "./report.js";
import { pushSupported, enableDailyReminder, disableDailyReminder, dailyReminderOn, saveMemberNotif } from "./push.js";
import { passesMemberPref, buildActivityMessage } from "./reminder-logic.js";
import { parseUtterance, parseReceipt, mergeReceipts, guessCategory, guessItemCategory, splitByCategory, groupItems, memoryKeys } from "./nlp.js";
import { voiceSupported, listenOnce } from "./voice.js";
import { compressImage, dataUrlKB } from "./image.js";

const $ = (s, r = document) => r.querySelector(s);
const appEl = document.getElementById("app");

/* ─── Preferensi lokal ─── */
const pref = {
  get(k, d) { try { const v = localStorage.getItem("kn_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kn_" + k, JSON.stringify(v)); } catch { /* abaikan */ } },
};
function applyTheme() {
  const t = pref.get("theme", "auto");
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
const hidden = () => pref.get("hide", false);
const money = (n, o) => `<span class="num ${hidden() ? "blur" : ""}">${esc(rupiah(n, o))}</span>`;

/* ─── Data helper ─── */
const S = () => state.household?.settings || {};
const allWallets = () => S().wallets || [];
const activeWallets = () => allWallets().filter(w => !w.archived);
const walletById = id => allWallets().find(w => w.id === id);
const walletLabel = w => w ? (w.owner ? `${w.name} (${w.owner})` : w.name) : "(dompet dihapus)";
const walletName = id => walletLabel(walletById(id));
const walletOwner = id => walletById(id)?.owner || "";
const balance = id => Number(state.household?.balances?.[id]) || 0;
const myNick = () => state.household?.memberInfo?.[state.user?.uid]?.nick || "";
/** Kepemilikan = daftar di pengaturan + nama panggilan setiap anggota */
const owners = () => {
  const base = S().owners?.length ? S().owners : [];
  const nicks = (state.household?.members || []).map(m => state.household?.memberInfo?.[m]?.nick).filter(Boolean);
  const all = [...new Set([...base, ...nicks])];
  return all.length ? all : ["Saya"];
};
const cats = type => (S().categories?.[type]?.length ? S().categories[type] : DEFAULT_CATEGORIES[type]);
const memberName = u => { const i = state.household?.memberInfo?.[u]; return i?.nick || i?.name || "Anggota"; };
const firstName = n => String(n || "").split(" ")[0];
const isOwner = () => state.household?.ownerId === state.user?.uid;

function trxTitle(t) {
  if (t.type === "transfer") return `${walletName(t.walletId)} → ${walletName(t.toWalletId)}`;
  if (t.type === "adjust") return t.category && t.category !== "Penyesuaian Saldo" ? t.category : "Penyesuaian saldo";
  return t.category || TYPE_LABEL[t.type];
}
function trxIcon(t) {
  if (t.type === "transfer") return "🔄";
  if (t.type === "adjust") return t.category === "Utang" ? "💸" : t.category === "Piutang" ? "🤝" : "⚖️";
  return catIcon(t.category);
}
function trxAmount(t) {
  if (t.type === "income") return `<span class="trx-amt income">${money(t.amount, { sign: true })}</span>`;
  if (t.type === "expense") return `<span class="trx-amt expense">${money(-t.amount)}</span>`;
  if (t.type === "adjust") return `<span class="trx-amt adjust">${money(t.amount, { sign: true })}</span>`;
  return `<span class="trx-amt transfer">${money(t.amount)}</span>`;
}
function trxRow(t) {
  const sub = [];
  if (t.type === "income" || t.type === "expense") sub.push(walletName(t.walletId));
  if (t.type === "transfer") {
    const autoFrom = t.owner === walletOwner(t.walletId), autoTo = (t.toOwner || t.owner) === walletOwner(t.toWalletId);
    if (!(autoFrom && autoTo) && t.owner) sub.push(t.toOwner && t.toOwner !== t.owner ? `${t.owner} → ${t.toOwner}` : t.owner);
  } else if (t.owner && t.type !== "adjust" && t.owner !== walletOwner(t.walletId)) sub.push(t.owner);
  if (t.note && t.type !== "adjust") sub.push(t.note);
  if (t.type === "adjust") { sub.push(walletName(t.walletId)); if (t.note && t.category !== "Penyesuaian Saldo") sub.push(t.note); }
  return `<button class="trx-item" data-trx="${esc(t.id)}">
    <div class="trx-ico ${t.type}">${trxIcon(t)}</div>
    <div class="trx-main">
      <div class="trx-title">${esc(trxTitle(t))}${t.expenseType === "Tetap" ? '<span class="tag tetap">Tetap</span>' : ""}${t.hasProof ? '<span class="tag">📎</span>' : ""}</div>
      <div class="trx-sub">${fmtTime(t.date)}${sub.length ? " · " + esc(sub.join(" · ")) : ""}</div>
    </div>
    ${trxAmount(t)}
  </button>`;
}
function trxGrouped(list, { limit } = {}) {
  if (!list.length) return `<div class="empty"><div class="e-ico">🪹</div>Belum ada transaksi.</div>`;
  const items = limit ? list.slice(0, limit) : list;
  let html = "", cur = "";
  for (const t of items) {
    const k = dayKey(t.date);
    if (k !== cur) {
      cur = k;
      const day = items.filter(x => dayKey(x.date) === k);
      const net = day.reduce((a, x) => a + (x.type === "income" ? x.amount : x.type === "expense" ? -x.amount : 0), 0);
      html += `<div class="trx-day"><span>${esc(dayLabel(k))}</span><span class="num">${net ? money(net, { sign: true }) : ""}</span></div>`;
    }
    html += trxRow(t);
  }
  return `<div class="trx-list">${html}</div>`;
}
function findTrx(id) {
  return state.current.list.find(t => t.id === id) || state.view.list.find(t => t.id === id) || histCache.find(t => t.id === id);
}
let histCache = [];

/* ═══════════ ROOT RENDER ═══════════ */
let screen = null; // "boot" | "login" | "onboard" | "app"
let mountedView = null;

function render() {
  let next;
  if (!state.authReady) next = "boot";
  else if (!state.user) next = "login";
  else if (state.householdId === undefined) next = "boot";
  else if (state.householdId === null) next = "onboard";
  else if (!state.household) next = "boot";
  else next = "app";

  if (next !== screen) {
    screen = next;
    mountedView = null;
    if (next === "boot") appEl.innerHTML = `<div class="boot"><div class="boot-logo">N</div><div class="boot-text">Memuat data…</div></div>`;
    if (next === "login") renderLogin();
    if (next === "onboard") renderOnboard();
    if (next === "app") renderShell();
  }
  if (screen === "app") routeUpdate();
}
subscribe(render);
errorBus.add(err => toast(friendlyError(err), "error", 5000));
window.addEventListener("online", () => render());
window.addEventListener("offline", () => render());

/* ─── Login ─── */
function renderLogin() {
  appEl.innerHTML = `
  <div class="auth-wrap"><div class="auth-card">
    <div class="brand-logo">N</div>
    <h1>${esc(APP_NAME)}</h1>
    <p>Catatan keuangan keluarga yang rapi, aman, dan tersinkron di semua perangkat.</p>
    <ul class="feature-list">
      <li><span>🔒</span><span>Data hanya bisa diakses anggota keluargamu sendiri</span></li>
      <li><span>👨‍👩‍👧</span><span>Satu buku kas bersama, input dari HP masing-masing</span></li>
      <li><span>📶</span><span>Tetap bisa mencatat saat offline, sinkron otomatis</span></li>
      <li><span>📊</span><span>Budget per periode gajian & export ke Excel</span></li>
    </ul>
    <button class="btn-google" id="btnLogin">${GOOGLE_SVG}<span>Masuk dengan Google</span></button>
    ${D.USE_EMU ? `<button class="btn btn-ghost btn-block" style="margin-top:10px" id="btnEmu">Masuk (emulator)</button>` : ""}
    <div class="auth-foot">v${APP_VERSION} · <a href="privacy.html">Kebijakan Privasi</a></div>
  </div></div>`;
  $("#btnLogin").onclick = e => busy(e.currentTarget, async () => {
    try { await D.loginGoogle(); } catch (err) { toast(friendlyError(err), "error", 6000); }
  });
  $("#btnEmu")?.addEventListener("click", () => {
    const name = prompt("Nama pengguna emulator", "Hanif") || "Hanif";
    D.loginEmulator("uid-" + name.toLowerCase(), name.toLowerCase() + "@test.local", name).catch(e => toast(e.message, "error"));
  });
}

/* ─── Onboarding ─── */
function renderOnboard() {
  const name = state.user.displayName || "";
  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  appEl.innerHTML = `
  <div class="auth-wrap"><div class="auth-card" style="max-width:480px">
    <div class="brand-logo">N</div>
    <h1>Halo, ${esc(firstName(name) || "kamu")} 👋</h1>
    <p>Buat buku kas keluarga baru, atau gabung ke buku kas yang sudah dibuat pasanganmu.</p>
    <div class="onboard-grid">
      <div class="onboard-option">
        <h3>🏠 Buat rumah tangga baru</h3>
        <p class="muted">Kamu jadi pemilik dan bisa mengundang anggota lain.</p>
        <div class="field"><label for="obName">Nama rumah tangga</label><input class="input" id="obName" value="Keluarga ${esc(firstName(name))}" maxlength="40"></div>
        <div class="row-2">
          <div class="field"><label for="obOwner">Nama panggilanmu</label><input class="input" id="obOwner" value="${esc(firstName(name))}" maxlength="20"></div>
          <div class="field"><label for="obPay">Tanggal gajian</label><select class="input select" id="obPay">${days.map(d => `<option ${d === 25 ? "selected" : ""}>${d}</option>`).join("")}</select></div>
        </div>
        <button class="btn btn-primary btn-block" id="obCreate">Buat & Mulai</button>
      </div>
      <div class="onboard-option">
        <h3>🔑 Gabung dengan kode undangan</h3>
        <p class="muted">Minta kode 8 karakter dari menu Akun di HP anggota keluarga.</p>
        <div class="field"><label for="obNick">Nama panggilanmu</label><input class="input" id="obNick" value="${esc(firstName(name))}" maxlength="20" placeholder="Contoh: Ibun, Ayah"><span class="hint">Dipakai sebagai pemilik rekening & penanda siapa yang mencatat.</span></div>
        <div class="inline-add" style="margin-top:0"><input class="input" id="obCode" placeholder="Contoh: K7MP2QXA" maxlength="9" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.12em;font-weight:700"><button class="btn btn-primary" id="obJoin">Gabung</button></div>
      </div>
    </div>
    <button class="btn btn-ghost btn-block" style="margin-top:16px" id="obLogout">${icon("logout")} Keluar (${esc(state.user.email || "")})</button>
  </div></div>`;
  $("#obCreate").onclick = e => busy(e.currentTarget, async () => {
    try { await D.createHousehold({ name: $("#obName").value.trim(), paydayDay: $("#obPay").value, ownerName: $("#obOwner").value.trim() }); location.hash = "#/home"; toast("Rumah tangga dibuat 🎉", "success"); }
    catch (err) { toast(friendlyError(err), "error", 6000); }
  });
  $("#obJoin").onclick = e => busy(e.currentTarget, async () => {
    try { await D.joinHousehold($("#obCode").value, $("#obNick").value); location.hash = "#/home"; toast("Berhasil bergabung 🎉", "success"); }
    catch (err) { toast(friendlyError(err), "error", 6000); }
  });
  $("#obLogout").onclick = () => D.logout();
}

/* ═══════════ SHELL + ROUTER ═══════════ */
const NAV = [
  { id: "home", label: "Beranda", icon: "home" },
  { id: "history", label: "Riwayat", icon: "list" },
  { id: "stats", label: "Budget", icon: "chart" },
  { id: "plan", label: "Rencana", icon: "target" },
  { id: "settings", label: "Akun", icon: "user" },
];
const route = () => { const r = location.hash.replace(/^#\/?/, ""); return NAV.some(n => n.id === r) ? r : "home"; };

function avatarHtml(cls = "") {
  const u = state.user;
  return u.photoURL
    ? `<img class="avatar ${cls}" src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`
    : `<div class="avatar ${cls}">${esc((u.displayName || u.email || "?")[0].toUpperCase())}</div>`;
}

/** Tombol avatar → Akun (di HP; di desktop Akun ada di sidebar) */
const avatarLink = () => `<a href="#/settings" class="hide-desktop" aria-label="Akun">${avatarHtml()}</a>`;

function renderShell() {
  const r = route();
  const navBtn = n => `<button class="nav-item ${n.id === r ? "active" : ""}" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></button>`;
  appEl.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-logo">N</div><div><b>${esc(APP_NAME)}</b><small id="sbHh"></small></div></div>
      <button class="btn btn-primary side-add" data-act="add">${icon("plus")} Catat Transaksi</button>
      ${NAV.map(n => `<button class="side-item ${n.id === r ? "active" : ""}" data-nav="${n.id}">${icon(n.icon)}${n.label}</button>`).join("")}
      <div class="side-foot">${avatarHtml("sm")}<div class="who"><b>${esc(state.user.displayName || "")}</b><small>${esc(state.user.email || "")}</small></div></div>
    </aside>
    <main class="main" id="view"></main>
    <nav class="bottom-nav">
      ${navBtn(NAV[0])}${navBtn(NAV[1])}
      <button class="nav-fab" data-act="add" aria-label="Catat transaksi">${icon("plus")}</button>
      ${navBtn(NAV[2])}${navBtn(NAV[3])}
    </nav>
  </div>`;
  appEl.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => { location.hash = "#/" + b.dataset.nav; });
  appEl.querySelectorAll("[data-act=add]").forEach(b => b.onclick = () => trxForm());
}
/** Elemen #view baru tiap ganti halaman, supaya listener halaman lama tidak menumpuk */
function freshView() {
  const old = $("#view");
  const el = document.createElement("main");
  el.className = "main"; el.id = "view";
  old.replaceWith(el);
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-trx]");
    if (b) { const t = findTrx(b.dataset.trx); if (t) trxDetail(t); }
  });
  return el;
}
window.addEventListener("hashchange", () => { if (screen === "app") { mountedView = null; routeUpdate(); window.scrollTo(0, 0); } });

const VIEWS = {};
function routeUpdate() {
  const r = route();
  appEl.querySelectorAll("[data-nav]").forEach(b => b.classList.toggle("active", b.dataset.nav === r));
  const sb = $("#sbHh"); if (sb) sb.textContent = state.household?.name || "";
  const v = VIEWS[r];
  if (mountedView !== r) { mountedView = r; v.mount(freshView()); }
  v.update($("#view"));
}

function offlineBar() {
  if (navigator.onLine) return "";
  return `<div class="offline-bar">${icon("cloudoff", "")}<span>Sedang offline — transaksi tetap tersimpan dan akan tersinkron otomatis.</span></div>`;
}
function periodNav(id = "pn") {
  return `<div class="period-nav" id="${id}">
    <button class="icon-btn" data-pn="-1" aria-label="Periode sebelumnya">${icon("left")}</button>
    <b id="${id}Label"></b>
    <button class="icon-btn" data-pn="1" aria-label="Periode berikutnya">${icon("right")}</button>
  </div>`;
}
function bindPeriodNav(root, id = "pn") {
  root.querySelectorAll(`#${id} [data-pn]`).forEach(b => b.onclick = () => D.setViewOffset((state.view.offset || 0) + Number(b.dataset.pn)));
}
function updatePeriodNav(root, id = "pn") {
  const p = state.view.period;
  if (!p) return;
  $(`#${id}Label`, root).textContent = p.label + (state.view.offset === 0 ? " (berjalan)" : "");
  $(`#${id} [data-pn="1"]`, root).disabled = (state.view.offset || 0) >= 0;
}

/* ═══════════ VIEW: BERANDA ═══════════ */
VIEWS.home = {
  mount(el) {
    el.innerHTML = `
      <div class="topbar">
        <div><div class="sub" id="hGreet"></div><h1 id="hName"></h1></div>
        <div class="topbar-actions"><button class="icon-btn" id="hTheme" aria-label="Ganti tema"></button>${avatarLink()}</div>
      </div>
      <div id="hOffline"></div>
      <div class="grid grid-home">
        <div class="grid">
          <section class="card hero o1" id="hHero"></section>
          <section class="card o1b hidden" id="hQuick"><div class="card-head"><h2>⚡ Catat cepat</h2><button class="link-btn" id="hQuickEdit">Atur</button></div><div class="chips quick-chips" id="hQuickList"></div></section>
          <section class="card o1c hidden" id="hBills"><div class="card-head"><h2>🧾 Tagihan terdekat</h2><a class="link-btn" href="#/plan">Semua</a></div><div class="plan-list" id="hBillList"></div></section>
          <section class="card o3" id="hBudget"></section>
          <section class="card o4">
            <div class="card-head"><h2>Transaksi terbaru</h2><a class="link-btn" href="#/history">Lihat semua</a></div>
            <div id="hRecent"></div>
          </section>
        </div>
        <div class="grid">
          <section class="card o2b">
            <div class="card-head"><h2>💡 Insight keuangan</h2><a class="link-btn" href="#/stats" id="hInsMore"></a></div>
            <div id="hIns"></div>
          </section>
          <section class="card o2">
            <div class="card-head"><h2>Dompet & Rekening</h2><button class="link-btn" id="hAddWallet">+ Tambah</button></div>
            <div class="wallet-strip" id="hWallets"></div>
          </section>
          <section class="card o5">
            <div class="card-head"><h2>Pengeluaran per kategori</h2><a class="link-btn" href="#/stats">Detail</a></div>
            <div id="hCats"></div>
          </section>
        </div>
      </div>`;
    $("#hTheme", el).onclick = () => { const dark = document.documentElement.dataset.theme === "dark"; pref.set("theme", dark ? "light" : "dark"); applyTheme(); this.update(el); };
    $("#hAddWallet", el).onclick = () => walletSheet();
    $("#hQuickEdit", el).onclick = () => templatesSheet();
    $("#hQuickList", el).onclick = e => { const b = e.target.closest("[data-tpl]"); if (b) quickRecord(b.dataset.tpl); };
    el.addEventListener("click", e => {
      if (e.target.closest("[data-eye]")) { pref.set("hide", !hidden()); this.update(el); }
      const w = e.target.closest("[data-wallet]"); if (w) walletDetail(w.dataset.wallet);
      if (e.target.closest("[data-setbudget]")) budgetSheet(state.current.period);
      const pl = e.target.closest("[data-pl]");
      if (pl) { e.stopPropagation(); pref.set("planTab", "bills"); if (pl.dataset.pl === "pay") openBillPay(pl.dataset.id); else location.hash = "#/plan"; }
    });
  },
  update(el) {
    const h = new Date().getHours();
    $("#hGreet", el).textContent = (h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam") + ", " + firstName(state.user.displayName || "");
    $("#hName", el).textContent = state.household.name;
    $("#hTheme", el).innerHTML = icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon");
    $("#hOffline", el).innerHTML = offlineBar();

    const cur = state.current;
    const p = cur.period;
    const s = summarize(cur.list);
    const total = activeWallets().reduce((a, w) => a + balance(w.id), 0);
    $("#hHero", el).innerHTML = `
      <div class="label">Total saldo <button class="eye-btn" data-eye>${hidden() ? "Tampilkan" : "Sembunyikan"}</button></div>
      <div class="big">${money(total)}</div>
      <div class="hero-stats">
        <div class="hero-stat"><small>↓ Pemasukan</small><b>${money(s.income)}</b></div>
        <div class="hero-stat"><small>↑ Pengeluaran</small><b>${money(s.expense)}</b></div>
      </div>
      <div class="label" style="margin-top:12px;position:relative;z-index:1">📅 ${esc(p?.label || "")}</div>`;

    // Budget
    const bud = p ? budgetFor(p.key) : { amount: 0 };
    const bEl = $("#hBudget", el);
    if (!bud.amount) {
      bEl.innerHTML = `<div class="card-head"><h2>Budget periode ini</h2></div>
        <p class="muted" style="margin:0 0 12px">Belum ada budget. Tentukan batas pengeluaran rutin agar mendapat peringatan saat mendekati batas.</p>
        <button class="btn btn-primary btn-sm" data-setbudget>Atur budget</button>`;
    } else {
      const pct = (s.rutin / bud.amount) * 100;
      const sisa = bud.amount - s.rutin;
      const dl = daysLeft(p);
      const cls = pct >= 100 ? "w100" : pct >= 90 ? "w90" : pct >= 80 ? "w80" : "";
      const pill = pct >= 100 ? `<span class="pill bad">🚨 Habis</span>` : pct >= 80 ? `<span class="pill warn">⚠️ ${Math.round(pct)}%</span>` : `<span class="pill ok">Aman · ${Math.round(pct)}%</span>`;
      bEl.innerHTML = `<div class="card-head"><h2>Budget periode ini</h2>${pill}</div>
        <div class="budget-top"><div><div class="muted" style="font-size:12.5px">Sisa budget</div><div class="big ${sisa < 0 ? "" : ""}" style="${sisa < 0 ? "color:var(--expense)" : ""}">${money(sisa)}</div></div>
        <button class="link-btn" data-setbudget>Ubah</button></div>
        <div class="progress ${cls}"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
        <div class="budget-meta"><span>Terpakai ${money(s.rutin)} dari ${money(bud.amount)}</span><span>${dl} hari lagi${sisa > 0 && dl ? ` · ±${money(Math.floor(sisa / dl))}/hari` : ""}</span></div>
        ${s.tetap ? `<div class="hint" style="margin-top:8px">📌 Pengeluaran tetap (tidak masuk budget): ${money(s.tetap)}</div>` : ""}
        ${bud.inherited ? `<div class="hint" style="margin-top:4px">Memakai budget periode sebelumnya.</div>` : ""}`;
      budgetAlert(p, pct, sisa);
    }

    // Dompet
    const ws = activeWallets();
    $("#hWallets", el).innerHTML = ws.length ? ws.map(w => `
      <button class="wallet-chip" data-wallet="${esc(w.id)}">
        <div class="w-ico">${walletIcon(w.type)}</div>
        <div class="w-name">${esc(w.name)}${w.owner ? ` <span class="w-owner">${esc(w.owner)}</span>` : ""}</div>
        <div class="w-bal ${balance(w.id) < 0 ? "neg" : ""}">${money(balance(w.id))}</div>
      </button>`).join("") : `<div class="muted">Belum ada dompet.</div>`;

    // Catat cepat & tagihan terdekat
    const tpls = S().templates || [];
    $("#hQuick", el).classList.toggle("hidden", !tpls.length);
    $("#hQuickList", el).innerHTML = tpls.map(t => `<button class="chip quick-chip" data-tpl="${esc(t.id)}">${t.type === "income" ? "💰" : catIcon(t.category)} ${esc(t.label)} <span class="faint num">${esc(rupiahShort(t.amount))}</span></button>`).join("");
    const nb = sortedBills().filter(x => !(x.st.paidCurrent && x.st.state === "upcoming") && x.st.days <= 7).slice(0, 3);
    $("#hBills", el).classList.toggle("hidden", !nb.length);
    $("#hBillList", el).innerHTML = nb.map(x => billRow(x.b, x.st, { compact: true })).join("");

    // Insight
    const ins = currentInsights();
    $("#hIns", el).innerHTML = cur.ready ? insightList(ins.slice(0, 3)) : `<div class="skeleton"></div>`;
    $("#hInsMore", el).textContent = ins.length > 3 ? `Lihat semua (${ins.length})` : "";
    notifyInsights(ins);

    // Kategori
    $("#hCats", el).innerHTML = catBars(s.byCategory, 5);
    $("#hRecent", el).innerHTML = cur.ready ? trxGrouped(cur.list, { limit: 8 }) : `<div class="skeleton" style="margin:8px 0"></div><div class="skeleton" style="width:70%"></div>`;
  },
};

function catBars(byCat, limit = 99, budgets = {}) {
  const arr = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!arr.length) return `<div class="empty" style="padding:18px"><div class="e-ico">📭</div>Belum ada pengeluaran.</div>`;
  const max = arr[0][1];
  const total = arr.reduce((a, x) => a + x[1], 0);
  return `<div class="bars">${arr.slice(0, limit).map(([c, v]) => `
    <div class="bar-row"><div class="ico">${catIcon(c)}</div>
      <div><div class="name"><span>${esc(c)}</span><span class="faint">${Math.round(v / total * 100)}%</span></div><div class="track"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>
      <div class="val">${money(v)}</div></div>`).join("")}</div>`;
}

/* ─── Insight keuangan ─── */
function currentInsights() {
  const cur = state.current;
  if (!cur.ready || !cur.period) return [];
  D.loadPrevSummaries();
  return computeInsights({
    period: cur.period, list: cur.list, budget: budgetFor(cur.period.key).amount,
    prev: state.prev.list, wallets: allWallets(), balances: state.household?.balances || {}, now: new Date(),
    bills: state.bills, debts: state.debts, catBudgets: state.household?.catBudgets || {},
  });
}
const LEVEL_CLASS = { bad: "bad", warn: "warn", info: "info", good: "ok" };
function insightList(items) {
  if (!items.length) return `<div class="empty" style="padding:16px"><div class="e-ico">🧘</div>Belum ada catatan khusus. Keuangan periode ini terlihat wajar.</div>`;
  return `<div class="insights">${items.map(x => `
    <div class="insight lv-${x.level}">
      <div class="in-ico">${x.icon}</div>
      <div><div class="in-title">${esc(x.title)}</div><div class="in-text">${esc(x.text)}</div></div>
    </div>`).join("")}</div>`;
}
/** Notifikasi insight: hanya yang baru & penting, maks. 1 per 12 jam (kecuali level "bad") */
function notifyInsights(items) {
  if (!state.prev.key) return; // tunggu data pembanding agar tidak berubah-ubah
  const seen = new Set(pref.get("seenIns", []));
  const fresh = items.filter(x => (x.level === "bad" || x.level === "warn") && !seen.has(x.id));
  if (!fresh.length) return;
  const top = fresh[0];
  const last = pref.get("lastInsNotif", 0);
  if (top.level !== "bad" && Date.now() - last < 12 * 3600e3) return;
  fresh.forEach(x => seen.add(x.id));
  pref.set("seenIns", [...seen].slice(-200));
  pref.set("lastInsNotif", Date.now());
  if (pref.get("notif", false) && "Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker?.ready.then(r => r.showNotification(`${top.icon} ${top.title}`, { body: top.text, icon: "assets/icons/icon-192.png", tag: "insight" })).catch(() => {});
  } else {
    toast(`${top.icon} ${top.title}`, top.level === "bad" ? "error" : "warn", 6000);
  }
}

/* ─── Budget per kategori ─── */
function catBudgetBars(list) {
  const lim = state.household?.catBudgets || {};
  const spent = {};
  for (const t of list) if (t.type === "expense") spent[t.category || "Lainnya"] = (spent[t.category || "Lainnya"] || 0) + t.amount;
  const rows = Object.entries(lim).filter(([, v]) => v > 0).map(([c, v]) => ({ c, v, s: spent[c] || 0 })).sort((a, b) => b.s / b.v - a.s / a.v);
  if (!rows.length) return `<p class="muted" style="margin:0">Belum ada. Atur batas per kategori (mis. Makan & Minum Rp 1,5 jt, Hiburan Rp 300 rb) agar tahu kategori mana yang paling boros.</p>`;
  return `<div class="bars cat-budget">${rows.map(r => {
    const pct = r.s / r.v * 100, cls = pct >= 100 ? "w100" : pct >= 90 ? "w90" : pct >= 80 ? "w80" : "";
    return `<div class="bar-row"><div class="ico">${catIcon(r.c)}</div>
      <div><div class="name"><span>${esc(r.c)}</span><span class="faint">${money(r.s)} / ${money(r.v)}</span></div>
      <div class="progress ${cls}" style="height:8px;margin:5px 0 0"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div></div>
      <div class="val" style="color:${pct >= 100 ? "var(--expense)" : "inherit"}">${pct >= 100 ? "Lebih " + money(r.s - r.v) : "Sisa " + money(r.v - r.s)}</div></div>`;
  }).join("")}</div>`;
}
function catBudgetSheet() {
  const lim = { ...(state.household?.catBudgets || {}) };
  const cs = cats("expense");
  const s = openSheet({
    title: "Budget per kategori",
    body: `<p class="muted" style="margin-top:0">Batas per periode gajian. Kosongkan kategori yang tidak ingin dibatasi. Berlaku untuk semua pengeluaran (rutin & tetap) di kategori tsb.</p>
      <div class="cb-list">${cs.map((c, i) => `<div class="cb-row"><span>${catIcon(c)} ${esc(c)}</span><div class="amount-wrap"><span style="font-size:13px;left:10px">Rp</span><input class="input num" data-cb="${i}" inputmode="numeric" placeholder="—" value="${lim[c] ? formatNominalInput(lim[c]) : ""}" style="padding-left:36px;text-align:right"></div></div>`).join("")}</div>
      <div class="hint" id="cbTotal" style="margin:10px 0 14px"></div>
      <button class="btn btn-primary btn-block" id="cbSave">Simpan</button>`,
  });
  const total = () => { const t = s.$$("[data-cb]").reduce((a, x) => a + parseNominal(x.value), 0); s.$("#cbTotal").textContent = t ? `Total batas: ${rupiah(t)}` : ""; };
  s.$$("[data-cb]").forEach(x => x.oninput = () => { x.value = formatNominalInput(x.value); total(); });
  total();
  s.$("#cbSave").onclick = e => busy(e.currentTarget, async () => {
    const map = {};
    s.$$("[data-cb]").forEach(x => { const v = parseNominal(x.value); if (v) map[cs[+x.dataset.cb]] = v; });
    try { await D.setCatBudgets(map); s.close(); toast("Budget kategori disimpan ✓", "success"); } catch (err) { toast(friendlyError(err), "error"); }
  });
}

/* ─── Laporan (gambar) ─── */
async function makeReport() {
  const p = state.view.period, list = state.view.list;
  const sm = summarize(list);
  const ins = (state.view.offset || 0) === 0 ? currentInsights() : [];
  try {
    const r = await shareReport({
      household: state.household.name, period: p, summary: sm, budget: budgetFor(p.key).amount,
      insights: ins.slice(0, 3), balance: activeWallets().reduce((a, w) => a + balance(w.id), 0),
    });
    toast(r === "shared" ? "Laporan dibagikan ✓" : "Laporan diunduh ✓", "success");
  } catch (err) { if (err?.name !== "AbortError") toast("Gagal membuat laporan: " + (err?.message || err), "error"); }
}

/* ─── Template catat cepat ─── */
async function quickRecord(id) {
  const t = (S().templates || []).find(x => x.id === id);
  if (!t) return;
  const w = walletById(t.walletId);
  if (!w || w.archived) return toast("Dompet template tidak ada lagi — atur ulang template.", "warn");
  const data = { ...t, date: new Date(), note: t.note || "", owner: walletOwner(t.walletId) || myNick() || owners()[0] };
  try {
    const r = await D.addTransaction(data);
    toast(`${t.label} ${rupiah(t.amount)} tercatat${r.offline ? " (offline)" : ""}`, "success", 6000, {
      label: "Batalkan", fn: async () => {
        const hit = state.current.list.find(x => x.type === t.type && x.amount === t.amount && x.category === t.category && x.walletId === t.walletId && Date.now() - x.date < 120000);
        if (hit) { await D.deleteTransaction(hit); toast("Dibatalkan", "info"); }
      },
    });
  } catch (err) { toast(friendlyError(err), "error"); }
}
function templatesSheet() {
  const list = [...(S().templates || [])];
  const s = openSheet({
    title: "Template catat cepat",
    body: `<p class="muted" style="margin-top:0">Template dipakai untuk mencatat transaksi yang sering dengan 1 ketukan dari Beranda. Buat template dari form <b>Catat transaksi</b> → "☆ Simpan sebagai template".</p>
      <div class="set-list" id="tpList"></div>`,
  });
  const draw = () => {
    s.$("#tpList").innerHTML = list.length ? list.map((t, i) => `<div class="set-item"><div class="si-ico">${t.type === "income" ? "💰" : catIcon(t.category)}</div><div class="si-main"><b>${esc(t.label)}</b><small>${esc(TYPE_LABEL[t.type])} · ${esc(rupiah(t.amount))} · ${esc(walletName(t.walletId))}</small></div><button class="icon-btn" data-del="${i}" aria-label="Hapus">${icon("trash")}</button></div>`).join("")
      : `<div class="empty" style="padding:18px">Belum ada template.</div>`;
  };
  draw();
  s.$("#tpList").onclick = async e => { const b = e.target.closest("[data-del]"); if (!b) return; list.splice(+b.dataset.del, 1); draw(); await D.setTemplates(list); toast("Template dihapus", "success"); };
}

/* ─── Notifikasi transaksi anggota lain ─── */
// A. Realtime saat aplikasi terbuka / baru diminimize
D.activityBus.add(items => {
  const pref = D.memberNotifPref();
  const list = items.filter(t => passesMemberPref(t, pref));
  if (!list.length) return;
  const msg = buildActivityMessage(list, state.household?.memberInfo || {}, walletName);
  if (!document.hidden) toast(`👥 ${msg.title}: ${msg.body.split("\n")[0].replace(/^\S+\s/, "")}`, "info", 6000);
  else if ("Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker?.ready.then(r => r.showNotification(`👥 ${msg.title}`, { body: msg.body, icon: "assets/icons/icon-192.png", tag: "activity", renotify: true, data: { url: "./#/history" } })).catch(() => {});
  }
});
function memberNotifSheet() {
  const cur = D.memberNotifPref();
  return new Promise(resolve => {
    const s = openSheet({
      title: "Notifikasi transaksi anggota",
      onClose: resolve,
      body: `<p class="muted" style="margin-top:0">Dapat kabar saat anggota lain mencatat transaksi. Saat aplikasi terbuka muncul langsung; saat tertutup dikirim berkala (±15–30 menit). Transaksimu sendiri tidak dikirim ke HP-mu.</p>
        <div class="set-list" style="margin-bottom:12px">
          ${[["all", "🔔 Semua transaksi", "Pengeluaran, pemasukan & pindah dana"], ["min", "💸 Hanya pengeluaran besar", "Di atas nominal tertentu"], ["off", "🔕 Mati", ""]].map(([k, t, d]) => `<label class="set-item" style="cursor:pointer"><input type="radio" name="mn" value="${k}" ${cur.mode === k ? "checked" : ""}><div class="si-main"><b>${t}</b>${d ? `<small>${d}</small>` : ""}</div></label>`).join("")}
        </div>
        <div class="field" id="mnMinWrap"><label for="mnMin">Minimal pengeluaran</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="mnMin" inputmode="numeric" value="${formatNominalInput(cur.min || 100000)}" style="font-size:20px;min-height:50px"></div></div>
        <button class="btn btn-primary btn-block" id="mnSave">Simpan</button>`,
    });
    const sync = () => s.$("#mnMinWrap").classList.toggle("hidden", s.$("input[name=mn]:checked").value !== "min");
    s.$$("input[name=mn]").forEach(r => r.onchange = sync); sync();
    s.$("#mnMin").oninput = e => { e.target.value = formatNominalInput(e.target.value); };
    s.$("#mnSave").onclick = e => busy(e.currentTarget, async () => {
      const pref = { mode: s.$("input[name=mn]:checked").value, min: parseNominal(s.$("#mnMin").value) || 100000 };
      try {
        const r = await saveMemberNotif(pref);
        s.close();
        toast(pref.mode === "off" ? "Notifikasi anggota dimatikan" : r.pushOk ? "Notifikasi anggota aktif ✓" : "Aktif saat aplikasi terbuka. Untuk saat tertutup, izinkan notifikasi di HP ini.", r.pushOk || pref.mode === "off" ? "success" : "warn", 6000);
      } catch (err) { toast(friendlyError(err), "error"); }
    });
  });
}

/* Peringatan budget 80/90/100% (sekali per level per periode) */
function budgetAlert(p, pct, sisa) {
  if (!state.current.ready) return;
  const level = pct >= 100 ? 100 : pct >= 90 ? 90 : pct >= 80 ? 80 : 0;
  const key = "alert_" + state.householdId + "_" + p.key;
  const prev = pref.get(key, 0);
  if (level > prev) {
    pref.set(key, level);
    const title = level >= 100 ? "🚨 Budget periode ini habis" : `⚠️ Budget sudah terpakai ${level}%`;
    const body = level >= 100 ? `Lebih ${rupiah(-sisa)} dari budget.` : `Sisa ${rupiah(sisa)}.`;
    toast(`${title} — ${body}`, level >= 100 ? "error" : "warn", 7000);
    if (pref.get("notif", false) && "Notification" in window && Notification.permission === "granted") {
      navigator.serviceWorker?.ready.then(r => r.showNotification(title, { body, icon: "assets/icons/icon-192.png", tag: "budget" })).catch(() => {});
    }
  } else if (level < prev) pref.set(key, level);
}

/* ═══════════ VIEW: RIWAYAT ═══════════ */
const hf = { q: "", type: "all", wallet: "", cat: "", owner: "" };
VIEWS.history = {
  mount(el) {
    el.innerHTML = `
      <div class="topbar"><div><h1>Riwayat</h1><div class="sub">Semua transaksi per periode</div></div>
        <div class="topbar-actions">${avatarLink()}<button class="btn btn-ghost btn-sm" id="hsExport">${icon("download")} <span class="hide-mobile">Export</span> Excel</button></div></div>
      <div id="hsOffline"></div>
      ${periodNav("pn")}
      <div class="toolbar">
        <div class="search">${icon("search")}<input class="input" id="hsQ" type="search" placeholder="Cari catatan, kategori, nominal…" value="${esc(hf.q)}"></div>
        <div class="chips" id="hsType">${[["all", "Semua"], ["expense", "Keluar"], ["income", "Masuk"], ["transfer", "Transfer"]].map(([k, l]) => `<button class="chip ${hf.type === k ? "active" : ""}" data-type="${k}">${l}</button>`).join("")}</div>
        <select class="input select" id="hsWallet"></select>
        <select class="input select" id="hsCat"></select>
      </div>
      <div class="sum-row" id="hsSum"></div>
      <section class="card" style="padding:8px 10px"><div id="hsList"></div></section>`;
    bindPeriodNav(el);
    $("#hsQ", el).oninput = e => { hf.q = e.target.value; this.list(el); };
    $("#hsType", el).onclick = e => { const b = e.target.closest("[data-type]"); if (!b) return; hf.type = b.dataset.type; el.querySelectorAll("#hsType .chip").forEach(c => c.classList.toggle("active", c === b)); this.list(el); };
    $("#hsWallet", el).onchange = e => { hf.wallet = e.target.value; this.list(el); };
    $("#hsCat", el).onchange = e => { hf.cat = e.target.value; this.list(el); };
    $("#hsExport", el).onclick = () => exportSheet();
  },
  update(el) {
    $("#hsOffline", el).innerHTML = offlineBar();
    updatePeriodNav(el);
    const ws = allWallets();
    $("#hsWallet", el).innerHTML = `<option value="">Semua dompet</option>` + ws.map(w => `<option value="${esc(w.id)}" ${hf.wallet === w.id ? "selected" : ""}>${esc(walletLabel(w))}${w.archived ? " (arsip)" : ""}</option>`).join("");
    const cs = [...new Set([...cats("expense"), ...cats("income"), ...state.view.list.map(t => t.category).filter(Boolean)])];
    $("#hsCat", el).innerHTML = `<option value="">Semua kategori</option>` + cs.map(c => `<option ${hf.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("");
    this.list(el);
  },
  list(el) {
    const q = hf.q.trim().toLowerCase();
    const qNum = parseNominal(q);
    let list = state.view.list.filter(t => {
      if (hf.type !== "all" && (hf.type === "transfer" ? !["transfer", "adjust"].includes(t.type) : t.type !== hf.type)) return false;
      if (hf.wallet && t.walletId !== hf.wallet && t.toWalletId !== hf.wallet) return false;
      if (hf.cat && t.category !== hf.cat) return false;
      if (q) {
        const hay = [t.category, t.note, t.owner, t.toOwner, walletName(t.walletId), t.toWalletId ? walletName(t.toWalletId) : "", TYPE_LABEL[t.type], ...(t.items || []).map(i => i.n)].join(" ").toLowerCase();
        if (!hay.includes(q) && !(qNum && String(t.amount).includes(String(qNum)))) return false;
      }
      return true;
    });
    histCache = list;
    const s = summarize(list);
    $("#hsSum", el).innerHTML = `
      <div class="sum-box"><small>Masuk</small><b style="color:var(--income)">${money(s.income)}</b></div>
      <div class="sum-box"><small>Keluar</small><b style="color:var(--expense)">${money(s.expense)}</b></div>
      <div class="sum-box"><small>Selisih</small><b>${money(s.income - s.expense)}</b></div>`;
    $("#hsList", el).innerHTML = state.view.ready ? trxGrouped(list) : `<div style="padding:12px"><div class="skeleton"></div></div>`;
  },
};

/* ═══════════ VIEW: BUDGET & STATISTIK ═══════════ */
let trendCache = { key: "", data: null, loading: false };
VIEWS.stats = {
  mount(el) {
    el.innerHTML = `
      <div class="topbar"><div><h1>Budget & Statistik</h1><div class="sub">Pantau batas pengeluaran per periode gajian</div></div>
        <div class="topbar-actions">${avatarLink()}<button class="btn btn-ghost btn-sm" id="stReport">📄 <span class="hide-mobile">Bagikan</span> Laporan</button></div></div>
      ${periodNav("pn")}
      <div class="grid grid-2" style="margin-top:12px">
        <section class="card span-2" id="stIns"><div class="card-head"><h2>💡 Analisis & saran</h2></div><div id="stInsBody"></div></section>
        <section class="card" id="stBudget"></section>
        <section class="card" id="stSplit"></section>
        <section class="card span-2"><div class="card-head"><h2>🎯 Budget per kategori</h2><button class="btn btn-sm btn-ghost" id="stCatBudEdit">${icon("edit")} Atur</button></div><div id="stCatBud"></div></section>
        <section class="card"><div class="card-head"><h2>Pengeluaran per kategori</h2></div><div id="stCats"></div></section>
        <section class="card"><div class="card-head"><h2>Pengeluaran per kepemilikan</h2></div><div id="stOwners"></div></section>
        <section class="card span-2">
          <div class="card-head"><h2>Tren 6 periode</h2><div class="legend"><span><i style="background:var(--income)"></i>Masuk</span><span><i style="background:var(--expense)"></i>Keluar</span></div></div>
          <div id="stTrend"></div>
        </section>
      </div>`;
    bindPeriodNav(el);
    el.addEventListener("click", e => { if (e.target.closest("[data-setbudget]")) budgetSheet(state.view.period); });
    $("#stCatBudEdit", el).onclick = () => catBudgetSheet();
    $("#stReport", el).onclick = e => busy(e.currentTarget, () => makeReport());
  },
  update(el) {
    updatePeriodNav(el);
    const p = state.view.period;
    if (!p) return;
    $("#stIns", el).classList.toggle("hidden", (state.view.offset || 0) !== 0);
    if ((state.view.offset || 0) === 0) $("#stInsBody", el).innerHTML = insightList(currentInsights());
    const s = summarize(state.view.list);
    const bud = budgetFor(p.key);
    if (bud.amount) {
      const pct = s.rutin / bud.amount * 100;
      const cls = pct >= 100 ? "w100" : pct >= 90 ? "w90" : pct >= 80 ? "w80" : "";
      $("#stBudget", el).innerHTML = `<div class="card-head"><h2>Budget</h2><button class="btn btn-sm btn-ghost" data-setbudget>${icon("edit")} Ubah</button></div>
        <div class="budget-top"><div><div class="muted" style="font-size:12.5px">Terpakai</div><div class="big">${money(s.rutin)}</div></div><div style="text-align:right"><div class="muted" style="font-size:12.5px">dari</div><b>${money(bud.amount)}</b></div></div>
        <div class="progress ${cls}"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
        <div class="budget-meta"><span>${Math.round(pct)}% terpakai</span><span>Sisa ${money(bud.amount - s.rutin)}</span></div>
        ${bud.inherited ? `<div class="hint" style="margin-top:8px">Belum diatur khusus — memakai budget periode sebelumnya.</div>` : ""}`;
    } else {
      $("#stBudget", el).innerHTML = `<div class="card-head"><h2>Budget</h2></div><p class="muted" style="margin:0 0 12px">Belum ada budget untuk periode ini.</p><button class="btn btn-primary btn-sm" data-setbudget>Atur budget</button>`;
    }
    $("#stSplit", el).innerHTML = `<div class="card-head"><h2>Ringkasan</h2><span class="pill info">${s.count} transaksi</span></div>
      <div class="kv" style="margin:0">
        <div><span>Pemasukan</span><b style="color:var(--income)">${money(s.income)}</b></div>
        <div><span>Pengeluaran rutin</span><b>${money(s.rutin)}</b></div>
        <div><span>Pengeluaran tetap 📌</span><b>${money(s.tetap)}</b></div>
        <div><span>Total pengeluaran</span><b style="color:var(--expense)">${money(s.expense)}</b></div>
        <div><span>Selisih</span><b>${money(s.income - s.expense, { sign: true })}</b></div>
      </div>`;
    $("#stCats", el).innerHTML = catBars(s.byCategory);
    $("#stCatBud", el).innerHTML = catBudgetBars(state.view.list);
    const ob = Object.fromEntries(Object.entries(s.byOwner));
    $("#stOwners", el).innerHTML = Object.keys(ob).length ? catBars(ob).replace(/<div class="ico">.*?<\/div>/g, '<div class="ico">👤</div>') : `<div class="empty" style="padding:18px">Belum ada data.</div>`;
    this.trend(el);
  },
  async trend(el) {
    const pd = payday();
    const key = state.householdId + "|" + pd + "|" + state.view.period.key;
    const box = $("#stTrend", el);
    const draw = data => {
      const max = Math.max(1, ...data.map(d => Math.max(d.in, d.out)));
      box.innerHTML = `<div class="trend">${data.map(d => `
        <div class="trend-col ${d.cur ? "cur" : ""}" title="${esc(d.label)}: masuk ${esc(rupiah(d.in))}, keluar ${esc(rupiah(d.out))}">
          <div class="trend-bars"><i class="in" style="height:${(d.in / max * 100).toFixed(1)}%"></i><i class="out" style="height:${(d.out / max * 100).toFixed(1)}%"></i></div>
          <small>${esc(d.short)}</small>
        </div>`).join("")}</div>
        ${(() => { const act = data.filter(d => d.in || d.out); return act.length > 1 ? `<div class="hint" style="margin-top:8px">Rata-rata pengeluaran: ${money(act.reduce((a, d) => a + d.out, 0) / act.length)} / periode (${act.length} periode berisi data)</div>` : ""; })()}`;
    };
    if (trendCache.key === key && trendCache.data) {
      // perbarui kolom periode terpilih dengan data realtime
      const s = summarize(state.view.list);
      const d = trendCache.data.map(x => x.cur ? { ...x, in: s.income, out: s.expense } : x);
      return draw(d);
    }
    if (trendCache.loading === key) return;
    trendCache.loading = key;
    box.innerHTML = `<div class="skeleton" style="height:160px"></div>`;
    try {
      const off = state.view.offset || 0;
      const periods = Array.from({ length: 6 }, (_, i) => periodOf(new Date(), pd, off - 5 + i));
      const list = await D.fetchRange(periods[0].start, periods[5].end);
      const data = periods.map((p, i) => {
        const s = summarize(list.filter(t => t.date >= p.start && t.date < p.end));
        return { label: p.label, short: p.shortLabel, in: s.income, out: s.expense, cur: i === 5 };
      });
      trendCache = { key, data, loading: false };
      if (route() === "stats") draw(data);
    } catch (err) {
      trendCache.loading = false;
      box.innerHTML = `<div class="empty">Gagal memuat tren. ${esc(friendlyError(err))}</div>`;
    }
  },
};

/* ═══════════ VIEW: AKUN & PENGATURAN ═══════════ */
VIEWS.settings = {
  mount(el) {
    el.addEventListener("click", e => {
      const a = e.target.closest("[data-s]");
      if (!a) return;
      const act = a.dataset.s, arg = a.dataset.arg;
      const handlers = {
        hhName: () => textSheet("Nama rumah tangga", state.household.name, v => D.updateHousehold({ name: v })),
        nick: () => textSheet("Nama panggilan saya", myNick() || firstName(state.user.displayName), v => D.setMyNick(v)),
        invite: () => inviteSheet(),
        member: () => memberSheet(arg),
        wallet: () => walletDetail(arg),
        addWallet: () => walletSheet(),
        cats: () => listEditSheet(arg === "income" ? "Kategori pemasukan" : "Kategori pengeluaran", cats(arg), v => D.updateSettings(`categories.${arg}`, v)),
        owners: () => listEditSheet("Kepemilikan", owners(), v => D.updateSettings("owners", v), "Nama anggota/pos dana, contoh: Ayah, Ibu, Anak, Bersama."),
        payday: () => paydaySheet(),
        theme: () => { const order = ["auto", "light", "dark"]; const t = order[(order.indexOf(pref.get("theme", "auto")) + 1) % 3]; pref.set("theme", t); applyTheme(); this.update(el); },
        notif: () => toggleNotif().then(() => this.update(el)),
        templates: () => templatesSheet(),
        "member-notif": () => memberNotifSheet().then(() => this.update(el)),
        catbud: () => catBudgetSheet(),
        lock: () => lockSettingsSheet().then(() => this.update(el)),
        daily: async () => {
          try {
            if (dailyReminderOn()) { await disableDailyReminder(); toast("Pengingat harian dimatikan"); }
            else { await enableDailyReminder(); toast("Pengingat harian aktif ⏰ setiap pukul 20.00", "success"); }
          } catch (err) { toast(err.message || String(err), "warn", 7000); }
          this.update(el);
        },
        export: () => exportSheet(),
        recalc: () => recalcSheet(),
        archived: () => archivedSheet(),
        leave: () => leaveFlow(),
        logout: async () => { if (await confirmDialog({ title: "Keluar dari akun?", message: "Data tetap aman di cloud. Kamu bisa masuk lagi kapan saja.", okText: "Keluar" })) D.logout(); },
      };
      handlers[act]?.();
    });
  },
  update(el) {
    const h = state.household, u = state.user;
    const themeLabel = { auto: "Otomatis", light: "Terang", dark: "Gelap" }[pref.get("theme", "auto")];
    const notifOn = pref.get("notif", false) && "Notification" in window && Notification.permission === "granted";
    const item = (s, ico, title, sub = "", end = "", arg = "") => `<button class="set-item" data-s="${s}" ${arg ? `data-arg="${esc(arg)}"` : ""}><div class="si-ico">${ico}</div><div class="si-main"><b>${esc(title)}</b>${sub ? `<small>${sub}</small>` : ""}</div><div class="si-end">${end}</div></button>`;
    const archivedCount = allWallets().filter(w => w.archived).length;
    el.innerHTML = `
      <div class="topbar"><div><h1>Akun & Pengaturan</h1><div class="sub">${esc(h.name)}</div></div></div>
      <div class="grid grid-2">
        <div>
          <div class="set-group"><div class="set-list">
            <div class="set-item">${avatarHtml()}<div class="si-main"><b>${esc(u.displayName || "")}</b><small>${esc(u.email || "")}</small></div></div>
          </div></div>
          <div class="set-group"><h3>Rumah tangga</h3><div class="set-list">
            ${item("hhName", "🏠", h.name, "Nama buku kas keluarga", "Ubah")}
            ${item("nick", "🏷️", "Nama panggilan saya", "Untuk pemilik rekening & pencatat transaksi", esc(myNick() || "Atur"))}
            ${item("invite", "🔑", "Undang anggota", "Bagikan kode undangan", esc(h.inviteCode || ""))}
            ${h.members.map(m => item("member", m === h.ownerId ? "👑" : "👤", memberName(m) + (m === u.uid ? " (kamu)" : ""), esc([h.memberInfo?.[m]?.nick ? h.memberInfo?.[m]?.name : "", h.memberInfo?.[m]?.email].filter(Boolean).join(" · ")), m === h.ownerId ? "Pemilik" : "Anggota", m)).join("")}
          </div></div>
          <div class="set-group"><h3>Dompet & rekening</h3><div class="set-list">
            ${activeWallets().map(w => item("wallet", walletIcon(w.type), w.name, esc(w.type) + " · " + esc(w.owner || "Bersama"), money(balance(w.id)), w.id)).join("")}
            ${item("addWallet", "➕", "Tambah dompet / rekening")}
            ${archivedCount ? item("archived", "🗄️", "Dompet diarsipkan", "", String(archivedCount)) : ""}
          </div></div>
        </div>
        <div>
          <div class="set-group"><h3>Pencatatan</h3><div class="set-list">
            ${item("cats", "🏷️", "Kategori pengeluaran", esc(cats("expense").slice(0, 4).join(", ")) + "…", "", "expense")}
            ${item("cats", "💼", "Kategori pemasukan", esc(cats("income").join(", ")), "", "income")}
            ${item("owners", "👥", "Kepemilikan", esc(owners().join(", ")))}
            ${item("payday", "📅", "Tanggal gajian (awal periode)", "Periode budget dimulai tiap tanggal ini", "Tgl " + payday())}
            ${item("templates", "⚡", "Template catat cepat", "Transaksi favorit 1 ketukan", String((S().templates || []).length))}
            ${item("catbud", "🎯", "Budget per kategori", "Batas per kategori tiap periode", String(Object.keys(state.household?.catBudgets || {}).length || "Atur"))}
          </div></div>
          <div class="set-group"><h3>Aplikasi</h3><div class="set-list">
            ${item("theme", "🌓", "Tema", "", themeLabel)}
            ${item("notif", "🔔", "Notifikasi peringatan budget", "Peringatan budget & insight boros/hemat", notifOn ? "Aktif" : "Mati")}
            ${item("daily", "⏰", "Pengingat harian 20.00", "Ringkasan & tagihan, walau aplikasi tertutup", dailyReminderOn() ? "Aktif" : VAPID_KEY ? "Mati" : "Belum disetel")}
            ${item("member-notif", "👥", "Notifikasi transaksi anggota", "Saat anggota lain mencatat transaksi", { all: "Semua", min: "≥ " + rupiahShort(D.memberNotifPref().min), off: "Mati" }[D.memberNotifPref().mode])}
            ${item("lock", "🔒", "Kunci aplikasi", "PIN / sidik jari di perangkat ini", lockConfigured() ? "Aktif" : "Mati")}
            ${item("export", "📤", "Export ke Excel", "Unduh transaksi sebagai .xlsx")}
            ${item("recalc", "🧮", "Hitung ulang saldo", "Perbaiki saldo dari seluruh transaksi")}
          </div></div>
          <div class="set-group"><div class="set-list">
            ${item("leave", "🚪", "Keluar dari rumah tangga")}
            ${item("logout", "🔓", "Keluar dari akun")}
          </div></div>
          <p class="faint" style="font-size:12px;text-align:center">${esc(APP_NAME)} v${APP_VERSION} · <a href="privacy.html">Privasi</a></p>
        </div>
      </div>`;
  },
};

/* ═══════════ SHEETS ═══════════ */

/* ─── Form transaksi (tambah / ubah) ─── */
function trxForm(existing = null, presetType = "expense") {
  const ws = activeWallets();
  if (!ws.length) { toast("Tambah dompet terlebih dahulu.", "warn"); return walletSheet(); }
  if (existing?.type === "adjust") return toast("Penyesuaian saldo tidak bisa diubah, hapus lalu buat ulang.", "warn");
  const lastWallet = pref.get("lastWallet", ws[0].id);
  const lastOwner = pref.get("lastOwner", myNick() || owners()[0]);
  const f = existing ? { ...existing } : { type: presetType, walletId: ws.some(w => w.id === lastWallet) ? lastWallet : ws[0].id, toWalletId: "", owner: lastOwner, toOwner: lastOwner, expenseType: "Rutin", date: new Date(), amount: 0, note: "", category: "" };
  const wsForSelect = existing ? allWallets().filter(w => !w.archived || w.id === existing.walletId || w.id === existing.toWalletId) : ws;
  const wOpts = sel => wsForSelect.map(w => `<option value="${esc(w.id)}" ${w.id === sel ? "selected" : ""}>${walletIcon(w.type)} ${esc(w.name)}${w.owner ? ` (${esc(w.owner)})` : ""}</option>`).join("");
  const oOpts = sel => [...new Set([...owners(), sel].filter(Boolean))].map(o => `<option ${o === sel ? "selected" : ""}>${esc(o)}</option>`).join("");

  const s = openSheet({
    title: existing ? "Ubah transaksi" : "Catat transaksi",
    body: `
      <div class="seg t-${f.type}" id="fType" ${existing ? 'style="pointer-events:none;opacity:.7"' : ""}>
        <button data-t="expense">Pengeluaran</button><button data-t="income">Pemasukan</button><button data-t="transfer">Pindah Dana</button>
      </div>
      ${existing ? "" : `<div class="quick-input">
        <button type="button" class="btn btn-ghost btn-sm" id="fVoice">🎙️ Ucapkan</button>
        <button type="button" class="btn btn-ghost btn-sm" id="fScan">📷 Scan struk</button>
        <input type="file" id="fScanFile" accept="image/*" capture="environment" hidden>
      </div>
      <div class="quick-hint hidden" id="fQuickHint"></div>`}
      <div class="chips tpl-chips" id="fTpl"></div>
      <div class="field"><label for="fAmt">Nominal</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="fAmt" inputmode="numeric" autocomplete="off" placeholder="0" value="${f.amount ? formatNominalInput(f.amount) : ""}" autofocus></div></div>
      <div id="fDyn"></div>
      <div class="row-2">
        <div class="field"><label for="fDate">Tanggal & jam</label><input class="input" type="datetime-local" id="fDate" value="${toLocalInput(f.date)}"></div>
        <div class="field" id="fOwnerWrap"><label for="fOwner">Milik</label><select class="input select" id="fOwner">${oOpts(f.owner)}</select></div>
      </div>
      <div class="hint hidden" id="fOwnerAuto" style="margin:-6px 0 14px"></div>
      <div class="field"><label for="fNote">Catatan (opsional)</label><input class="input" id="fNote" maxlength="300" placeholder="Contoh: belanja mingguan" value="${esc(f.note || "")}"></div>
      <div class="field"><span class="field-label">Bukti transaksi (opsional)</span>
        <button type="button" class="btn btn-ghost btn-sm" id="fProofAdd">📎 Lampirkan foto bukti / struk</button>
        <input type="file" id="fProofFile" accept="image/*" hidden>
        <div class="proof-prev hidden" id="fProofPrev"><img id="fProofImg" alt="Bukti transaksi"><div class="proof-meta"><small id="fProofInfo"></small><button type="button" class="link-btn" id="fProofChange">Ganti</button><button type="button" class="link-btn" id="fProofDel" style="color:var(--expense)">Hapus</button></div></div>
      </div>
      <button class="btn btn-primary btn-block" id="fSave">${existing ? "Simpan perubahan" : "Simpan"}</button>
      ${existing ? "" : `<button class="link-btn" id="fSaveTpl" style="display:block;margin:12px auto 0">☆ Simpan sebagai template catat cepat</button>`}`,
    onMount(api) {
      const dyn = api.$("#fDyn");
      const drawDyn = () => {
        api.$("#fType").className = `seg t-${f.type}`;
        api.$$("#fType button").forEach(b => b.classList.toggle("active", b.dataset.t === f.type));
        if (f.type === "transfer") {
          if (!f.toWalletId || f.toWalletId === f.walletId) f.toWalletId = (wsForSelect.find(w => w.id !== f.walletId) || {}).id || "";
          dyn.innerHTML = `
            <div class="row-2">
              <div class="field"><label for="fW">Dari</label><select class="input select" id="fW">${wOpts(f.walletId)}</select></div>
              <div class="field"><label for="fW2">Ke</label><select class="input select" id="fW2">${wOpts(f.toWalletId)}</select></div>
            </div>
            <div class="field"><label for="fOwner2">Untuk kepemilikan</label><select class="input select" id="fOwner2">${oOpts(f.toOwner || f.owner)}</select><span class="hint">Isi berbeda dari "Milik" jika dana berpindah antar anggota.</span></div>`;
          api.$("#fW2").onchange = e => { f.toWalletId = e.target.value; };
          api.$("#fOwner2").onchange = e => { f.toOwner = e.target.value; };
        } else {
          const list = cats(f.type);
          if (!list.includes(f.category)) f.category = existing?.category && f.type === existing.type ? existing.category : "";
          const extra = f.category && !list.includes(f.category) ? [f.category] : [];
          dyn.innerHTML = `
            <div class="field"><span class="field-label">Kategori</span><div class="cat-grid" id="fCats">${[...list, ...extra].map(c => `<button type="button" class="cat-btn ${c === f.category ? "active" : ""}" data-c="${esc(c)}"><span>${catIcon(c)}</span>${esc(c)}</button>`).join("")}</div></div>
            ${f.type === "expense" ? `<div class="field"><span class="field-label">Jenis pengeluaran</span><div class="toggle-row" id="fET">
              <button type="button" data-et="Rutin" class="${f.expenseType !== "Tetap" ? "active" : ""}"><b>🔄 Rutin</b><small>Masuk hitungan budget</small></button>
              <button type="button" data-et="Tetap" class="${f.expenseType === "Tetap" ? "active" : ""}"><b>📌 Tetap</b><small>Cicilan, SPP, dll — di luar budget</small></button></div></div>` : ""}
            <div class="field"><label for="fW">${f.type === "income" ? "Masuk ke" : "Dibayar dari"}</label><select class="input select" id="fW">${wOpts(f.walletId)}</select></div>`;
          api.$("#fCats").onclick = e => { const b = e.target.closest("[data-c]"); if (!b) return; f.category = b.dataset.c; f.catManual = true; api.$$("#fCats .cat-btn").forEach(x => x.classList.toggle("active", x === b)); };
          api.$("#fET")?.addEventListener("click", e => { const b = e.target.closest("[data-et]"); if (!b) return; f.expenseType = b.dataset.et; api.$$("#fET button").forEach(x => x.classList.toggle("active", x === b)); });
        }
        api.$("#fW").onchange = e => { f.walletId = e.target.value; };
        api.$("#fOwnerWrap label").textContent = f.type === "transfer" ? "Dari kepemilikan" : "Milik";
        const tpls = existing ? [] : (S().templates || []).filter(t => t.type === f.type);
        api.$("#fTpl").innerHTML = tpls.map(t => `<button type="button" class="chip" data-tp="${esc(t.id)}">⚡ ${esc(t.label)}</button>`).join("");
        api.$("#fTpl").classList.toggle("hidden", !tpls.length);
        api.$("#fW2")?.addEventListener("change", syncOwners);
        api.$("#fW").addEventListener("change", syncOwners);
        syncOwners();
      };
      /* Rekening yang punya pemilik → "Milik" terisi otomatis & disembunyikan */
      const syncOwners = () => {
        const o1 = walletOwner(f.walletId);
        const wrap = api.$("#fOwnerWrap");
        if (o1) { f.owner = o1; api.$("#fOwner").innerHTML = oOpts(o1); }
        wrap.classList.toggle("hidden", !!o1);
        if (f.type === "transfer") {
          const o2 = walletOwner(f.toWalletId);
          const w2 = api.$("#fOwner2")?.closest(".field");
          if (o2) { f.toOwner = o2; api.$("#fOwner2").innerHTML = oOpts(o2); }
          w2?.classList.toggle("hidden", !!o2);
        }
        const note = api.$("#fOwnerAuto");
        const parts = [];
        if (o1) parts.push(f.type === "transfer" ? `dari ${o1}` : o1);
        if (f.type === "transfer" && walletOwner(f.toWalletId)) parts.push(`ke ${walletOwner(f.toWalletId)}`);
        note.textContent = parts.length ? `👤 Kepemilikan otomatis mengikuti rekening: ${parts.join(" ")}` : "";
        note.classList.toggle("hidden", !parts.length);
      };
      drawDyn();
      api.$("#fTpl").onclick = e => {
        const b = e.target.closest("[data-tp]"); if (!b) return;
        const t = (S().templates || []).find(x => x.id === b.dataset.tp); if (!t) return;
        Object.assign(f, { category: t.category, walletId: walletById(t.walletId) ? t.walletId : f.walletId, expenseType: t.expenseType || "Rutin", toWalletId: t.toWalletId || f.toWalletId });
        drawDyn();
        api.$("#fAmt").value = formatNominalInput(t.amount);
        if (t.note) api.$("#fNote").value = t.note;
      };
      api.$("#fSaveTpl")?.addEventListener("click", () => {
        const amount = parseNominal(api.$("#fAmt").value);
        if (!amount) return toast("Isi nominal dulu untuk dijadikan template.", "warn");
        if (f.type !== "transfer" && !f.category) return toast("Pilih kategori dulu.", "warn");
        const label0 = api.$("#fNote").value.trim() || (f.type === "transfer" ? "Pindah dana" : f.category);
        textSheet("Nama template", label0.slice(0, 24), async label => {
          const list = [...(S().templates || []), { id: makeId("t_"), label: label.slice(0, 24), type: f.type, amount, category: f.category || "", walletId: f.walletId, toWalletId: f.toWalletId || "", expenseType: f.expenseType || "Rutin", note: api.$("#fNote").value.trim() }];
          await D.setTemplates(list.slice(-12));
        });
      });
      api.$("#fType").onclick = e => { const b = e.target.closest("[data-t]"); if (!b) return; f.type = b.dataset.t; drawDyn(); };

      /* ─── Kategori otomatis dari catatan ─── */
      f.catManual = !!existing;
      const memory = () => state.household?.catMemory || {};
      const autoCat = text => {
        if (f.catManual || f.type === "transfer") return;
        const g = guessCategory(text, f.type, cats(f.type), memory());
        if (g && g !== f.category) { f.category = g; drawDyn(); api.$("#fCats .cat-btn.active")?.classList.add("auto"); }
      };
      api.$("#fNote").addEventListener("input", e => autoCat(e.target.value));

      /* ─── Isi form dari suara / struk ─── */
      const hint = (html, show = true) => { const h = api.$("#fQuickHint"); if (!h) return; h.innerHTML = html; h.classList.toggle("hidden", !show); };
      const apply = p => {
        if (p.type && p.type !== f.type) f.type = p.type;
        if (p.walletId) f.walletId = p.walletId;
        if (p.toWalletId) f.toWalletId = p.toWalletId;
        if (p.category) { f.category = p.category; f.catManual = false; }
        drawDyn();
        if (p.amount) api.$("#fAmt").value = formatNominalInput(p.amount);
        if (p.note) api.$("#fNote").value = p.note;
        if (p.date) api.$("#fDate").value = toLocalInput(p.date);
        if (!p.category && p.note) autoCat(p.note);
        if (p.category) api.$("#fCats .cat-btn.active")?.classList.add("auto");
      };
      /* ─── Bukti transaksi ─── */
      let proof; // undefined = tidak berubah, null = dihapus, string = foto baru
      const showProof = (url, info) => {
        api.$("#fProofPrev").classList.toggle("hidden", !url);
        api.$("#fProofAdd").classList.toggle("hidden", !!url);
        if (url) { api.$("#fProofImg").src = url; api.$("#fProofInfo").textContent = info || ""; }
      };
      if (existing?.hasProof) D.getProof(existing.id).then(u => u && proof === undefined && showProof(u, "Bukti tersimpan")).catch(() => {});
      const pickProof = () => api.$("#fProofFile").click();
      api.$("#fProofAdd").onclick = pickProof; api.$("#fProofChange").onclick = pickProof;
      api.$("#fProofDel").onclick = () => { proof = null; showProof(null); };
      const attachFile = async (file, info) => {
        const url = await compressImage(file);
        proof = url; showProof(url, `${info || "Foto dilampirkan"} · ${dataUrlKB(url)} KB`);
      };
      api.$("#fProofFile").onchange = async e => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (!file) return;
        try { await attachFile(file); } catch (err) { toast(err.message || "Gagal memproses foto.", "error"); }
      };

      api.$("#fVoice")?.addEventListener("click", async e => {
        const btn = e.currentTarget;
        if (btn.classList.contains("rec")) return listenOnce.stop?.();
        if (!voiceSupported()) return toast("Browser ini belum mendukung input suara. Gunakan Chrome (Android) atau Safari (iPhone).", "warn", 6000);
        btn.classList.add("rec"); btn.textContent = "⏹ Selesai";
        hint(`🎙️ <i>Contoh: “belanja pasar seratus lima puluh ribu pakai BTN Ibun”</i>`);
        try {
          const text = await listenOnce({ onPartial: t => hint(`🎙️ “${esc(t)}”`) });
          if (!text) { hint("", false); return; }
          const p = parseUtterance(text, { wallets: activeWallets(), cats: { expense: cats("expense"), income: cats("income") }, memory: memory() });
          apply(p);
          const sum = p.parts?.length > 1 ? `<br>🧮 ${p.parts.map(v => esc(rupiah(v))).join(" + ")} = <b>${esc(rupiah(p.amount))}</b>` : "";
          hint(`🎙️ “${esc(text)}”${p.amount ? sum : " — <b>nominal tidak terdengar, isi manual</b>"}`);
        } catch (err) { hint("", false); toast(err.message, "warn", 6000); }
        finally { btn.classList.remove("rec"); btn.textContent = "🎙️ Ucapkan"; }
      });
      api.$("#fScan")?.addEventListener("click", () => api.$("#fScanFile").click());
      api.$("#fScanFile")?.addEventListener("change", async e => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (!file) return;
        const btn = api.$("#fScan"); btn.disabled = true;
        hint(`📷 Menyiapkan… <span class="ocr-bar"><i style="width:0%"></i></span>`);
        try {
          const { recognizeReceipt } = await import("./ocr.js");
          const prog = pass => (p, lbl) => hint(`📷 ${esc(lbl)}${pass > 1 ? " (cek ulang)" : ""} <span class="ocr-bar"><i style="width:${Math.round(p * 100)}%"></i></span>`);
          if (!proof) attachFile(file, "Struk dilampirkan sebagai bukti").catch(() => {});
          const text = await recognizeReceipt(file, prog(1), { binarize: true, psm: "4" });
          let r = parseReceipt(text);
          // Lapis kedua: bila tanggal hilang / total kurang meyakinkan, baca ulang dengan mode berbeda lalu gabungkan
          if (!r.date || r.confidence !== "high") {
            const text2 = await recognizeReceipt(file, prog(2), { binarize: false, psm: "4" });
            r = mergeReceipts(r, parseReceipt(text2));
          }
          // nama toko lebih menentukan daripada isi barang (O!Save → Belanja Dapur, bukan Makan & Minum)
          const category = guessCategory(r.merchant, "expense", cats("expense"), memory()) || guessCategory(r.merchant + " " + text.slice(0, 300), "expense", cats("expense"), memory()) || f.category;
          hint("", false);
          if (!r.total && !r.items.length) { toast("Struk tidak terbaca jelas — isi manual. Tips: foto lurus, terang, struk memenuhi layar.", "warn", 7000); return; }
          receiptReview(r, {
            category, walletId: f.walletId,
            onSingle: ({ total, items, category: cat, walletId, date }) => {
              f.items = items; f.walletId = walletId;
              apply({ type: "expense", amount: total, date, note: [r.merchant, items.length ? items.length + " barang" : ""].filter(Boolean).join(" · "), category: cat });
              hint(`🧾 ${esc(r.merchant || "Struk")} · ${items.length} barang · <b>${esc(rupiah(total))}</b>. Periksa lalu Simpan.`);
            },
            onSplit: async ({ groups, walletId, date }) => {
              const owner = walletOwner(walletId) || myNick() || owners()[0];
              let n = 0;
              for (const g of groups) {
                await D.addTransaction({ type: "expense", amount: g.amount, category: g.category, walletId, owner, date, expenseType: "Rutin",
                  note: `${r.merchant || "Belanja"} · ${g.items.length} barang`, items: g.items }, proof || null);
                n++;
              }
              api.close();
              toast(`${n} transaksi tercatat dari 1 struk ✓`, "success");
            },
          });
        } catch (err) { hint("", false); toast("Gagal membaca struk: " + (err?.message || err), "error", 6000); }
        finally { btn.disabled = false; }
      });
      const amt = api.$("#fAmt");
      amt.oninput = () => { const pos = amt.value.length - amt.selectionStart; amt.value = formatNominalInput(amt.value); const p = Math.max(0, amt.value.length - pos); amt.setSelectionRange(p, p); };
      api.$("#fSave").onclick = e => busy(e.currentTarget, async () => {
        f.amount = parseNominal(amt.value);
        if (!api.$("#fOwnerWrap").classList.contains("hidden")) f.owner = api.$("#fOwner").value;
        if (f.type === "transfer" && api.$("#fOwner2") && !api.$("#fOwner2").closest(".field").classList.contains("hidden")) f.toOwner = api.$("#fOwner2").value;
        f.note = api.$("#fNote").value;
        f.date = new Date(api.$("#fDate").value || Date.now());
        if (!f.amount) return toast("Isi nominal terlebih dahulu.", "warn");
        if (isNaN(f.date)) return toast("Tanggal tidak valid.", "warn");
        if (f.type !== "transfer" && !f.category) return toast("Pilih kategori.", "warn");
        if (f.type === "transfer" && (!f.toWalletId || f.toWalletId === f.walletId)) return toast("Dompet asal dan tujuan harus berbeda.", "warn");
        try {
          const r = existing ? await D.updateTransaction(existing, f, proof) : await D.addTransaction(f, proof || null);
          // Belajar: catatan → kategori (untuk saran berikutnya)
          if (f.note && f.category && f.type !== "transfer") {
            const mem = state.household?.catMemory || {};
            const keys = memoryKeys(f.note).filter(k => mem[k] !== f.category);
            if (keys.length) D.learnCategory(keys, f.category).catch(() => {});
          }
          pref.set("lastWallet", f.walletId); pref.set("lastOwner", f.owner);
          api.close();
          toast(r.offline ? "Tersimpan di perangkat — akan tersinkron saat online" : existing ? "Perubahan disimpan ✓" : `${TYPE_LABEL[f.type]} ${rupiah(f.amount)} tersimpan ✓`, r.offline ? "warn" : "success");
          const p = periodOf(f.date, payday());
          if (p.key !== state.current.period?.key && !existing) toast(`Masuk ke periode ${p.label}`, "info");
        } catch (err) { toast(friendlyError(err), "error", 6000); }
      });
    },
  });
}

/* ─── Detail transaksi ─── */
function trxDetail(t) {
  const sign = t.type === "income" ? "income" : t.type === "expense" ? "expense" : "transfer";
  const rows = [
    ["Jenis", TYPE_LABEL[t.type] + (t.expenseType ? ` · ${t.expenseType}` : "")],
    t.category && t.type !== "adjust" ? ["Kategori", `${catIcon(t.category)} ${t.category}`] : null,
    t.type === "transfer" ? ["Dari", walletName(t.walletId)] : ["Dompet", walletName(t.walletId)],
    t.type === "transfer" ? ["Ke", walletName(t.toWalletId)] : null,
    t.owner ? ["Milik", t.type === "transfer" && t.toOwner && t.toOwner !== t.owner ? `${t.owner} → ${t.toOwner}` : t.owner] : null,
    ["Tanggal", fmtDate(t.date, true)],
    t.note ? ["Catatan", t.note] : null,
    ["Dicatat oleh", memberName(t.createdBy)],
  ].filter(Boolean);
  const s = openSheet({
    title: "Detail transaksi",
    body: `
      <div class="detail-amount"><div class="trx-ico ${t.type}" style="margin:0 auto 10px;width:56px;height:56px;font-size:26px">${trxIcon(t)}</div>
        <div class="big trx-amt ${sign}">${t.type === "expense" ? money(-t.amount) : money(t.amount, { sign: t.type !== "transfer" })}</div></div>
      <div class="kv">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>
      ${t.items?.length ? `<details class="items-box"><summary>🧾 Rincian belanja (${t.items.length} barang)</summary>
        <div class="items-list">${t.items.map(i => `<div><span>${esc(i.n)}${i.q > 1 ? ` <small class="faint">${i.q}×</small>` : ""}</span><b class="num">${money(i.p)}</b></div>`).join("")}</div></details>` : ""}
      ${t.hasProof ? `<div class="field-label" style="margin-bottom:6px">📎 Bukti transaksi</div><button type="button" class="proof-view" id="dProof"><div class="skeleton" style="height:140px"></div></button>` : ""}
      <div class="btn-row">
        <button class="btn btn-danger" id="dDel">${icon("trash")} Hapus</button>
        ${t.type !== "adjust" ? `<button class="btn btn-primary" id="dEdit">${icon("edit")} Ubah</button>` : ""}
      </div>`,
  });
  s.$("#dEdit")?.addEventListener("click", () => { s.close(); trxForm(t); });
  if (t.hasProof) D.getProof(t.id).then(url => {
    const box = s.$("#dProof"); if (!box) return;
    if (!url) { box.innerHTML = `<span class="muted">Bukti tidak ditemukan.</span>`; return; }
    box.innerHTML = `<img src="${url}" alt="Bukti transaksi">`;
    box.onclick = () => proofViewer(url, `Bukti_${trxTitle(t)}_${fmtDate(t.date)}`);
  }).catch(err => { const box = s.$("#dProof"); if (box) box.innerHTML = `<span class="muted">${esc(friendlyError(err))}</span>`; });
  s.$("#dDel").onclick = async () => {
    if (!(await confirmDialog({ title: "Hapus transaksi?", message: `${trxTitle(t)} — ${rupiah(t.amount)}. Saldo dompet akan disesuaikan otomatis.`, okText: "Hapus", danger: true }))) return;
    try { const r = await D.deleteTransaction(t); s.close(); toast(r.offline ? "Dihapus (menunggu sinkron)" : "Transaksi dihapus", "success"); }
    catch (err) { toast(friendlyError(err), "error"); }
  };
}

/* ─── Rincian struk: periksa, koreksi, pisah per kategori ─── */
function receiptReview(r, { category, walletId, onSingle, onSplit }) {
  const expCats = cats("expense");
  let baseCat = expCats.includes(category) ? category : (expCats.find(c => /belanja/i.test(c)) || expCats[0]);
  const items = groupItems(r.items).map(it => ({ ...it, category: guessItemCategory(it.name, baseCat, expCats) }));
  const nFixed = items.filter(x => x.fixed).length;
  let total = r.total || Math.max(0, r.itemsSum - r.discount);
  const conf = { high: ["ok", "✓ Total terverifikasi"], medium: ["warn", "Periksa total"], low: ["bad", "⚠ Total diperkirakan"] }[r.confidence] || ["warn", "Periksa total"];
  const ws = activeWallets();
  const catOpts = sel => expCats.map(c => `<option ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("");
  const s = openSheet({
    title: "Rincian struk",
    body: `
      <div class="rc-head">
        <div><b>${esc(r.merchant || "Struk belanja")}</b><small class="muted">${r.date ? esc(fmtDate(r.date, true)) : "Tanggal tidak terbaca — memakai waktu sekarang"}</small></div>
        <span class="pill ${conf[0]}" title="${esc(r.sources.join(", "))}">${conf[1]}</span>
      </div>
      <div class="field"><label for="rcTotal">Total dibayar</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="rcTotal" inputmode="numeric" value="${formatNominalInput(total)}"></div>
        ${r.sources.length ? `<span class="hint">Dicocokkan dari: ${esc(r.sources.join(" · "))}</span>` : ""}</div>
      <div class="rc-check" id="rcCheck"></div>
      <div class="row-2">
        <div class="field"><label for="rcW">Dibayar dari</label><select class="input select" id="rcW">${ws.map(w => `<option value="${esc(w.id)}" ${w.id === walletId ? "selected" : ""}>${walletIcon(w.type)} ${esc(walletLabel(w))}</option>`).join("")}</select></div>
        <div class="field"><label for="rcCat">Kategori struk</label><select class="input select" id="rcCat">${catOpts(baseCat)}</select></div>
      </div>
      ${items.length ? `<div class="field-label" style="margin:4px 0 6px">${items.length} barang · ketuk harga untuk koreksi, ✕ untuk buang baris salah</div>
      <div class="rc-items" id="rcItems">${items.map((it, i) => `
        <div class="rc-item${it.suspect ? " suspect" : ""}" data-i="${i}">
          <div class="rc-name">${esc(it.name)}${it.qty > 1 ? ` <small class="faint">${it.qty} × ${esc(rupiah(it.unit).replace("Rp ", ""))}</small>` : ""}${it.fixed ? ` <span class="rc-tag" title="Harga dibetulkan otomatis agar cocok dengan total — cek struk">dibetulkan</span>` : ""}${it.suspect ? ` <span class="rc-tag warn">cek harga</span>` : ""}
            <select class="rc-cat" data-cat="${i}">${catOpts(it.category)}</select></div>
          <input class="input num rc-price" data-p="${i}" inputmode="numeric" value="${formatNominalInput(it.price)}">
          <button type="button" class="icon-btn rc-del" data-del="${i}" aria-label="Buang">✕</button>
        </div>`).join("")}</div>` : `<p class="muted">Rincian barang tidak terbaca, hanya total.</p>`}
      <div id="rcSplitInfo" class="hint" style="margin:10px 0"></div>
      <div class="btn-row" style="flex-wrap:wrap">
        <button class="btn btn-ghost hidden" id="rcSplit">Pisah per kategori</button>
        <button class="btn btn-primary" id="rcOne">Pakai sebagai 1 transaksi</button>
      </div>`,
  });
  const live = () => items.filter(x => x.include !== false);
  const refresh = () => {
    total = parseNominal(s.$("#rcTotal").value);
    const sum = live().reduce((a, x) => a + x.price, 0), net = sum - (r.discount || 0);
    const box = s.$("#rcCheck");
    if (!items.length) box.innerHTML = "";
    else if (net === total) box.innerHTML = `<div class="pill ok">✓ Jumlah rincian cocok dengan total (${esc(rupiah(sum))}${r.discount ? " − diskon " + esc(rupiah(r.discount)) : ""})${nFixed ? ` · ${nFixed} harga salah baca dibetulkan otomatis` : ""}</div>`;
    else box.innerHTML = `<div class="pill warn">⚠ Rincian ${esc(rupiah(net))} · selisih ${esc(rupiah(total - net))} — ada harga yang mungkin salah baca</div>`;
    const groups = splitByCategory(live(), total);
    const multi = groups.length > 1;
    s.$("#rcSplit").classList.toggle("hidden", !multi);
    s.$("#rcSplit").textContent = `Pisah jadi ${groups.length} transaksi`;
    s.$("#rcSplitInfo").innerHTML = multi ? "Pisah per kategori: " + groups.map(g => `<b>${esc(g.category)}</b> ${esc(rupiah(g.amount))}`).join(" · ") : "";
  };
  s.el.addEventListener("input", e => {
    const p = e.target.dataset.p;
    if (p != null) { e.target.value = formatNominalInput(e.target.value); const it = items[+p]; it.price = parseNominal(e.target.value); it.unit = Math.round(it.price / (it.qty || 1)); e.target.closest(".rc-item").classList.remove("suspect"); }
    if (e.target.id === "rcTotal") e.target.value = formatNominalInput(e.target.value);
    refresh();
  });
  s.el.addEventListener("change", e => {
    if (e.target.dataset.cat != null) { items[+e.target.dataset.cat].category = e.target.value; refresh(); }
    if (e.target.id === "rcCat") { const old = baseCat; baseCat = e.target.value; items.forEach(x => { if (x.category === old || !expCats.includes(x.category)) x.category = e.target.value; }); s.$$(".rc-cat").forEach((sel, i) => { sel.value = items[i].category; }); refresh(); }
  });
  s.el.addEventListener("click", e => {
    const d = e.target.closest("[data-del]"); if (!d) return;
    const i = +d.dataset.del; items[i].include = items[i].include === false; d.closest(".rc-item").classList.toggle("off", items[i].include === false); refresh();
  });
  const compact = list => list.map(x => ({ n: x.name, q: x.qty || 1, p: x.price }));
  const date = r.date || new Date();
  s.$("#rcOne").onclick = () => {
    if (!parseNominal(s.$("#rcTotal").value)) return toast("Isi total.", "warn");
    onSingle({ total: parseNominal(s.$("#rcTotal").value), items: compact(live()), category: s.$("#rcCat").value, walletId: s.$("#rcW").value, date });
    s.close();
  };
  s.$("#rcSplit").onclick = e => busy(e.currentTarget, async () => {
    const groups = splitByCategory(live(), parseNominal(s.$("#rcTotal").value)).map(g => ({ ...g, items: compact(g.items) }));
    try { await onSplit({ groups, walletId: s.$("#rcW").value, date }); s.close(); } catch (err) { toast(friendlyError(err), "error"); }
  });
  refresh();
}

function proofViewer(url, name) {
  const v = openSheet({ title: "Bukti transaksi", wide: true, body: `<div class="proof-full"><img src="${url}" alt="Bukti transaksi"></div>
    <div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" id="pvDl">${icon("download")} Simpan foto</button></div>` });
  v.$("#pvDl").onclick = () => { const a = document.createElement("a"); a.href = url; a.download = name.replace(/[^\w-]+/g, "_") + ".jpg"; document.body.appendChild(a); a.click(); a.remove(); };
}

/* ─── Dompet ─── */
function walletSheet(w = null) {
  const types = Object.keys(WALLET_TYPES);
  const s = openSheet({
    title: w ? "Ubah dompet" : "Tambah dompet / rekening",
    body: `
      <div class="field"><span class="field-label">Jenis</span><div class="chips" id="wsType">${types.map(t => `<button type="button" class="chip ${(w?.type || "Bank") === t ? "active" : ""}" data-t="${t}">${WALLET_TYPES[t]} ${t}</button>`).join("")}</div></div>
      <div class="field"><label for="wsName">Nama</label><input class="input" id="wsName" maxlength="30" placeholder="Contoh: BTN, GoPay, Mandiri" value="${esc(w?.name || "")}" autofocus></div>
      <div class="field"><span class="field-label">Pemilik rekening</span><div class="chips" id="wsOwner" style="flex-wrap:wrap">${["", ...owners()].map(o => `<button type="button" class="chip ${(w ? (w.owner || "") : myNick()) === o ? "active" : ""}" data-o="${esc(o)}">${o ? "👤 " + esc(o) : "👥 Bersama"}</button>`).join("")}</div>
        <span class="hint">Transaksi dari rekening ini otomatis tercatat milik pemiliknya. Pilih "Bersama" untuk dompet/rekening keluarga.</span></div>
      ${w ? "" : `<div class="field"><label for="wsBal">Saldo saat ini</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="wsBal" inputmode="numeric" placeholder="0" style="font-size:22px;min-height:54px"></div><span class="hint">Dicatat sebagai penyesuaian saldo (tidak dihitung sebagai pemasukan).</span></div>`}
      <button class="btn btn-primary btn-block" id="wsSave">Simpan</button>`,
  });
  let type = w?.type || "Bank";
  let owner = w ? (w.owner || "") : myNick();
  s.$("#wsOwner").onclick = e => { const b = e.target.closest("[data-o]"); if (!b) return; owner = b.dataset.o; s.$$("#wsOwner .chip").forEach(c => c.classList.toggle("active", c === b)); };
  s.$("#wsType").onclick = e => { const b = e.target.closest("[data-t]"); if (!b) return; type = b.dataset.t; s.$$("#wsType .chip").forEach(c => c.classList.toggle("active", c === b)); };
  s.$("#wsBal")?.addEventListener("input", e => { e.target.value = formatNominalInput(e.target.value); });
  s.$("#wsSave").onclick = e => busy(e.currentTarget, async () => {
    const name = s.$("#wsName").value.trim();
    if (!name) return toast("Isi nama dompet.", "warn");
    if (allWallets().some(x => x.id !== w?.id && !x.archived && x.name.toLowerCase() === name.toLowerCase() && (x.owner || "") === owner)) return toast(`${name}${owner ? " milik " + owner : ""} sudah ada.`, "warn");
    const list = allWallets().map(x => ({ ...x }));
    try {
      if (w) {
        const i = list.findIndex(x => x.id === w.id); list[i] = { ...list[i], name, type, owner };
        await D.updateSettings("wallets", list);
      } else {
        const id = makeId("w_");
        list.push({ id, type, name, owner, archived: false });
        await D.updateSettings("wallets", list);
        const bal = parseNominal(s.$("#wsBal").value);
        if (bal) await D.adjustBalance(id, bal);
      }
      s.close(); toast("Dompet disimpan ✓", "success");
    } catch (err) { toast(friendlyError(err), "error"); }
  });
}

function walletDetail(id) {
  const w = walletById(id);
  if (!w) return;
  const recent = [...state.current.list].filter(t => t.walletId === id || t.toWalletId === id).slice(0, 6);
  const s = openSheet({
    title: `${walletIcon(w.type)} ${walletLabel(w)}`,
    body: `
      <div class="detail-amount"><div class="muted">Saldo saat ini</div><div class="big">${money(balance(id))}</div></div>
      <div class="btn-row" style="margin-bottom:16px">
        <button class="btn btn-ghost btn-sm" id="wdAdj">⚖️ Sesuaikan saldo</button>
        <button class="btn btn-ghost btn-sm" id="wdEdit">${icon("edit")} Ubah</button>
        <button class="btn btn-ghost btn-sm" id="wdArc">${w.archived ? "♻️ Aktifkan" : "🗄️ Arsipkan"}</button>
      </div>
      <div class="field-label" style="margin-bottom:4px">Transaksi periode ini</div>
      ${recent.length ? `<div class="trx-list">${recent.map(trxRow).join("")}</div>` : `<div class="empty" style="padding:16px">Belum ada transaksi periode ini.</div>`}`,
  });
  s.el.addEventListener("click", e => { const b = e.target.closest("[data-trx]"); if (b) { const t = findTrx(b.dataset.trx); if (t) { s.close(); trxDetail(t); } } });
  s.$("#wdEdit").onclick = () => { s.close(); walletSheet(w); };
  s.$("#wdAdj").onclick = () => { s.close(); adjustSheet(w); };
  s.$("#wdArc").onclick = async () => {
    if (!w.archived && balance(id) !== 0 && !(await confirmDialog({ title: "Arsipkan dompet?", message: `Saldo masih ${rupiah(balance(id))}. Dompet diarsipkan tidak dihitung di total saldo, tapi riwayatnya tetap ada.`, okText: "Arsipkan" }))) return;
    const list = allWallets().map(x => x.id === id ? { ...x, archived: !x.archived } : x);
    await D.updateSettings("wallets", list); s.close(); toast(w.archived ? "Dompet diaktifkan" : "Dompet diarsipkan", "success");
  };
}

function adjustSheet(w) {
  const s = openSheet({
    title: "Sesuaikan saldo",
    body: `<p class="muted" style="margin-top:0">Masukkan saldo sebenarnya di <b>${esc(w.name)}</b> (misalnya sesuai m-banking). Selisihnya dicatat sebagai penyesuaian, bukan pemasukan/pengeluaran.</p>
      <div class="field"><label for="adV">Saldo sebenarnya</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="adV" inputmode="numeric" value="${formatNominalInput(Math.max(0, balance(w.id)))}" autofocus></div></div>
      <div class="hint" id="adDiff" style="margin-bottom:14px"></div>
      <button class="btn btn-primary btn-block" id="adSave">Simpan</button>`,
  });
  const upd = () => { const d = parseNominal(s.$("#adV").value) - balance(w.id); s.$("#adDiff").textContent = d ? `Selisih: ${rupiah(d, { sign: true })}` : "Tidak ada selisih."; };
  s.$("#adV").oninput = e => { e.target.value = formatNominalInput(e.target.value); upd(); }; upd();
  s.$("#adSave").onclick = e => busy(e.currentTarget, async () => {
    try { const r = await D.adjustBalance(w.id, parseNominal(s.$("#adV").value)); s.close(); toast(r.noop ? "Saldo sudah sesuai" : "Saldo disesuaikan ✓", "success"); }
    catch (err) { toast(friendlyError(err), "error"); }
  });
}

function archivedSheet() {
  const arc = allWallets().filter(w => w.archived);
  const s = openSheet({ title: "Dompet diarsipkan", body: `<div class="set-list">${arc.map(w => `<button class="set-item" data-w="${esc(w.id)}"><div class="si-ico">${walletIcon(w.type)}</div><div class="si-main"><b>${esc(w.name)}</b><small>${esc(w.type)}</small></div><div class="si-end">${money(balance(w.id))}</div></button>`).join("")}</div>` });
  s.el.addEventListener("click", e => { const b = e.target.closest("[data-w]"); if (b) { s.close(); walletDetail(b.dataset.w); } });
}

/* ─── Budget ─── */
function budgetSheet(p) {
  const bud = budgetFor(p.key);
  const s = openSheet({
    title: "Atur budget",
    body: `<p class="muted" style="margin-top:0">Periode <b>${esc(p.label)}</b>. Budget membatasi <b>pengeluaran rutin</b>; pengeluaran tetap tidak dihitung.</p>
      <div class="field"><label for="bV">Budget</label><div class="amount-wrap"><span>Rp</span><input class="amount-input num" id="bV" inputmode="numeric" value="${bud.amount ? formatNominalInput(bud.amount) : ""}" placeholder="0" autofocus></div>
      <span class="hint">Periode berikutnya otomatis memakai angka ini sampai kamu ubah. Kosongkan untuk menghapus.</span></div>
      <button class="btn btn-primary btn-block" id="bSave">Simpan budget</button>`,
  });
  s.$("#bV").oninput = e => { e.target.value = formatNominalInput(e.target.value); };
  s.$("#bSave").onclick = e => busy(e.currentTarget, async () => {
    try { await D.setBudget(p.key, parseNominal(s.$("#bV").value)); s.close(); toast("Budget disimpan ✓", "success"); }
    catch (err) { toast(friendlyError(err), "error"); }
  });
}

/* ─── Pengaturan: helper sheets ─── */
function textSheet(title, value, save) {
  const s = openSheet({ title, body: `<div class="field"><input class="input" id="tV" maxlength="40" value="${esc(value)}" autofocus></div><button class="btn btn-primary btn-block" id="tSave">Simpan</button>` });
  s.$("#tSave").onclick = e => busy(e.currentTarget, async () => {
    const v = s.$("#tV").value.trim(); if (!v) return;
    try { await save(v); s.close(); toast("Tersimpan ✓", "success"); } catch (err) { toast(friendlyError(err), "error"); }
  });
}

function listEditSheet(title, initial, save, hint = "") {
  let items = [...initial];
  const s = openSheet({ title, body: `${hint ? `<p class="muted" style="margin-top:0">${esc(hint)}</p>` : ""}<div class="tag-edit" id="leList"></div>
    <div class="inline-add"><input class="input" id="leNew" maxlength="30" placeholder="Tambah baru…"><button class="btn btn-ghost btn-sm" id="leAdd">${icon("plus")}</button></div>
    <button class="btn btn-primary btn-block" style="margin-top:18px" id="leSave">Simpan</button>` });
  const draw = () => { s.$("#leList").innerHTML = items.map((c, i) => `<span class="tg">${catIcon(c) !== "🏷️" ? catIcon(c) + " " : ""}${esc(c)}<button data-i="${i}" aria-label="Hapus ${esc(c)}">✕</button></span>`).join(""); };
  draw();
  const add = () => { const v = s.$("#leNew").value.trim(); if (v && !items.includes(v)) { items.push(v); draw(); } s.$("#leNew").value = ""; s.$("#leNew").focus(); };
  s.$("#leAdd").onclick = add;
  s.$("#leNew").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  s.$("#leList").onclick = e => { const b = e.target.closest("[data-i]"); if (b) { items.splice(Number(b.dataset.i), 1); draw(); } };
  s.$("#leSave").onclick = e => busy(e.currentTarget, async () => {
    if (!items.length) return toast("Minimal satu item.", "warn");
    try { await save(items); s.close(); toast("Tersimpan ✓", "success"); } catch (err) { toast(friendlyError(err), "error"); }
  });
}

function paydaySheet() {
  const s = openSheet({ title: "Tanggal gajian", body: `<p class="muted" style="margin-top:0">Periode budget dimulai setiap tanggal ini sampai sehari sebelum tanggal yang sama bulan berikutnya. Pilih 1 untuk periode per bulan kalender.</p>
    <div class="field"><select class="input select" id="pdV">${Array.from({ length: 28 }, (_, i) => `<option ${i + 1 === payday() ? "selected" : ""}>${i + 1}</option>`).join("")}</select></div>
    <div class="hint" id="pdPrev" style="margin-bottom:14px"></div>
    <button class="btn btn-primary btn-block" id="pdSave">Simpan</button>` });
  const prev = () => { s.$("#pdPrev").textContent = "Periode berjalan: " + periodOf(new Date(), s.$("#pdV").value).label; };
  s.$("#pdV").onchange = prev; prev();
  s.$("#pdSave").onclick = e => busy(e.currentTarget, async () => {
    try { await D.updateSettings("paydayDay", Number(s.$("#pdV").value)); s.close(); toast("Tanggal gajian disimpan ✓", "success"); } catch (err) { toast(friendlyError(err), "error"); }
  });
}

function inviteSheet() {
  const code = state.household.inviteCode;
  const url = location.origin + location.pathname;
  const text = `Gabung ke buku kas "${state.household.name}" di ${APP_NAME}.\n1. Buka ${url}\n2. Masuk dengan Google\n3. Pilih "Gabung dengan kode" dan masukkan: ${code}`;
  const s = openSheet({ title: "Undang anggota", body: `
    <p class="muted" style="margin-top:0">Anggota baru cukup login Google lalu memasukkan kode ini. Mereka akan bisa melihat & mencatat semua transaksi.</p>
    <div class="code-box num" id="ivCode">${esc(code)}</div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn-ghost" id="ivCopy">${icon("copy")} Salin</button>
      <button class="btn btn-primary" id="ivShare">${icon("share")} Bagikan</button>
    </div>
    <button class="btn btn-ghost btn-block btn-sm" style="margin-top:12px" id="ivNew">🔄 Buat kode baru (kode lama tidak berlaku)</button>` });
  s.$("#ivCopy").onclick = async () => { try { await navigator.clipboard.writeText(code); toast("Kode disalin", "success"); } catch { toast("Gagal menyalin", "error"); } };
  s.$("#ivShare").onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: APP_NAME, text }); } catch { /* batal */ } }
    else { try { await navigator.clipboard.writeText(text); toast("Pesan undangan disalin", "success"); } catch { toast("Gagal menyalin", "error"); } }
  };
  s.$("#ivNew").onclick = e => busy(e.currentTarget, async () => {
    try { const c = await D.regenerateInvite(); s.$("#ivCode").textContent = c; toast("Kode baru dibuat", "success"); } catch (err) { toast(friendlyError(err), "error"); }
  });
}

function memberSheet(m) {
  const h = state.household, info = h.memberInfo?.[m] || {};
  const canRemove = isOwner() && m !== state.user.uid;
  const s = openSheet({ title: info.name || "Anggota", body: `
    <div class="kv"><div><span>Email</span><b>${esc(info.email || "-")}</b></div><div><span>Peran</span><b>${m === h.ownerId ? "Pemilik" : "Anggota"}</b></div></div>
    ${canRemove ? `<button class="btn btn-danger btn-block" id="mRm">Keluarkan dari rumah tangga</button>` : ""}` });
  s.$("#mRm")?.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Keluarkan anggota?", message: `${info.name} tidak akan bisa melihat data lagi. Sebaiknya buat kode undangan baru juga.`, okText: "Keluarkan", danger: true }))) return;
    try { await D.removeMember(m); s.close(); toast("Anggota dikeluarkan", "success"); } catch (err) { toast(friendlyError(err), "error"); }
  });
}

async function leaveFlow() {
  if (!(await confirmDialog({ title: "Keluar dari rumah tangga?", message: "Kamu tidak akan bisa melihat data ini lagi kecuali diundang kembali.", okText: "Keluar", danger: true }))) return;
  try { await D.leaveHousehold(); toast("Kamu sudah keluar dari rumah tangga", "success"); } catch (err) { toast(friendlyError(err), "error", 6000); }
}

async function toggleNotif() {
  if (pref.get("notif", false)) { pref.set("notif", false); return toast("Notifikasi dimatikan"); }
  if (!("Notification" in window)) return toast("Perangkat ini tidak mendukung notifikasi.", "warn");
  const p = await Notification.requestPermission();
  if (p === "granted") { pref.set("notif", true); toast("Notifikasi budget aktif 🔔", "success"); }
  else toast("Izin notifikasi ditolak di pengaturan browser.", "warn");
}

function recalcSheet() {
  confirmDialog({ title: "Hitung ulang saldo?", message: "Saldo semua dompet akan dihitung ulang dari seluruh riwayat transaksi. Gunakan jika saldo terlihat tidak cocok.", okText: "Hitung ulang" }).then(async ok => {
    if (!ok) return;
    try { const r = await D.recalcBalances(); toast(`Selesai — ${r.count} transaksi dihitung ulang`, "success"); } catch (err) { toast(friendlyError(err), "error"); }
  });
}

/* ─── Export Excel ─── */
function exportSheet() {
  const pd = payday();
  const opts = [
    ["cur", "Periode berjalan", () => periodOf(new Date(), pd, 0)],
    ["view", "Periode yang dipilih di Riwayat", () => state.view.period],
    ["p3", "3 periode terakhir", () => { const a = periodOf(new Date(), pd, -2); return { start: a.start, end: periodOf(new Date(), pd, 0).end, label: "3 periode terakhir" }; }],
    ["p12", "12 periode terakhir", () => { const a = periodOf(new Date(), pd, -11); return { start: a.start, end: periodOf(new Date(), pd, 0).end, label: "12 periode terakhir" }; }],
    ["all", "Semua data", () => ({ start: null, end: null, label: "Semua data" })],
  ];
  const s = openSheet({ title: "Export ke Excel", body: `
    <div class="set-list" style="margin-bottom:14px">${opts.map(([k, l], i) => `<label class="set-item" style="cursor:pointer"><input type="radio" name="exr" value="${k}" ${i === 0 ? "checked" : ""}><div class="si-main"><b>${l}</b></div></label>`).join("")}</div>
    <button class="btn btn-primary btn-block" id="exGo">${icon("download")} Unduh .xlsx</button>` });
  s.$("#exGo").onclick = e => busy(e.currentTarget, async () => {
    const k = s.$("input[name=exr]:checked").value;
    const r = opts.find(o => o[0] === k)[2]();
    try {
      const [XLSX, list] = await Promise.all([import("../vendor/xlsx.js"), D.fetchRange(r.start, r.end)]);
      const rows = [...list].reverse().map(t => ({
        Tanggal: fmtDate(t.date), Jam: fmtTime(t.date), Jenis: TYPE_LABEL[t.type], Kategori: t.category || "",
        "Tipe Pengeluaran": t.expenseType || "", Dompet: walletName(t.walletId), "Ke Dompet": t.toWalletId ? walletName(t.toWalletId) : "",
        Milik: t.owner || "", "Ke Milik": t.type === "transfer" ? (t.toOwner || "") : "",
        Nominal: t.type === "expense" ? -t.amount : t.amount, Catatan: t.note || "", Bukti: t.hasProof ? "Ada" : "", "Dicatat oleh": memberName(t.createdBy),
      }));
      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: "Tidak ada transaksi" }]);
      ws1["!cols"] = [12, 7, 16, 20, 14, 18, 18, 12, 12, 14, 30, 16].map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws1, "Transaksi");
      const itemRows = [...list].reverse().flatMap(t => (t.items || []).map(i => ({ Tanggal: fmtDate(t.date), Catatan: t.note || "", Kategori: t.category || "", Barang: i.n, Qty: i.q || 1, Harga: i.p })));
      if (itemRows.length) { const wsI = XLSX.utils.json_to_sheet(itemRows); wsI["!cols"] = [12, 26, 18, 36, 6, 12].map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, wsI, "Rincian Struk"); }
      const sm = summarize(list);
      const ring = [
        ["Rentang", r.label], ["Dibuat", fmtDate(new Date(), true)], [],
        ["Pemasukan", sm.income], ["Pengeluaran rutin", sm.rutin], ["Pengeluaran tetap", sm.tetap], ["Total pengeluaran", sm.expense], ["Selisih", sm.income - sm.expense], [],
        ["Pengeluaran per kategori", "Nominal"], ...Object.entries(sm.byCategory).sort((a, b) => b[1] - a[1]),
        [], ["Pengeluaran per kepemilikan", "Nominal"], ...Object.entries(sm.byOwner).sort((a, b) => b[1] - a[1]),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(ring); ws2["!cols"] = [{ wch: 28 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Ringkasan");
      const ws3 = XLSX.utils.aoa_to_sheet([["Dompet", "Jenis", "Status", "Saldo saat ini"], ...allWallets().map(w => [w.name, w.type, w.archived ? "Arsip" : "Aktif", balance(w.id)])]);
      ws3["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 8 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws3, "Saldo Dompet");
      const fname = `Keuangan_${(state.household.name || "Keluarga").replace(/[^\w]+/g, "_")}_${r.label.replace(/[^\w]+/g, "_")}.xlsx`;
      XLSX.writeFile(wb, fname);
      s.close(); toast(`${list.length} transaksi diexport ✓`, "success");
    } catch (err) { toast(friendlyError(err), "error", 6000); }
  });
}

/* ─── Pasang halaman Rencana & kunci aplikasi ─── */
installPlan(VIEWS, {
  state, D, pref, esc, money, rupiah, parseNominal, formatNominalInput, openSheet, confirmDialog, busy, toast, friendlyError, icon,
  walletLabel, walletName, walletIcon, walletOwner, myNick, activeWallets, allWallets, balance, cats, catIcon, fmtDate, toLocalInput,
  summarize, avatarLink,
});
setupLock({ onForgot: () => D.logout(), isLoggedIn: () => !!state.user });

/* ─── Cegah salin / potong / seret teks di luar kolom input ─── */
const editable = el => el?.closest?.("input, textarea, select, [contenteditable]");
["copy", "cut", "dragstart", "selectstart"].forEach(ev => document.addEventListener(ev, e => { if (!editable(e.target)) e.preventDefault(); }));
document.addEventListener("contextmenu", e => { if (!editable(e.target)) e.preventDefault(); });

/* ─── Service worker ─── */
if ("serviceWorker" in navigator && !D.USE_EMU) {
  /* Pembaruan otomatis: cek versi baru saat aplikasi dibuka/kembali aktif, lalu muat ulang sendiri */
  let hadController = !!navigator.serviceWorker.controller, reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) { hadController = true; return; } // pemasangan pertama, bukan pembaruan
    if (reloading) return;
    if (!document.querySelector("#sheetRoot .sheet") && !document.getElementById("lockRoot")) { reloading = true; location.reload(); }
    else toast("Versi baru aplikasi siap", "info", 20000, { label: "Muat ulang", fn: () => location.reload() });
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    setInterval(check, 30 * 60e3);
  }).catch(err => console.warn("SW", err));
}

render();
