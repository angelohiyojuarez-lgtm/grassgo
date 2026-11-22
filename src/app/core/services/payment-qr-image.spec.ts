import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preparePaymentQr } from './payment-qr-image';

const JPEG = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(80);
const OriginalURL = URL;
describe('Preparación de la foto del QR', () => {
  const decode = vi.fn(),
    createUrl = vi.fn(),
    revokeUrl = vi.fn(),
    digest = vi.fn();
  const dimensions = { width: 2400, height: 1200 };
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: vi.fn(), toDataURL: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    dimensions.width = 2400;
    dimensions.height = 1200;
    decode.mockResolvedValue(undefined);
    createUrl.mockReturnValue('blob:qr-local');
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
        naturalWidth = dimensions.width;
        naturalHeight = dimensions.height;
        decode = decode;
      },
    );
    vi.stubGlobal('crypto', { randomUUID: () => 'qr-local', subtle: { digest } });
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('rechaza SVG, HTML, fotos vacías y archivos mayores de 5 MB sin abrirlos', async () => {
    for (const file of [
      new File(['<svg/>'], 'qr.svg', { type: 'image/svg+xml' }),
      new File(['<html>'], 'qr.html', { type: 'text/html' }),
      new File([], 'qr.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'qr.png', { type: 'image/png' }),
    ])
      await expect(preparePaymentQr(file)).rejects.toMatchObject({
        code: 'functions/invalid-argument',
      });
    expect(createUrl).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
  });
  it('decodifica y redibuja todo el QR sin recortarlo ni guardar el archivo original', async () => {
    const result = await preparePaymentQr(
      new File(['PNG original'], 'qr.png', { type: 'image/png' }),
    );
    expect(result).toEqual({
      id: 'qr-local',
      imageData: JPEG,
      contentType: 'image/jpeg',
      width: 1600,
      height: 800,
      sha256: '0'.repeat(64),
    });
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1600, 800);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
    expect(context.fillStyle).toBe('#fff');
    expect(digest).toHaveBeenCalledWith('SHA-256', new TextEncoder().encode(JPEG));
    expect(revokeUrl).toHaveBeenCalledWith('blob:qr-local');
  });
  it('reduce calidad solo cuando se necesita para limitar el documento y conserva dimensiones', async () => {
    canvas.toDataURL
      .mockReturnValueOnce('data:image/jpeg;base64,/9j/' + 'A'.repeat(420000))
      .mockReturnValueOnce(JPEG);
    const result = await preparePaymentQr(new File(['foto'], 'qr.webp', { type: 'image/webp' }));
    expect(canvas.toDataURL).toHaveBeenCalledTimes(2);
    expect(canvas.toDataURL.mock.calls[0][1]).toBeGreaterThan(canvas.toDataURL.mock.calls[1][1]);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(800);
  });
  it('rechaza una imagen falsificada y libera la URL aunque falle al decodificar', async () => {
    decode.mockRejectedValueOnce(Error('Foto ilegible'));
    await expect(
      preparePaymentQr(new File(['<html>'], 'qr.jpg', { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect(canvas.getContext).not.toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledOnce();
  });
  it('rechaza fotos diminutas, enormes y proporciones que no permiten leer el QR', async () => {
    for (const [width, height] of [
      [0, 500],
      [63, 63],
      [10000, 10000],
      [40000, 100],
    ]) {
      dimensions.width = width;
      dimensions.height = height;
      await expect(
        preparePaymentQr(new File(['foto'], 'qr.jpg', { type: 'image/jpeg' })),
      ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    }
    expect(canvas.getContext).not.toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledTimes(4);
  });
  it('no acepta una salida falsa o excesiva y no calcula su hash', async () => {
    for (const data of [
      'data:image/png;base64,AAA',
      'data:image/jpeg;base64,/9j/' + 'A'.repeat(420000),
    ]) {
      canvas.toDataURL.mockReturnValue(data);
      await expect(
        preparePaymentQr(new File(['foto'], 'qr.png', { type: 'image/png' })),
      ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    }
    expect(digest).not.toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledTimes(2);
  });
});
