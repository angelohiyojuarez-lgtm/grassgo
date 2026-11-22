const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_JPEG_BYTES = 450 * 1024;

/** Optimiza una fotografía decodificada; nunca almacena HTML, SVG ni una URL externa. */
export async function prepareReceipt(file: File): Promise<{ dataUrl: string; sha256: string }> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > MAX_SOURCE_BYTES
  )
    throw Object.assign(new Error('Elige una imagen JPG, PNG o WebP de hasta 5 MB.'), {
      code: 'functions/invalid-argument',
    });
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 48000000
    )
      throw Error('La imagen no se puede procesar.');
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('No se pudo preparar la imagen.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let dataUrl = '';
    for (const quality of [0.88, 0.78, 0.65, 0.5]) {
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      if ((dataUrl.length - 23) * 0.75 <= MAX_JPEG_BYTES) break;
    }
    if (
      !dataUrl.startsWith('data:image/jpeg;base64,/9j/') ||
      (dataUrl.length - 23) * 0.75 > MAX_JPEG_BYTES
    )
      throw Error('Usa una foto más pequeña donde se lean el monto, la fecha y el destinatario.');
    const bytes = new TextEncoder().encode(dataUrl);
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (value) => value.toString(16).padStart(2, '0'),
    ).join('');
    return { dataUrl, sha256 };
  } catch (error) {
    throw Object.assign(
      new Error((error as Error).message || 'No se pudo leer la imagen. Elige otra foto.'),
      { code: 'functions/invalid-argument' },
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
