import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import { CourtIncome, IncomeSale, incomeRange, summarizeIncome } from '../models/business-income';
import { BusinessIncomeService } from './business-income.service';
import { DirectBookingService } from './direct-booking.service';
import { limaToday } from '../../features/booking/calendar-utils';

const sdk = vi.hoisted(() => ({
  get: vi.fn(),
  getDocs: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/'), id: parts.at(-1) }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (ref: unknown, ...filters: unknown[]) => ({ ...(ref as object), filters }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (value: number) => ({ limit: value }),
  startAfter: (ref: unknown) => ({ startAfter: ref }),
  getDocFromServer: sdk.get,
  getDocsFromServer: sdk.getDocs,
  runTransaction: sdk.transaction,
  serverTimestamp: () => ({ toMillis: () => Date.now() }),
  Timestamp: { fromMillis: (value: number) => ({ toMillis: () => value }) },
}));

it('usa calendario de Lima y separa cobros, ventas, costos desconocidos y pérdidas sin duplicar el adelanto', () => {
  expect(incomeRange('day', '2026-11-22')).toMatchObject({
    startDate: '2026-11-22',
    endDate: '2026-11-23',
    startMs: Date.parse('2026-11-22T05:00:00Z'),
  });
  expect(incomeRange('week', '2026-11-22')).toMatchObject({
    startDate: '2026-11-16',
    endDate: '2026-11-23',
  });
  expect(incomeRange('week', '2027-01-01')).toMatchObject({
    startDate: '2026-12-28',
    endDate: '2027-01-04',
  });
  expect(incomeRange('month', '2028-02-29')).toMatchObject({
    startDate: '2028-02-01',
    endDate: '2028-03-01',
  });
  expect(() => incomeRange('month', '2026-02-30')).toThrow();
  const court = { advanceCents: 1000, balanceCents: 2000, totalCents: 3000 } as CourtIncome;
  const sales = [
    { quantity: 2, totalCents: 600, costTotalCents: 200, profitCents: 400 },
    { quantity: 1, totalCents: 100, costTotalCents: null, profitCents: null },
    { quantity: 1, totalCents: 100, costTotalCents: 150, profitCents: -50 },
  ] as IncomeSale[];
  expect(summarizeIncome([court], [court], sales)).toMatchObject({
    courtsCents: 3000,
    productsCents: 800,
    totalCents: 3800,
    unitsSold: 4,
    knownProfitCents: 350,
    uncostedSales: 1,
    costedSales: 2,
  });
  expect(summarizeIncome([], [], [])).toMatchObject({
    totalCents: 0,
    saleCount: 0,
    uncostedSales: 0,
  });
});

it('consulta todas las páginas del periodo, registra saldo una vez y enlaza el adelanto con la confirmación real', async () => {
  const now = Date.now(),
    today = limaToday(),
    range = incomeRange('day', today),
    stamp = (value: number) => ({ toMillis: () => value });
  const base = 'establishments/local',
    records = new Map<string, Record<string, any>>([
      ['platform_roles/root', { role: 'superadmin', status: 'active' }],
      [base, { status: 'approved', bookingEngine: 'direct' }],
      [base + '/members/owner', { role: 'admin', status: 'active' }],
    ]);
  let user: { uid: string } | null = { uid: 'owner' };
  const court = (
    id: string,
    advance: number,
    balance: number,
    advanceAt: number,
    balanceAt: number | null,
  ) => ({
    reservationId: id,
    courtId: 'principal',
    courtName: 'Cancha',
    date: today,
    hour: 12,
    totalCents: advance + (balance || 3000),
    advanceCents: advance,
    advanceAt: stamp(advanceAt),
    advanceBy: 'owner',
    balanceCents: balance,
    balanceAt: balanceAt === null ? null : stamp(balanceAt),
    balanceBy: balance ? 'owner' : null,
    balanceMethod: balance ? 'cash' : null,
  });
  records.set(base + '/court_income/a', court('a', 1000, 2000, now, now));
  records.set(base + '/court_income/b', court('b', 2000, 5000, range.startMs - 1, now));
  records.set(base + '/court_income/c', court('c', 1000, 0, range.startMs - 1, null));
  for (let index = 0; index < 251; index++)
    records.set(base + '/kiosk_movements/sale-' + String(index).padStart(3, '0'), {
      kind: 'sale',
      productId: 'water',
      quantity: 2,
      productSnapshot: { name: 'Agua' },
      totalCents: 600,
      costTotalCents: index ? 200 : null,
      profitCents: index ? 400 : null,
      paymentMethod: 'cash',
      at: stamp(now),
    });
  records.set(base + '/kiosk_movements/stock', { kind: 'restock', totalCents: 0, at: stamp(now) });
  const snap = (path: string) => ({
    id: path.split('/').at(-1),
    path,
    exists: () => records.has(path),
    data: () => records.get(path),
  });
  const scalar = (value: any) => (typeof value?.toMillis === 'function' ? value.toMillis() : value);
  sdk.get.mockImplementation(async ({ path }: { path: string }) => snap(path));
  sdk.getDocs.mockImplementation(
    async ({ path, filters = [] }: { path: string; filters: any[] }) => {
      let paths = [...records.keys()].filter(
        (key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'),
      );
      for (const f of filters)
        if (f.where) {
          const [key, op, value] = f.where;
          paths = paths.filter((keyPath) => {
            const actual = scalar(records.get(keyPath)?.[key]),
              expected = scalar(value);
            return (
              actual !== null &&
              actual !== undefined &&
              (op === '=='
                ? actual === expected
                : op === '>='
                  ? actual >= expected
                  : actual < expected)
            );
          });
        }
      const order = filters.find((f) => f.orderBy)?.orderBy?.[0];
      if (order)
        paths.sort(
          (a, b) =>
            scalar(records.get(a)?.[order]) - scalar(records.get(b)?.[order]) || a.localeCompare(b),
        );
      const cursor = filters.find((f) => f.startAfter)?.startAfter;
      if (cursor) paths = paths.slice(paths.indexOf(cursor.path) + 1);
      const maximum = filters.find((f) => f.limit)?.limit;
      if (maximum) paths = paths.slice(0, maximum);
      return { docs: paths.map(snap) };
    },
  );
  sdk.transaction.mockImplementation(
    async (_db: unknown, callback: (tx: any) => Promise<unknown>) => {
      const writes: (() => void)[] = [];
      const result = await callback({
        get: sdk.get,
        update: (ref: { path: string }, data: Record<string, any>) => {
          sdk.update(ref, data);
          writes.push(() => records.set(ref.path, { ...records.get(ref.path), ...data }));
        },
        set: (ref: { path: string }, data: Record<string, any>) => {
          sdk.set(ref, data);
          writes.push(() => records.set(ref.path, data));
        },
      });
      writes.forEach((write) => write());
      return result;
    },
  );
  TestBed.configureTestingModule({
    providers: [
      {
        provide: FirebaseService,
        useValue: {
          getDb: async () => ({}),
          auth: {
            get currentUser() {
              return user;
            },
          },
        },
      },
      { provide: AuthService, useValue: { ready: Promise.resolve(), user: () => user } },
    ],
  });
  const service = TestBed.inject(BusinessIncomeService);
  const result = await service.report('local', 'day', today);
  expect(result.summary).toMatchObject({
    courtsCents: 8000,
    productsCents: 150600,
    totalCents: 158600,
    saleCount: 251,
    knownProfitCents: 100000,
    uncostedSales: 1,
  });
  expect(result.topProducts[0]).toMatchObject({ quantity: 502, totalCents: 150600 });
  expect(result.outstanding.map((item) => item.reservationId)).toEqual(['c']);
  await expect(service.receiveBalance('local', 'c', 'cash', false)).rejects.toMatchObject({
    code: 'functions/invalid-argument',
  });
  await expect(service.receiveBalance('local', 'c', 'cash', true)).resolves.toEqual({
    alreadyRecorded: false,
  });
  const first = records.get(base + '/court_income/c');
  await expect(service.receiveBalance('local', 'c', 'yape', true)).resolves.toEqual({
    alreadyRecorded: true,
  });
  expect(records.get(base + '/court_income/c')).toEqual(first);
  expect(sdk.update).toHaveBeenCalledTimes(1);
  user = { uid: 'root' };
  expect((await service.report('local', 'day', today)).summary.courtsCents).toBe(11000);
  user = { uid: 'owner' };
  records.set('direct_requests/new', {
    clientUid: 'client',
    establishmentId: 'local',
    establishmentName: 'Local',
    courtId: 'principal',
    courtName: 'Cancha',
    date: today,
    hour: 12,
    startsAt: stamp(now + 3600000),
    endsAt: stamp(now + 7200000),
    createdAt: stamp(now),
    status: 'pending_verification',
    paymentStatus: 'submitted',
    proofSubmittedAt: stamp(now),
    totalCents: 4000,
    advanceCents: 1000,
  });
  records.set('direct_slots/local/courts/principal/days/' + today + '/hours/12', {
    reservationId: 'new',
    status: 'held',
  });
  const booking = TestBed.inject(DirectBookingService);
  await booking.reviewPayment({
    reservationId: 'new',
    action: 'confirm',
    paymentVerified: true,
    amountCents: 1000,
  });
  expect(records.get(base + '/court_income/new')).toMatchObject({
    reservationId: 'new',
    totalCents: 4000,
    advanceCents: 1000,
    advanceBy: 'owner',
    balanceCents: 0,
    balanceAt: null,
  });
  expect(records.get('direct_requests/new')).toMatchObject({
    status: 'confirmed',
    paymentStatus: 'verified',
    verifiedAdvanceCents: 1000,
  });
  user = null;
  await expect(service.report('local', 'day', today)).rejects.toMatchObject({
    code: 'functions/unauthenticated',
  });
});
