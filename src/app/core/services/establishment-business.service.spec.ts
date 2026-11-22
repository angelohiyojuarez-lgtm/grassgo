import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseService } from '../firebase/firebase.service';
import {
  BusinessContact,
  BusinessPayment,
  PreparedPaymentQr,
} from '../models/establishment-business';
import { EstablishmentBusinessService } from './establishment-business.service';

const sdk = vi.hoisted(() => ({
  getDoc: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: sdk.getDoc,
  runTransaction: sdk.transaction,
  serverTimestamp: () => ({ serverTime: true }),
}));
const imageData = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(80);
const qr = (id = 'qr-original'): PreparedPaymentQr => ({
  id,
  imageData,
  contentType: 'image/jpeg',
  width: 600,
  height: 600,
  sha256: 'a'.repeat(64),
});
const contact = (): BusinessContact => ({
  phone: '999111222',
  description: 'Grass para jugar en equipo',
  reference: 'Frente a la plaza',
  revision: 0,
});
const payment = (id = 'qr-original'): BusinessPayment => ({
  methods: ['Yape'],
  recipient: 'Titular del local',
  phone: '999111222',
  qr: 'payment-qrs/local/' + id,
  revision: 0,
});
const contactPath = 'establishments/local/settings/contact';
const paymentPath = 'establishments/local/settings/payment';
const qrPath = (id = 'qr-original') => 'catalog/local/paymentQrs/' + id;

describe('Datos y QR propios del establecimiento', () => {
  let service: EstablishmentBusinessService;
  let records: Map<string, Record<string, any>>;
  const auth: { currentUser: { uid: string } | null } = { currentUser: null };
  const getDb = vi.fn();
  const snapshot = (path: string) => ({
    exists: () => records.has(path),
    data: () => records.get(path),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    auth.currentUser = { uid: 'dueno-local' };
    getDb.mockResolvedValue({});
    records = new Map([
      [
        'establishments/local',
        { name: 'Grass del barrio', bookingEngine: 'direct', status: 'approved' },
      ],
      [
        'catalog/local',
        {
          name: 'Grass del barrio',
          status: 'published',
          advanceCents: 1000,
          courts: [{ id: 'principal', dayPriceCents: 3000 }],
          booking: {
            engine: 'direct',
            holdMinutes: 15,
            enabled: false,
            payment: { mode: 'demo', qr: '/assets/demo-payment-qr.svg' },
          },
        },
      ],
    ]);
    sdk.getDoc.mockImplementation(async (path: string) => snapshot(path));
    sdk.get.mockImplementation(async (path: string) => snapshot(path));
    sdk.transaction.mockImplementation(
      async (_db: unknown, callback: (tx: any) => Promise<unknown>) => {
        const writes: (() => void)[] = [];
        let writing = false;
        const result = await callback({
          get: (path: string) => {
            if (writing) throw Error('Lectura posterior a escritura');
            return sdk.get(path);
          },
          set: (path: string, data: Record<string, any>) => {
            writing = true;
            sdk.set(path, data);
            writes.push(() => records.set(path, data));
          },
          update: (path: string, data: Record<string, any>) => {
            writing = true;
            if (!records.has(path)) throw Error('Ficha pública inexistente');
            sdk.update(path, data);
            writes.push(() => {
              const next = { ...records.get(path) };
              for (const [key, value] of Object.entries(data)) {
                if (key === 'booking.payment')
                  next['booking'] = { ...next['booking'], payment: value };
                else next[key] = value;
              }
              records.set(path, next);
            });
          },
        });
        writes.forEach((write) => write());
        return result;
      },
    );
    TestBed.configureTestingModule({
      providers: [{ provide: FirebaseService, useValue: { auth, getDb } }],
    });
    service = TestBed.inject(EstablishmentBusinessService);
  });
  afterEach(() => vi.restoreAllMocks());

  it('no inventa datos del destinatario y carga solo documentos concretos', async () => {
    const data = await service.load('local');
    expect(data).toEqual({
      name: 'Grass del barrio',
      contact: { phone: '', description: '', reference: '', revision: 0 },
      payment: {
        methods: [],
        recipient: '',
        phone: '',
        qr: '/assets/demo-payment-qr.svg',
        revision: 0,
      },
    });
    expect(sdk.getDoc).toHaveBeenCalledTimes(4);
    expect(sdk.transaction).not.toHaveBeenCalled();
  });
  it('prioriza configuración canónica y conserva los valores legados cuando falta', async () => {
    records.set('catalog/local', { ...records.get('catalog/local'), ...contact(), revision: 99 });
    expect((await service.load('local')).contact).toEqual(contact());
    records.set(contactPath, { ...contact(), phone: '988777666', revision: 3 });
    records.set(paymentPath, { ...payment(), revision: 2 });
    const data = await service.load('local');
    expect(data.contact.phone).toBe('988777666');
    expect(data.contact.revision).toBe(3);
    expect(data.payment.revision).toBe(2);
  });
  it('exige sesión e identificadores seguros antes de consultar o guardar', async () => {
    auth.currentUser = null;
    await expect(service.load('local')).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    await expect(service.saveContact('local', contact())).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    await expect(service.savePayment('local', payment(), qr())).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    auth.currentUser = { uid: 'dueno-local' };
    await expect(service.load('../otro')).rejects.toMatchObject({
      code: 'functions/invalid-argument',
    });
    expect(getDb).not.toHaveBeenCalled();
  });
  it('guarda contacto, espejo e historial juntos preservando todo el resto del catálogo', async () => {
    const original = records.get('catalog/local')!;
    const saved = await service.saveContact('local', contact());
    expect(saved.revision).toBe(1);
    expect(sdk.set).toHaveBeenCalledTimes(3);
    expect(records.get('catalog/local')).toEqual({
      ...original,
      phone: contact().phone,
      description: contact().description,
      reference: contact().reference,
      contactRevision: 1,
      contactUpdatedAt: { serverTime: true },
    });
  });
  it('el historial guarda actor, antes y después sin crear reservas ni verificar pagos', async () => {
    const saved = await service.saveContact('local', contact());
    const first = records.get(contactPath)!;
    expect(first['updatedBy']).toBe('dueno-local');
    expect(records.get(contactPath + '/history/1')).toEqual({
      establishmentId: 'local',
      kind: 'contact',
      revision: 1,
      actorUid: 'dueno-local',
      at: { serverTime: true },
      before: null,
      after: first,
    });
    await service.saveContact('local', { ...saved, reference: 'A una cuadra' });
    expect(records.get(contactPath + '/history/2')!['before']).toBe(first);
    expect([...records.keys()].some((key) => key.startsWith('direct_requests/'))).toBe(false);
  });
  it('rechaza contacto obsoleto y evita escribir un guardado vigente sin diferencias', async () => {
    const first = await service.saveContact('local', contact());
    sdk.set.mockClear();
    sdk.update.mockClear();
    await expect(service.saveContact('local', contact())).rejects.toMatchObject({
      code: 'functions/aborted',
    });
    expect(await service.saveContact('local', first)).toEqual(first);
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });
  it('valida límites del celular y textos antes de iniciar una transacción', async () => {
    for (const data of [
      { ...contact(), phone: 'tel:999' },
      { ...contact(), description: 'x'.repeat(1001) },
      { ...contact(), reference: 'x'.repeat(301) },
      { ...contact(), revision: -1 },
    ])
      await expect(service.saveContact('local', data)).rejects.toMatchObject({
        code: 'functions/invalid-argument',
      });
    expect(sdk.transaction).not.toHaveBeenCalled();
  });
  it('publica QR, pago, espejo e historial atómicos sin activar reservas ni cambiar precios', async () => {
    const original = records.get('catalog/local')!;
    const saved = await service.savePayment('local', payment(), qr());
    expect(saved.revision).toBe(1);
    expect(sdk.set).toHaveBeenCalledTimes(4);
    expect(sdk.update).toHaveBeenCalledTimes(1);
    expect(records.get(qrPath())).toEqual({
      establishmentId: 'local',
      ...qr(),
      createdAt: { serverTime: true },
    });
    const parent = records.get('catalog/local')!;
    expect(parent['advanceCents']).toBe(original['advanceCents']);
    expect(parent['courts']).toBe(original['courts']);
    expect(parent['booking']).toEqual({
      ...original['booking'],
      payment: {
        mode: 'live',
        methods: ['Yape'],
        recipient: payment().recipient,
        phone: payment().phone,
        qr: payment().qr,
      },
    });
    expect(parent['booking'].enabled).toBe(false);
    expect(parent['paymentRevision']).toBe(1);
    expect(records.get(paymentPath + '/history/1')!['after']).toBe(records.get(paymentPath));
  });
  it('reemplazar un QR conserva la imagen y las instrucciones contratadas por solicitudes anteriores', async () => {
    const first = await service.savePayment('local', payment(), qr());
    const oldQr = records.get(qrPath());
    const snapshot = { ...records.get('catalog/local')!['booking'].payment };
    records.set('direct_requests/anterior', {
      status: 'pending_payment',
      paymentSnapshot: snapshot,
    });
    const next = await service.savePayment(
      'local',
      { ...first, qr: payment('qr-nuevo').qr },
      qr('qr-nuevo'),
    );
    expect(next.revision).toBe(2);
    expect(records.get(qrPath())).toBe(oldQr);
    expect(records.get('direct_requests/anterior')!['paymentSnapshot']).toBe(snapshot);
    expect(snapshot.qr).toBe(first.qr);
    expect(records.has(qrPath('qr-nuevo'))).toBe(true);
  });
  it('permite cambiar el celular manteniendo un QR válido ya guardado y sin reescribir su imagen', async () => {
    const first = await service.savePayment('local', payment(), qr());
    sdk.set.mockClear();
    sdk.update.mockClear();
    const saved = await service.savePayment('local', { ...first, phone: '988777666' });
    expect(saved.revision).toBe(2);
    expect(sdk.set).toHaveBeenCalledTimes(3);
    expect(sdk.set.mock.calls.some(([path]) => path === qrPath())).toBe(false);
  });
  it('no reescribe datos idénticos vigentes y no acepta una versión vieja aunque sean iguales', async () => {
    const first = await service.savePayment('local', payment(), qr());
    sdk.set.mockClear();
    sdk.update.mockClear();
    expect(await service.savePayment('local', first)).toEqual(first);
    await expect(service.savePayment('local', payment(), qr())).rejects.toMatchObject({
      code: 'functions/aborted',
    });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });
  it('rechaza QR ajeno, legado, inexistente o con contenido manipulado', async () => {
    for (const path of [
      'payment-qrs/ajeno/qr-original',
      'payment-qrs/local/../robo',
      '/assets/qr.svg',
    ])
      await expect(service.savePayment('local', { ...payment(), qr: path })).rejects.toMatchObject({
        code: 'functions/invalid-argument',
      });
    await expect(service.savePayment('local', payment())).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    records.set(qrPath(), { establishmentId: 'ajeno', ...qr() });
    await expect(service.savePayment('local', payment())).rejects.toMatchObject({
      code: 'functions/invalid-argument',
    });
    records.set(qrPath(), { establishmentId: 'local', ...qr(), imageData: 'javascript:alert(1)' });
    await expect(service.savePayment('local', payment())).rejects.toMatchObject({
      code: 'functions/invalid-argument',
    });
    expect(sdk.set).not.toHaveBeenCalled();
  });
  it('valida el pago y la imagen y no deja escrituras parciales si falta el catálogo', async () => {
    for (const data of [
      { ...payment(), methods: [] },
      { ...payment(), methods: ['Yape', 'Yape'] },
      { ...payment(), methods: ['Tarjeta'] },
      { ...payment(), recipient: ' ' },
      { ...payment(), phone: 'abc' },
    ])
      await expect(service.savePayment('local', data, qr())).rejects.toMatchObject({
        code: 'functions/invalid-argument',
      });
    await expect(
      service.savePayment('local', payment(), { ...qr(), imageData: '<svg/>' }),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    records.delete('catalog/local');
    await expect(service.savePayment('local', payment(), qr())).rejects.toThrow(
      'Ficha pública inexistente',
    );
    expect(records.has(paymentPath)).toBe(false);
    expect(records.has(qrPath())).toBe(false);
  });
  it('propaga el rechazo de permisos y no aplica el motor nuevo a locales anteriores', async () => {
    sdk.get.mockRejectedValueOnce(
      Object.assign(Error('Sin permiso'), { code: 'permission-denied' }),
    );
    await expect(service.saveContact('local', contact())).rejects.toMatchObject({
      code: 'permission-denied',
    });
    records.get('establishments/local')!['bookingEngine'] = 'legacy';
    await expect(service.load('local')).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });
});
