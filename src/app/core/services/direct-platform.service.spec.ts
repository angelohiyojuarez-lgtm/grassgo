import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import { DirectPlatformService } from './direct-platform.service';

const sdk = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getCount: vi.fn(),
  transaction: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  onSnapshot: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (base: { path?: string }, ...parts: string[]) => {
    const path = parts.length ? parts.join('/') : base.path + '/evento-nuevo';
    return { path, id: path.split('/').at(-1) };
  },
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (reference: { path: string }, ...filters: unknown[]) => ({ ...reference, filters }),
  where: (...values: unknown[]) => ({ where: values }),
  orderBy: (...values: unknown[]) => ({ orderBy: values }),
  limit: (value: number) => ({ limit: value }),
  getDocFromServer: sdk.getDoc,
  getDocsFromServer: sdk.getDocs,
  getCountFromServer: sdk.getCount,
  runTransaction: sdk.transaction,
  onSnapshot: sdk.onSnapshot,
  serverTimestamp: () => ({ serverTime: true }),
}));

describe('Superadmin conectado con los negocios reales', () => {
  let service: DirectPlatformService;
  let records: Map<string, Record<string, any>>;
  let user: { uid: string } | null;
  const getDb = vi.fn();
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1)!,
    exists: () => records.has(path),
    data: () => records.get(path),
  });
  const directChildren = (path: string) =>
    [...records.keys()].filter(
      (key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'),
    );
  const dottedUpdate = (before: Record<string, any>, fields: Record<string, any>) => {
    const after = structuredClone(before);
    for (const [key, value] of Object.entries(fields)) {
      const parts = key.split('.');
      let target = after;
      while (parts.length > 1) {
        const part = parts.shift()!;
        target = target[part] ??= {};
      }
      target[parts[0]] = value;
    }
    return after;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    user = { uid: 'root' };
    getDb.mockResolvedValue({});
    const payment = {
      mode: 'live',
      qr: 'payment-qrs/el-puma/qr-real',
      methods: ['Yape'],
      recipient: 'Titular del negocio',
      phone: '999111222',
    };
    const court = {
      id: 'principal',
      name: 'Cancha principal',
      status: 'active',
      dayPriceCents: 3500,
      nightPriceCents: 4500,
      nightStartsAt: 18,
      pricingRevision: 1,
    };
    records = new Map([
      ['platform_roles/root', { role: 'superadmin', status: 'active' }],
      [
        'establishments/el-puma',
        {
          name: 'Grass El Puma',
          location: 'Salinas',
          status: 'approved',
          bookingEngine: 'direct',
          managedAdminUid: 'dueño',
          bookingPolicy: { enabled: true, advanceCents: 1000, holdMinutes: 15 },
        },
      ],
      [
        'catalog/el-puma',
        {
          status: 'published',
          description: 'Información guardada por el dueño',
          days: [0, 1, 2, 3, 4, 5, 6],
          openHour: 9,
          closeHour: 24,
          scheduleRevision: 2,
          paymentRevision: 3,
          booking: { enabled: true, engine: 'direct', payment },
          courts: [{ ...court, pricingConfirmed: true }],
        },
      ],
      ['establishments/el-puma/members/dueño', { role: 'admin', status: 'active' }],
      [
        'establishments/el-puma/settings/schedule',
        { days: [0, 1, 2, 3, 4, 5, 6], openHour: 9, closeHour: 24, revision: 2 },
      ],
      ['establishments/el-puma/settings/payment', { ...payment, revision: 3 }],
      ['establishments/el-puma/courts/principal', { ...court, maintenance: false }],
      ['direct_requests/privado', { clientUid: 'cliente', totalCents: 3500, status: 'confirmed' }],
    ]);
    sdk.getDoc.mockImplementation(async ({ path }: { path: string }) => snapshot(path));
    sdk.get.mockImplementation(async ({ path }: { path: string }) => snapshot(path));
    sdk.getDocs.mockImplementation(
      async ({ path, filters = [] }: { path: string; filters: any[] }) => {
        let paths = directChildren(path);
        for (const constraint of filters) {
          if (constraint.where) {
            const [key, , value] = constraint.where;
            paths = paths.filter((item) => records.get(item)?.[key] === value);
          }
          if (constraint.limit) paths = paths.slice(0, constraint.limit);
        }
        return { docs: paths.map(snapshot) };
      },
    );
    sdk.getCount.mockImplementation(async ({ path }: { path: string }) => ({
      data: () => ({ count: directChildren(path).length }),
    }));
    sdk.transaction.mockImplementation(
      async (_db: unknown, callback: (tx: any) => Promise<void>) => {
        const writes: (() => void)[] = [];
        await callback({
          get: sdk.get,
          update: (reference: { path: string }, data: Record<string, any>) => {
            sdk.update(reference, data);
            writes.push(() =>
              records.set(reference.path, dottedUpdate(records.get(reference.path)!, data)),
            );
          },
          set: (reference: { path: string }, data: Record<string, any>) => {
            sdk.set(reference, data);
            writes.push(() => records.set(reference.path, data));
          },
        });
        writes.forEach((write) => write());
      },
    );
    sdk.onSnapshot.mockImplementation(() => vi.fn());
    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseService, useValue: { getDb } },
        { provide: AuthService, useValue: { ready: Promise.resolve(), user: () => user } },
      ],
    });
    service = TestBed.inject(DirectPlatformService);
  });

  it('exige identidad y rol global activo antes de consultar negocios', async () => {
    user = null;
    await expect(service.overview()).rejects.toMatchObject({ code: 'functions/unauthenticated' });
    expect(getDb).not.toHaveBeenCalled();
    user = { uid: 'root' };
    records.delete('platform_roles/root');
    await expect(service.overview()).rejects.toMatchObject({ code: 'functions/permission-denied' });
    records.set('platform_roles/root', { role: 'superadmin', status: 'suspended' });
    await expect(service.activity()).rejects.toMatchObject({ code: 'functions/permission-denied' });
    expect(sdk.getDocs).not.toHaveBeenCalled();
  });
  it('muestra el negocio existente y reconoce publicado aunque su estado privado sea aprobado', async () => {
    const result = await service.overview();
    expect(result.totalBusinessCount).toBe(1);
    expect(result.limitReached).toBe(false);
    expect(result.totals).toEqual({
      businesses: 1,
      published: 1,
      enabled: 1,
      suspended: 0,
      courts: 1,
    });
    expect(result.establishments[0]).toMatchObject({
      id: 'el-puma',
      name: 'Grass El Puma',
      status: 'approved',
      publicationStatus: 'published',
      description: 'Información guardada por el dueño',
      ready: true,
      missing: [],
      bookingEnabled: true,
      courts: [{ id: 'principal', dayPriceCents: 3500, nightPriceCents: 4500 }],
    });
    const queried = sdk.getDoc.mock.calls
      .map(([ref]) => ref.path)
      .concat(sdk.getDocs.mock.calls.map(([ref]) => ref.path));
    expect(
      queried.some((path: string) => /direct_requests|direct_proofs|profiles/.test(path)),
    ).toBe(false);
    expect(sdk.set).not.toHaveBeenCalled();
  });
  it('no considera cobros habilitados solo porque la ficha pública esté visible', async () => {
    records.delete('establishments/el-puma/settings/payment');
    const result = await service.overview();
    expect(result.totals.published).toBe(1);
    expect(result.totals.enabled).toBe(0);
    expect(result.establishments[0]).toMatchObject({
      paymentConfigured: false,
      ready: false,
      missing: ['QR y datos reales de pago'],
    });
  });
  it('detecta horarios y pagos desincronizados frente a lo guardado por el dueño', async () => {
    records.get('catalog/el-puma')!['openHour'] = 10;
    records.get('catalog/el-puma')!['booking'].payment.phone = '999222333';
    // La proyección y el canónico son objetos separados en una base de datos real.
    records.get('establishments/el-puma/settings/payment')!['phone'] = '999111222';
    const venue = (await service.overview()).establishments[0];
    expect(venue.scheduleConfigured).toBe(false);
    expect(venue.paymentConfigured).toBe(false);
    expect(venue.bookingEnabled).toBe(false);
  });
  it('respeta todos los días cerrados sin inventar disponibilidad', async () => {
    records.get('establishments/el-puma/settings/schedule')!['days'] = [];
    records.get('catalog/el-puma')!['days'] = [];
    const venue = (await service.overview()).establishments[0];
    expect(venue.scheduleConfigured).toBe(true);
    expect(venue.missing).toContain('Días de atención abiertos');
    expect(venue.ready).toBe(false);
  });
  it('no inventa dueño ni canchas y detecta precios no proyectados', async () => {
    records.get('establishments/el-puma/members/dueño')!['status'] = 'suspended';
    records.get('catalog/el-puma')!['courts'][0].nightPriceCents = 5000;
    // Separar el dato privado que el fixture copió superficialmente.
    records.get('establishments/el-puma/courts/principal')!['nightPriceCents'] = 4500;
    const venue = (await service.overview()).establishments[0];
    expect(venue.ownerAssigned).toBe(false);
    expect(venue.missing).toContain('Dueño asignado');
    expect(venue.missing).toContain('Guardar o confirmar los precios de cada cancha');
    expect(venue.ready).toBe(false);
  });
  it('mantiene el contador global exacto y avisa al limitar el directorio', async () => {
    for (let index = 1; index < 103; index++)
      records.set('establishments/negocio-' + index, { name: 'Negocio ' + index, status: 'draft' });
    const result = await service.overview();
    expect(result.totalBusinessCount).toBe(103);
    expect(result.establishments).toHaveLength(100);
    expect(result.totals.businesses).toBe(100);
    expect(result.limitReached).toBe(true);
  });
  it('propaga fallos de consulta en lugar de devolver negocios o cifras de ejemplo', async () => {
    sdk.getDocs.mockRejectedValueOnce(Error('Sin conexión'));
    await expect(service.overview()).rejects.toThrow('Sin conexión');
  });
  it('devuelve actividad limitada y sin los campos privados extra del registro', async () => {
    records.set('audit_logs/real', {
      action: 'business_published',
      establishmentId: 'el-puma',
      actorUid: 'root',
      at: { toMillis: () => 12345 },
      status: 'published',
      privatePayload: 'no exponer',
    });
    const result = await service.activity();
    expect(result.events).toEqual([
      {
        id: 'real',
        action: 'business_published',
        establishmentId: 'el-puma',
        actorUid: 'root',
        at: 12345,
        status: 'published',
      },
    ]);
    expect(sdk.getDocs).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ orderBy: ['at', 'desc'] }, { limit: 30 }] }),
    );
  });
  it('suspende negocio y catálogo en una transacción conservando pago, horarios y reservas', async () => {
    const payment = structuredClone(records.get('catalog/el-puma')!['booking'].payment);
    const schedule = structuredClone(records.get('establishments/el-puma/settings/schedule'));
    const reservation = structuredClone(records.get('direct_requests/privado'));
    await service.setStatus({ establishmentId: 'el-puma', status: 'suspended' });
    const auditId = records.get('establishments/el-puma')!['platformStatusChangeId'];
    expect(sdk.update).toHaveBeenCalledTimes(2);
    expect(sdk.set).toHaveBeenCalledOnce();
    expect(records.get('establishments/el-puma')).toMatchObject({
      status: 'suspended',
      bookingPolicy: { enabled: false, advanceCents: 1000 },
      platformStatusChangeId: auditId,
      platformStatusUpdatedBy: 'root',
    });
    expect(records.get('catalog/el-puma')).toMatchObject({
      status: 'suspended',
      booking: { enabled: false, payment },
      platformStatusChangeId: auditId,
      platformStatusUpdatedBy: 'root',
    });
    expect(records.get('audit_logs/' + auditId)).toEqual({
      action: 'establishment_status_changed',
      establishmentId: 'el-puma',
      actorUid: 'root',
      at: { serverTime: true },
      status: 'suspended',
      previousStatus: 'approved',
      publicationStatus: 'suspended',
    });
    expect(records.get('establishments/el-puma/settings/schedule')).toEqual(schedule);
    expect(records.get('direct_requests/privado')).toEqual(reservation);
  });
  it('aprobar conserva deshabilitadas las reservas y no publica automáticamente', async () => {
    records.get('establishments/el-puma')!['status'] = 'suspended';
    records.get('catalog/el-puma')!['status'] = 'suspended';
    await service.setStatus({ establishmentId: 'el-puma', status: 'approved' });
    expect(records.get('establishments/el-puma')).toMatchObject({
      status: 'approved',
      bookingPolicy: { enabled: false },
    });
    expect(records.get('catalog/el-puma')).toMatchObject({
      status: 'draft',
      booking: { enabled: false },
    });
    const auditId = records.get('establishments/el-puma')!['platformStatusChangeId'];
    expect(records.get('audit_logs/' + auditId)!['publicationStatus']).toBe('draft');
  });
  it('un estado idéntico no despublica ni duplica auditoría; no crea catálogos ausentes', async () => {
    await service.setStatus({ establishmentId: 'el-puma', status: 'approved' });
    expect(sdk.update).not.toHaveBeenCalled();
    expect(sdk.set).not.toHaveBeenCalled();
    expect(records.get('catalog/el-puma')!['status']).toBe('published');
    records.delete('catalog/el-puma');
    await service.setStatus({ establishmentId: 'el-puma', status: 'suspended' });
    expect(sdk.update).toHaveBeenCalledOnce();
    expect(records.has('catalog/el-puma')).toBe(false);
    const auditId = records.get('establishments/el-puma')!['platformStatusChangeId'];
    expect(records.get('audit_logs/' + auditId)!['publicationStatus']).toBe('missing');
  });
  it('usa UUID distintos compatibles con las reglas y vincula cada auditoría con ambos documentos', async () => {
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    await service.setStatus({ establishmentId: 'el-puma', status: 'suspended' });
    const suspendedId = records.get('establishments/el-puma')!['platformStatusChangeId'];
    expect(suspendedId).toMatch(uuid);
    expect(records.get('catalog/el-puma')!['platformStatusChangeId']).toBe(suspendedId);
    expect(records.has('audit_logs/' + suspendedId)).toBe(true);
    await service.setStatus({ establishmentId: 'el-puma', status: 'approved' });
    const approvedId = records.get('establishments/el-puma')!['platformStatusChangeId'];
    expect(approvedId).toMatch(uuid);
    expect(approvedId).not.toBe(suspendedId);
    expect(records.get('catalog/el-puma')!['platformStatusChangeId']).toBe(approvedId);
    expect(records.get('audit_logs/' + suspendedId)!['status']).toBe('suspended');
    expect(records.get('audit_logs/' + approvedId)!['status']).toBe('approved');
  });
  it('rechaza identidad de negocio inválida y revalida el rol dentro de la transacción', async () => {
    await expect(
      service.setStatus({ establishmentId: '../ajeno', status: 'suspended' }),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect(getDb).not.toHaveBeenCalled();
    sdk.get.mockImplementation(async ({ path }: { path: string }) =>
      path.startsWith('platform_roles/')
        ? { data: () => ({ role: 'superadmin', status: 'suspended' }) }
        : snapshot(path),
    );
    await expect(
      service.setStatus({ establishmentId: 'el-puma', status: 'suspended' }),
    ).rejects.toMatchObject({ code: 'functions/permission-denied' });
    expect(sdk.update).not.toHaveBeenCalled();
    expect(sdk.set).not.toHaveBeenCalled();
  });
  it('escucha los cambios del dueño y su limpieza bloquea callbacks tardíos', async () => {
    const changed = vi.fn(),
      failed = vi.fn();
    const stop = await service.observeChanges(changed, failed);
    expect(sdk.onSnapshot).toHaveBeenCalledTimes(3);
    const [business, businessNext, businessError] = sdk.onSnapshot.mock.calls[0];
    const [catalog, catalogNext] = sdk.onSnapshot.mock.calls[1];
    const [audit, auditNext] = sdk.onSnapshot.mock.calls[2];
    expect(business).toMatchObject({ path: 'establishments', filters: [{ limit: 100 }] });
    expect(catalog).toMatchObject({ path: 'catalog', filters: [{ limit: 100 }] });
    expect(audit).toMatchObject({
      path: 'audit_logs',
      filters: [{ orderBy: ['at', 'desc'] }, { limit: 30 }],
    });
    businessNext();
    catalogNext();
    auditNext();
    expect(changed).toHaveBeenCalledTimes(3);
    businessError(Error('Sin conexión'));
    expect(failed).toHaveBeenCalledOnce();
    stop();
    businessNext();
    catalogNext();
    auditNext();
    businessError(Error('Tardío'));
    expect(changed).toHaveBeenCalledTimes(3);
    expect(failed).toHaveBeenCalledOnce();
    for (const result of sdk.onSnapshot.mock.results) expect(result.value).toHaveBeenCalledOnce();
  });
});
