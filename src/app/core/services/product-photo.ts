import { Injectable } from '@angular/core';
import { KIOSK_PHOTO_MAX_LENGTH } from '../models/kiosk';

/** Límite de la vista previa preparada; este módulo no sube ni guarda archivos. */
export const PRODUCT_PHOTO_MAX_LENGTH = KIOSK_PHOTO_MAX_LENGTH;

/** Adaptador inyectable para preparar fotos sin acoplar la interfaz al DOM. */
@Injectable({ providedIn: 'root' })
export class ProductPhotoService {
  prepare(file: File): Promise<string> {
    return prepareProductPhoto(file);
  }
}
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 48000000;
const JPEG = /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/;

const photoError = (message: string): Error & { code: string } =>
  Object.assign(new Error(message), { code: 'functions/invalid-argument' });

async function readHeader(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(photoError('No se pudo leer la foto. Elige otra imagen.'));
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(new Uint8Array(reader.result))
        : reject(photoError('No se pudo leer la foto. Elige otra imagen.'));
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
}

function matchingHeader(header: Uint8Array, type: string): boolean {
  if (header.length < 12) return false;
  if (type === 'image/jpeg') return header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (type === 'image/png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => header[index] === value);
  return (
    type === 'image/webp' &&
    [82, 73, 70, 70].every((value, index) => header[index] === value) &&
    [87, 69, 66, 80].every((value, index) => header[index + 8] === value)
  );
}

/** Redibuja la foto completa como JPEG para una vista previa local, sin recortes ni envío. */
export async function prepareProductPhoto(file: File): Promise<string> {
  if (
    !file ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > MAX_SOURCE_BYTES
  )
    throw photoError('Elige una foto JPG, PNG o WebP de hasta 5 MB.');

  let source: string | undefined;
  try {
    if (!matchingHeader(await readHeader(file), file.type))
      throw photoError('El archivo no es una foto JPG, PNG o WebP válida. Elige otra imagen.');
    source = URL.createObjectURL(file);
    const image = new Image();
    image.src = source;
    await image.decode();
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 16 ||
      height < 16 ||
      width * height > MAX_SOURCE_PIXELS
    )
      throw photoError(
        'La foto es demasiado pequeña o grande. Elige una imagen más clara del producto.',
      );

    const canvas = document.createElement('canvas'),
      context = canvas.getContext('2d');
    if (!context) throw photoError('No se pudo preparar la foto. Vuelve a intentarlo.');
    const initialScale = Math.min(1, 960 / Math.max(width, height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = initialScale * 0.8 ** attempt;
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.74, 0.6, 0.46]) {
        const prepared = canvas.toDataURL('image/jpeg', quality);
        if (prepared.length < 32 || !JPEG.test(prepared))
          throw photoError('No se pudo preparar la foto. Elige otra imagen del producto.');
        if (prepared.length <= PRODUCT_PHOTO_MAX_LENGTH) return prepared;
      }
    }
    throw photoError(
      'La foto sigue siendo muy pesada. Elige otra imagen más sencilla del producto.',
    );
  } catch (error) {
    if ((error as { code?: string })?.code === 'functions/invalid-argument') throw error;
    throw photoError(
      'No se pudo leer la foto. Puede estar incompleta o dañada; elige otra imagen.',
    );
  } finally {
    if (source !== undefined) URL.revokeObjectURL(source);
  }
}
