/* =====================================================
   HOUSEHOLD FINANCE — app.js
   - Dynamic kepemilikan & dompet via Settings
   - OneSignal push notification (opsional)
   - localStorage cache (instant load)
   - Server-side password validation
===================================================== */

// ─── RUNTIME CONFIG (merge config.js + localStorage) ─
const CFG_KEY = "hf_config";

function getCfg() {
  try {
    const saved = JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
    return Object.assign({}, APP_CONFIG, saved);
  } catch(_) { return APP_CONFIG; }
}

function saveCfg(patch) {
  try {
    const cur = getCfg();
    localStorage.setItem(CFG_KEY, JSON.stringify(Object.assign(cur, patch)));
  } catch(_) {}
}

// Shorthand getters
const SCRIPT_URL      = () => getCfg().scriptUrl;
const ONESIGNAL_APPID = () => getCfg().oneSignalAppId || "";
const SESSION_TTL     = () => getCfg().sessionTTL || 3600000;
const CACHE_TTL       = () => getCfg().cacheTTL   || 180000;

// ─── CACHE ───────────────────────────────────────────
const CACHE_KEY = "hf_cache_v1";

function saveCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch(_) {}
}
function getCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL()) return null;
    return data;
  } catch(_) { return null; }
}

// ─── STATE ───────────────────────────────────────────
let semuaData     = [];
let semuaBudget   = [];
let lastBudgetPct = 0;
let _bgRefreshing = false;

// ─── GAS API ─────────────────────────────────────────
async function gasCall(params) {
  const url = SCRIPT_URL() + "?" + new URLSearchParams({ ...params, _t: Date.now() });
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(_) { throw new Error("Resp bukan JSON: " + text.slice(0, 80)); }
}

// ─── HELPERS ─────────────────────────────────────────
const wait        = ms => new Promise(r => setTimeout(r, ms));
const showLoading = v  => { document.getElementById("loadingOverlay").style.display = v ? "flex" : "none"; };

const formatRupiah = n =>
  "Rp " + Math.abs(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const formatTanggal = t => {
  const d = new Date(t); if (isNaN(d)) return "-";
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

const capitalizeFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

// ─── KEPEMILIKAN & DOMPET (dinamis) ──────────────────
function getKepemilikan() {
  const cfg = getCfg();
  return cfg.kepemilikan && cfg.kepemilikan.length
    ? cfg.kepemilikan
    : (cfg.defaultKepemilikan || ["Saya"]);
}

function getDompetOptions() {
  const cfg = getCfg();
  return cfg.dompet && Object.keys(cfg.dompet).length
    ? cfg.dompet
    : (cfg.defaultDompet || { "Cash": ["Cash"], "M-Banking": ["Bank"], "E-Wallet": ["GoPay"] });
}

function buildKepemilikanOptions(selectId, selectedVal = "") {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const cur = selectedVal || sel.value;
  sel.innerHTML = "";
  getKepemilikan().forEach(k => {
    const o = document.createElement("option");
    o.value = o.textContent = k;
    if (k === cur) o.selected = true;
    sel.appendChild(o);
  });
}

function buildDompetOptions(selectId, selectedVal = "") {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const cur = selectedVal || sel.value;
  sel.innerHTML = "";
  Object.keys(getDompetOptions()).forEach(d => {
    const o = document.createElement("option");
    o.value = o.textContent = d;
    if (d === cur) o.selected = true;
    sel.appendChild(o);
  });
}

function buildDetailOptions(selectId, dompetSelectId, selectedVal = "") {
  const domSel    = document.getElementById(dompetSelectId);
  const detailSel = document.getElementById(selectId);
  if (!domSel || !detailSel) return;
  const opts = getDompetOptions()[domSel.value] || [];
  const cur  = selectedVal || detailSel.value;
  detailSel.innerHTML = '<option value="">-- Pilih --</option>';
  opts.forEach(o => {
    const el = document.createElement("option");
    el.value = el.textContent = o;
    if (o === cur) el.selected = true;
    detailSel.appendChild(el);
  });
}

function rebuildAllSelects() {
  buildKepemilikanOptions("kepemilikan");
  buildDompetOptions("dompet");
  buildDetailOptions("dompetDetail", "dompet");
  buildKepemilikanOptions("trfDariKepemilikan");
  buildKepemilikanOptions("trfKeKepemilikan");
  buildDompetOptions("trfDariDompet");
  buildDompetOptions("trfKeDompet");
  buildDetailOptions("trfDariDetail", "trfDariDompet");
  buildDetailOptions("trfKeDetail", "trfKeDompet");
}

// ─── TOAST ───────────────────────────────────────────
const TOAST_ICONS = { success: "✅", error: "❌", warning: "⚡", info: "ℹ️" };
const TOAST_TYPES = { success: "t-success", error: "t-error", warning: "t-warning", info: "t-info" };
let _toastCount = 0;

function showToast(msg, type = "info", duration = 4000, sub = "") {
  const wrap = document.getElementById("toastContainer");
  const id   = "toast_" + (++_toastCount);
  const el   = document.createElement("div");
  el.id        = id;
  el.className = `toast ${TOAST_TYPES[type] || "t-info"}`;
  el.style.setProperty("--toast-dur", duration + "ms");
  el.innerHTML = `
    <div class="toast-inner">
      <div class="toast-icon-box">${TOAST_ICONS[type] || "ℹ️"}</div>
      <div class="toast-body">
        <div class="toast-title">${msg}</div>
        ${sub ? `<div class="toast-sub" style="display:block">${sub}</div>` : ""}
      </div>
      <button class="toast-close" onclick="dismissToast('${id}')">✕</button>
    </div>`;
  wrap.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
  el._timer = setTimeout(() => dismissToast(id), duration);
}

function dismissToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  clearTimeout(el._timer);
  el.classList.remove("show");
  el.classList.add("hiding");
  setTimeout(() => el.remove(), 300);
}

// ─── SUCCESS NOTIF ───────────────────────────────────
let _snTimer = null;
function showSuccessNotif(icon, label, detail, nominal, dur = 4000) {
  let el = document.getElementById("successNotif");
  if (!el) {
    el = document.createElement("div");
    el.id = "successNotif";
    el.className = "success-notif";
    el.innerHTML = `
      <div class="sn-left"><div class="sn-icon-ring"><span id="snIcon"></span></div></div>
      <div class="sn-body">
        <div class="sn-label"  id="snLabel"></div>
        <div class="sn-detail" id="snDetail"></div>
        <div class="sn-amount" id="snAmount"></div>
      </div>
      <button class="sn-close" onclick="dismissSuccessNotif()">✕</button>
      <div class="sn-progress-track"><div class="sn-progress-fill" id="snFill"></div></div>`;
    document.body.appendChild(el);
  }
  const fill = document.getElementById("snFill");
  fill.style.animation = "none"; fill.offsetWidth;
  fill.style.animation = `snDrain ${dur}ms linear forwards`;
  document.getElementById("snIcon").textContent   = icon;
  document.getElementById("snLabel").textContent  = label;
  document.getElementById("snDetail").textContent = detail;
  document.getElementById("snAmount").textContent = formatRupiah(nominal);
  el.classList.remove("sn-hide");
  el.classList.add("sn-show");
  if (_snTimer) clearTimeout(_snTimer);
  _snTimer = setTimeout(() => dismissSuccessNotif(), dur);
}
function dismissSuccessNotif() {
  const el = document.getElementById("successNotif");
  if (!el) return;
  el.classList.remove("sn-show");
  el.classList.add("sn-hide");
}

// ─── CUSTOM ALERT ────────────────────────────────────
function showAlert({ icon = "ℹ️", title = "", message = "", buttons = [] }) {
  document.getElementById("alertIconWrap").textContent = icon;
  document.getElementById("alertTitle").textContent    = title;
  document.getElementById("alertMessage").textContent  = message;
  const actionsEl = document.getElementById("alertActions");
  actionsEl.innerHTML = "";
  (buttons.length ? buttons : [{ label: "OK", type: "primary" }]).forEach(btn => {
    const b = document.createElement("button");
    b.className   = `alert-btn ${btn.type || "primary"}`;
    b.textContent = btn.label;
    b.onclick     = () => { closeAlert(); if (btn.onClick) btn.onClick(); };
    actionsEl.appendChild(b);
  });
  document.getElementById("alertBackdrop").classList.add("show");
  document.getElementById("alertModal").classList.add("show");
}
function closeAlert() {
  document.getElementById("alertBackdrop").classList.remove("show");
  document.getElementById("alertModal").classList.remove("show");
}

// ─── SPLASH ──────────────────────────────────────────
function showSplash() {
  const bar = document.getElementById("splashBar");
  bar.style.transition = "none"; bar.style.width = "0%";
  document.getElementById("splashPct").textContent    = "0%";
  document.getElementById("splashStatus").textContent = "Memuat data...";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = "width .4s cubic-bezier(.4,0,.2,1)";
    document.getElementById("splashScreen").classList.add("active");
  }));
}
function hideSplash() { document.getElementById("splashScreen").classList.remove("active"); }
function setSplash(pct, status) {
  requestAnimationFrame(() => {
    document.getElementById("splashBar").style.width = pct + "%";
    document.getElementById("splashPct").textContent = Math.round(pct) + "%";
    if (status) document.getElementById("splashStatus").textContent = status;
  });
}

// ─── LOAD DATA ───────────────────────────────────────
function applyData(data) {
  semuaData   = data.transaksi || [];
  semuaBudget = data.budget    || [];
  handleBudgetUI();
  renderDashboard();
  renderRiwayat(filter3HariTerakhir(semuaData));
}

async function loadData(withSplash = false) {
  const cached = getCache();
  if (cached) {
    if (withSplash) {
      showSplash(); setSplash(60, "Memuat data tersimpan...");
      await wait(80); applyData(cached);
      setSplash(100, "Siap! ✨"); await wait(300); hideSplash();
    } else { applyData(cached); }
    _bgRefresh(); return;
  }
  if (withSplash) { showSplash(); await wait(200); setSplash(25, "Menghubungkan ke server..."); }
  else showLoading(true);
  try {
    const data = await gasCall({ action: "getData" });
    if (data.status === "ERROR") {
      showToast("GAS Error: " + data.message, "error");
      withSplash ? hideSplash() : showLoading(false); return;
    }
    saveCache(data);
    if (withSplash) { setSplash(85, "Menyiapkan tampilan..."); await wait(100); }
    applyData(data);
    if (withSplash) { setSplash(100, "Siap! ✨"); await wait(400); hideSplash(); }
  } catch(err) {
    showToast("Gagal memuat data. Cek koneksi internet.", "error");
    withSplash ? hideSplash() : null;
  }
  if (!withSplash) showLoading(false);
}

async function _bgRefresh() {
  if (_bgRefreshing) return;
  _bgRefreshing = true;
  try {
    const data = await gasCall({ action: "getData" });
    if (data.status === "OK") { saveCache(data); applyData(data); }
  } catch(_) {}
  _bgRefreshing = false;
}

async function refreshData() {
  showLoading(true);
  try {
    const data = await gasCall({ action: "getData" });
    if (data.status === "OK") { saveCache(data); applyData(data); }
  } catch(_) { showToast("Gagal refresh data", "error"); }
  showLoading(false);
}

// ─── SIMPAN TRANSAKSI ─────────────────────────────────
async function simpanTransaksi() {
  const kategori = document.getElementById("kategori").value.trim();
  const nominal  = document.getElementById("nominal").value.replace(/\./g, "");
  if (!kategori) { showAlert({ icon: "⚠️", title: "Kategori Kosong", message: "Masukkan kategori transaksi.", buttons: [{ label: "OK" }] }); return; }
  if (!nominal)  { showAlert({ icon: "⚠️", title: "Nominal Kosong",  message: "Masukkan nominal transaksi.", buttons: [{ label: "OK" }] }); return; }

  const btn   = document.getElementById("btnSimpan");
  const jenis = document.getElementById("jenis").value;
  btn.disabled = true; showLoading(true);

  try {
    const result = await gasCall({
      action: "addTransaksi", jenis, kategori, nominal,
      deskripsi:    document.getElementById("deskripsi").value.trim(),
      dompet:       document.getElementById("dompet").value,
      dompetDetail:    document.getElementById("dompetDetail").value,
      kepemilikan:     document.getElementById("kepemilikan").value,
      tipePengeluaran: jenis === "Pengeluaran"
                         ? (document.getElementById("tipePengeluaran")?.value || "Rutin")
                         : "",
    });
    showLoading(false);
    if (result.status === "OK") {
      closeModal();
      document.getElementById("kategori").value  = "";
      document.getElementById("nominal").value   = "";
      document.getElementById("deskripsi").value = "";
      if (document.getElementById("tipePengeluaran")) document.getElementById("tipePengeluaran").value = "Rutin";
      if (document.getElementById("tipePengeluaranWrap")) document.getElementById("tipePengeluaranWrap").style.display = "none";
      if (document.getElementById("jenis")) document.getElementById("jenis").value = "Pendapatan";
      showSuccessNotif(
        jenis === "Pendapatan" ? "💰" : "💸",
        jenis === "Pendapatan" ? "Pendapatan Tercatat ✓" : "Pengeluaran Tercatat ✓",
        kategori, nominal
      );
      localStorage.removeItem(CACHE_KEY);
      await wait(600); refreshData();
    } else {
      showAlert({ icon: "❌", title: "Gagal Menyimpan", message: result.message || "Terjadi kesalahan.", buttons: [{ label: "Tutup", type: "danger" }] });
    }
  } catch(err) {
    showLoading(false);
    showAlert({ icon: "📡", title: "Koneksi Bermasalah", message: err.message, buttons: [{ label: "Tutup", type: "danger" }] });
  } finally { btn.disabled = false; }
}

// ─── PINDAH DANA ──────────────────────────────────────
async function simpanTransfer() {
  const nominal         = document.getElementById("trfNominal").value.replace(/\./g, "");
  const dariKepemilikan = document.getElementById("trfDariKepemilikan").value;
  const dariDompet      = document.getElementById("trfDariDompet").value;
  const dariDetail      = document.getElementById("trfDariDetail").value;
  const keKepemilikan   = document.getElementById("trfKeKepemilikan").value;
  const keDompet        = document.getElementById("trfKeDompet").value;
  const keDetail        = document.getElementById("trfKeDetail").value;
  const catatan         = document.getElementById("trfCatatan").value.trim();

  if (!nominal)    { showAlert({ icon: "⚠️", title: "Nominal Kosong", message: "Masukkan nominal.", buttons: [{ label: "OK" }] }); return; }
  if (!dariDetail) { showAlert({ icon: "⚠️", title: "Pilih Asal",    message: "Pilih detail dompet asal.", buttons: [{ label: "OK" }] }); return; }
  if (!keDetail)   { showAlert({ icon: "⚠️", title: "Pilih Tujuan",  message: "Pilih detail dompet tujuan.", buttons: [{ label: "OK" }] }); return; }
  if (dariDompet === keDompet && dariDetail === keDetail && dariKepemilikan === keKepemilikan) {
    showAlert({ icon: "⚠️", title: "Sama Persis", message: "Dompet asal dan tujuan tidak boleh sama.", buttons: [{ label: "OK" }] }); return;
  }

  const btn = document.getElementById("btnTransfer");
  btn.disabled = true; showLoading(true);

  try {
    const result = await gasCall({ action: "addTransfer", nominal, dariKepemilikan, dariDompet, dariDetail, keKepemilikan, keDompet, keDetail, catatan });
    showLoading(false);
    if (result.status === "OK") {
      closeModal();
      document.getElementById("trfNominal").value = "";
      document.getElementById("trfCatatan").value = "";
      showSuccessNotif("🔄", "Pindah Dana Berhasil ✓", `${dariKepemilikan} → ${keKepemilikan}`, nominal);
      localStorage.removeItem(CACHE_KEY);
      await wait(600); refreshData();
    } else {
      showAlert({ icon: "❌", title: "Transfer Gagal", message: result.message || "Terjadi kesalahan.", buttons: [{ label: "Tutup", type: "danger" }] });
    }
  } catch(err) {
    showLoading(false);
    showAlert({ icon: "📡", title: "Koneksi Bermasalah", message: err.message, buttons: [{ label: "Tutup", type: "danger" }] });
  } finally { btn.disabled = false; }
}

// ─── SET BUDGET ───────────────────────────────────────
async function setBudget() {
  const val = document.getElementById("budgetInput").value.replace(/\./g, "");
  if (!val) { showAlert({ icon: "⚠️", title: "Nominal Kosong", message: "Masukkan nominal budget.", buttons: [{ label: "OK" }] }); return; }

  const periode = getPeriodeBudget();
  const key     = getPeriodeKey(periode.start);
  const btn     = document.getElementById("btnBudget");
  btn.disabled  = true; showLoading(true);

  try {
    const result = await gasCall({
      action: "setBudget", periodeKey: key, periodeLabel: periode.label,
      bulan: periode.start.getMonth() + 1, tahun: periode.start.getFullYear(), budget: val,
    });
    showLoading(false);
    if (result.status === "OK") {
      showSuccessNotif("📊", "Budget Tersimpan ✓", periode.label, val);
      localStorage.removeItem(CACHE_KEY);
      await wait(600); refreshData();
    } else {
      showAlert({ icon: "❌", title: "Gagal Simpan Budget", message: result.message || "Terjadi kesalahan.", buttons: [{ label: "Tutup", type: "danger" }] });
    }
  } catch(err) {
    showLoading(false);
    showAlert({ icon: "📡", title: "Koneksi Bermasalah", message: err.message, buttons: [{ label: "Tutup", type: "danger" }] });
  } finally { btn.disabled = false; }
}

// ─── PERIODE BUDGET (25–24) ───────────────────────────
function getPeriodeBudget(now = new Date()) {
  const d = now.getDate();
  const periodeStart = d >= 25
    ? new Date(now.getFullYear(), now.getMonth(), 25)
    : new Date(now.getFullYear(), now.getMonth() - 1, 25);
  const periodeEnd = new Date(periodeStart.getFullYear(), periodeStart.getMonth() + 1, 24, 23, 59, 59, 999);
  const bn = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const label = `25 ${bn[periodeStart.getMonth()]} – 24 ${bn[periodeEnd.getMonth()]} ${periodeEnd.getFullYear()}`;
  return { start: periodeStart, end: periodeEnd, label };
}
function getPeriodeKey(s) {
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-25`;
}

// ─── RENDER DASHBOARD ────────────────────────────────
function renderDashboard() {
  let pendapatan = 0, pengeluaranTotal = 0, pengeluaranRutin = 0, pengeluaranTetap = 0;
  const saldoPerDompet = {};

  semuaData.forEach(trx => {
    const n = Number(String(trx.nominal).replace(/\./g, "")) || 0;
    const j = String(trx.jenis || "").trim().toLowerCase();
    const key = `${trx.dompet}||${trx.dompetDetail}`;
    if (!saldoPerDompet[key]) saldoPerDompet[key] = { dompet: trx.dompet, detail: trx.dompetDetail, saldo: 0 };
    if (j === "pendapatan") {
      pendapatan += n;
      saldoPerDompet[key].saldo += n;
    } else if (j === "pengeluaran") {
      pengeluaranTotal += n;
      saldoPerDompet[key].saldo -= n;
      if ((trx.tipePengeluaran || "Rutin") === "Tetap") pengeluaranTetap += n;
      else pengeluaranRutin += n;
    } else if (j === "transfer-keluar") saldoPerDompet[key].saldo -= n;
    else if (j === "transfer-masuk")    saldoPerDompet[key].saldo += n;
  });

  document.getElementById("totalPendapatan").textContent  = formatRupiah(pendapatan);
  document.getElementById("totalPengeluaran").textContent = formatRupiah(pengeluaranTotal);
  document.getElementById("saldo").textContent            = formatRupiah(pendapatan - pengeluaranTotal);

  // Ringkasan pengeluaran Rutin vs Tetap
  const elRutin = document.getElementById("totalPengeluaranRutin");
  const elTetap = document.getElementById("totalPengeluaranTetap");
  if (elRutin) elRutin.textContent = formatRupiah(pengeluaranRutin);
  if (elTetap) elTetap.textContent = formatRupiah(pengeluaranTetap);

  // Render saldo per tipe dompet (dinamis)
  const dompetOpts = getDompetOptions();
  const saldoBox   = document.getElementById("subBalances");
  if (saldoBox) {
    saldoBox.innerHTML = "";
    Object.keys(dompetOpts).forEach(tipe => {
      const icon = { "Cash": "💵", "M-Banking": "🏦", "E-Wallet": "📱" }[tipe] || "💰";
      let total = 0;
      Object.values(saldoPerDompet).forEach(v => { if (v.dompet === tipe) total += v.saldo; });
      saldoBox.innerHTML += `
        <div class="sub-balance" onclick="toggleDetail('${tipe}')">
          ${icon} ${tipe}<span>${formatRupiah(total)}</span>
        </div>`;
    });
  }
  updateBudget();
}

function handleBudgetUI() {
  const periode = getPeriodeBudget();
  const key     = getPeriodeKey(periode.start);
  const cur     = semuaBudget.find(b => b.periodeKey === key);
  const pEl     = document.getElementById("budgetPeriod");
  if (pEl) pEl.textContent = "📅 " + periode.label;
  const inp = document.getElementById("budgetInput");
  const btn = document.getElementById("btnBudget");
  if (cur && cur.budget) { inp.value = cur.budget.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); btn.textContent = "Edit"; }
  else { inp.value = ""; btn.textContent = "Set"; }
}

function updateBudget() {
  const periode = getPeriodeBudget();
  const key     = getPeriodeKey(periode.start);
  const cur     = semuaBudget.find(b => b.periodeKey === key);
  let realisasi = 0;
  semuaData.forEach(t => {
    const tgl = new Date(t.tanggal);
    const isRutin = (t.tipePengeluaran || "Rutin") === "Rutin";
    if (tgl >= periode.start && tgl <= periode.end && String(t.jenis).toLowerCase() === "pengeluaran" && isRutin)
      realisasi += Number(String(t.nominal).replace(/\./g, "")) || 0;
  });
  if (!cur || !cur.budget) {
    document.getElementById("budgetSisa").textContent  = "Belum ada budget periode ini";
    document.getElementById("budgetBar").style.width   = "0%";
    document.getElementById("budgetWarning").innerHTML = "";
    return;
  }
  const persen = (realisasi / cur.budget) * 100;
  const sisa   = cur.budget - realisasi;
  document.getElementById("budgetSisa").textContent = "Sisa: " + formatRupiah(sisa);
  const bar  = document.getElementById("budgetBar");
  bar.style.width = Math.min(persen, 100) + "%";
  const warn = document.getElementById("budgetWarning");
  const prev = lastBudgetPct; lastBudgetPct = persen;
  if (persen >= 100)      { bar.style.background = "#ef4444"; warn.innerHTML = "🚨 Budget HABIS!";            warn.className = "budget-warning warning100"; if (prev < 100) _notifBudget(100, sisa, persen); }
  else if (persen >= 90)  { bar.style.background = "#fb923c"; warn.innerHTML = "⚠️ Budget hampir habis (90%)"; warn.className = "budget-warning warning90";  if (prev < 90)  _notifBudget(90, sisa, persen);  }
  else if (persen >= 80)  { bar.style.background = "#fde047"; warn.innerHTML = "⚡ Budget sudah 80%";          warn.className = "budget-warning warning80";  if (prev < 80)  _notifBudget(80, sisa, persen);  }
  else                    { bar.style.background = "#4ade80"; warn.innerHTML = "Budget periode ini aman ✓";   warn.className = "budget-warning"; }
}

function _notifBudget(pct, sisa, ap) {
  const emoji = pct >= 100 ? "🚨" : pct >= 90 ? "⚠️" : "⚡";
  const t = `${emoji} Budget ${pct >= 100 ? "HABIS!" : pct + "% terpakai"}`;
  const b = pct >= 100 ? "Budget periode ini sudah habis!" : `Sisa: ${formatRupiah(sisa)} (${Math.round(ap)}%)`;
  _sendLocalNotif(t, b);
  showToast(`${t} — ${b}`, pct >= 100 ? "error" : "warning", 7000);
}

// ─── DETAIL SALDO BOTTOM SHEET ───────────────────────
function toggleDetail(tipe) {
  const icons = { "Cash": "💵", "M-Banking": "🏦", "E-Wallet": "📱" };
  const ikon  = icons[tipe] || "💰";
  document.getElementById("detailSheetTitle").textContent = `${ikon} Detail ${tipe}`;
  const body = document.getElementById("detailSheetBody");
  body.innerHTML = "";
  const df = semuaData.filter(t => t.dompet === tipe);
  if (!df.length) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:#9ca3af"><div style="font-size:2.5rem;margin-bottom:8px">🪹</div><p>Belum ada transaksi di ${tipe}</p></div>`;
  } else {
    const byDetail = {};
    df.forEach(t => {
      const det = t.dompetDetail || "Tidak Ada";
      const prs = t.kepemilikan  || "Umum";
      if (!byDetail[det]) byDetail[det] = {};
      if (!byDetail[det][prs]) byDetail[det][prs] = 0;
      const n = Number(String(t.nominal).replace(/\./g, "")) || 0;
      const j = String(t.jenis || "").toLowerCase();
      byDetail[det][prs] += (j === "pendapatan" || j === "transfer-masuk") ? n : -n;
    });
    Object.entries(byDetail).forEach(([det, persons]) => {
      const total = Object.values(persons).reduce((a, b) => a + b, 0);
      const g = document.createElement("div"); g.className = "detail-wallet-group";
      g.innerHTML = `<div class="detail-wallet-label">${det}</div>`;
      Object.entries(persons).forEach(([prs, val]) => {
        const row = document.createElement("div"); row.className = "detail-person-row";
        row.innerHTML = `
          <div class="detail-person-info">
            <div class="detail-person-avatar">${prs.charAt(0).toUpperCase()}</div>
            <div>
              <div class="detail-person-name">${prs}</div>
              <div class="detail-person-sub">${det}</div>
            </div>
          </div>
          <div class="detail-person-amount ${val >= 0 ? "positive" : "negative"}">${val < 0 ? "- " : ""}${formatRupiah(Math.abs(val))}</div>`;
        g.appendChild(row);
      });
      const tr = document.createElement("div"); tr.className = "detail-total-row";
      tr.innerHTML = `<span class="detail-total-label">Total ${det}</span><span class="detail-total-amount">${formatRupiah(total)}</span>`;
      g.appendChild(tr); body.appendChild(g);
    });
  }
  document.getElementById("detailBackdrop").classList.add("show");
  document.getElementById("detailSheet").classList.add("show");
}
function closeDetail() {
  document.getElementById("detailBackdrop").classList.remove("show");
  document.getElementById("detailSheet").classList.remove("show");
}

// ─── RIWAYAT ─────────────────────────────────────────
function filter3HariTerakhir(data) {
  const batas = new Date(); batas.setDate(batas.getDate() - 3);
  return data.filter(t => new Date(t.tanggal) >= batas);
}
function filterTanggal() {
  const s = document.getElementById("startDate").value, e = document.getElementById("endDate").value;
  if (!s || !e) { showToast("Pilih tanggal awal dan akhir", "warning"); return; }
  const start = new Date(s), end = new Date(e); end.setHours(23, 59, 59, 999);
  renderRiwayat(semuaData.filter(t => { const d = new Date(t.tanggal); return d >= start && d <= end; }));
}
function filterTable() {
  const kw = document.getElementById("filter").value.toLowerCase();
  renderRiwayat(semuaData.filter(t => (t.kategori + t.dompet + t.jenis + t.deskripsi).toLowerCase().includes(kw)));
}
function renderRiwayat(data) {
  const c = document.getElementById("riwayatContainer"); c.innerHTML = "";
  if (!data.length) { c.innerHTML = "<p style='text-align:center;padding:24px;color:#6b7280'>Tidak ada transaksi.</p>"; return; }
  data.slice().reverse().forEach((trx, idx) => {
    const jr  = String(trx.jenis || "").toLowerCase();
    const isT = jr.startsWith("transfer");
    const bc  = isT ? "transfer" : jr;
    const bl  = isT ? "🔄 Transfer" : trx.jenis;
    c.innerHTML += `
      <div class="${isT ? "trx-card transfer-card" : "trx-card"}" style="animation-delay:${idx * .03}s">
        <div class="trx-header">
          <h6><span class="trx-badge ${bc}">${bl}</span>${(trx.kategori || "").toUpperCase()}</h6>
          <span class="trx-date">${formatTanggal(trx.tanggal)}</span>
        </div>
        <div class="trx-detail">
          <span class="trx-detail-meta">${trx.kepemilikan || ""} • ${trx.dompet || ""} (${trx.dompetDetail || ""})</span>
          <span class="trx-nominal ${bc}">${formatRupiah(trx.nominal)}</span>
        </div>
        <small class="trx-deskripsi">${capitalizeFirst(trx.deskripsi || "-")}${
        trx.jenis === "Pengeluaran" && trx.tipePengeluaran === "Tetap"
          ? ' <span class=\'badge-tetap\'>📌 Tetap</span>'
          : ""
      }</small>
      </div>`;
  });
}

// ─── EXPORT ──────────────────────────────────────────
function exportExcel() {
  let f = semuaData.slice();
  const kw = document.getElementById("filter").value.toLowerCase();
  const sd = document.getElementById("startDate").value, ed = document.getElementById("endDate").value;
  if (kw) f = f.filter(t => (t.kategori + t.dompet + t.jenis + t.deskripsi).toLowerCase().includes(kw));
  if (sd && ed) { const s = new Date(sd), e = new Date(ed); e.setHours(23, 59, 59, 999); f = f.filter(t => { const d = new Date(t.tanggal); return d >= s && d <= e; }); }
  if (!f.length) { showToast("Tidak ada data untuk diekspor", "warning"); return; }
  let csv = "Jenis,Kategori,Nominal,Deskripsi,Kepemilikan,Dompet,Detail,Tanggal\n";
  f.forEach(t => { csv += `${t.jenis},${t.kategori},${t.nominal},"${t.deskripsi}",${t.kepemilikan},${t.dompet},${t.dompetDetail},${formatTanggal(t.tanggal)}\n`; });
  const a = document.createElement("a");
  a.href     = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download = `finance_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ─── MODAL ────────────────────────────────────────────
function openModal() {
  document.getElementById("modalTambah").classList.add("show");
  document.getElementById("modalBackdrop").classList.add("show");
}
function closeModal() {
  document.getElementById("modalTambah").classList.remove("show");
  document.getElementById("modalBackdrop").classList.remove("show");
}
function toggleTipePengeluaran() {
  const jenis = document.getElementById("jenis")?.value;
  const wrap  = document.getElementById("tipePengeluaranWrap");
  if (wrap) wrap.style.display = jenis === "Pengeluaran" ? "" : "none";
}

function onTipePengeluaranChange(sel) {
  if (!sel) return;
  if (sel.value === "Tetap") sel.classList.add("tetap-selected");
  else sel.classList.remove("tetap-selected");
}

function switchModalTab(tab) {
  const isTrx = tab === "trx";
  document.getElementById("panelTrx").style.display      = isTrx ? "" : "none";
  document.getElementById("panelTransfer").style.display = isTrx ? "none" : "";
  document.getElementById("tabTrx").classList.toggle("active", isTrx);
  document.getElementById("tabTransfer").classList.toggle("active", !isTrx);
}

// ─── SETTINGS MODAL ──────────────────────────────────
function openSettings() {
  const cfg = getCfg();
 
  document.getElementById("setAppName").value  = cfg.appName  || "";
  document.getElementById("setAppEmoji").value = cfg.appEmoji || "🏠";
  document.getElementById("setScriptUrl").value    = cfg.scriptUrl    || "";
  document.getElementById("setOneSignalId").value  = cfg.oneSignalAppId || "";
  document.getElementById("setKepemilikan").value =
    (cfg.kepemilikan || cfg.defaultKepemilikan || ["Saya"]).join(", ");
  const dompetCfg = cfg.dompet || cfg.defaultDompet || {};
  document.getElementById("setDompetJson").value =
    JSON.stringify(dompetCfg, null, 2);
 
  // ← BARU: update indikator URL
  checkUrlStatus(cfg.scriptUrl || "");
 
  document.getElementById("settingsBackdrop").classList.add("show");
  document.getElementById("settingsModal").classList.add("show");
}

function closeSettings() {
  document.getElementById("settingsBackdrop").classList.remove("show");
  document.getElementById("settingsModal").classList.remove("show");
}

function saveSettings() {
  const appName    = document.getElementById("setAppName").value.trim();
  const appEmoji   = document.getElementById("setAppEmoji").value.trim();
  const scriptUrl  = document.getElementById("setScriptUrl").value.trim();
  const oneSignal  = document.getElementById("setOneSignalId").value.trim();
  const kepRaw     = document.getElementById("setKepemilikan").value;
  const dompetRaw  = document.getElementById("setDompetJson").value;

  // Validasi kepemilikan
  const kepemilikan = kepRaw.split(",").map(s => s.trim()).filter(Boolean);
  if (!kepemilikan.length) {
    showToast("Kepemilikan tidak boleh kosong", "warning"); return;
  }

  // Validasi dompet JSON
  let dompet;
  try { dompet = JSON.parse(dompetRaw); }
  catch(_) { showToast("Format dompet tidak valid (harus JSON)", "error"); return; }

  saveCfg({ appName, appEmoji, scriptUrl, oneSignalAppId: oneSignal, kepemilikan, dompet });

  // Update app name di UI
  if (appName) {
    const titleEls = document.querySelectorAll(".app-title");
    titleEls.forEach(el => el.textContent = `${appEmoji} ${appName}`);
    document.title = appName;
  }

  // Rebuild selects
  rebuildAllSelects();

  // Reinit OneSignal jika App ID berubah
  if (oneSignal && oneSignal !== APP_CONFIG.oneSignalAppId) {
    _initOneSignal();
  }

  closeSettings();
  showToast("Pengaturan tersimpan ✓", "success");
  localStorage.removeItem(CACHE_KEY);
}

// ─── LOGIN ────────────────────────────────────────────
async function checkPassword() {
  const v = document.getElementById("passwordInput").value;
  if (!v) return;

  // Cek apakah scriptUrl sudah diisi
  if (!SCRIPT_URL()) {
    showAlert({
      icon: "⚙️", title: "Belum Dikonfigurasi",
      message: "Buka Settings dan isi Script URL terlebih dahulu.",
      buttons: [{ label: "Buka Settings", onClick: () => { document.getElementById("loginScreen").style.display = "none"; openSettings(); } }, { label: "Tutup" }]
    }); return;
  }

  const btn = document.querySelector(".btn-login");
  btn.disabled = true; btn.textContent = "Memeriksa...";

  try {
    const result = await gasCall({ action: "checkPassword", pwd: v });
    if (result.status === "OK") {
      localStorage.setItem("hf_session", JSON.stringify({ status: true, time: Date.now() }));
      document.getElementById("loginScreen").style.display = "none";
      loadData(true);
      setTimeout(() => {
        if (_hasOneSignal() && window.OneSignalDeferred) {
          OneSignalDeferred.push(async os => {
            const subscribed = await os.User.PushSubscription.optedIn;
            if (!subscribed) await os.Notifications.requestPermission();
          });
        }
        _checkNotifState();
      }, 1500);
    } else {
      const el = document.getElementById("loginError");
      el.textContent = "❌ Password salah, coba lagi";
      el.style.animation = "none"; el.offsetWidth;
      el.style.animation = "bounceIn .3s ease";
    }
  } catch(err) {
    const el = document.getElementById("loginError");
    el.textContent = "❌ Koneksi bermasalah, coba lagi";
  } finally {
    btn.disabled = false; btn.textContent = "Masuk →";
  }
}

function logout() {
  showAlert({
    icon: "🚪", title: "Keluar?", message: "Sesi akan dihapus.",
    buttons: [
      { label: "Keluar", type: "danger", onClick: () => {
        localStorage.removeItem("hf_session");
        localStorage.removeItem(CACHE_KEY);
        location.reload();
      }},
      { label: "Batal" }
    ]
  });
}

// ─── PUSH NOTIFICATION ───────────────────────────────
const _hasOneSignal = () => {
  const id = ONESIGNAL_APPID();
  return id && id !== "" && id.length > 10;
};

function _initOneSignal() {
  if (!_hasOneSignal()) return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  OneSignalDeferred.push(async function(OneSignal) {
    try {
      await OneSignal.init({
        appId: ONESIGNAL_APPID(),
        notifyButton: { enable: false },
        promptOptions: { slidedown: { prompts: [{ type: "push", autoPrompt: true }] } }
      });
      const perm = await OneSignal.Notifications.permission;
      if (perm) updateNotifBanner(false);
    } catch(e) { console.warn("[OneSignal init]", e); }
  });
}

function _checkNotifState() {
  if (!("Notification" in window)) { updateNotifBanner(false); return; }
  if (Notification.permission === "granted") { updateNotifBanner(false); return; }
  if (Notification.permission === "denied")  { updateNotifBanner(true, "denied"); return; }
  updateNotifBanner(true, "ask");
}

async function askNotifPermission() {
  if (!("Notification" in window)) { showToast("Browser tidak mendukung notifikasi", "warning"); return; }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    updateNotifBanner(false);
    showToast("🔔 Notifikasi aktif!", "success", 4500);
    if (_hasOneSignal() && window.OneSignalDeferred) {
      try { OneSignalDeferred.push(async os => { await os.User.PushSubscription.optIn(); }); }
      catch(e) { console.warn("[OneSignal optIn]", e); }
    }
  } else if (perm === "denied") {
    updateNotifBanner(true, "denied");
    showToast("Notifikasi diblokir. Ubah di pengaturan browser.", "warning", 5000);
  }
}

function updateNotifBanner(show, state = "ask") {
  const banner = document.getElementById("notifBanner");
  if (!banner) return;
  if (!show) { banner.style.display = "none"; return; }
  if (state === "denied") {
    banner.style.display = "flex";
    banner.querySelector(".notif-banner-text strong").textContent = "Notifikasi Diblokir";
    banner.querySelector(".notif-banner-text span").textContent   = "Aktifkan di pengaturan browser";
    banner.querySelector("button").style.display = "none";
  } else {
    banner.style.display = "flex";
    banner.querySelector(".notif-banner-text strong").textContent = "Aktifkan Notifikasi";
    banner.querySelector(".notif-banner-text span").textContent   = "Terima notif transaksi & peringatan budget 🔔";
    const btn = banner.querySelector("button");
    btn.style.display = ""; btn.textContent = "Izinkan";
  }
}

function _sendLocalNotif(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options = {
    body, icon: "assets/icons/icon-192.png", badge: "assets/icons/icon-192.png",
    vibrate: [200, 100, 200], tag: "hf-" + Date.now(), data: { url: window.location.href }
  };
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, options));
  } else { new Notification(title, options); }
}

// ─── INIT ─────────────────────────────────────────────
window.addEventListener("load", () => {
  const cfg = getCfg();

  // Update app name di UI
  const appTitle = `${cfg.appEmoji || "🏠"} ${cfg.appName || "Household Finance"}`;
  document.querySelectorAll(".app-title").forEach(el => el.textContent = appTitle);
  document.title = cfg.appName || "Household Finance";

  // Cek sesi
  const raw = localStorage.getItem("hf_session");
  if (raw) {
    try {
      const sess = JSON.parse(raw);
      if (Date.now() - sess.time < SESSION_TTL()) {
        document.getElementById("loginScreen").style.display = "none";
        loadData(true);
        setTimeout(_checkNotifState, 2500);
      } else { localStorage.removeItem("hf_session"); }
    } catch(_) { localStorage.removeItem("hf_session"); }
  }

  // Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(e => console.warn("[SW]", e));
  }

  // OneSignal
  _initOneSignal();

  // Build selects
  rebuildAllSelects();

  // Event listeners dompet
  document.getElementById("dompet")?.addEventListener("change", () => buildDetailOptions("dompetDetail", "dompet"));
  document.getElementById("trfDariDompet")?.addEventListener("change", () => buildDetailOptions("trfDariDetail", "trfDariDompet"));
  document.getElementById("trfKeDompet")?.addEventListener("change", () => buildDetailOptions("trfKeDetail", "trfKeDompet"));

  // Format angka
  ["nominal", "trfNominal", "budgetInput"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", e => {
      e.target.value = e.target.value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    });
  });

  // Enter to login
  document.getElementById("passwordInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter") checkPassword();
  });
});

// Update indikator status URL di settings form
function checkUrlStatus(val) {
  const el = document.getElementById("urlStatus");
  if (!el) return;
  if (!val || !val.trim()) {
    el.textContent = "Belum diisi";
    el.className = "settings-url-status empty";
  } else if (val.includes("script.google.com")) {
    el.textContent = "✓ Terisi";
    el.className = "settings-url-status ok";
  } else {
    el.textContent = "Cek URL";
    el.className = "settings-url-status empty";
  }
}
