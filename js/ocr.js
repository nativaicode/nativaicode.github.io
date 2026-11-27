/* Scan struk di perangkat (tesseract.js, bahasa Indonesia). Tidak ada gambar yang dikirim ke server.
   Mesin OCR (±5 MB) diunduh sekali saat pertama dipakai, lalu tersimpan di cache. */
let workerP = null, progressCb = null;
const abs = p => new URL(p, location.href).href;

async function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      const mod = await import("../vendor/ocr/tesseract.esm.min.js");
      const createWorker = mod.createWorker || mod.default?.createWorker;
      return createWorker("ind", 1, {
        workerPath: abs("vendor/ocr/worker.min.js"),
        corePath: abs("vendor/ocr/"),
        langPath: abs("vendor/ocr"),
        workerBlobURL: false,
        logger: m => progressCb?.(m),
      });
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

/** Perkecil + abu-abu + tingkatkan kontras agar teks struk lebih terbaca */
async function preprocess(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) { const g = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; d[i] = g; if (g < min) min = g; if (g > max) max = g; }
  const k = 255 / Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] - min) * k; d[i] = d[i + 1] = d[i + 2] = g; }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Kembalikan teks hasil OCR. onProgress(0..1, label) */
export async function recognizeReceipt(file, onProgress) {
  progressCb = m => {
    const lbl = m.status === "recognizing text" ? "Membaca struk…" : /load|init/i.test(m.status) ? "Menyiapkan pemindai (sekali saja)…" : "Memproses…";
    onProgress?.(m.progress || 0, lbl);
  };
  onProgress?.(0, "Menyiapkan gambar…");
  const [canvas, worker] = await Promise.all([preprocess(file), getWorker()]);
  const { data } = await worker.recognize(canvas);
  return data.text || "";
}
