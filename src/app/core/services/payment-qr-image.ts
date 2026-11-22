import {
  PreparedPaymentQr,
  PAYMENT_QR_MAX_LENGTH,
  businessSettingsError,
  validPaymentQr,
} from '../models/establishment-business';

/** Decodifica y vuelve a dibujar la foto completa; el propietario revisa el QR antes de publicarlo. */
export async function preparePaymentQr(file: File): Promise<PreparedPaymentQr> {
  if (
    !file ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > 5 * 1024 * 1024
  )
    businessSettingsError('invalid-argument', 'Elige una foto JPG, PNG o WebP de hasta 5 MB.');
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    if (
      image.naturalWidth < 64 ||
      image.naturalHeight < 64 ||
      image.naturalWidth * image.naturalHeight > 48000000
    )
      throw Error('La foto es demasiado pequeña o grande. Elige otra donde se vea completo el QR.');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.round(image.naturalWidth * scale),
      height = Math.round(image.naturalHeight * scale);
    if (width < 64 || height < 64)
      throw Error('La foto es muy angosta. Elige otra donde se vea completo el QR.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw Error('No se pudo preparar la foto del QR.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    let imageData = '';
    for (const quality of [0.94, 0.88, 0.8, 0.72]) {
      imageData = canvas.toDataURL('image/jpeg', quality);
      if (imageData.length <= PAYMENT_QR_MAX_LENGTH) break;
    }
    if (
      imageData.length < 32 ||
      imageData.length > PAYMENT_QR_MAX_LENGTH ||
      !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(imageData)
    )
      throw Error('La foto no se pudo preparar con claridad. Sube una imagen más sencilla del QR.');
    const result: PreparedPaymentQr = {
      id: crypto.randomUUID(),
      imageData,
      contentType: 'image/jpeg',
      width,
      height,
      sha256: Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(imageData))),
        (value) => value.toString(16).padStart(2, '0'),
      ).join(''),
    };
    if (!validPaymentQr(result))
      throw Error('La foto no se pudo preparar con claridad. Sube una imagen más sencilla del QR.');
    return result;
  } catch (error) {
    businessSettingsError(
      'invalid-argument',
      (error as Error).message || 'No se pudo leer la foto. Elige otra.',
    );
  } finally {
    URL.revokeObjectURL(source);
  }
}
