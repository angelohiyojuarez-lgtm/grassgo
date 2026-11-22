import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import {
  NewPlatformBusiness,
  PlatformOnboardingService,
  advanceInputCents,
} from './platform-onboarding.service';

const sdk = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  getDocs: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/'), id: parts.at(-1) }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (ref: unknown, ...filters: unknown[]) => ({ ref, filters }),
  where: (...args: unknown[]) => ({ where: args }),
  limit: (value: number) => ({ limit: value }),
  getDocFromServer: sdk.get,
  getDocsFromServer: sdk.getDocs,
  runTransaction: sdk.transaction,
  serverTimestamp: () => ({ serverTime: true }),
}));
const id = '3ba11b40-1400-4000-8000-000000000001';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const input = (): NewPlatformBusiness => ({
  requestId: id,
  name: 'Negocio nuevo',
  location: 'Ubicación real',
  ownerEmail: 'Dueno@ejemplo.test',
  courts: [
    {
      id: 'principal',
      name: 'Cancha elegida',
      sport: 'Fútbol',
      surface: 'Grass sintético',
      dayPriceCents: 3500,
      nightPriceCents: 4500,
      nightStartsAt: 18,
    },
  ],
  advanceCents: 2500,
});

describe('Alta y publicación con aceptación del dueño', () => {
  let service: PlatformOnboardingService;
  let records: Map<string, Record<string, any>>;
  let user: { uid: string; email: string; getIdTokenResult: ReturnType<typeof vi.fn> };
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1),
    exists: () => records.has(path),
    data: () => records.get(path),
  });
  const applyUpdate = (data: Record<string, any>, patch: Record<string, any>) => {
    const after = structuredClone(data);
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.');
      let target = after;
      while (parts.length > 1) {
        const next = parts.shift()!;
        target = target[next] ??= {};
      }
      target[parts[0]] = value;
    }
    return after;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    records = new Map([['platform_roles/root', { role: 'superadmin', status: 'active' }]]);
    user = { uid: 'root', email: 'root@ejemplo.test', getIdTokenResult: vi.fn() };
    sdk.get.mockImplementation(async ({ path }: { path: string }) => snapshot(path));
    sdk.getDocs.mockResolvedValue({ docs: [] });
    sdk.transaction.mockImplementation(
      async (_db: unknown, callback: (tx: any) => Promise<void>) => {
        const writes: (() => void)[] = [];
        await callback({
          get: sdk.get,
          set: (ref: { path: string }, data: Record<string, any>) => {
            sdk.set(ref, data);
            writes.push(() => records.set(ref.path, data));
          },
          update: (ref: { path: string }, data: Record<string, any>) => {
            sdk.update(ref, data);
            writes.push(() => records.set(ref.path, applyUpdate(records.get(ref.path)!, data)));
          },
        });
        writes.forEach((write) => write());
      },
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseService, useValue: { getDb: async () => ({}) } },
        { provide: AuthService, useValue: { ready: Promise.resolve(), user: () => user } },
      ],
    });
    service = TestBed.inject(PlatformOnboardingService);
  });

  it('crea el alta y la cancha con los precios indicados, sin inventar horarios ni dueño, y conserva el intento idempotente', async () => {
    await expect(service.create(input())).resolves.toEqual({ id });
    expect(sdk.set).toHaveBeenCalledTimes(9);
    expect(sdk.update).toHaveBeenCalledTimes(1);
    const venue = records.get('establishments/' + id)!;
    expect(venue).toMatchObject({
      status: 'approved',
      bookingEngine: 'direct',
      ownerInvitationId: id,
      bookingPolicy: { enabled: false, advanceCents: 2500, holdMinutes: 15 },
      lifecycleChangeId: id,
    });
    expect(venue).not.toHaveProperty('managedAdminUid');
    const court = records.get(`establishments/${id}/courts/principal`)!;
    expect(court).toMatchObject({
      name: 'Cancha elegida',
      sport: 'Fútbol',
      surface: 'Grass sintético',
      images: [],
      dayPriceCents: 3500,
      nightPriceCents: 4500,
      nightStartsAt: 18,
      pricingRevision: 1,
      pricingUpdatedAt: { serverTime: true },
      status: 'active',
      maintenance: false,
      runtime: null,
    });
    expect(records.get(`catalog/${id}/courts/principal`)).toEqual(court);
    expect(court).not.toHaveProperty('openHour');
    expect(court).not.toHaveProperty('closeHour');
    expect(records.get('catalog/' + id)).toMatchObject({
      status: 'draft',
      advanceCents: 2500,
      booking: { enabled: false },
      lifecycleChangeId: id,
    });
    expect(records.get('establishment_invitations/' + id)).toMatchObject({
      establishmentId: id,
      establishmentName: 'Negocio nuevo',
      targetEmail: 'dueno@ejemplo.test',
      status: 'pending',
      createdBy: 'root',
    });
    expect(records.get('audit_logs/' + id)).toEqual({
      action: 'establishment_created',
      establishmentId: id,
      actorUid: 'root',
      at: { serverTime: true },
      status: 'approved',
      publicationStatus: 'draft',
    });
    sdk.set.mockClear();
    await service.create(input());
    expect(sdk.set).not.toHaveBeenCalled();
    await expect(service.create({ ...input(), name: 'Otro negocio' })).rejects.toMatchObject({
      code: 'functions/already-exists',
    });
    await expect(service.create({ ...input(), advanceCents: 0 })).rejects.toMatchObject({
      code: 'functions/invalid-argument',
    });
    expect(advanceInputCents('25,50')).toBe(2550);
    expect(advanceInputCents('0.01')).toBe(1);
    expect(advanceInputCents('25.555')).toBeNull();
  });

  it('acepta únicamente la invitación del correo verificado con cinco escrituras, sin leer datos ajenos ni escalar a superadmin', async () => {
    await service.create(input());
    sdk.set.mockClear();
    sdk.update.mockClear();
    sdk.get.mockClear();
    user = {
      uid: 'dueño',
      email: 'dueno@ejemplo.test',
      getIdTokenResult: vi
        .fn()
        .mockResolvedValue({ claims: { email: 'dueno@ejemplo.test', email_verified: false } }),
    };
    await expect(service.accept(id)).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(sdk.set).not.toHaveBeenCalled();
    user.getIdTokenResult.mockResolvedValue({
      claims: { email: 'otra@ejemplo.test', email_verified: true },
    });
    await expect(service.accept(id)).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    user.getIdTokenResult.mockResolvedValue({
      claims: { email: 'dueno@ejemplo.test', email_verified: true },
    });
    await expect(service.accept(id)).resolves.toEqual({ establishmentId: id });
    expect(
      sdk.get.mock.calls.every(([ref]) => ref.path === 'establishment_invitations/' + id),
    ).toBe(true);
    expect(sdk.update).toHaveBeenCalledTimes(2);
    expect(sdk.set).toHaveBeenCalledTimes(3);
    expect(records.get(`establishments/${id}/members/dueño`)).toEqual({
      role: 'admin',
      status: 'active',
    });
    expect(records.get(`users/dueño/memberships/${id}`)).toEqual({
      name: 'Negocio nuevo',
      role: 'admin',
      status: 'active',
    });
    expect(records.has('platform_roles/dueño')).toBe(false);
    expect(records.get('establishment_invitations/' + id)).toMatchObject({
      status: 'accepted',
      acceptedBy: 'dueño',
    });
    const changeId = records.get('establishments/' + id)!['lifecycleChangeId'];
    expect(changeId).toMatch(uuid);
    expect(records.get('audit_logs/' + changeId)).toMatchObject({
      action: 'owner_invitation_accepted',
      actorUid: 'dueño',
      status: 'approved',
      publicationStatus: 'draft',
    });
    sdk.set.mockClear();
    sdk.update.mockClear();
    await service.accept(id);
    expect(sdk.set).not.toHaveBeenCalled();
    expect(sdk.update).not.toHaveBeenCalled();
    user.uid = 'otro-uid';
    await expect(service.accept(id)).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
  });

  it('publica solo con configuración canónica, dueño y QR real, enlaza UUID y no verifica comprobantes de clientes', async () => {
    await service.create(input());
    const venue = records.get('establishments/' + id)!;
    venue['managedAdminUid'] = 'dueño';
    records.set(`establishments/${id}/members/dueño`, { role: 'admin', status: 'active' });
    sdk.set.mockClear();
    sdk.update.mockClear();
    await expect(service.publish(id)).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(sdk.update).not.toHaveBeenCalled();
    const payment = {
      mode: 'live',
      methods: ['Yape'],
      recipient: 'Titular real',
      phone: '999111222',
      qr: `payment-qrs/${id}/qr-real`,
    };
    const weekly = { establishmentId: id, days: [1, 2], openHour: 9, closeHour: 23, revision: 1 };
    const pricing = {
      dayPriceCents: 3500,
      nightPriceCents: 4500,
      nightStartsAt: 18,
      pricingRevision: 1,
      pricingUpdatedAt: { seconds: 123, nanoseconds: 0 },
    };
    records.set(`establishments/${id}/settings/schedule`, weekly);
    records.set(`establishments/${id}/settings/payment`, {
      ...payment,
      establishmentId: id,
      revision: 1,
    });
    for (const path of [`establishments/${id}/courts/principal`, `catalog/${id}/courts/principal`])
      Object.assign(records.get(path)!, pricing);
    const parent = records.get('catalog/' + id)!;
    Object.assign(parent, {
      days: weekly.days,
      openHour: 9,
      closeHour: 23,
      scheduleRevision: 1,
      paymentRevision: 1,
    });
    Object.assign(parent['courts'][0], {
      dayPriceCents: pricing.dayPriceCents,
      nightPriceCents: pricing.nightPriceCents,
      nightStartsAt: pricing.nightStartsAt,
      pricingRevision: 1,
      pricingConfirmed: true,
    });
    parent['booking'].payment = payment;
    await expect(service.publish(id)).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(sdk.update).not.toHaveBeenCalled();
    records.set(`catalog/${id}/paymentQrs/qr-real`, {
      id: 'qr-real',
      establishmentId: id,
      imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(50),
      contentType: 'image/jpeg',
      width: 64,
      height: 64,
      sha256: 'a'.repeat(64),
    });
    await expect(service.publish(id)).resolves.toEqual({ success: true });
    expect(sdk.update).toHaveBeenCalledTimes(2);
    expect(sdk.set).toHaveBeenCalledOnce();
    const changeId = records.get('establishments/' + id)!['lifecycleChangeId'];
    expect(changeId).toMatch(uuid);
    expect(records.get('catalog/' + id)).toMatchObject({
      status: 'published',
      lifecycleChangeId: changeId,
      booking: { enabled: true, engine: 'direct', payment },
    });
    expect(venue['bookingPolicy'].advanceCents).toBe(2500);
    expect(records.get('audit_logs/' + changeId)).toEqual({
      action: 'business_published',
      establishmentId: id,
      actorUid: 'root',
      at: { serverTime: true },
      status: 'published',
      publicationStatus: 'published',
    });
    expect(
      [...records.keys()].some(
        (path) => path.startsWith('direct_requests/') || path.startsWith('direct_proofs/'),
      ),
    ).toBe(false);
    sdk.set.mockClear();
    sdk.update.mockClear();
    await service.publish(id);
    expect(sdk.update).not.toHaveBeenCalled();
    expect(sdk.set).not.toHaveBeenCalled();
  });
});
