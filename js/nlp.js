/* Pemahaman teks bahasa Indonesia untuk pencatatan cepat (suara, struk, kategori otomatis).
   Semua fungsi murni → mudah diuji. */

/* ─── Normalisasi ─── */
export const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9.,!\s]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["di", "ke", "dari", "pakai", "pake", "lewat", "via", "untuk", "buat", "yang", "dan", "beli", "bayar", "rp", "rupiah", "ribu", "juta", "rb", "jt", "tadi", "hari", "ini", "saya", "aku", "kita", "the", "dengan", "sama", "bulan"]);

/* ─── Angka ─── */
const DIGIT = { nol: 0, satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
const SPECIAL = { sepuluh: 10, sebelas: 11, seratus: 100 };
const SCALE = { ribu: 1e3, rb: 1e3, k: 1e3, juta: 1e6, jt: 1e6, miliar: 1e9, milyar: 1e9, m: 1e9 };
const NUMWORD = new Set([...Object.keys(DIGIT), ...Object.keys(SPECIAL), "belas", "puluh", "ratus", "seribu", "sejuta", "setengah", "ribu", "juta", "miliar", "milyar"]);

/** "seratus lima puluh ribu" → 150000 */
export function wordsToNumber(tokens) {
  let total = 0, small = 0, last = 0, half = false;
  for (const t of tokens) {
    if (t === "setengah") { half = true; continue; }
    if (t in DIGIT && t !== "se") { small += DIGIT[t]; last = DIGIT[t]; }
    else if (t in SPECIAL) { small += SPECIAL[t]; last = 0; }
    else if (t === "belas") { small += 10; last = 0; }
    else if (t === "puluh") { small += last * 9; last = 0; }
    else if (t === "ratus") { small += last * 99; last = 0; }
    else if (t === "seribu") { total += 1000; small = 0; }
    else if (t === "sejuta") { total += 1e6; small = 0; }
    else if (t in SCALE) {
      const mul = half && !small ? 0.5 : (small || 1) + (half ? 0.5 : 0);
      total += mul * SCALE[t];
      small = 0; last = 0; half = false;
    }
  }
  return Math.round(total + small);
}

/** Cari nominal dalam teks: "150 ribu", "1,5 juta", "Rp 25.000", "50rb", "seratus lima puluh ribu" → angka terbesar */
export function parseAmount(text) {
  const s = norm(text).replace(/rp\.?\s*/g, " ");
  const found = [];
  const re = /(\d+(?:[.,]\d+)*)\s*(ribu|rb|k|juta|jt|miliar|milyar|m)?\b/g;
  let m;
  while ((m = re.exec(s))) {
    let num = m[1];
    const unit = m[2];
    let v;
    if (unit) {
      // 1,5 juta / 1.5 jt → desimal; 1.500 ribu → ribuan
      if (/^\d+[.,]\d{1,2}$/.test(num)) v = parseFloat(num.replace(",", "."));
      else v = parseFloat(num.replace(/[.,]/g, ""));
      v *= SCALE[unit];
    } else {
      if (/^\d{1,3}([.,]\d{3})+$/.test(num)) v = parseFloat(num.replace(/[.,]/g, ""));
      else if (/^\d+[.,]\d{1,2}$/.test(num)) v = parseFloat(num.replace(",", "."));
      else v = parseFloat(num.replace(/[.,]/g, ""));
    }
    if (v > 0) found.push(v);
  }
  // kata bilangan
  const toks = s.split(" ");
  let span = [];
  const flush = () => { if (span.some(t => t !== "se")) { const v = wordsToNumber(span); if (v > 0) found.push(v); } span = []; };
  for (const t of toks) { if (NUMWORD.has(t)) span.push(t); else flush(); }
  flush();
  return found.length ? Math.round(Math.max(...found)) : 0;
}

/* ─── Kamus kategori bawaan (dipetakan ke kategori yang benar-benar ada) ─── */
const DICT = [
  [/makan|minum|kopi|sarapan|nasi|bakso|mie|mi ayam|gofood|grabfood|shopeefood|jajan|warteg|resto|kfc|mcd|mcdonald|starbucks|snack|cemilan|martabak|sate|soto|pizza|burger|boba|es teh|warung/, ["Makan & Minum", "Makan", "Makanan"]],
  [/belanja|pasar|sayur|beras|telur|minyak goreng|galon|indomaret|alfamart|alfamidi|superindo|hypermart|osave|o save|transmart|lotte|sembako|lauk|ikan|ayam potong|daging|gula|tepung|bumbu|grosir/, ["Belanja Dapur", "Belanja", "Dapur", "Kebutuhan Dapur"]],
  [/bensin|pertamina|pertamax|pertalite|shell|spbu|parkir|tol|ojek|gojek|goride|grabbike|grabcar|gocar|krl|commuter|mrt|lrt|transjakarta|busway|kereta|taksi|servis motor|servis mobil|oli|cuci motor|cuci mobil|e toll|etoll/, ["Transportasi", "Transport", "Kendaraan"]],
  [/listrik|pln|token|pdam|air bersih|wifi|internet|indihome|biznet|first media|myrepublic|pulsa|kuota|paket data|iuran|ipl|sampah|tagihan/, ["Tagihan & Utilitas", "Tagihan", "Utilitas"]],
  [/cicilan|kpr|kredit|angsuran|paylater|leasing/, ["Cicilan", "Angsuran", "Kredit"]],
  [/sekolah|spp|buku|les|kursus|kuliah|ukt|seragam|daycare/, ["Pendidikan", "Sekolah"]],
  [/obat|apotek|apotik|dokter|klinik|rumah sakit|vitamin|bpjs|vaksin|lab/, ["Kesehatan"]],
  [/popok|pampers|diapers|susu anak|susu formula|mainan|baju anak/, ["Anak", "Kebutuhan Anak"]],
  [/sabun|deterjen|detergen|tisu|tissue|sampo|shampoo|pasta gigi|perabot|laundry|gas elpiji|elpiji|lpg/, ["Rumah Tangga", "Kebutuhan Rumah"]],
  [/nonton|bioskop|netflix|spotify|youtube premium|game|liburan|rekreasi|wisata|hotel|tiket konser/, ["Hiburan", "Liburan"]],
  [/sedekah|infaq|infak|zakat|donasi|amal|wakaf|kurban|qurban/, ["Sedekah & Donasi", "Sedekah", "Donasi"]],
  [/gaji|payroll|upah/, ["Gaji"]],
  [/bonus|thr|insentif|tunjangan/, ["Bonus"]],
  [/jualan|usaha|penjualan|dagang|omzet/, ["Usaha"]],
  [/hadiah|angpau|angpao|kado/, ["Hadiah"]],
];
const INCOME_RE = /\b(gaji|terima|diterima|pemasukan|masuk|dapat|dapet|bonus|thr|cashback|refund|pengembalian|transferan dari|dikasih|angpau|penjualan|jualan laku)\b/;
const TRANSFER_RE = /\b(pindah|pindahkan|transfer ke|tf ke|tarik tunai|ambil uang|top ?up|isi saldo|setor tunai)\b/;

const lc = s => String(s || "").toLowerCase();
function findCat(name, list) {
  const n = lc(name);
  return list.find(c => lc(c) === n) || list.find(c => lc(c).includes(n) || n.includes(lc(c)));
}

/** Kunci memori dari catatan: kata bermakna pertama, mis. "Indomaret Cinere" → "indomaret" */
export function memoryKeys(note) {
  const toks = norm(note).replace(/[.,!]/g, " ").split(" ").filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t) && !NUMWORD.has(t));
  const keys = [];
  if (toks[0]) keys.push(toks[0]);
  if (toks.length >= 2) keys.push(toks.slice(0, 2).join(" "));
  return keys;
}

/**
 * Tebak kategori dari teks.
 * @param {string} text
 * @param {"expense"|"income"} type
 * @param {string[]} cats    kategori yang ada untuk jenis ini
 * @param {object} memory    {kunci: kategori} hasil belajar
 */
export function guessCategory(text, type, cats, memory = {}) {
  const t = norm(text);
  if (!t) return "";
  // 1) memori (frasa 2 kata dulu, lalu kata tunggal)
  const keys = memoryKeys(text).reverse();
  for (const k of keys) if (memory[k] && cats.includes(memory[k])) return memory[k];
  for (const tok of t.split(" ")) if (memory[tok] && cats.includes(memory[tok])) return memory[tok];
  // 2) nama kategori disebut langsung
  for (const c of cats) { const n = norm(c).split(" ")[0]; if (n.length >= 4 && t.includes(n)) return c; }
  // 3) kamus bawaan
  for (const [re, names] of DICT) if (re.test(t)) for (const nm of names) { const c = findCat(nm, cats); if (c) return c; }
  return "";
}

/** Cocokkan dompet yang disebut: "pakai BTN Ibun" → wallet {name:"BTN", owner:"Ibun"} */
export function guessWallet(text, wallets) {
  const t = " " + norm(text) + " ";
  let best = null, score = 0;
  for (const w of wallets) {
    const name = norm(w.name);
    if (!name || !t.includes(" " + name + " ") && !t.includes(" " + name)) continue;
    let sc = name.length;
    if (w.owner && t.includes(norm(w.owner))) sc += 50;
    if (sc > score) { score = sc; best = w; }
  }
  // tanpa nama dompet: "cash/tunai" → dompet tipe Cash
  if (!best && /\b(cash|tunai|uang tunai|dompet)\b/.test(t)) best = wallets.find(w => w.type === "Cash") || null;
  return best;
}

/**
 * Pahami kalimat pencatatan: "belanja pasar seratus lima puluh ribu pakai BTN Ibun"
 * → { type, amount, category, walletId, toWalletId, note }
 */
export function parseUtterance(text, { wallets = [], cats = { expense: [], income: [] }, memory = {} } = {}) {
  const t = norm(text);
  const amount = parseAmount(text);
  let type = TRANSFER_RE.test(t) ? "transfer" : INCOME_RE.test(t) ? "income" : "expense";
  const out = { type, amount, category: "", walletId: "", toWalletId: "", note: "" };
  if (type === "transfer") {
    // "pindah dari BTN Ayah ke Gopay" / "top up gopay dari BTN"
    const fromM = t.match(/\bdari\s+(.+?)(?=\s+ke\s|$)/);
    const toM = t.match(/\bke\s+(.+?)(?=\s+dari\s|$)/) || t.match(/\b(?:top ?up|isi saldo)\s+(.+?)(?=\s+dari\s|$)/);
    const to = toM ? guessWallet(toM[1], wallets) : null;
    const from = fromM ? guessWallet(fromM[1], wallets.filter(w => w.id !== to?.id)) : null;
    out.toWalletId = to?.id || ""; out.walletId = from?.id || "";
  } else {
    out.walletId = guessWallet(t, wallets)?.id || "";
    out.category = guessCategory(text, type, cats[type] || [], memory);
  }
  // catatan: kalimat asli tanpa nominal & frasa dompet
  let note = String(text).replace(/\brp\.?\s*[\d.,]+/gi, "").replace(/\b\d+(?:[.,]\d+)*\s*(ribu|rb|k|juta|jt)?\b/gi, "");
  note = note.split(/\s+/).filter(w => !NUMWORD.has(w.toLowerCase())).join(" ");
  note = note.replace(/\s+(pakai|pake|lewat|via|dari|ke)\s+.*$/i, "").replace(/\s+/g, " ").trim();
  out.note = note.charAt(0).toUpperCase() + note.slice(1, 120);
  return out;
}

/* ─── Struk belanja (hasil OCR) ─── */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };
function moneyIn(line) {
  const out = [];
  const re = /(\d{1,3}(?:[.,]\d{3})+|\d{4,9})(?:[.,]\d{2})?(?!\d)/g;
  let m;
  while ((m = re.exec(line))) { const v = parseInt(m[1].replace(/[.,]/g, ""), 10); if (v >= 100 && v < 1e10) out.push(v); }
  return out;
}

/** Ambil total, tanggal, nama toko dari teks struk */
export function parseReceipt(text, now = new Date()) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.replace(/[|]/g, " ").trim()).filter(Boolean);
  // Toko: baris berhuruf pertama yang bukan alamat/angka
  const merchant = (lines.find(l => /[a-z]{3,}/i.test(l) && !/^(jl|jalan|telp|tel|npwp|no\.|kasir|tanggal|tgl)/i.test(l) && (l.match(/[a-z]/gi) || []).length >= 4) || "")
    .replace(/[^a-z0-9 &'.-]/gi, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  // Total: utamakan baris TOTAL/GRAND TOTAL/TOTAL BAYAR (bukan subtotal/diskon/kembali/tunai)
  let total = 0;
  const prio = [/grand\s*total|total\s*(belanja|bayar|harga|tagihan)|jumlah\s*(bayar|total)/i, /\btotal\b|\bjumlah\b|\btagihan\b/i];
  const bad = /sub\s*-?\s*total|disc|diskon|hemat|kembali|change|ppn|tax|pajak|dpp|item|qty|potongan|voucher|poin|point/i;
  for (const re of prio) {
    for (let i = 0; i < lines.length && !total; i++) {
      if (re.test(lines[i]) && !bad.test(lines[i])) {
        const v = moneyIn(lines[i]).concat(moneyIn(lines[i + 1] || "").slice(0, 1));
        if (v.length) total = Math.max(...moneyIn(lines[i]).length ? moneyIn(lines[i]) : v);
      }
    }
    if (total) break;
  }
  if (!total) { // cadangan: nominal terbesar yang wajar (bukan baris tunai/kembali)
    const all = lines.filter(l => !/kembali|change|tunai|cash|telp|npwp/i.test(l)).flatMap(moneyIn).filter(v => v < 5e7);
    total = all.length ? Math.max(...all) : 0;
  }
  // Tanggal: dd/mm/yy(yy), dd-mm-yyyy, dd.mm.yy, yyyy-mm-dd, "27 Nov 2026"
  let date = null;
  const full = lines.join(" ");
  let m = full.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) date = new Date(+m[1], +m[2] - 1, +m[3]);
  if (!date && (m = full.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) {
    let y = +m[3]; if (y < 100) y += 2000;
    date = new Date(y, +m[2] - 1, +m[1]);
  }
  if (!date && (m = full.match(/\b(\d{1,2})\s*([a-z]{3})[a-z]*\.?\s*(\d{2,4})\b/i)) && lc(m[2]) in MONTHS) {
    let y = +m[3]; if (y < 100) y += 2000;
    date = new Date(y, MONTHS[lc(m[2])], +m[1]);
  }
  if (date && (isNaN(date) || date > new Date(now.getTime() + 864e5) || date < new Date(now.getFullYear() - 1, 0, 1))) date = null;
  const tm = full.match(/(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
  if (date && tm) date.setHours(+tm[1], +tm[2]);
  return { total, date, merchant };
}
