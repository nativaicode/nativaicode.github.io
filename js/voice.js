/* Input suara (Web Speech API, bahasa Indonesia). Gratis, memakai pengenal suara bawaan browser. */
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = () => !!SR();

/** Dengarkan satu kalimat. onPartial(teks) dipanggil saat teks sementara berubah. */
export function listenOnce({ onPartial } = {}) {
  return new Promise((resolve, reject) => {
    const Rec = SR();
    if (!Rec) return reject(new Error("Browser ini belum mendukung input suara. Gunakan Chrome di Android atau Safari di iPhone."));
    const rec = new Rec();
    rec.lang = "id-ID"; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    let final = "", partial = "";
    rec.onresult = e => {
      partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else partial += r[0].transcript;
      }
      onPartial?.((final + " " + partial).trim());
    };
    rec.onerror = e => reject(new Error(e.error === "not-allowed" ? "Izin mikrofon ditolak. Aktifkan di pengaturan browser." : e.error === "no-speech" ? "Tidak terdengar suara. Coba lagi lebih dekat ke mikrofon." : e.error === "network" ? "Input suara butuh koneksi internet." : "Input suara gagal (" + e.error + ")."));
    rec.onend = () => resolve((final || partial).trim());
    listenOnce.stop = () => { try { rec.stop(); } catch { /* abaikan */ } };
    rec.start();
  });
}
