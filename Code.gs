// =====================================================
// HOUSEHOLD FINANCE — Code.gs
// General purpose household finance tracker
// Compatible with app.js PWA
// =====================================================

// ─── PASSWORD (ganti sesuai kebutuhan) ───────────────
// Lebih aman: simpan di Script Properties
// Key: APP_PASSWORD  Value: password_kamu
function getPassword() {
  try {
    const p = PropertiesService.getScriptProperties().getProperty("APP_PASSWORD");
    if (p) return p;
  } catch(_) {}
  return "ganti_password_ini"; // fallback default
}

// ─── ROUTER ──────────────────────────────────────────
function doGet(e) {
  if (!e || !e.parameter) return jsonOut({ status: "ERROR", message: "No parameter" });
  const action = e.parameter.action || "getData";
  if (action === "checkPassword")  return handleCheckPassword(e.parameter);
  if (action === "changePassword") return handleChangePassword(e.parameter);
  if (action === "addTransaksi")   return handleAddTransaksi(e.parameter);
  if (action === "addTransfer")   return handleAddTransfer(e.parameter);
  if (action === "setBudget")     return handleSetBudget(e.parameter);
  return handleGetData();
}

function doPost(e) {
  try {
    let p = {};
    if (e.parameter && e.parameter.action) p = e.parameter;
    else if (e.postData && e.postData.contents) p = JSON.parse(e.postData.contents);
    else return jsonOut({ status: "ERROR", message: "No data" });
    const action = p.action || "";
    if (action === "checkPassword")  return handleCheckPassword(p);
    if (action === "changePassword") return handleChangePassword(p);
    if (action === "addTransaksi")   return handleAddTransaksi(p);
    if (action === "addTransfer")   return handleAddTransfer(p);
    if (action === "setBudget")     return handleSetBudget(p);
    if (action === "getData")       return handleGetData();
    return jsonOut({ status: "ERROR", message: "Unknown action: " + action });
  } catch(err) {
    return jsonOut({ status: "ERROR", message: "doPost: " + err.toString() });
  }
}

// ─── Check Password ───────────────────────────────────
function handleCheckPassword(p) {
  if (p.pwd === getPassword()) return jsonOut({ status: "OK" });
  return jsonOut({ status: "ERROR", message: "Password salah" });
}

// ─── Tambah Transaksi ─────────────────────────────────
function handleAddTransaksi(p) {
  try {
    if (!p.kategori || !p.nominal) return jsonOut({ status: "ERROR", message: "kategori & nominal wajib" });
    const sheet = getSheet("Transaksi");
    sheet.appendRow([
      new Date(), p.jenis || "", p.kategori || "", p.deskripsi || "",
      Number(p.nominal) || 0, p.dompet || "", p.dompetDetail || "", p.kepemilikan || "",
      p.jenis === "Pengeluaran" ? (p.tipePengeluaran || "Rutin") : ""
    ]);
    const emoji = (p.jenis || "") === "Pendapatan" ? "💰" : (p.tipePengeluaran === "Tetap" ? "📌" : "💸");
    const tipeLabel = p.jenis === "Pengeluaran" && p.tipePengeluaran === "Tetap" ? " [Tetap]" : "";
    _sendOneSignalPush(
      `${emoji} ${p.jenis}${tipeLabel} — ${p.kepemilikan}`,
      `${p.kategori}: ${_fmtRp(Number(p.nominal) || 0)}${p.deskripsi ? " · " + p.deskripsi : ""}`
    );
    return jsonOut({ status: "OK" });
  } catch(err) {
    return jsonOut({ status: "ERROR", message: "addTransaksi: " + err.toString() });
  }
}

// ─── Pindah Dana ──────────────────────────────────────
function handleAddTransfer(p) {
  try {
    if (!p.nominal) return jsonOut({ status: "ERROR", message: "nominal wajib" });
    const sheet           = getSheet("Transaksi");
    const now             = new Date();
    const nominal         = Number(p.nominal) || 0;
    const catatan         = p.catatan || "Pindah Dana";
    const dariKepemilikan = p.dariKepemilikan || p.kepemilikan || "";
    const keKepemilikan   = p.keKepemilikan   || p.kepemilikan || "";

    sheet.appendRow([now, "Transfer-Keluar", catatan,
      `${dariKepemilikan} → ${keKepemilikan} | ${p.dariDetail} → ${p.keDetail}`,
      nominal, p.dariDompet || "", p.dariDetail || "", dariKepemilikan]);

    sheet.appendRow([now, "Transfer-Masuk", catatan,
      `${dariKepemilikan} → ${keKepemilikan} | ${p.dariDetail} → ${p.keDetail}`,
      nominal, p.keDompet || "", p.keDetail || "", keKepemilikan]);

    _sendOneSignalPush(
      `🔄 Pindah Dana — ${dariKepemilikan} → ${keKepemilikan}`,
      `${p.dariDetail} → ${p.keDetail}: ${_fmtRp(nominal)}`
    );
    return jsonOut({ status: "OK" });
  } catch(err) {
    return jsonOut({ status: "ERROR", message: "addTransfer: " + err.toString() });
  }
}

// ─── Set Budget ───────────────────────────────────────
function handleSetBudget(p) {
  try {
    if (!p.budget) return jsonOut({ status: "ERROR", message: "budget wajib diisi" });
    const sheet = getSheet("Budget");

    let periodeKey   = p.periodeKey || "";
    let periodeLabel = p.periodeLabel || "";
    if (!periodeKey && p.bulan && p.tahun)
      periodeKey = `${p.tahun}-${String(p.bulan).padStart(2, "0")}-25`;
    if (!periodeKey) return jsonOut({ status: "ERROR", message: "periodeKey wajib" });

    const rows   = sheet.getDataRange().getValues();
    const budget = Number(p.budget);
    let found    = false;

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === periodeKey) {
        sheet.getRange(i + 1, 3).setValue(budget);
        found = true; break;
      }
    }
    if (!found) sheet.appendRow([periodeKey, periodeLabel, budget, 0]);
    return jsonOut({ status: "OK" });
  } catch(err) {
    return jsonOut({ status: "ERROR", message: "setBudget: " + err.toString() });
  }
}

// ─── Get Data ─────────────────────────────────────────
function handleGetData() {
  try {
    const sheetTrx = getSheet("Transaksi");
    const dataTrx  = sheetTrx.getDataRange().getValues();
    const transaksi = [];

    for (let i = 1; i < dataTrx.length; i++) {
      if (!dataTrx[i][0] && !dataTrx[i][2]) continue;
      transaksi.push({
        tanggal:      Utilities.formatDate(new Date(dataTrx[i][0]), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
        jenis:        String(dataTrx[i][1] || ""),
        kategori:     String(dataTrx[i][2] || ""),
        deskripsi:    String(dataTrx[i][3] || ""),
        nominal:      Number(dataTrx[i][4]) || 0,
        dompet:       String(dataTrx[i][5] || ""),
        dompetDetail:    String(dataTrx[i][6] || ""),
        kepemilikan:     String(dataTrx[i][7] || ""),
        tipePengeluaran: String(dataTrx[i][8] || "Rutin"),
      });
    }

    const sheetBudget = getSheet("Budget");
    const dataBudget  = sheetBudget.getDataRange().getValues();
    const budget      = [];

    for (let i = 1; i < dataBudget.length; i++) {
      if (!dataBudget[i][0]) continue;
      budget.push({
        periodeKey:   String(dataBudget[i][0]),
        periodeLabel: String(dataBudget[i][1] || ""),
        budget:       Number(dataBudget[i][2]) || 0,
        realisasi:    Number(dataBudget[i][3]) || 0,
      });
    }

    // Auto-buat periode aktif jika belum ada
    const now   = new Date();
    const d     = now.getDate();
    const psM   = d >= 25 ? now.getMonth() : now.getMonth() - 1;
    const psY   = psM < 0 ? now.getFullYear() - 1 : now.getFullYear();
    const psM2  = ((psM % 12) + 12) % 12;
    const key   = `${psY}-${String(psM2 + 1).padStart(2, "0")}-25`;

    if (!budget.find(b => b.periodeKey === key)) {
      let lastBudget = 0;
      for (let i = budget.length - 1; i >= 0; i--) {
        if (budget[i].budget > 0) { lastBudget = budget[i].budget; break; }
      }
      sheetBudget.appendRow([key, "", lastBudget, 0]);
      budget.push({ periodeKey: key, periodeLabel: "", budget: lastBudget, realisasi: 0 });
    }

    return jsonOut({ status: "OK", transaksi, budget });
  } catch(err) {
    return jsonOut({ status: "ERROR", message: "getData: " + err.toString() });
  }
}

// ─── Helpers ──────────────────────────────────────────
function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`Sheet '${name}' tidak ditemukan`);
  return sheet;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _fmtRp(n) {
  return "Rp " + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// ─── OneSignal Push Notification ──────────────────────
// Setup Script Properties:
// ONESIGNAL_APP_ID  → App ID dari dashboard OneSignal
// ONESIGNAL_REST_KEY → REST API Key dari dashboard OneSignal
// ONESIGNAL_URL     → URL PWA kamu (contoh: https://username.github.io)
function _sendOneSignalPush(title, message) {
  try {
    const props  = PropertiesService.getScriptProperties();
    const appId  = props.getProperty("ONESIGNAL_APP_ID");
    const apiKey = props.getProperty("ONESIGNAL_REST_KEY");
    const url    = props.getProperty("ONESIGNAL_URL") || "";
    if (!appId || !apiKey) return;

    const payload = {
      app_id:            appId,
      included_segments: ["All"],
      headings:          { en: title, id: title },
      contents:          { en: message, id: message },
      url:               url,
      android_accent_color: "2563eb",
    };

    UrlFetchApp.fetch("https://onesignal.com/api/v1/notifications", {
      method:             "post",
      contentType:        "application/json",
      headers:            { Authorization: "Basic " + apiKey },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch(e) {
    console.log("OneSignal error:", e.toString());
  }
}

// ─── Test Push Notification ───────────────────────────
function testPush() {
  _sendOneSignalPush("🧪 Test Notifikasi", "Push notification berhasil dikirim!");
}
