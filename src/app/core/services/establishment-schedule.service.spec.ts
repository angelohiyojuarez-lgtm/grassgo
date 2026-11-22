import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseService } from '../firebase/firebase.service';
import { DateClosure, scheduleDateStart } from '../models/establishment-schedule';
import { EstablishmentScheduleService } from './establishment-schedule.service';

const sdk = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  transaction: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (path: string, ...filters: unknown[]) => ({ path, filters }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (value: number) => ({ limit: value }),
  getDocFromServer: sdk.getDoc,
  getDocsFromServer: sdk.getDocs,
  runTransaction: sdk.transaction,
  serverTimestamp: () => ({ toMillis: () => Date.now() }),
  Timestamp: { fromMillis: (value: number) => ({ toMillis: () => value }) },
}));
const NOW = Date.parse('2026-11-19T16:00:00Z');
const schedulePath = 'establishments/local/settings/schedule';
const closurePath = 'establishments/local/closures/2026-11-20';
const weekly = () => ({ days: [1, 2, 3, 4, 5, 6, 0], openHour: 8, closeHour: 24, revision: 0 });
const closure = (): DateClosure => ({
  date: '2026-11-20',
  dateStart: scheduleDateStart('2026-11-20'),
  closed: true,
  reason: 'Mantenimiento',
  revision: 0,
});

describe('Horarios y cierres por establecimiento', () => {
  let service: EstablishmentScheduleService;
  let records: Map<string, Record<string, any>>;
  const auth: { currentUser: { uid: string } | null } = { currentUser: null };
  const getDb = vi.fn();
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1),
    exists: () => records.has(path),
    data: () => records.get(path),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    auth.currentUser = { uid: 'administrador-local' };
    getDb.mockResolvedValue({});
    records = new Map([
      ['establishments/local', { name: 'Mi establecimiento', bookingEngine: 'direct' }],
      [
        'catalog/local',
        {
          name: 'Mi establecimiento',
          status: 'published',
          advanceCents: 1000,
          booking: { enabled: false, payment: { mode: 'live', phone: '' } },
        },
      ],
    ]);
    sdk.getDoc.mockImplementation(async (path: string) => snapshot(path));
    sdk.get.mockImplementation(async (path: string) => snapshot(path));
    sdk.getDocs.mockImplementation(async ({ path }: { path: string }) => ({
      docs: [...records.keys()]
        .filter((key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
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
            if (!records.has(path)) throw new Error('Documento público inexistente');
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
    service = TestBed.inject(EstablishmentScheduleService);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('exige sesión antes de leer o escribir', async () => {
    auth.currentUser = null;
    await expect(service.load('local')).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    await expect(service.saveWeekly('local', weekly())).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    await expect(service.saveClosure('local', closure())).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it('no inventa horas cuando todavía no hay canchas configuradas', async () => {
    const result = await service.load('local');
    expect(result.schedule).toEqual({
      days: [0, 1, 2, 3, 4, 5, 6],
      openHour: null,
      closeHour: null,
      revision: 0,
    });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });

  it('infiere solo el horario real común de las canchas activas', async () => {
    records.set('establishments/local/courts/a', {
      status: 'active',
      openHour: 8,
      closeHour: 24,
      openDays: [6, 1],
    });
    records.set('establishments/local/courts/b', {
      status: 'active',
      openHour: 8,
      closeHour: 24,
      openDays: [1, 6],
    });
    expect((await service.load('local')).schedule).toEqual({
      days: [1, 6],
      openHour: 8,
      closeHour: 24,
      revision: 0,
    });
    records.get('establishments/local/courts/b')!['closeHour'] = 23;
    expect((await service.load('local')).schedule.openHour).toBeNull();
    expect(sdk.set).not.toHaveBeenCalled();
  });

  it('consulta únicamente cierres vigentes, ordenados y con límite explícito', async () => {
    records.set(schedulePath, { ...weekly(), days: [], revision: 3 });
    const result = await service.load('local');
    expect(result.schedule.days).toEqual([]);
    const call = sdk.getDocs.mock.calls.find(([value]) => value.path.endsWith('/closures'))![0];
    expect(call.filters[0]).toEqual({ where: ['closed', '==', true] });
    expect(call.filters[1].where.slice(0, 2)).toEqual(['dateStart', '>=']);
    expect(call.filters[1].where[2].toMillis()).toBe(scheduleDateStart('2026-11-19'));
    expect(call.filters.slice(2)).toEqual([{ orderBy: ['dateStart', 'asc'] }, { limit: 100 }]);
  });

  it('guarda horario, espejo e historial en la misma transacción sin activar cobros', async () => {
    const catalogBefore = records.get('catalog/local')!;
    const result = await service.saveWeekly('local', weekly());
    expect(result).toEqual({ ...weekly(), days: [0, 1, 2, 3, 4, 5, 6], revision: 1 });
    expect(sdk.set).toHaveBeenCalledTimes(3);
    expect(sdk.update).toHaveBeenCalledTimes(1);
    const saved = records.get(schedulePath)!;
    expect(saved['updatedBy']).toBe('administrador-local');
    expect(saved['updatedAt'].toMillis()).toBe(NOW);
    expect(records.get('catalog/local')).toEqual({
      ...catalogBefore,
      days: result.days,
      openHour: 8,
      closeHour: 24,
      scheduleRevision: 1,
      scheduleUpdatedAt: expect.anything(),
    });
    expect(records.get(schedulePath + '/history/1')).toEqual({
      establishmentId: 'local',
      kind: 'schedule',
      revision: 1,
      actorUid: 'administrador-local',
      at: expect.anything(),
      before: null,
      after: saved,
    });
    expect([...records.keys()].some((path) => path.startsWith('direct_requests/'))).toBe(false);
  });

  it('conserva el estado anterior en el historial y permite cerrar toda la semana', async () => {
    await service.saveWeekly('local', weekly());
    const before = records.get(schedulePath)!;
    const next = await service.saveWeekly('local', { ...weekly(), days: [], revision: 1 });
    expect(next.days).toEqual([]);
    expect(next.revision).toBe(2);
    expect(records.get('catalog/local')!['days']).toEqual([]);
    expect(records.get(schedulePath + '/history/2')!['before']).toBe(before);
  });

  it('rechaza una revisión obsoleta y no vuelve a escribir si no hay cambios', async () => {
    const first = await service.saveWeekly('local', weekly());
    sdk.set.mockClear();
    sdk.update.mockClear();
    await expect(service.saveWeekly('local', weekly())).rejects.toMatchObject({
      code: 'functions/aborted',
    });
    expect(await service.saveWeekly('local', first)).toEqual(first);
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });

  it('no deja un horario privado publicado parcialmente si falta el espejo', async () => {
    records.delete('catalog/local');
    await expect(service.saveWeekly('local', weekly())).rejects.toThrow(
      'Documento público inexistente',
    );
    expect(records.has(schedulePath)).toBe(false);
    expect(records.has(schedulePath + '/history/1')).toBe(false);
  });

  it('no escribe cuando falla la autorización del establecimiento privado', async () => {
    sdk.get.mockRejectedValueOnce(
      Object.assign(new Error('Sin acceso al local'), { code: 'permission-denied' }),
    );
    await expect(service.saveWeekly('otro-local', weekly())).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
  });

  it('rechaza días repetidos, horas inválidas y borradores sin hora', async () => {
    for (const value of [
      { ...weekly(), days: [1, 1] },
      { ...weekly(), days: [7] },
      { ...weekly(), openHour: null },
      { ...weekly(), openHour: 24 },
      { ...weekly(), closeHour: 8 },
    ])
      await expect(service.saveWeekly('local', value)).rejects.toMatchObject({
        code: 'functions/invalid-argument',
      });
    expect(sdk.transaction).not.toHaveBeenCalled();
  });

  it('publica el cierre sin el motivo privado y sin modificar reservas existentes', async () => {
    records.set('direct_requests/confirmada', { status: 'confirmed', paymentStatus: 'verified' });
    const existing = records.get('direct_requests/confirmada');
    const value = await service.saveClosure('local', closure());
    expect(value.revision).toBe(1);
    expect(value.dateStart).toBe(Date.parse('2026-11-20T05:00:00Z'));
    const privateData = records.get(closurePath)!;
    const publicData = records.get('catalog/local/closures/2026-11-20')!;
    expect(privateData['reason']).toBe('Mantenimiento');
    expect(privateData['updatedBy']).toBe('administrador-local');
    expect(Object.keys(publicData).sort()).toEqual(
      ['closed', 'date', 'dateStart', 'establishmentId', 'revision', 'updatedAt'].sort(),
    );
    expect(JSON.stringify(publicData)).not.toContain('Mantenimiento');
    expect(records.get(closurePath + '/history/1')).toEqual({
      establishmentId: 'local',
      kind: 'closure',
      revision: 1,
      actorUid: 'administrador-local',
      at: expect.anything(),
      before: null,
      after: privateData,
    });
    expect(records.get('direct_requests/confirmada')).toBe(existing);
    expect(sdk.set).toHaveBeenCalledTimes(4);
  });

  it('reabre con una nueva revisión y conserva el cierre anterior, sin borrarlo', async () => {
    const saved = await service.saveClosure('local', closure());
    const before = records.get(closurePath)!;
    const result = await service.saveClosure('local', { ...saved, closed: false });
    expect(result).toEqual({ ...saved, closed: false, revision: 2 });
    expect(records.get(closurePath + '/history/2')!['before']).toBe(before);
    expect(records.get('catalog/local/closures/2026-11-20')!['closed']).toBe(false);
    expect(await service.getClosure('local', saved.date)).toEqual(result);
    expect(await service.getClosure('local', '2026-11-21')).toBeNull();
  });

  it('rechaza cerrar con una revisión vieja y permite un guardado sin diferencias vigente', async () => {
    const saved = await service.saveClosure('local', closure());
    sdk.set.mockClear();
    await expect(
      service.saveClosure('local', { ...closure(), closed: false }),
    ).rejects.toMatchObject({ code: 'functions/aborted' });
    expect(await service.saveClosure('local', saved)).toEqual(saved);
    expect(sdk.set).not.toHaveBeenCalled();
  });

  it('rechaza fechas imposibles, desfases de medianoche y motivos demasiado largos', async () => {
    for (const date of ['2026-02-30', '2026-13-01', '20-11-2026']) {
      await expect(service.getClosure('local', date)).rejects.toMatchObject({
        code: 'functions/invalid-argument',
      });
      await expect(service.saveClosure('local', { ...closure(), date })).rejects.toMatchObject({
        code: 'functions/invalid-argument',
      });
    }
    await expect(
      service.saveClosure('local', { ...closure(), dateStart: Date.parse('2026-11-20T00:00:00Z') }),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    await expect(
      service.saveClosure('local', { ...closure(), reason: 'x'.repeat(161) }),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect(sdk.transaction).not.toHaveBeenCalled();
  });
});
