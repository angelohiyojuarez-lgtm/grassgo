import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EstablishmentPricingService } from './establishment-pricing.service';
import { FirebaseService } from '../firebase/firebase.service';
import { CourtPricing } from '../models/establishment-pricing';

const sdk = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), transaction: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (path: string) => path,
  where: (...values: unknown[]) => values,
  limit: (value: number) => value,
  getDocFromServer: sdk.getDoc,
  getDocsFromServer: sdk.getDocs,
  runTransaction: sdk.transaction,
  serverTimestamp: () => ({ serverTime: true }),
}));

describe('Tarifas compartidas de fútbol y vóley', () => {
  let records: Map<string, Record<string, any>>;
  let service: EstablishmentPricingService;
  const auth = { currentUser: { uid: 'dueño' } };
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1),
    exists: () => records.has(path),
    data: () => records.get(path),
  });
  const privateCourt = (id: string) => `establishments/negocio/courts/${id}`;
  const canonical = (id: string) => `${privateCourt(id)}/settings/pricing`;
  const request = (id: string, amount: number, revision = 0): CourtPricing => ({
    id,
    name: 'Nombre ignorado',
    dayPriceCents: amount,
    nightPriceCents: amount + 500,
    nightStartsAt: 18,
    revision,
  });
  beforeEach(() => {
    vi.clearAllMocks();
    auth.currentUser = { uid: 'dueño' };
    const football = {
      id: 'futbol',
      name: 'Grass grande',
      sport: 'Fútbol',
      status: 'active',
      dayPriceCents: 3000,
      nightPriceCents: 3500,
      nightStartsAt: 18,
      runtime: null,
    };
    const volleyball = {
      id: 'voley',
      name: 'Cancha de vóley',
      sport: 'Vóley',
      status: 'active',
      dayPriceCents: 2000,
      nightPriceCents: 2500,
      nightStartsAt: 18,
      runtime: null,
    };
    records = new Map([
      [
        'establishments/negocio',
        { bookingEngine: 'direct', status: 'published', name: 'Mi establecimiento' },
      ],
      [
        'catalog/negocio',
        {
          status: 'published',
          advanceCents: 1000,
          booking: { enabled: true, engine: 'direct' },
          courts: [football, volleyball],
        },
      ],
      ['direct_requests/anterior', { status: 'confirmed', courtId: 'futbol', totalCents: 3000 }],
      ...[football, volleyball].flatMap((court): [string, Record<string, any>][] => [
        [privateCourt(court.id), { ...court }],
        [`catalog/negocio/courts/${court.id}`, { ...court }],
      ]),
    ]);
    sdk.getDoc.mockImplementation(async (path: string) => snapshot(path));
    sdk.getDocs.mockImplementation(async (path: string) => ({
      docs: [...records.keys()]
        .filter((key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
        .map(snapshot),
    }));
    sdk.transaction.mockImplementation(
      async (_db: unknown, work: (tx: any) => Promise<unknown>) => {
        const writes: (() => void)[] = [];
        const result = await work({
          get: async (path: string) => snapshot(path),
          set: (path: string, value: Record<string, any>) =>
            writes.push(() => records.set(path, value)),
          update: (path: string, value: Record<string, any>) =>
            writes.push(() => records.set(path, { ...records.get(path), ...value })),
        });
        writes.forEach((write) => write());
        return result;
      },
    );
    TestBed.configureTestingModule({
      providers: [{ provide: FirebaseService, useValue: { auth, getDb: async () => ({}) } }],
    });
    service = TestBed.inject(EstablishmentPricingService);
  });

  it('dueño y superadmin guardan por cancha con las mismas proyecciones e historial, sin alterar deportes ni reservas anteriores', async () => {
    const oldBooking = structuredClone(records.get('direct_requests/anterior'));
    const otherCourt = structuredClone(records.get('catalog/negocio')!['courts'][1]);
    await service.savePricing('negocio', request('futbol', 4000));
    expect(records.get('catalog/negocio')!['courts'][1]).toEqual(otherCourt);
    auth.currentUser = { uid: 'superadmin' };
    await service.savePricing('negocio', request('voley', 2500));
    const loaded = await service.load('negocio');
    expect(loaded.courts.map((court) => [court.id, court.sport, court.dayPriceCents])).toEqual([
      ['futbol', 'Fútbol', 4000],
      ['voley', 'Vóley', 2500],
    ]);
    for (const id of ['futbol', 'voley']) {
      const source = records.get(canonical(id))!;
      const projection = records
        .get('catalog/negocio')!
        ['courts'].find((court: any) => court.id === id);
      expect(projection.pricingRevision).toBe(source['revision']);
      expect(projection.pricingConfirmed).toBe(true);
      expect(records.get(`catalog/negocio/courts/${id}`)!['dayPriceCents']).toBe(
        source['dayPriceCents'],
      );
    }
    const audits = [...records.entries()]
      .filter(([path]) => path.startsWith('audit_logs/'))
      .map(([, data]) => data);
    expect(audits.map((audit) => [audit['actorUid'], audit['referenceId']])).toEqual([
      ['dueño', 'futbol'],
      ['superadmin', 'voley'],
    ]);
    expect(records.get('direct_requests/anterior')).toEqual(oldBooking);
    expect(records.get('catalog/negocio')).toMatchObject({
      status: 'published',
      booking: { enabled: true },
    });
  });

  it('rechaza revisión obsoleta o precio menor al adelanto y confirma certificados antiguos sin duplicar reintentos', async () => {
    await expect(service.savePricing('negocio', request('futbol', 1000, 7))).rejects.toMatchObject({
      code: 'functions/aborted',
    });
    records.get('catalog/negocio')!['advanceCents'] = 2500;
    await expect(service.savePricing('negocio', request('futbol', 2000))).rejects.toMatchObject({
      code: 'functions/invalid-argument',
    });
    records.get('catalog/negocio')!['advanceCents'] = 1000;
    records.set(canonical('futbol'), {
      ...request('futbol', 3000, 1),
      establishmentId: 'negocio',
      courtId: 'futbol',
      updatedAt: { serverTime: true },
    });
    const saved = await service.savePricing('negocio', request('futbol', 3000, 1));
    expect(saved.revision).toBe(2);
    expect(records.get('catalog/negocio')!['courts'][0].pricingRevision).toBe(2);
    const count = [...records.keys()].filter((key) => key.startsWith('audit_logs/')).length;
    await service.savePricing('negocio', request('futbol', 3000, 2));
    expect([...records.keys()].filter((key) => key.startsWith('audit_logs/')).length).toBe(count);
  });
});
