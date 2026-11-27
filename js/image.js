/* Kompres foto bukti transaksi agar muat di Firestore (dokumen maks. 1 MB) */
export async function compressImage(file, { maxSide = 1280, maxBytes = 600_000 } = {}) {
  const bmp = await createImageBitmap(file);
  let side = maxSide, q = 0.72, url = "";
  for (let i = 0; i < 6; i++) {
    const s = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    url = c.toDataURL("image/jpeg", q);
    if (url.length * 0.75 <= maxBytes) return url;
    side *= 0.8; q = Math.max(0.45, q - 0.08);
  }
  if (url.length > 950_000) throw new Error("Foto terlalu besar, coba foto ulang dengan resolusi lebih kecil.");
  return url;
}
export const dataUrlKB = u => Math.round((u.length * 0.75) / 1024);
