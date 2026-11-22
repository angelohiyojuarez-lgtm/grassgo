import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import {
  NewPlatformBusiness,
  NewPlatformCourt,
  PlatformOnboardingService,
} from './platform-onboarding.service';

const sdk = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/'), id: parts.at(-1) }),
  getDocFromServer: sdk.get,
  runTransaction: sdk.transaction,
  serverTimestamp: () => ({ seconds: 1805751000, nanoseconds: 0 }),
}));

describe('Alta con varias canchas', () => {
  it('valida precios antes del alta, reanuda dos deportes sin duplicar y publica con certificados sin lecturas por cancha', async () => {
    vi.clearAllMocks();
    const id = '27ba8df0-0000-4000-8000-000000000001';
    const secondId = '27ba8df0-0000-4000-8000-000000000002';
    const courts: NewPlatformCourt[] = [
      {
        id: 'principal',
        name: 'Cancha de fútbol',
        sport: 'Fútbol',
        surface: 'Grass sintético',
        dayPriceCents: 4500,
        nightPriceCents: 5500,
        nightStartsAt: 18,
      },
      {
        id: secondId,
        name: 'Cancha de vóley',
        sport: 'Vóley',
        surface: 'Losa deportiva',
        dayPriceCents: 3000,
        nightPriceCents: 4000,
        nightStartsAt: 19,
      },
    ];
    const input: NewPlatformBusiness = {
      requestId: id,
      name: 'Negocio multideporte',
      location: 'Ubicación indicada',
      ownerEmail: 'dueño@ejemplo.test',
      advanceCents: 1500,
      courts,
    };
    const records = new Map<string, Record<string, any>>([
      ['platform_roles/root', { role: 'superadmin', status: 'active' }],
    ]);
    const snapshot = (path: string) => ({
      id: path.split('/').at(-1),
      exists: () => records.has(path),
      data: () => records.get(path),
    });
    sdk.get.mockImplementation(async ({ path }: { path: string }) => snapshot(path));
    let failSecond = true;
    let commits = 0;
    sdk.transaction.mockImplementation(
      async (_db: unknown, callback: (tx: any) => Promise<void>) => {
        const writes: { path: string; value: Record<string, any>; update: boolean }[] = [];
        await callback({
          get: sdk.get,
          set: (ref: { path: string }, value: Record<string, any>) => {
            sdk.set(ref, value);
            writes.push({ path: ref.path, value, update: false });
          },
          update: (ref: { path: string }, value: Record<string, any>) => {
            sdk.update(ref, value);
            writes.push({ path: ref.path, value, update: true });
          },
        });
        if (
          failSecond &&
          writes.some((write) => write.path === `establishments/${id}/courts/${secondId}`)
        ) {
          failSecond = false;
          throw Object.assign(Error('Interrupción de conexión'), { code: 'functions/unavailable' });
        }
        if (writes.length) commits++;
        for (const write of writes) {
          if (!write.update) {
            records.set(write.path, write.value);
            continue;
          }
          const next = structuredClone(records.get(write.path)!);
          for (const [key, value] of Object.entries(write.value)) {
            const parts = key.split('.');
            let target = next;
            while (parts.length > 1) {
              const part = parts.shift()!;
              target = target[part] ??= {};
            }
            target[parts[0]] = value;
          }
          records.set(write.path, next);
        }
      },
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseService, useValue: { getDb: async () => ({}) } },
        {
          provide: AuthService,
          useValue: {
            ready: Promise.resolve(),
            user: () => ({ uid: 'root', email: 'root@ejemplo.test' }),
          },
        },
      ],
    });
    const service = TestBed.inject(PlatformOnboardingService);
    await expect(
      service.create({ ...input, courts: [courts[0], { ...courts[1], dayPriceCents: 1499 }] }),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect(commits).toBe(0);
    expect(records.has('establishments/' + id)).toBe(false);
    await expect(service.create(input)).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(records.get('establishments/' + id)).toMatchObject({
      status: 'approved',
      bookingPolicy: { enabled: false, advanceCents: 1500 },
    });
    expect(records.get('catalog/' + id)!['courts']).toHaveLength(1);
    const firstCourtBefore = JSON.stringify(records.get(`establishments/${id}/courts/principal`));
    expect(records.has(`establishments/${id}/courts/${secondId}`)).toBe(false);
    await expect(service.create(input)).resolves.toEqual({ id });
    const parent = records.get('catalog/' + id)!;
    expect(parent['courts'].map((court: NewPlatformCourt) => court.sport)).toEqual([
      'Fútbol',
      'Vóley',
    ]);
    expect(parent['courts'].map((court: NewPlatformCourt) => court.dayPriceCents)).toEqual([
      4500, 3000,
    ]);
    expect(JSON.stringify(records.get(`establishments/${id}/courts/principal`))).toBe(
      firstCourtBefore,
    );
    expect(records.get(`establishments/${id}/courts/${secondId}/settings/pricing`)).toMatchObject({
      establishmentId: id,
      courtId: secondId,
      dayPriceCents: 3000,
      revision: 1,
    });
    expect(parent['courtAdditionId']).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
    );
    expect(parent['courtAdditionId']).not.toBe(secondId);
    expect(records.get('audit_logs/' + parent['courtAdditionId'])).toMatchObject({
      action: 'business_setting_changed',
      referenceId: secondId,
      revision: 1,
    });
    const commitsBeforeRetry = commits;
    await service.create(input);
    expect(commits).toBe(commitsBeforeRetry);
    records.get('establishments/' + id)!['managedAdminUid'] = 'dueño';
    records.set(`establishments/${id}/members/dueño`, { role: 'admin', status: 'active' });
    const payment = {
      mode: 'live',
      methods: ['Yape'],
      recipient: 'Titular del negocio',
      phone: '999111222',
      qr: `payment-qrs/${id}/qr-real`,
    };
    records.set(`establishments/${id}/settings/schedule`, {
      establishmentId: id,
      days: [1, 2],
      openHour: 9,
      closeHour: 23,
      revision: 1,
    });
    records.set(`establishments/${id}/settings/payment`, {
      ...payment,
      establishmentId: id,
      revision: 1,
    });
    records.set(`catalog/${id}/paymentQrs/qr-real`, {
      establishmentId: id,
      id: 'qr-real',
      imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(50),
      contentType: 'image/jpeg',
      width: 64,
      height: 64,
      sha256: 'a'.repeat(64),
    });
    Object.assign(parent, {
      days: [1, 2],
      openHour: 9,
      closeHour: 23,
      scheduleRevision: 1,
      paymentRevision: 1,
    });
    parent['booking'].payment = payment;
    const certificate = parent['courts'][1]['pricingRevision'];
    delete parent['courts'][1]['pricingRevision'];
    await expect(service.publish(id)).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(records.get('establishments/' + id)!['bookingPolicy'].enabled).toBe(false);
    parent['courts'][1]['pricingRevision'] = certificate;
    sdk.get.mockClear();
    await expect(service.publish(id)).resolves.toEqual({ success: true });
    expect(sdk.get.mock.calls.some(([ref]) => ref.path.includes('/courts/'))).toBe(false);
    expect(records.get('establishments/' + id)).toMatchObject({
      status: 'published',
      bookingPolicy: { enabled: true, advanceCents: 1500 },
    });
    expect(records.get('catalog/' + id)!['courts']).toHaveLength(2);
    expect(records.has('platform_roles/dueño')).toBe(false);
    expect([...records.keys()].some((path) => path.startsWith('direct_requests/'))).toBe(false);
  });
});
