/**
 * Compression d'image côté téléphone : recadrage carré centré, redimensionné,
 * en JPEG. Une photo iPhone de 3–5 Mo devient ~20–40 Ko (stockable gratuitement
 * dans Firestore, sans Cloud Storage).
 */
export async function squareJpeg(file, size = 256, quality = 0.82) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Choisis une image.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Image trop lourde (25 Mo max).');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Repli (anciens Safari) via <img>
    bitmap = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Format d’image non lisible.')); };
      img.src = url;
    });
  }
  const w = bitmap.width;
  const h = bitmap.height;
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();

  // Baisse la qualité si besoin pour rester sous la limite des règles (150 000 car.).
  for (let q = quality; q >= 0.5; q -= 0.08) {
    const data = canvas.toDataURL('image/jpeg', q);
    if (data.length < 140000) return data;
  }
  return canvas.toDataURL('image/jpeg', 0.5);
}
