import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareReceipt } from './receipt-image';

const JPEG = 'data:image/jpeg;base64,/9j/AAAA';
const OriginalURL = URL;

describe('Preparación privada de la foto del comprobante', () => {
  const decode = vi.fn(),
    createUrl = vi.fn(),
    revokeUrl = vi.fn(),
    digest = vi.fn();
  const imageSize = { width: 2400, height: 1200 };
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: vi.fn(), toDataURL: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    imageSize.width = 2400;
    imageSize.height = 1200;
    decode.mockResolvedValue(undefined);
    createUrl.mockReturnValue('blob:comprobante-local');
    digest.mockResolvedValue(new Uint8Array(32).buffer);
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
        naturalWidth = imageSize.width;
        naturalHeight = imageSize.height;
        decode = decode;
      },
    );
    vi.stubGlobal('crypto', { subtle: { digest } });
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rechaza tipos no permitidos, archivos vacíos y fotos de más de 5 MB antes de abrirlos', async () => {
    for (const file of [
      new File(['<svg>'], 'imagen.svg', { type: 'image/svg+xml' }),
      new File([], 'vacia.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'enorme.png', { type: 'image/png' }),
    ])
      await expect(prepareReceipt(file)).rejects.toMatchObject({
        code: 'functions/invalid-argument',
      });
    expect(createUrl).not.toHaveBeenCalled();
    expect(canvas.toDataURL).not.toHaveBeenCalled();
  });

  it('decodifica la foto, limita sus dimensiones y obtiene un JPEG nuevo sin guardar el archivo original', async () => {
    const file = new File(['contenido original de PNG'], 'captura.png', { type: 'image/png' });
    const result = await prepareReceipt(file);
    expect(decode).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(1800);
    expect(canvas.height).toBe(900);
    expect(context.fillStyle).toBe('#fff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1800, 900);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1800, 900);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', expect.any(Number));
    expect(result.dataUrl).toBe(JPEG);
    expect(result.dataUrl).not.toContain('contenido original');
    expect(digest).toHaveBeenCalledWith('SHA-256', new TextEncoder().encode(JPEG));
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(revokeUrl).toHaveBeenCalledWith('blob:comprobante-local');
  });

  it('reduce la calidad si hace falta para respetar el límite privado del documento', async () => {
    const tooLarge = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(650000);
    canvas.toDataURL.mockReturnValueOnce(tooLarge).mockReturnValueOnce(JPEG);
    await prepareReceipt(new File(['foto'], 'foto.jpg', { type: 'image/jpeg' }));
    expect(canvas.toDataURL).toHaveBeenCalledTimes(2);
    expect(canvas.toDataURL.mock.calls[1][1]).toBeLessThan(canvas.toDataURL.mock.calls[0][1]);
  });

  it('no acepta un archivo de imagen falsificado y libera su URL aunque falle la decodificación', async () => {
    decode.mockRejectedValueOnce(Error('La foto no pudo decodificarse.'));
    await expect(
      prepareReceipt(new File(['<html>'], 'foto.jpg', { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect(canvas.toDataURL).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledOnce();
  });

  it('rechaza imágenes de dimensiones excesivas antes de reservar el canvas', async () => {
    imageSize.width = 10000;
    imageSize.height = 10000;
    await expect(
      prepareReceipt(new File(['foto'], 'foto.png', { type: 'image/png' })),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect(canvas.getContext).not.toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledOnce();
  });

  it('no devuelve una imagen si el navegador no logra producir un JPEG pequeño y válido', async () => {
    const file = new File(['foto'], 'foto.webp', { type: 'image/webp' });
    canvas.toDataURL.mockReturnValue('data:image/png;base64,AAAA');
    await expect(prepareReceipt(file)).rejects.toMatchObject({
      code: 'functions/invalid-argument',
    });
    expect(digest).not.toHaveBeenCalled();
    canvas.toDataURL.mockReturnValue('data:image/jpeg;base64,/9j/' + 'A'.repeat(650000));
    await expect(prepareReceipt(file)).rejects.toMatchObject({
      code: 'functions/invalid-argument',
    });
    expect(digest).not.toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledTimes(2);
  });
});
