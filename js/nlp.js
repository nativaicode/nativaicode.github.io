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

/** Semua nominal dalam teks (urut kemunculan). Angka < 100 tanpa satuan diabaikan (mis. "2 porsi"). */
export function findAmounts(text) {
  const s = norm(text).replace(/rp\.?\s*/g, " ");
  const found = [];
  const re = /(\d+(?:[.,]\d+)*)\s*(ribu|rb|k|juta|jt|miliar|milyar|m)?\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = m[1], unit = m[2];
    let v;
    if (unit) {
      // 1,5 juta / 1.5 jt → desimal; 1.500 ribu → ribuan
      v = /^\d+[.,]\d{1,2}$/.test(num) ? parseFloat(num.replace(",", ".")) : parseFloat(num.replace(/[.,]/g, ""));
      v *= SCALE[unit];
    } else {
      if (/^\d{1,3}([.,]\d{3})+$/.test(num)) v = parseFloat(num.replace(/[.,]/g, ""));
      else if (/^\d+[.,]\d{1,2}$/.test(num)) v = parseFloat(num.replace(",", "."));
      else v = parseFloat(num.replace(/[.,]/g, ""));
      if (v < 100) continue;
    }
    if (v > 0) found.push({ v: Math.round(v), at: m.index });
  }
  // kata bilangan ("seratus lima puluh ribu")
  const toks = s.split(" ");
  let span = [], pos = 0, start = 0;
  // span harus memuat kata bilangan (bukan cuma "ribu" yang mengikuti angka, mis. "3 ribu")
  const flush = () => { if (span.some(t => !(t in SCALE) && t !== "se")) { const v = wordsToNumber(span); if (v >= 100) found.push({ v, at: start }); } span = []; };
  for (const t of toks) {
    if (NUMWORD.has(t)) { if (!span.length) start = pos; span.push(t); } else flush();
    pos += t.length + 1;
  }
  flush();
  return found.sort((a, b) => a.at - b.at).map(x => x.v);
}

const JOIN_RE = /\b(dan|tambah|plus|sama|serta|ditambah)\b|,\s|\+|&/;
/**
 * Nominal dari teks. Beberapa item yang disambung "dan / tambah / , / +" → dijumlahkan
 * ("nasi goreng 15 ribu dan teh tarik 5 ribu" → 20.000); selain itu ambil yang terbesar.
 * @returns {{total:number, parts:number[]}}
 */
export function parseAmountDetail(text) {
  const parts = findAmounts(text);
  if (!parts.length) return { total: 0, parts: [] };
  if (parts.length > 1 && JOIN_RE.test(String(text).toLowerCase().replace(/(\d),(\d)/g, "$1.$2"))) return { total: parts.reduce((a, b) => a + b, 0), parts };
  return { total: Math.max(...parts), parts: [Math.max(...parts)] };
}
export const parseAmount = text => parseAmountDetail(text).total;

/* ─── Kamus kategori bawaan (dipetakan ke kategori yang benar-benar ada) ─── */
const DICT = [
  [/makan|minum|kopi|sarapan|nasi|bakso|mie|mi ayam|gofood|grabfood|shopeefood|jajan|warteg|resto|kfc|mcd|mcdonald|starbucks|snack|cemilan|martabak|sate|soto|pizza|burger|boba|es teh|warung/, ["Makan & Minum", "Makan", "Makanan"]],
  [/belanja|pasar|sayur|beras|telur|minyak goreng|galon|indomaret|alfamart|alfamidi|superindo|hypermart|osave|o save|o!save|transmart|lotte|sembako|lauk|ikan|ayam potong|daging|gula|tepung|bumbu|grosir/, ["Belanja Dapur", "Belanja", "Dapur", "Kebutuhan Dapur"]],
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
  const { total: amount, parts } = parseAmountDetail(text);
  let type = TRANSFER_RE.test(t) ? "transfer" : INCOME_RE.test(t) ? "income" : "expense";
  const out = { type, amount, parts, category: "", walletId: "", toWalletId: "", note: "" };
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

/** Nominal rupiah dalam satu baris (abaikan angka kecil seperti qty/kode) */
function moneyIn(line) {
  const out = [];
  const re = /(\d{1,3}(?:[.,]\d{3})+|\d{4,9})(?:[.,]\d{2})?(?!\d)/g;
  let m;
  while ((m = re.exec(line))) { const v = parseInt(m[1].replace(/[.,]/g, ""), 10); if (v >= 100 && v < 1e10) out.push(v); }
  return out;
}
/** Harga di ujung baris: "Mie Sedaap Laksa 83gr   2.800" → 2800 (toleran karakter sampah OCR) */
function trailingPrice(line) {
  const m = line.match(/(-?)\s*[“"'—–-]?\s*(\d{1,3}(?:[.,]\d{3})+)\s*[-.,'"|)]*\s*$/);
  return m ? { price: parseInt(m[2].replace(/[.,]/g, ""), 10) * (m[1] ? -1 : 1), at: m.index } : null;
}

/* Jaringan toko yang dikenali (teks OCR sering membaca O sebagai 0) */
const CHAINS = [
  [/\b[o0]\s*!?\s*save\b|\bosave\b/, "O!Save"], [/indomaret/, "Indomaret"], [/alfamidi/, "Alfamidi"], [/alfa\s*express/, "Alfa Express"], [/alfamart/, "Alfamart"],
  [/super\s*indo/, "Superindo"], [/hypermart/, "Hypermart"], [/transmart/, "Transmart"], [/carrefour/, "Carrefour"], [/lotte\s*(mart|grosir)/, "Lotte Mart"],
  [/\bgiant\b/, "Giant"], [/\bhero\b/, "Hero"], [/ranch\s*market/, "Ranch Market"], [/farmers\s*market/, "Farmers Market"], [/grand\s*lucky/, "Grand Lucky"],
  [/foodmart/, "Foodmart"], [/yomart/, "Yomart"], [/griya|yogya/, "Yogya"], [/tip\s*top/, "Tip Top"], [/lawson/, "Lawson"], [/family\s*mart/, "FamilyMart"],
  [/circle\s*k/, "Circle K"], [/guardian/, "Guardian"], [/watsons/, "Watsons"], [/century/, "Century"], [/kimia\s*farma/, "Kimia Farma"], [/\bk[\s-]?24\b/, "Apotek K-24"],
  [/pertamina|spbu/, "SPBU Pertamina"], [/\bshell\b/, "Shell"], [/ace\s*hardware/, "ACE Hardware"], [/informa/, "Informa"], [/miniso/, "Miniso"], [/mr\.?\s*d\.?i\.?y/, "Mr. DIY"],
  [/gramedia/, "Gramedia"], [/matahari/, "Matahari"], [/ramayana/, "Ramayana"], [/\bkfc\b/, "KFC"], [/mc\s*donald|mcd\b/, "McDonald's"], [/starbucks/, "Starbucks"],
  [/hokben|hoka\s*hoka/, "HokBen"], [/solaria/, "Solaria"], [/richeese/, "Richeese"], [/pizza\s*hut/, "Pizza Hut"], [/chatime/, "Chatime"], [/j\.?\s*co\b/, "J.CO"],
];
const ADDRESS = /^(j[l1i]\.?\s|jalan|kec\b|kel\b|kota|kab\b|telp|tel\b|phone|npwp|no\.?\s*\d|rt\s*\d|rw\s*\d|blok|ruko|kasir|tanggal|tgl|struk|nota|member)/i;
const NOT_ITEM = /sub\s*-?\s*tota|\btotal|jumlah|tunai|cash|kembali|change|card|debit|kredit|credit|qris|ovo|gopay|dana\b|shopeepay|ppn|pajak|tax|dpp|npwp|telp|kasir|member|poin|point|bayar|harga jual|terima kasih|warranty|buka|struk|no\.?\s*trx/i;
const DISCOUNT = /hemat|diskon|disc\b|discount|potongan|voucher|promo/i;

function detectMerchant(lines) {
  const all = norm(lines.join(" ").replace(/0!/g, "o!"));
  for (const [re, name] of CHAINS) if (re.test(all) || re.test(lines.join(" ").toLowerCase())) return name;
  const l = lines.slice(0, 8).find(x => (x.match(/[a-z]/gi) || []).length >= 4 && !ADDRESS.test(x.trim()) && !/\d{4,}/.test(x) && (x.match(/[a-z ]/gi) || []).length / x.length > 0.7);
  if (!l) return "";
  const clean = l.replace(/[^a-z0-9 &'.!-]/gi, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  // HURUF BESAR SEMUA → Judul Kapital ("WARUNG MAKAN SEDERHANA" → "Warung Makan Sederhana")
  return clean === clean.toUpperCase() ? clean.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : clean;
}

function detectDate(lines, now) {
  const full = lines.join(" ");
  let date = null, m;
  if ((m = full.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) date = new Date(+m[1], +m[2] - 1, +m[3]);
  if (!date && (m = full.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|20\d{2})\b/))) { let y = +m[3]; if (y < 100) y += 2000; date = new Date(y, +m[2] - 1, +m[1]); }
  if (!date && (m = full.match(/\b(\d{1,2})\s*([a-z]{3})[a-z]*\.?\s*(\d{2,4})\b/i)) && m[2].toLowerCase() in MONTHS) { let y = +m[3]; if (y < 100) y += 2000; date = new Date(y, MONTHS[m[2].toLowerCase()], +m[1]); }
  if (date && (isNaN(date) || date > new Date(now.getTime() + 864e5) || date < new Date(now.getFullYear() - 1, 0, 1))) date = null;
  if (date) {
    // jam: utamakan yang dekat dengan tanggal, format HH:MM (bukan "Buka 7:00 sampai 22:00")
    const near = full.slice(full.indexOf(m[0]), full.indexOf(m[0]) + m[0].length + 12).match(/([01]?\d|2[0-3]):([0-5]\d)/);
    const tm = near || full.replace(/buka.*?\d{1,2}:\d{2}.*?\d{1,2}:\d{2}/i, "").match(/(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
    if (tm) date.setHours(+tm[1], +tm[2]);
  }
  return date;
}

/**
 * Baca struk: total (voting dari beberapa baris + cocokkan dengan jumlah rincian), tanggal, toko, rincian barang.
 * @returns {{total, date, merchant, items:[{name, qty, unit, price}], discount, itemsSum, confidence:"high"|"medium"|"low", sources:string[]}}
 */
/** Rapikan salah baca OCR yang umum pada nama barang */
export function cleanItemName(name) {
  return String(name).replace(/\s+/g, " ").trim()
    .replace(/(\d)9r\b/g, "$1gr")                       // 609r → 60gr
    .replace(/([a-z])[!|]/gi, "$1l")                       // Ful! → Full
    .split(" ").map(t => t.replace(/^([A-Za-z]{2,})(1{1,2})([).,]*)$/, (m, a, b) => a + "l".repeat(b.length))).join(" ") // Ful1/Fu11 → Full
    .replace(/[).,]+(?=\s)/g, "")
    .slice(0, 40);
}

export function parseReceipt(text, now = new Date()) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const merchant = detectMerchant(lines);
  const date = detectDate(lines, now);

  // ── Rincian barang (sebelum baris total pertama) ──
  const firstTotal = lines.findIndex(l => /sub\s*-?\s*tota|\btotal\b|jumlah\s*:|grand/i.test(l));
  const end = firstTotal < 0 ? lines.length : firstTotal;
  const items = [];
  let discount = 0, pendingQty = null;
  for (let i = 0; i < end; i++) {
    const l = lines[i];
    const q = l.match(/^[xX×]\s*([0-9Il]{1,3})\b\s*([\d.,]*)/);
    if (q && (l.match(/[a-z]/gi) || []).length <= 3) { pendingQty = { qty: parseInt(q[1].replace(/[Il]/g, "1"), 10) || 1, unit: q[2] ? parseInt(q[2].replace(/[.,]/g, ""), 10) || 0 : 0 }; continue; }
    const tp = trailingPrice(l);
    if (!tp) continue;
    let name = l.slice(0, tp.at).replace(/[“"'—–]+$/, "").replace(/\s[-.]+$/, "").trim();
    if ((name.match(/[a-z]/gi) || []).length < 3 || ADDRESS.test(name) || NOT_ITEM.test(name)) continue;
    if (DISCOUNT.test(name)) { discount += Math.abs(tp.price); continue; }
    let qty = 1, unit = tp.price;
    const inl = name.match(/(\d{1,3})\s*[xX×@]\s*([\d.,]{3,})\s*$/); // "2 x 3.500" di nama
    const col = !inl && name.match(/\s(\d{1,3})\s+(\d{1,3}[.,]\d{3})\s*$/); // format kolom "NAMA QTY HARGA TOTAL" (Indomaret)
    if (inl) { qty = +inl[1]; unit = parseInt(inl[2].replace(/[.,]/g, ""), 10); name = name.slice(0, inl.index).trim(); }
    else if (col && +col[1] * parseInt(col[2].replace(/[.,]/g, ""), 10) === tp.price) { qty = +col[1]; unit = tp.price / qty; name = name.slice(0, col.index).trim(); }
    else if (pendingQty) {
      qty = pendingQty.qty; unit = pendingQty.unit || Math.round(tp.price / qty);
      if (qty * unit !== tp.price) { qty = 1; unit = tp.price; } // qty/harga satuan salah baca → percayai harga baris
    }
    pendingQty = null;
    if (tp.price <= 0) { discount += Math.abs(tp.price); continue; }
    items.push({ name: cleanItemName(name), qty, unit, price: tp.price });
  }
  // harga Rupiah tidak pernah berakhiran angka selain 0 → digit terakhir salah baca ("5.509" → 5.500)
  for (const it of items) if (it.unit % 10) { it.unit -= it.unit % 10; it.price = it.unit * it.qty; it.fixed = true; }
  let itemsSum = items.reduce((a, x) => a + x.price, 0);
  // diskon/hemat yang tercetak setelah subtotal
  for (let i = end; i < lines.length; i++) {
    if (DISCOUNT.test(lines[i]) && !/total/i.test(lines[i]) && !/anda\s*hemat|total\s*hemat/i.test(lines[i])) { const v = moneyIn(lines[i]).slice(-1)[0]; if (v) discount += v; }
  }

  // ── Total: voting dari baris total/subtotal/jumlah/pembayaran ──
  const votes = new Map(), src = new Map();
  const vote = (v, w, why) => { votes.set(v, (votes.get(v) || 0) + w); src.set(v, [...(src.get(v) || []), why]); };
  lines.forEach((l, i) => {
    if (/kembali|change|jumlah\s*barang\s*:\s*\d+\s*$/i.test(l)) return;
    const vals = moneyIn(l.replace(/jumlah\s*barang\s*:?\s*\d+/i, ""));
    const next = !vals.length ? moneyIn(lines[i + 1] || "").slice(-1) : [];
    const v = (vals.length ? vals : next).slice(-1)[0];
    if (!v) return;
    if (/grand\s*total|total\s*(belanja|bayar|harga|tagihan|akhir)|\bjumlah\s*(bayar|total)?\s*:|^total\b|\stotal\s*:?/i.test(l) && !/sub\s*-?\s*tota/i.test(l)) vote(v, 3, "Total");
    else if (/sub\s*-?\s*tota/i.test(l)) vote(v, 2, "Subtotal");
    else if (/tunai|cash|card|debit|kredit|credit|qris|non\s*tunai|bayar|edc/i.test(l)) vote(v, 1, "Pembayaran");
  });
  if (itemsSum) { const net = itemsSum - discount; for (const v of votes.keys()) if (v === net) vote(v, 2, "Rincian"); }
  let total = 0, confidence = "low", sources = [];
  if (votes.size) {
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    total = best[0]; sources = [...new Set(src.get(total))];
    confidence = best[1] >= 5 || sources.length >= 2 ? "high" : "medium";
  } else if (items.length >= 2) { total = itemsSum - discount; confidence = "low"; sources = ["Rincian"]; }
  else {
    const all = lines.filter(l => !/kembali|change|telp|npwp/i.test(l)).flatMap(moneyIn).filter(v => v < 5e7);
    total = all.length ? Math.max(...all) : 0;
  }
  if (confidence !== "low" && items.length && total) {
    reconcileItems(items, total + discount);
    itemsSum = items.reduce((a, x) => a + x.price, 0);
    if (itemsSum - discount === total && !sources.includes("Rincian")) { sources.push("Rincian"); confidence = "high"; }
  }
  return { total, date, merchant, items, discount, itemsSum, confidence, sources };
}

/* ── Rekonsiliasi rincian vs total ──
 * OCR kadang salah baca satu harga ("5.500" → "500"). Bila total sudah terverifikasi,
 * cari koreksi yang membuat jumlah rincian PERSIS sama dengan total:
 *  (a) samakan harga dengan barang kembar (nama mirip) di struk yang sama,
 *  (b) tambahkan satu digit depan yang hilang ("500" → "5.500").
 * Baris yang dikoreksi diberi tanda `fixed`, sisanya yang janggal diberi `suspect`. */
const sig = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "").replace(/0/g, "o").replace(/[1l!|]/g, "i").replace(/5/g, "s").replace(/9/g, "g").replace(/8/g, "b");
function bigrams(s) { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); } return m; }
export function nameSimilarity(a, b) {
  const A = bigrams(sig(a)), B = bigrams(sig(b));
  let inter = 0, n = 0;
  for (const v of A.values()) n += v;
  for (const v of B.values()) n += v;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  return n ? 2 * inter / n : 0;
}

export function reconcileItems(items, target) {
  const sum = () => items.reduce((a, x) => a + x.price, 0);
  const setUnit = (it, u) => { it.unit = u; it.price = u * it.qty; it.fixed = true; };
  for (let round = 0; round < 4; round++) {
    const d = target - sum();
    if (!d) break;
    let done = false;
    // (a) barang kembar
    for (let i = 0; i < items.length && !done; i++) for (let j = 0; j < items.length && !done; j++) {
      if (i === j || items[i].unit === items[j].unit) continue;
      if (nameSimilarity(items[i].name, items[j].name) < 0.8) continue;
      if ((items[j].unit - items[i].unit) * items[i].qty === d) { setUnit(items[i], items[j].unit); done = true; }
    }
    // (b) digit depan hilang
    for (const it of items) {
      if (done) break;
      for (let k = 1; k <= 9 && !done; k++) {
        const u = k * 10 ** String(it.unit).length + it.unit;
        if ((u - it.unit) * it.qty === d) { setUnit(it, u); done = true; }
      }
    }
    if (!done) break;
  }
  if (target !== sum()) markSuspects(items);
  return items;
}

/** Gabungkan barang yang sama (nama mirip + harga satuan sama) jadi satu baris berjumlah,
 *  dan pakai ejaan nama yang paling sering/paling bersih. */
export function groupItems(items) {
  const quality = n => (n.match(/[a-z ]/gi) || []).length / n.length - (/[!|)(]|[a-z][0-9][a-z]/i.test(n) ? 0.3 : 0);
  const groups = [];
  for (const it of items) {
    const g = groups.find(g => g.unit === it.unit && g.members.some(m => nameSimilarity(m.name, it.name) >= 0.88));
    if (g) { g.members.push(it); g.qty += it.qty; g.price += it.price; g.fixed ||= it.fixed; g.suspect ||= it.suspect; }
    else groups.push({ unit: it.unit, qty: it.qty, price: it.price, fixed: !!it.fixed, suspect: !!it.suspect, members: [it] });
  }
  return groups.map(g => {
    const count = new Map(); g.members.forEach(m => count.set(m.name, (count.get(m.name) || 0) + 1));
    const name = [...count.entries()].sort((a, b) => b[1] - a[1] || quality(b[0]) - quality(a[0]))[0][0];
    const out = { name, qty: g.qty, unit: g.unit, price: g.price };
    if (g.fixed) out.fixed = true;
    if (g.suspect) out.suspect = true;
    return out;
  });
}

/** Tandai harga yang kemungkinan salah baca (untuk disorot di layar review) */
export function markSuspects(items) {
  for (const it of items) {
    it.suspect = it.unit < 500 || items.some(o => o !== it && o.unit !== it.unit && nameSimilarity(o.name, it.name) >= 0.8);
  }
  return items;
}

/** Gabungkan dua hasil baca (dua mode OCR): ambil yang paling meyakinkan per bagian */
export function mergeReceipts(a, b) {
  const rank = { high: 3, medium: 2, low: 1 };
  const fit = r => r.items.length && r.total ? -Math.abs(r.itemsSum - r.discount - r.total) : -Infinity;
  const best = rank[b.confidence] > rank[a.confidence] ? b : a;
  return {
    ...best,
    date: a.date || b.date,
    merchant: a.merchant || b.merchant,
    ...(fit(b) > fit(a) || (b.items.length > a.items.length && fit(b) === fit(a)) ? { items: b.items, itemsSum: b.itemsSum, discount: b.discount } : { items: a.items, itemsSum: a.itemsSum, discount: a.discount }),
  };
}

/* Kategori per barang: hanya barang non-makanan yang jelas berbeda dari kategori struk */
const ITEM_DICT = [
  [/\bdeo\b|deodoran|sabun|sampo|shampoo|pasta gigi|odol|sikat gigi|pembalut|softex|charm|laurier|tisu|tissue|deterjen|detergen|rinso|molto|downy|so klin|soklin|sunlight|mama lemon|wipol|pewangi|pengharum|kapur barus|baygon|hit\b|lotion|parfum|cologne|lifebuoy|pepsodent|ciptadent|nuvo|dettol|biore|vaseline|ponds|garnier|wardah|pantene|clear\b|sunsilk/, ["Rumah Tangga", "Kebutuhan Rumah"]],
  [/popok|pampers|diapers|mamypoko|merries|sweety|susu formula|sgm|dancow|bebelac|chil kid|morinaga|baby|bayi|telon/, ["Anak", "Kebutuhan Anak"]],
  [/obat|vitamin|paracetamol|panadol|bodrex|tolak angin|antangin|promag|minyak kayu putih|plester|hansaplast|masker|betadine|oralit|imboost/, ["Kesehatan"]],
  [/buku tulis|pulpen|pensil|penghapus|spidol|kertas hvs|map plastik|sidu/, ["Pendidikan"]],
];
export function guessItemCategory(name, fallback, cats) {
  const n = norm(name);
  for (const [re, names] of ITEM_DICT) if (re.test(n)) for (const nm of names) { const c = findCat(nm, cats); if (c) return c; }
  return fallback;
}

/** Kelompokkan rincian per kategori; selisih (diskon/salah baca) diserap kelompok terbesar agar total tetap tepat */
export function splitByCategory(items, total) {
  const g = new Map();
  for (const it of items) { if (it.include === false) continue; const k = it.category || "Lainnya"; const x = g.get(k) || { category: k, amount: 0, items: [] }; x.amount += it.price; x.items.push(it); g.set(k, x); }
  const groups = [...g.values()].sort((a, b) => b.amount - a.amount);
  const sum = groups.reduce((a, x) => a + x.amount, 0);
  if (groups.length && total && sum !== total) groups[0].amount += total - sum;
  return groups;
}
