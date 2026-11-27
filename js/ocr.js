/* Scan struk di perangkat (tesseract.js, bahasa Indonesia). Tidak ada gambar yang dikirim ke server.
   Mesin OCR (±5 MB) diunduh sekali saat pertama dipakai, lalu tersimpan di cache. */
let workerP = null, progressCb = null, curPsm = null;
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

/**
 * Praproses foto struk:
 *  - skala agar tinggi huruf ideal untuk OCR (lebar ±1400 px)
 *  - abu-abu + binarisasi adaptif (Bradley) → tahan bayangan/lipatan kertas thermal
 */
export async function preprocess(file, { binarize = true, targetW = 1400 } = {}) {
  const bmp = await createImageBitmap(file);
  let scale = targetW / bmp.width;
  scale = Math.max(0.5, Math.min(2, scale));
  if (bmp.height * scale > 6000) scale = 6000 / bmp.height;
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
  if (binarize) {
    // Bradley adaptive threshold dengan integral image
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 1; y <= h; y++) {
      let row = 0;
      for (let x = 1; x <= w; x++) { row += g[(y - 1) * w + x - 1]; I[y * (w + 1) + x] = I[(y - 1) * (w + 1) + x] + row; }
    }
    const r = Math.max(8, Math.round(w / 32)), t = 0.13;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum = I[(y1 + 1) * (w + 1) + x1 + 1] - I[y0 * (w + 1) + x1 + 1] - I[(y1 + 1) * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        const v = g[y * w + x] * cnt < sum * (1 - t) ? 0 : 255;
        const k = (y * w + x) * 4; d[k] = d[k + 1] = d[k + 2] = v;
      }
    }
  } else {
    let min = 255, max = 0;
    for (const v of g) { if (v < min) min = v; if (v > max) max = v; }
    const k = 255 / Math.max(1, max - min);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) d[i] = d[i + 1] = d[i + 2] = (g[j] - min) * k;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Kembalikan teks hasil OCR. onProgress(0..1, label). opts: {binarize, psm, targetW} */
export async function recognizeReceipt(file, onProgress, opts = {}) {
  const { psm = "4", ...pre } = opts;
  progressCb = m => {
    const lbl = m.status === "recognizing text" ? "Membaca struk…" : /load|init/i.test(m.status) ? "Menyiapkan pemindai (sekali saja)…" : "Memproses…";
    onProgress?.(m.progress || 0, lbl);
  };
  onProgress?.(0, "Menyiapkan gambar…");
  const [canvas, worker] = await Promise.all([preprocess(file, pre), getWorker()]);
  if (curPsm !== psm) { await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1" }); curPsm = psm; }
  const { data } = await worker.recognize(canvas);
  return data.text || "";
}
