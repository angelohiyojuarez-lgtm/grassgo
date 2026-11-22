import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseService } from '../firebase/firebase.service';
import { CourtPricing, solesToCents } from '../models/establishment-pricing';
import { EstablishmentPricingService } from './establishment-pricing.service';

const sdk = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (path: string, ...filters: unknown[]) => ({ path, filters }),
  where: (...values: unknown[]) => ({ where: values }),
  limit: (value: number) => ({ limit: value }),
  getDocFromServer: sdk.getDoc,
  getDocsFromServer: sdk.getDocs,
  runTransaction: sdk.transaction,
  serverTimestamp: () => ({ serverTime: true }),
}));
const privateCourt = 'establishments/local/courts/principal';
const publicCourt = 'catalog/local/courts/principal';
const canonical = privateCourt + '/settings/pricing';
const value = (): CourtPricing => ({
  id: 'principal',
  name: 'Campo no confiable',
  dayPriceCents: 3550,
  nightPriceCents: 4250,
  nightStartsAt: 19,
  revision: 0,
});

describe('Precios propios de las canchas', () => {
  let service: EstablishmentPricingService;
  let records: Map<string, Record<string, any>>;
  const auth: { currentUser: { uid: string } | null } = { currentUser: null };
  const getDb = vi.fn();
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1)!,
    exists: () => records.has(path),
    data: () => records.get(path),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    auth.currentUser = { uid: 'dueño-local' };
    getDb.mockResolvedValue({});
    const court = {
      name: 'Cancha principal',
      status: 'active',
      openHour: 8,
      closeHour: 24,
      dayPriceCents: 3000,
      nightPriceCents: 4000,
      nightStartsAt: 18,
      images: ['foto-original'],
      runtime: null,
    };
    records = new Map([
      ['establishments/local', { name: 'Mi local', bookingEngine: 'direct', status: 'approved' }],
      [privateCourt, { ...court }],
      [publicCourt, { ...court }],
      [
        'catalog/local',
        {
          status: 'published',
          advanceCents: 1000,
          phone: '999111222',
          booking: { enabled: false, engine: 'direct', holdMinutes: 15 },
          courts: [
            {
              id: 'segunda',
              name: 'Otra cancha',
              dayPriceCents: 2000,
              nightPriceCents: 2500,
              nightStartsAt: 18,
            },
            { id: 'principal', ...court },
          ],
        },
      ],
      ['direct_requests/anterior', { status: 'confirmed', totalCents: 3000, advanceCents: 1000 }],
    ]);
    sdk.getDoc.mockImplementation(async (path: string) => snapshot(path));
    sdk.get.mockImplementation(async (path: string) => snapshot(path));
    sdk.getDocs.mockImplementation(async ({ path }: { path: string }) => ({
      docs: [...records.keys()]
        .filter(
          (key) =>
            key.startsWith(path + '/') &&
            !key.slice(path.length + 1).includes('/') &&
            records.get(key)?.['status'] === 'active',
        )
        .map(snapshot),
    }));
    sdk.transaction.mockImplementation(
      async (_db: unknown, callback: (tx: any) => Promise<unknown>) => {
        const writes: (() => void)[] = [];
        const result = await callback({
          get: sdk.get,
          set: (path: string, data: Record<string, any>) => {
            sdk.set(path, data);
            writes.push(() => records.set(path, data));
          },
          update: (path: string, data: Record<string, any>) => {
            if (!records.has(path)) throw Error('Documento inexistente');
            sdk.update(path, data);
            writes.push(() => records.set(path, { ...records.get(path), ...data }));
          },
        });
        writes.forEach((write) => write());
        return result;
      },
    );
    TestBed.configureTestingModule({
      providers: [{ provide: FirebaseService, useValue: { auth, getDb } }],
    });
    service = TestBed.inject(EstablishmentPricingService);
  });
  it('exige sesión e identificadores seguros antes de consultar', async () => {
    auth.currentUser = null;
    await expect(service.load('local')).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    await expect(service.savePricing('local', value())).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    auth.currentUser = { uid: 'dueño-local' };
    await expect(service.load('../ajeno')).rejects.toMatchObject({
      code: 'functions/invalid-argument',
    });
    expect(getDb).not.toHaveBeenCalled();
  });
  it('no inventa canchas ni tarifas si todavía no existen', async () => {
    records.delete(privateCourt);
    const result = await service.load('local');
    expect(result).toEqual({ name: 'Mi local', advanceCents: 1000, courts: [] });
    expect(sdk.set).not.toHaveBeenCalled();
  });
  it('carga valores reales sin publicar y conserva desconocidos como vacíos', async () => {
    records.get(privateCourt)!['dayPriceCents'] = null;
    const result = await service.load('local');
    expect(result.courts[0]).toEqual({
      id: 'principal',
      name: 'Cancha principal',
      dayPriceCents: null,
      nightPriceCents: 4000,
      nightStartsAt: 18,
      revision: 0,
    });
    expect(sdk.update).not.toHaveBeenCalled();
  });
  it('prefiere el canónico y su revisión frente a la proyección', async () => {
    records.set(canonical, { ...value(), revision: 4 });
    const result = await service.load('local');
    expect(result.courts[0]).toMatchObject({
      dayPriceCents: 3550,
      nightPriceCents: 4250,
      revision: 4,
      name: 'Cancha principal',
    });
  });
  it('guarda seis documentos atómicos con auditoría sin tocar reservas, adelanto ni publicación', async () => {
    const other = structuredClone(records.get('catalog/local')!['courts'][0]);
    const booking = structuredClone(records.get('catalog/local')!['booking']);
    const oldRequest = structuredClone(records.get('direct_requests/anterior'));
    const result = await service.savePricing('local', value());
    expect(result).toMatchObject({ ...value(), name: 'Cancha principal', revision: 1 });
    expect(sdk.set).toHaveBeenCalledTimes(3);
    expect(sdk.update).toHaveBeenCalledTimes(3);
    expect(records.get(privateCourt)).toMatchObject({
      status: 'active',
      openHour: 8,
      closeHour: 24,
      runtime: null,
      images: ['foto-original'],
      dayPriceCents: 3550,
      nightPriceCents: 4250,
      pricingRevision: 1,
    });
    const parent = records.get('catalog/local')!;
    expect(parent['booking']).toEqual(booking);
    expect(parent['advanceCents']).toBe(1000);
    expect(parent['status']).toBe('published');
    expect(parent['phone']).toBe('999111222');
    expect(parent['courts'][0]).toEqual(other);
    expect(parent['courts'][1]).toMatchObject({
      id: 'principal',
      dayPriceCents: 3550,
      nightPriceCents: 4250,
      nightStartsAt: 19,
      images: ['foto-original'],
    });
    expect(parent).toMatchObject({
      pricingCourtId: 'principal',
      pricingCourtIndex: 1,
      pricingRevision: 1,
    });
    expect(records.get(canonical + '/history/1')).toMatchObject({
      establishmentId: 'local',
      kind: 'pricing',
      revision: 1,
      actorUid: 'dueño-local',
      before: null,
      after: records.get(canonical),
    });
    expect(records.get('direct_requests/anterior')).toEqual(oldRequest);
  });
  it('una revisión obsoleta no escribe aunque los importes coincidan', async () => {
    records.set(canonical, { ...value(), revision: 3 });
    await expect(service.savePricing('local', value())).rejects.toMatchObject({
      code: 'functions/aborted',
    });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });
  it('rechaza importes inválidos sin redondearlos ni enviar escrituras', async () => {
    for (const dayPriceCents of [null, -1, 999, 1000001, 3000.5])
      await expect(
        service.savePricing('local', { ...value(), dayPriceCents }),
      ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    for (const nightStartsAt of [null, -1, 24, 18.5])
      await expect(
        service.savePricing('local', { ...value(), nightStartsAt }),
      ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect(sdk.transaction).not.toHaveBeenCalled();
  });
  it('no crea canchas ausentes ni modifica una cancha inactiva', async () => {
    records.get(privateCourt)!['status'] = 'inactive';
    await expect(service.savePricing('local', value())).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    records.get(privateCourt)!['status'] = 'active';
    records.delete(publicCourt);
    await expect(service.savePricing('local', value())).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(sdk.set).not.toHaveBeenCalled();
  });
  it('rechaza una ficha con identificadores duplicados o más de veinte canchas', async () => {
    const parent = records.get('catalog/local')!;
    parent['courts'].push({ ...parent['courts'][1] });
    await expect(service.savePricing('local', value())).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    parent['courts'] = Array.from({ length: 21 }, (_, index) => ({ id: 'cancha-' + index }));
    await expect(service.savePricing('local', value())).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(sdk.set).not.toHaveBeenCalled();
  });
  it('reintentar el valor ya guardado conserva revisión e historial', async () => {
    await service.savePricing('local', value());
    sdk.set.mockClear();
    sdk.update.mockClear();
    const result = await service.savePricing('local', { ...value(), revision: 1 });
    expect(result.revision).toBe(1);
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });
  it('un motor anterior no recibe escrituras de esta configuración', async () => {
    records.get('establishments/local')!['bookingEngine'] = 'legacy';
    await expect(service.load('local')).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    await expect(service.savePricing('local', value())).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(sdk.set).not.toHaveBeenCalled();
  });
  it('interpreta soles con punto o coma y rechaza fracciones de céntimo', () => {
    expect(solesToCents('35,50')).toBe(3550);
    expect(solesToCents('35.5')).toBe(3550);
    expect(solesToCents('10000.00')).toBe(1000000);
    for (const text of ['', '9.99', '10000.01', '35.555', '1e3', 'S/ 35', '-35'])
      expect(solesToCents(text)).toBeNull();
  });
});
