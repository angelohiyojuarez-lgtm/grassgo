import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessMediaService } from './business-media.service';
import { FirebaseService } from '../firebase/firebase.service';
import { BackendTransport } from './backend-transport.service';

const sdk = vi.hoisted(() => ({ getDoc: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: sdk.getDoc,
}));
const imageData = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(80);
const valid = () => ({
  establishmentId: 'local',
  id: 'version-1',
  imageData,
  contentType: 'image/jpeg',
  width: 600,
  height: 600,
  sha256: 'a'.repeat(64),
});
describe('Lectura de imágenes QR versionadas', () => {
  let service: BusinessMediaService;
  const getDb = vi.fn(),
    base = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    getDb.mockResolvedValue({});
    base.mockResolvedValue(null);
    sdk.getDoc.mockResolvedValue({ data: () => valid() });
    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseService, useValue: { getDb } },
        { provide: BackendTransport, useValue: { base } },
      ],
    });
    service = TestBed.inject(BusinessMediaService);
  });
  it('carga únicamente el documento solicitado y devuelve una imagen JPEG segura', async () => {
    expect(await service.read('payment-qrs/local/version-1')).toBe(imageData);
    expect(sdk.getDoc).toHaveBeenCalledExactlyOnceWith('catalog/local/paymentQrs/version-1');
    expect(base).not.toHaveBeenCalled();
  });
  it('conserva las rutas de recursos existentes sin consultar Firestore', async () => {
    expect(await service.read('/assets/demo-payment-qr.svg')).toBe('/assets/demo-payment-qr.svg');
    expect(sdk.getDoc).not.toHaveBeenCalled();
  });
  it('rechaza rutas inyectadas o fuera del formato antes de consultar', async () => {
    for (const path of ['payment-qrs/local/../otra', 'payment-qrs/local/version-1/extra'])
      await expect(service.read(path)).rejects.toThrow('referencia');
    expect(getDb).not.toHaveBeenCalled();
  });
  it('rechaza documentos ausentes, de otro local y payloads que no sean la foto esperada', async () => {
    for (const data of [
      undefined,
      { ...valid(), establishmentId: 'ajeno' },
      { ...valid(), id: 'otra' },
      { ...valid(), imageData: '<svg/>' },
      { ...valid(), width: 0 },
    ]) {
      sdk.getDoc.mockResolvedValueOnce({ data: () => data });
      await expect(service.read('payment-qrs/local/version-1')).rejects.toThrow('foto válida');
    }
  });
  it('propaga denegación del backend sin recurrir a URLs públicas ni almacenamiento alternativo', async () => {
    sdk.getDoc.mockRejectedValueOnce(
      Object.assign(Error('Sin permiso'), { code: 'permission-denied' }),
    );
    await expect(service.read('payment-qrs/local/version-1')).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(base).not.toHaveBeenCalled();
  });
});
