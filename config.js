/* =====================================================
   HOUSEHOLD FINANCE — config.js
   
   Edit file ini sesuai kebutuhan, ATAU gunakan
   menu Settings di dalam app untuk konfigurasi.
   
   Konfigurasi yang disimpan via Settings akan
   override nilai default di sini.
===================================================== */

const APP_CONFIG = {
  // ─── App Identity ─────────────────────────────────
  appName:  "Household Finance Nativan",
  appEmoji: "🏠",

  // ─── Google Apps Script URL ───────────────────────
  // Dapatkan URL ini setelah deploy GAS (lihat README)
  scriptUrl: "https://script.google.com/macros/s/AKfycbwHWjsg4gmwkZsAm6d103CV2VQY3FqBIBYMyb8kKhY1jyjB7Y0PPnX8eBeKlIGCcrBy/exec",

  // ─── OneSignal App ID (opsional) ──────────────────
  // Kosongkan string jika tidak pakai push notification
  oneSignalAppId: "",

  // ─── Default Kepemilikan ──────────────────────────
  // Akan digunakan jika belum dikonfigurasi via Settings
  defaultKepemilikan: ["Saya"],

  // ─── Default Dompet & Detail ──────────────────────
  defaultDompet: {
    "Cash":      ["Cash"],
    "M-Banking": ["Bank A", "Bank B"],
    "E-Wallet":  ["GoPay", "Dana"],
  },

  // ─── Session & Cache ──────────────────────────────
  sessionTTL: 3600000,    // 1 jam
  cacheTTL:   3 * 60000,  // 3 menit
};
