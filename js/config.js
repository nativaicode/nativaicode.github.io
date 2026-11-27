/* Konfigurasi Firebase (Project: household-finance).
   Nilai ini memang publik — keamanan data dijaga oleh Firestore Security Rules
   (lihat firestore.rules), bukan dengan merahasiakan config. */
export const firebaseConfig = {
  apiKey: "AIzaSyCEeky4X2I2_m43xGtK9svJHoWomahGqcs",
  authDomain: "household-finance-e738c.firebaseapp.com",
  projectId: "household-finance-e738c",
  storageBucket: "household-finance-e738c.firebasestorage.app",
  messagingSenderId: "237494934378",
  appId: "1:237494934378:web:0cdf2fd23e27cbffbf6313",
};

/* Kunci publik Web Push (Firebase Console → Project settings → Cloud Messaging →
   Web Push certificates → Generate key pair). Kosong = pengingat harian nonaktif. */
export const VAPID_KEY = "BCpI7UZap--kPRuIuiDcWFG253CjdHZwo1is2HRY2vGZwhY_ZOv74Ylwc0Kjtg4DV9IwYn91PZ9h5DgMAmVzHY4";

export const APP_NAME = "Keuangan Nativan";
export const APP_VERSION = "2.8.0";
