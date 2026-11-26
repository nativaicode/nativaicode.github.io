/* Laporan periode sebagai gambar (PNG 1080×1350) untuk dibagikan ke WhatsApp dsb. */
import { rupiah, catIcon, fmtDate } from "./util.js";

const W = 1080, H = 1350, F = '"Plus Jakarta Sans", system-ui, sans-serif';

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function wrap(ctx, text, x, y, maxW, lh, maxLines = 3) {
  const words = String(text).split(" ");
  let line = "", lines = 0;
  for (let i = 0; i < words.length; i++) {
    const t = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(t).width > maxW && line) {
      lines++;
      if (lines === maxLines) { ctx.fillText(line + "…", x, y); return y + lh; }
      ctx.fillText(line, x, y); y += lh; line = words[i];
    } else line = t;
  }
  if (line) { ctx.fillText(line, x, y); y += lh; }
  return y;
}

export async function drawReport({ household, period, summary: s, budget = 0, insights = [], balance = 0 }) {
  try { await document.fonts.load(`700 40px ${F}`); await document.fonts.load(`500 28px ${F}`); } catch { /* fallback */ }
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  // latar
  ctx.fillStyle = "#f3f6f5"; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, 360);
  g.addColorStop(0, "#0f766e"); g.addColorStop(1, "#14b8a6");
  ctx.fillStyle = g; rr(ctx, 0, 0, W, 380, [0, 0, 48, 48]); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.beginPath(); ctx.arc(W - 80, 60, 200, 0, 7); ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = `600 30px ${F}`; ctx.fillText("Laporan Keuangan", 64, 92);
  ctx.font = `800 54px ${F}`; ctx.fillText(household, 64, 160);
  ctx.font = `500 30px ${F}`; ctx.globalAlpha = .9; ctx.fillText(`📅 ${period.label}`, 64, 212); ctx.globalAlpha = 1;
  ctx.font = `600 26px ${F}`; ctx.globalAlpha = .85; ctx.fillText("Total saldo semua dompet", 64, 280); ctx.globalAlpha = 1;
  ctx.font = `800 48px ${F}`; ctx.fillText(rupiah(balance), 64, 336);

  // kotak ringkasan
  const boxes = [["Pemasukan", s.income, "#15803d"], ["Pengeluaran", s.expense, "#be123c"], ["Selisih", s.income - s.expense, "#0f1f1b"]];
  boxes.forEach(([l, v, col], i) => {
    const x = 48 + i * 336, y = 412;
    ctx.fillStyle = "#fff"; rr(ctx, x, y, 312, 140, 28); ctx.fill();
    ctx.fillStyle = "#5d6f6a"; ctx.font = `600 24px ${F}`; ctx.fillText(l, x + 28, y + 50);
    ctx.fillStyle = col; ctx.font = `800 ${Math.abs(v) >= 1e9 ? 28 : 34}px ${F}`; ctx.fillText(rupiah(v), x + 28, y + 102);
  });

  let y = 592;
  // budget
  ctx.fillStyle = "#fff"; rr(ctx, 48, y, W - 96, 170, 28); ctx.fill();
  ctx.fillStyle = "#0f1f1b"; ctx.font = `700 28px ${F}`; ctx.fillText("Budget pengeluaran rutin", 84, y + 52);
  if (budget > 0) {
    const pct = s.rutin / budget;
    ctx.font = `600 24px ${F}`; ctx.fillStyle = "#5d6f6a";
    ctx.fillText(`${rupiah(s.rutin)} dari ${rupiah(budget)} · ${Math.round(pct * 100)}%`, 84, y + 92);
    ctx.fillStyle = "#eef3f1"; rr(ctx, 84, y + 116, W - 168, 24, 12); ctx.fill();
    ctx.fillStyle = pct >= 1 ? "#be123c" : pct >= .8 ? "#f59e0b" : "#15803d";
    rr(ctx, 84, y + 116, Math.max(24, (W - 168) * Math.min(1, pct)), 24, 12); ctx.fill();
  } else { ctx.font = `500 24px ${F}`; ctx.fillStyle = "#5d6f6a"; ctx.fillText("Belum ada budget untuk periode ini", 84, y + 96); }
  y += 200;

  // top kategori
  const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const hCat = 70 + Math.max(1, cats.length) * 58;
  ctx.fillStyle = "#fff"; rr(ctx, 48, y, W - 96, hCat, 28); ctx.fill();
  ctx.fillStyle = "#0f1f1b"; ctx.font = `700 28px ${F}`; ctx.fillText("Pengeluaran terbesar", 84, y + 52);
  const max = cats[0]?.[1] || 1;
  cats.forEach(([c, v], i) => {
    const yy = y + 100 + i * 58;
    ctx.font = `600 24px ${F}`; ctx.fillStyle = "#0f1f1b"; ctx.fillText(`${catIcon(c)} ${c}`, 84, yy);
    ctx.textAlign = "right"; ctx.font = `700 24px ${F}`; ctx.fillText(rupiah(v), W - 84, yy); ctx.textAlign = "left";
    ctx.fillStyle = "#eef3f1"; rr(ctx, 84, yy + 12, W - 168, 10, 5); ctx.fill();
    ctx.fillStyle = "#14b8a6"; rr(ctx, 84, yy + 12, Math.max(10, (W - 168) * v / max), 10, 5); ctx.fill();
  });
  if (!cats.length) { ctx.font = `500 24px ${F}`; ctx.fillStyle = "#5d6f6a"; ctx.fillText("Belum ada pengeluaran", 84, y + 100); }
  y += hCat + 30;

  // insight
  if (insights.length && y < H - 200) {
    const avail = H - 90 - y;
    ctx.fillStyle = "#fff"; rr(ctx, 48, y, W - 96, avail, 28); ctx.fill();
    ctx.fillStyle = "#0f1f1b"; ctx.font = `700 28px ${F}`; ctx.fillText("💡 Catatan", 84, y + 52);
    let yy = y + 96;
    for (const it of insights) {
      if (yy > y + avail - 40) break;
      ctx.font = `700 23px ${F}`; ctx.fillStyle = "#0f1f1b"; yy = wrap(ctx, `${it.icon} ${it.title}`, 84, yy, W - 168, 30, 1);
      ctx.font = `500 21px ${F}`; ctx.fillStyle = "#5d6f6a"; yy = wrap(ctx, it.text, 84, yy, W - 168, 28, 2) + 12;
    }
  }
  ctx.fillStyle = "#93a39e"; ctx.font = `600 22px ${F}`; ctx.textAlign = "center";
  ctx.fillText(`Keuangan Nativan · dibuat ${fmtDate(new Date(), true)}`, W / 2, H - 40);
  return c;
}

export async function shareReport(data) {
  const c = await drawReport(data);
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  const name = `Laporan_${data.household.replace(/[^\w]+/g, "_")}_${data.period.key}.png`;
  const file = new File([blob], name, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "Laporan Keuangan", text: `Laporan keuangan ${data.household} — ${data.period.label}` });
    return "shared";
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "downloaded";
}
