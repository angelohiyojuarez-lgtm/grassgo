import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_PHOTO_MAX_LENGTH, prepareProductPhoto } from './product-photo';

const JPEG = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(80);
const OriginalURL = URL;
const imageFile = (type = 'image/jpeg'): File => {
  const header =
    type === 'image/png'
      ? [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]
      : type === 'image/webp'
        ? [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]
        : [255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1];
  return new File([new Uint8Array(header), 'contenido de prueba'], 'producto', { type });
};

describe('Preparación local de la foto del producto', () => {
  const decode = vi.fn(),
    createUrl = vi.fn(),
    revokeUrl = vi.fn();
  const dimensions = { width: 2400, height: 1200 };
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: vi.fn(), toDataURL: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    dimensions.width = 2400;
    dimensions.height = 1200;
    decode.mockResolvedValue(undefined);
    createUrl.mockReturnValue('blob:producto-local');
    canvas.getContext.mockReturnValue(context);
    canvas.toDataURL.mockReturnValue(JPEG);
    vi.stubGlobal(
      'URL',
      class extends OriginalURL {
        static override createObjectURL = createUrl;
        static override revokeObjectURL = revokeUrl;
      },
    );
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        naturalWidth = dimensions.width;
        naturalHeight = dimensions.height;
        decode = decode;
      },
    );
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('valida formato, tamaño, cabecera y decodificación, y libera la URL incluso al fallar las dimensiones o el lienzo', async () => {
    for (const file of [
      new File(['<svg/>'], 'producto.svg', { type: 'image/svg+xml' }),
      new File(['<html>contenido falso</html>'], 'producto.jpg', { type: 'image/jpeg' }),
      new File([], 'vacia.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' }),
      new File([new Uint8Array([255, 216, 255])], 'truncada.jpg', { type: 'image/jpeg' }),
    ])
      await expect(prepareProductPhoto(file)).rejects.toMatchObject({
        code: 'functions/invalid-argument',
      });
    expect(createUrl).not.toHaveBeenCalled();
    decode.mockRejectedValueOnce(new Error('DecodeError en inglés'));
    await expect(prepareProductPhoto(imageFile())).rejects.toThrow('incompleta o dañada');
    for (const [width, height] of [
      [15, 64],
      [64, 15],
      [8000, 8000],
      [Number.NaN, 500],
    ]) {
      dimensions.width = width;
      dimensions.height = height;
      await expect(prepareProductPhoto(imageFile())).rejects.toMatchObject({
        code: 'functions/invalid-argument',
      });
    }
    expect(canvas.getContext).not.toHaveBeenCalled();
    dimensions.width = dimensions.height = 100;
    canvas.getContext.mockReturnValueOnce(null);
    await expect(prepareProductPhoto(imageFile())).rejects.toThrow('No se pudo preparar');
    expect(revokeUrl).toHaveBeenCalledTimes(6);
  });

  it('conserva proporciones y fondo blanco, comprime a JPEG local y reduce resolución cuando la calidad sola no alcanza', async () => {
    const result = await prepareProductPhoto(imageFile('image/png'));
    expect(result).toBe(JPEG);
    expect(result.length).toBeLessThanOrEqual(PRODUCT_PHOTO_MAX_LENGTH);
    expect([canvas.width, canvas.height]).toEqual([960, 480]);
    expect(context.fillStyle).toBe('#fff');
    expect(context.fillRect).toHaveBeenLastCalledWith(0, 0, 960, 480);
    expect(context.drawImage).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 960, 480);
    canvas.toDataURL.mockImplementation(() =>
      canvas.width >= 960
        ? 'data:image/jpeg;base64,/9j/' + 'A'.repeat(PRODUCT_PHOTO_MAX_LENGTH)
        : JPEG,
    );
    const fallback = await prepareProductPhoto(imageFile('image/webp'));
    expect(fallback).toBe(JPEG);
    expect(canvas.width).toBeLessThan(960);
    expect(canvas.width / canvas.height).toBe(2);
    expect(canvas.toDataURL.mock.calls.every(([type]) => type === 'image/jpeg')).toBe(true);
    canvas.toDataURL.mockReturnValue('data:image/png;base64,AAAA');
    await expect(prepareProductPhoto(imageFile())).rejects.toThrow('No se pudo preparar');
    expect(revokeUrl).toHaveBeenCalledTimes(3);
  });
});
