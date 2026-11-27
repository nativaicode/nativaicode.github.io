/* Komponen UI kecil: ikon, toast, sheet, dialog konfirmasi */
import { esc } from "./util.js";

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M4 21h16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  cloudoff: '<path d="m2 2 20 20M5.8 8.2A6 6 0 0 0 7 20h10m3.5-2.5A4.5 4.5 0 0 0 17 10a6 6 0 0 0-8.3-4.6"/>',
};
export const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;

export const GOOGLE_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

/* ─── Toast ─── */
export function toast(msg, type = "info", ms = 3200, action = null) {
  const root = document.getElementById("toastRoot");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const span = document.createElement("span");
  span.textContent = msg; span.style.flex = "1";
  el.appendChild(span);
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-action"; b.textContent = action.label;
    b.onclick = () => { el.remove(); action.fn(); };
    el.appendChild(b);
  }
  root.appendChild(el);
  while (root.children.length > 2) root.firstElementChild.remove();
  setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, ms);
}

/* ─── Sheet (bottom sheet di HP, dialog di desktop) ─── */
let sheetStack = [];
export function openSheet({ title = "", body = "", onMount, onClose, wide = false } = {}) {
  const root = document.getElementById("sheetRoot");
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${wide ? 'style="width:min(720px,94vw)"' : ""}>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Tutup">${icon("x")}</button></div>
      <div class="sheet-body">${body}</div>
    </div>`;
  root.appendChild(wrap);
  document.body.style.overflow = "hidden";
  const api = {
    el: wrap.querySelector(".sheet"),
    close() {
      if (!wrap.isConnected) return;
      wrap.remove();
      sheetStack = sheetStack.filter(s => s !== api);
      if (!sheetStack.length) document.body.style.overflow = "";
      onClose?.();
    },
    $(sel) { return wrap.querySelector(sel); },
    $$(sel) { return [...wrap.querySelectorAll(sel)]; },
  };
  wrap.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => api.close()));
  sheetStack.push(api);
  onMount?.(api);
  const first = api.el.querySelector("[autofocus]");
  if (first && matchMedia("(min-width: 700px)").matches) setTimeout(() => first.focus(), 50);
  return api;
}
/* Keyboard HP: jaga lembar & tombolnya tetap di atas keyboard */
(function keyboardAware() {
  const vv = window.visualViewport;
  if (!vv) return;
  const upd = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty("--kb", kb + "px");
    document.documentElement.style.setProperty("--vvh", Math.round(vv.height) + "px");
  };
  vv.addEventListener("resize", upd); vv.addEventListener("scroll", upd); upd();
  document.addEventListener("focusin", e => {
    const f = e.target;
    const sheet = f.closest?.(".sheet");
    if (!sheet || !f.matches("input, textarea, select") || matchMedia("(min-width: 700px)").matches) return;
    setTimeout(() => {
      // tampilkan tombol utama di bawah isian (bila muat), lalu pastikan isian tetap terlihat
      const btns = [...sheet.querySelectorAll(".btn-primary")].filter(b => b.offsetParent && (b.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING));
      const btn = btns[0];
      if (btn) {
        const sr = sheet.getBoundingClientRect(), br = btn.getBoundingClientRect(), fr = f.getBoundingClientRect();
        if (br.bottom > sr.bottom - 8 && br.bottom - fr.top < sr.height - 16) sheet.scrollTop += br.bottom - sr.bottom + 16;
      }
      f.scrollIntoView({ block: "nearest" });
    }, 320);
  });
})();

export function closeTopSheet() { sheetStack[sheetStack.length - 1]?.close(); }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeTopSheet(); });

/* ─── Konfirmasi ─── */
export function confirmDialog({ title, message, okText = "Ya", danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const s = openSheet({
      title,
      body: `<p class="muted" style="margin:0 0 18px">${esc(message)}</p>
        <div class="btn-row"><button class="btn btn-ghost" data-no>Batal</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-yes>${esc(okText)}</button></div>`,
      onClose: () => { if (!done) resolve(false); },
    });
    s.$("[data-no]").onclick = () => { done = true; resolve(false); s.close(); };
    s.$("[data-yes]").onclick = () => { done = true; resolve(true); s.close(); };
  });
}

/** Tombol dengan status loading */
export async function busy(btn, fn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span>`;
  try { return await fn(); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = html; } }
}

export function friendlyError(err) {
  const c = err?.code || "";
  if (c.includes("permission-denied")) return "Akses ditolak database. Jika baru update aplikasi, pastikan firestore.rules terbaru sudah di-Publish di Firebase.";
  if (c.includes("unavailable")) return "Tidak ada koneksi. Coba lagi nanti.";
  if (c === "auth/network-request-failed") return "Koneksi bermasalah saat login.";
  if (c === "auth/unauthorized-domain") return "Domain ini belum diizinkan di Firebase (Authentication → Settings → Authorized domains).";
  if (c === "auth/operation-not-allowed") return "Login Google belum diaktifkan di Firebase Authentication.";
  return err?.message || "Terjadi kesalahan.";
}
