/* Kunci aplikasi per perangkat: PIN (PBKDF2) + sidik jari/wajah (WebAuthn platform).
   Data kunci hanya disimpan di perangkat ini; tidak dikirim ke server. */
import { openSheet, toast, confirmDialog } from "./ui.js";

const KEY = "kn_lock";
const AUTO_LOCK_MS = 60 * 1000;
let opts = { onForgot: () => {}, isLoggedIn: () => false };
let unlocked = false, hiddenAt = 0;
/* Sesi buka-kunci disimpan di sessionStorage (hilang saat aplikasi/tab ditutup),
   supaya refresh tidak meminta PIN lagi selama aktivitas terakhir < 60 detik. */
const SK = "kn_unlock_seen";
const touch = () => { try { if (unlocked) sessionStorage.setItem(SK, String(Date.now())); } catch { /* abaikan */ } };
const freshSession = () => { try { const t = +sessionStorage.getItem(SK); return t && Date.now() - t < AUTO_LOCK_MS; } catch { return false; } };
const endSession = () => { try { sessionStorage.removeItem(SK); } catch { /* abaikan */ } };

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
const save = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* abaikan */ } };
export const lockConfigured = () => !!load()?.hash;

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPin(pin, saltB64) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: 150000 }, key, 256);
  return b64(bits);
}

export const bioAvailable = async () => {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch { return false; }
};
async function bioRegister() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Keuangan Nativan", id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "keuangan-lock", displayName: "Kunci Keuangan" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60000,
    },
  });
  return b64(cred.rawId);
}
async function bioVerify(idB64) {
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: unb64(idB64), transports: ["internal"] }],
      userVerification: "required", timeout: 60000,
    },
  });
  return true;
}

/* ─── Layar kunci ─── */
function showLock() {
  const cfg = load();
  if (!cfg?.hash || document.getElementById("lockRoot")) return;
  unlocked = false;
  const root = document.createElement("div");
  root.id = "lockRoot";
  root.innerHTML = `<div class="lock-box">
    <div class="brand-logo" style="margin:0 auto">N</div>
    <h2>Masukkan PIN</h2><div class="muted" style="font-size:13px">Keuangan Nativan terkunci</div>
    <div class="lock-dots" id="lkDots">${"<i></i>".repeat(cfg.len || 6)}</div>
    <div class="lock-msg" id="lkMsg"></div>
    <div class="keypad" id="lkPad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join("")}
      <button class="ghost" data-k="bio">${cfg.bio ? "👆 Sidik jari" : ""}</button><button data-k="0">0</button><button class="ghost" data-k="del">⌫</button>
    </div>
    <button class="link-btn" id="lkForgot" style="margin-top:18px">Lupa PIN? Keluar akun</button>
  </div>`;
  document.body.appendChild(root);
  document.body.style.overflow = "hidden";
  let pin = "", busy = false;
  const len = cfg.len || 6;
  const dots = () => root.querySelectorAll("#lkDots i").forEach((d, i) => d.classList.toggle("on", i < pin.length));
  const done = () => { unlocked = true; touch(); root.remove(); document.body.style.overflow = ""; cfg.fails = 0; save({ ...load(), fails: 0, until: 0 }); };
  const msg = t => { root.querySelector("#lkMsg").textContent = t; };
  const tryBio = async () => {
    if (!cfg.bio) return;
    try { await bioVerify(cfg.bio); done(); } catch { msg("Sidik jari dibatalkan — gunakan PIN."); }
  };
  const check = async () => {
    const c = load();
    if (c.until && Date.now() < c.until) { msg(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((c.until - Date.now()) / 1000)} detik.`); pin = ""; dots(); return; }
    busy = true;
    const ok = (await hashPin(pin, c.salt)) === c.hash;
    busy = false;
    if (ok) return done();
    const fails = (c.fails || 0) + 1;
    save({ ...c, fails, until: fails >= 5 ? Date.now() + 30000 * Math.pow(2, Math.min(4, fails - 5)) : 0 });
    pin = ""; dots();
    const box = root.querySelector("#lkDots"); box.classList.remove("shake"); void box.offsetWidth; box.classList.add("shake");
    msg(fails >= 5 ? "PIN salah 5 kali. Tunggu sebentar." : `PIN salah (${fails}/5)`);
  };
  const press = k => {
    if (busy) return;
    if (k === "bio") return tryBio();
    if (k === "del") { pin = pin.slice(0, -1); dots(); return; }
    if (pin.length >= len) return;
    pin += k; dots(); msg("");
    if (pin.length === len) check();
  };
  root.querySelector("#lkPad").onclick = e => { const b = e.target.closest("[data-k]"); if (b) press(b.dataset.k); };
  root.addEventListener("keydown", e => { if (/^\d$/.test(e.key)) press(e.key); if (e.key === "Backspace") press("del"); });
  root.tabIndex = -1; root.focus();
  root.querySelector("#lkForgot").onclick = async () => {
    if (!(await confirmDialog({ title: "Lupa PIN?", message: "Kunci akan dihapus dari perangkat ini dan kamu akan keluar dari akun. Data tetap aman di cloud — login lagi dengan Google lalu buat PIN baru.", okText: "Keluar akun", danger: true }))) return;
    save(null); done(); opts.onForgot();
  };
  if (cfg.bio) setTimeout(tryBio, 300);
}

export function setupLock(o) {
  opts = { ...opts, ...o };
  if (freshSession()) { unlocked = true; touch(); }
  setInterval(() => { if (!document.hidden) touch(); }, 10000);
  addEventListener("pagehide", touch);
  // Kunci saat dibuka (setelah login terdeteksi) & setelah ditinggal > 60 detik
  const tryLock = () => { if (lockConfigured() && opts.isLoggedIn() && !unlocked) showLock(); };
  const start = Date.now();
  const iv = setInterval(() => { if (opts.isLoggedIn() || Date.now() - start > 15000) { clearInterval(iv); tryLock(); } }, 200);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); touch(); }
    else if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) { unlocked = false; endSession(); tryLock(); }
  });
}

/* ─── Pengaturan kunci ─── */
function pinPrompt(title, sub) {
  return new Promise(resolve => {
    let done = false;
    const s = openSheet({
      title,
      body: `<p class="muted" style="margin-top:0">${sub}</p>
        <div class="field"><input class="input num" id="pnV" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="4–6 angka" style="font-size:24px;letter-spacing:.5em;text-align:center" autofocus></div>
        <button class="btn btn-primary btn-block" id="pnOk">Lanjut</button>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const ok = () => {
      const v = s.$("#pnV").value.replace(/\D/g, "");
      if (v.length < 4) return toast("PIN minimal 4 angka.", "warn");
      done = true; resolve(v); s.close();
    };
    s.$("#pnV").oninput = e => { e.target.value = e.target.value.replace(/\D/g, ""); };
    s.$("#pnV").onkeydown = e => { if (e.key === "Enter") ok(); };
    s.$("#pnOk").onclick = ok;
    setTimeout(() => s.$("#pnV")?.focus(), 80);
  });
}

export async function lockSettingsSheet() {
  const cfg = load();
  const canBio = await bioAvailable();
  return new Promise(resolve => {
    const s = openSheet({
      title: "Kunci aplikasi",
      onClose: resolve,
      body: `<p class="muted" style="margin-top:0">Aplikasi meminta PIN saat dibuka dan setelah ditinggal lebih dari 1 menit. Berlaku hanya di perangkat ini.</p>
        <div class="set-list" style="margin-bottom:14px">
          <button class="set-item" id="lsPin"><div class="si-ico">🔢</div><div class="si-main"><b>${cfg?.hash ? "Ganti PIN" : "Aktifkan dengan PIN"}</b><small>4–6 angka</small></div></button>
          ${cfg?.hash ? `<button class="set-item" id="lsBio" ${canBio ? "" : "disabled"}><div class="si-ico">👆</div><div class="si-main"><b>Sidik jari / Face ID</b><small>${canBio ? "Buka kunci tanpa mengetik PIN" : "Tidak didukung di perangkat/browser ini"}</small></div><div class="si-end">${cfg.bio ? "Aktif" : "Mati"}</div></button>
          <button class="set-item" id="lsOff"><div class="si-ico">🔓</div><div class="si-main"><b>Matikan kunci</b></div></button>` : ""}
        </div>`,
    });
    s.$("#lsPin").onclick = async () => {
      if (cfg?.hash) {
        const old = await pinPrompt("PIN lama", "Masukkan PIN saat ini.");
        if (!old) return;
        if ((await hashPin(old, cfg.salt)) !== cfg.hash) return toast("PIN lama salah.", "error");
      }
      const p1 = await pinPrompt("PIN baru", "Buat PIN 4–6 angka. Jangan gunakan tanggal lahir.");
      if (!p1) return;
      const p2 = await pinPrompt("Ulangi PIN", "Masukkan PIN yang sama sekali lagi.");
      if (p1 !== p2) return toast("PIN tidak sama, ulangi.", "error");
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      save({ hash: await hashPin(p1, salt), salt, len: p1.length, bio: cfg?.bio || null });
      unlocked = true; touch();
      s.close(); toast("Kunci aplikasi aktif 🔒", "success");
    };
    s.$("#lsBio")?.addEventListener("click", async () => {
      const c = load();
      if (c.bio) { save({ ...c, bio: null }); s.close(); return toast("Sidik jari dimatikan"); }
      try { const id = await bioRegister(); save({ ...c, bio: id }); s.close(); toast("Sidik jari aktif 👆", "success"); }
      catch (err) { toast("Gagal mengaktifkan sidik jari: " + (err.message || err.name), "error", 6000); }
    });
    s.$("#lsOff")?.addEventListener("click", async () => {
      const c = load();
      const p = await pinPrompt("Matikan kunci", "Masukkan PIN untuk konfirmasi.");
      if (!p) return;
      if ((await hashPin(p, c.salt)) !== c.hash) return toast("PIN salah.", "error");
      save(null); s.close(); toast("Kunci aplikasi dimatikan");
    });
  });
}
