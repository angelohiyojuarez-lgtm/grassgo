import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import { KIOSK_PHOTO_MAX_LENGTH, KioskProductInput, validKioskPhoto } from '../models/kiosk';
import { KioskService } from './kiosk.service';

const sdk = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  transaction: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/'), id: parts.at(-1) }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  getDocFromServer: sdk.get,
  runTransaction: sdk.transaction,
  onSnapshot: sdk.snapshot,
  serverTimestamp: () => ({ serverTime: true }),
}));

it('admin y superadmin guardan, reemplazan y quitan fotos opcionales; vender y reponer conserva foto, dinero e historial ligero', async () => {
  const productId = 'a311a111-1111-4111-8111-111111111111';
  const legacyId = 'a311a111-1111-4111-8111-111111111112';
  const op = (index: number) => `b311a111-1111-4111-8111-${String(index).padStart(12, '0')}`;
  const path = (id = productId) => 'establishments/local/kiosk_products/' + id;
  const movement = (index: number) => 'establishments/local/kiosk_movements/' + op(index);
  const photoA = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(80);
  const photoB = 'data:image/jpeg;base64,/9j/' + 'B'.repeat(80);
  const records = new Map<string, Record<string, any>>([
    ['platform_roles/root', { role: 'superadmin', status: 'active' }],
    ['establishments/local', { status: 'approved', bookingEngine: 'direct' }],
    ['establishments/local/members/owner', { role: 'admin', status: 'active' }],
  ]);
  let user = { uid: 'owner' };
  const snapshot = (key: string) => ({
    id: key.split('/').at(-1),
    exists: () => records.has(key),
    data: () => records.get(key),
  });
  sdk.get.mockImplementation(async ({ path }: { path: string }) => snapshot(path));
  sdk.transaction.mockImplementation(async (_db: unknown, callback: (tx: any) => Promise<void>) => {
    const writes: (() => void)[] = [];
    await callback({
      get: sdk.get,
      set: (ref: { path: string }, data: Record<string, any>) => {
        sdk.set(ref, data);
        writes.push(() => records.set(ref.path, data));
      },
    });
    writes.forEach((write) => write());
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: FirebaseService, useValue: { getDb: async () => ({}) } },
      { provide: AuthService, useValue: { ready: Promise.resolve(), user: () => user } },
    ],
  });
  const service = TestBed.inject(KioskService);
  const input: KioskProductInput = {
    productId,
    operationId: op(1),
    name: 'Agua',
    category: 'Bebidas',
    priceCents: 100,
    costCents: 40,
    initialStock: 5,
    active: true,
    expectedRevision: 0,
    photo: photoA,
  };
  await service.saveProduct('local', input);
  expect(records.get(path())?.['photo']).toBe(photoA);
  expect(records.get(movement(1))?.['productSnapshot']).not.toHaveProperty('photo');
  await service.sell('local', {
    productId,
    operationId: op(2),
    quantity: 1,
    expectedRevision: 1,
    paymentMethod: 'cash',
    paymentReceived: true,
  });
  expect(records.get(path())).toMatchObject({
    photo: photoA,
    stock: 4,
    priceCents: 100,
    costCents: 40,
  });
  expect(records.get(movement(2))).toMatchObject({
    totalCents: 100,
    costTotalCents: 40,
    profitCents: 60,
  });
  await service.restock('local', {
    productId,
    operationId: op(3),
    quantity: 2,
    expectedRevision: 2,
  });
  expect(records.get(path())).toMatchObject({ photo: photoA, stock: 6 });
  const replace = { ...input, operationId: op(4), expectedRevision: 3, photo: photoB };
  await service.saveProduct('local', replace);
  expect(records.get(path())).toMatchObject({ photo: photoB, stock: 6, revision: 4 });
  sdk.set.mockClear();
  await service.saveProduct('local', replace);
  expect(sdk.set).not.toHaveBeenCalled();
  await expect(service.saveProduct('local', { ...replace, photo: photoA })).rejects.toMatchObject({
    code: 'functions/already-exists',
  });
  await service.saveProduct('local', {
    ...input,
    operationId: op(5),
    expectedRevision: 4,
    photo: null,
  });
  expect(records.get(path())).toMatchObject({ photo: null, stock: 6, revision: 5 });
  await service.saveProduct('local', {
    ...input,
    productId: legacyId,
    operationId: op(6),
    photo: undefined,
    initialStock: 1,
  });
  await service.restock('local', {
    productId: legacyId,
    operationId: op(7),
    quantity: 1,
    expectedRevision: 1,
  });
  expect(records.get(path(legacyId))).not.toHaveProperty('photo');
  user = { uid: 'root' };
  await service.saveProduct('local', {
    ...input,
    productId: legacyId,
    operationId: op(8),
    expectedRevision: 2,
    photo: photoA,
  });
  expect(records.get(path(legacyId))).toMatchObject({
    photo: photoA,
    stock: 2,
    priceCents: 100,
    costCents: 40,
  });
  await service.saveProduct('local', {
    ...input,
    productId: legacyId,
    operationId: op(9),
    expectedRevision: 3,
    photo: undefined,
  });
  expect(records.get(path(legacyId))?.['photo']).toBe(photoA);
  for (const [key, value] of records)
    if (key.includes('/kiosk_movements/'))
      expect(JSON.stringify(value)).not.toContain('data:image');
  for (const invalid of [
    '',
    'https://example.com/foto.jpg',
    'data:image/svg+xml;base64,AAAA',
    'data:image/jpeg;base64,/9j/' + 'A'.repeat(KIOSK_PHOTO_MAX_LENGTH),
    42,
    {},
  ]) {
    expect(validKioskPhoto(invalid)).toBe(false);
    await expect(
      service.saveProduct('local', { ...input, photo: invalid as string }),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
  }
  expect(validKioskPhoto(null)).toBe(true);
  expect(validKioskPhoto(photoA)).toBe(true);
});
