import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import { KioskProductInput, KioskSaleInput } from '../models/kiosk';
import { KioskService, kioskError, kioskMoneyInput } from './kiosk.service';

const sdk = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  transaction: vi.fn(),
  onSnapshot: vi.fn(),
  getDocs: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/'), id: parts.at(-1) }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  query: (ref: { path: string }, ...filters: unknown[]) => ({ ...ref, filters }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (value: number) => ({ limit: value }),
  getDocFromServer: sdk.get,
  getDocsFromServer: sdk.getDocs,
  runTransaction: sdk.transaction,
  onSnapshot: sdk.onSnapshot,
  serverTimestamp: () => ({ serverTime: true }),
}));
const productId = 'a311a111-1111-4111-8111-111111111111';
const otherProduct = 'a311a111-1111-4111-8111-111111111112';
const op = (index: number) => `b311a111-1111-4111-8111-${String(index).padStart(12, '0')}`;
const productPath = (id = productId) => `establishments/local/kiosk_products/${id}`;
const movementPath = (index: number) => `establishments/local/kiosk_movements/${op(index)}`;
const input = (): KioskProductInput => ({
  productId,
  operationId: op(1),
  name: 'Agua',
  category: 'Bebidas',
  priceCents: 100,
  costCents: 40,
  initialStock: 5,
  active: true,
  expectedRevision: 0,
});
const sale = (operation: number, revision: number, quantity = 1): KioskSaleInput => ({
  productId,
  operationId: op(operation),
  quantity,
  expectedRevision: revision,
  paymentMethod: 'cash',
  paymentReceived: true,
});

describe('Kiosko por establecimiento: stock, precios históricos y cobros recibidos', () => {
  let service: KioskService;
  let records: Map<string, Record<string, any>>;
  let user: { uid: string } | null;
  let pending: Promise<unknown>;
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1),
    exists: () => records.has(path),
    data: () => records.get(path),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    user = { uid: 'owner' };
    pending = Promise.resolve();
    records = new Map([
      ['platform_roles/root', { role: 'superadmin', status: 'active' }],
      ['establishments/local', { status: 'approved', bookingEngine: 'direct' }],
      ['establishments/local/members/owner', { role: 'admin', status: 'active' }],
      ['establishments/otro', { status: 'approved', bookingEngine: 'direct' }],
    ]);
    sdk.get.mockImplementation(async ({ path }: { path: string }) => snapshot(path));
    // Serializa los callbacks como las transacciones que vuelven a leer al
    // perder una carrera. Dos ventas de la misma revisión no sobrescriben stock.
    sdk.transaction.mockImplementation((_db: unknown, callback: (tx: any) => Promise<void>) => {
      const result = pending.then(async () => {
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
      pending = result.catch(() => undefined);
      return result;
    });
    sdk.getDocs.mockResolvedValue({ docs: [] });
    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseService, useValue: { getDb: async () => ({}) } },
        { provide: AuthService, useValue: { ready: Promise.resolve(), user: () => user } },
      ],
    });
    service = TestBed.inject(KioskService);
  });

  it('crea, vende y repone atómicamente; reintenta sin duplicar, conserva precios y rechaza carreras de revisión', async () => {
    await service.saveProduct('local', input());
    expect(sdk.set).toHaveBeenCalledTimes(2);
    expect(records.get(productPath())).toMatchObject({
      stock: 5,
      revision: 1,
      lastMovementId: op(1),
      createdBy: 'owner',
    });
    expect(records.get(movementPath(1))).toMatchObject({
      kind: 'create',
      quantity: 5,
      stockBefore: 0,
      stockAfter: 5,
      totalCents: 0,
      costTotalCents: null,
      profitCents: null,
      paymentMethod: null,
      paymentReceived: false,
    });
    await service.sell('local', sale(2, 1, 2));
    expect(records.get(productPath())!['stock']).toBe(3);
    expect(records.get(movementPath(2))).toMatchObject({
      kind: 'sale',
      quantity: 2,
      stockBefore: 5,
      stockAfter: 3,
      productSnapshot: { name: 'Agua', priceCents: 100, costCents: 40 },
      totalCents: 200,
      costTotalCents: 80,
      profitCents: 120,
      paymentMethod: 'cash',
      paymentReceived: true,
      actorUid: 'owner',
    });
    await service.restock('local', { ...sale(3, 2, 4) });
    expect(records.get(productPath())!['stock']).toBe(7);
    expect(records.get(movementPath(3))).toMatchObject({
      kind: 'restock',
      quantity: 4,
      stockBefore: 3,
      stockAfter: 7,
      totalCents: 0,
      costTotalCents: null,
      profitCents: null,
      paymentReceived: false,
    });
    sdk.set.mockClear();
    await service.sell('local', sale(2, 1, 2));
    await service.restock('local', { ...sale(3, 2, 4) });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(records.get(productPath())!['stock']).toBe(7);
    await expect(service.sell('local', sale(2, 1, 1))).rejects.toMatchObject({
      code: 'functions/already-exists',
    });
    await expect(service.sell('local', sale(4, 2))).rejects.toMatchObject({
      code: 'functions/aborted',
    });
    expect(sdk.set).not.toHaveBeenCalled();
    user = { uid: 'root' };
    await service.saveProduct('local', {
      ...input(),
      operationId: op(4),
      expectedRevision: 3,
      priceCents: 120,
      costCents: 150,
      initialStock: 999,
    });
    expect(records.get(productPath())).toMatchObject({
      stock: 7,
      revision: 4,
      createdBy: 'owner',
      updatedBy: 'root',
    });
    expect(records.get(movementPath(4))).toMatchObject({
      kind: 'edit',
      quantity: 0,
      stockBefore: 7,
      stockAfter: 7,
      productSnapshot: { priceCents: 120, costCents: 150 },
    });
    await service.sell('local', sale(5, 4));
    expect(records.get(movementPath(5))).toMatchObject({
      totalCents: 120,
      costTotalCents: 150,
      profitCents: -30,
      actorUid: 'root',
    });
    expect(records.get(movementPath(2))!['productSnapshot'].priceCents).toBe(100);
    sdk.set.mockClear();
    const results = await Promise.allSettled([
      service.sell('local', sale(6, 5)),
      service.sell('local', sale(7, 5)),
    ]);
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((value) => value.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'functions/aborted' });
    expect(records.get(productPath())).toMatchObject({ stock: 5, revision: 6 });
    expect(sdk.set).toHaveBeenCalledTimes(2);
    await expect(service.sell('local', sale(8, 6, 6))).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(records.has(movementPath(8))).toBe(false);
  });

  it('valida importes y acceso de ambos roles, no inventa costos y exige pago y stock reales antes de escribir', async () => {
    expect(kioskMoneyInput('0.01')).toBe(1);
    expect(kioskMoneyInput('0,00')).toBe(0);
    expect(kioskMoneyInput('10000.00')).toBe(1_000_000);
    for (const value of ['', '1.001', '-1', '1e2', '10000.01', 'S/ 2'])
      expect(kioskMoneyInput(value)).toBeNull();
    for (const change of [
      { priceCents: 0 },
      { priceCents: 1.5 },
      { costCents: -1 },
      { costCents: undefined },
      { initialStock: 0.5 },
      { name: ' ' },
    ])
      await expect(
        service.saveProduct('local', { ...input(), ...change } as KioskProductInput),
      ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    expect(sdk.set).not.toHaveBeenCalled();
    await service.saveProduct('local', { ...input(), costCents: null, initialStock: 2 });
    await service.sell('local', { ...sale(2, 1), paymentMethod: 'yape' });
    expect(records.get(movementPath(2))).toMatchObject({
      totalCents: 100,
      costTotalCents: null,
      profitCents: null,
      paymentMethod: 'yape',
    });
    sdk.set.mockClear();
    await expect(
      service.sell('local', { ...sale(3, 2), paymentReceived: false } as unknown as KioskSaleInput),
    ).rejects.toMatchObject({ code: 'functions/invalid-argument' });
    await expect(service.restock('local', { ...sale(3, 2), quantity: -1 })).rejects.toMatchObject({
      code: 'functions/invalid-argument',
    });
    user = null;
    await expect(service.restock('local', sale(3, 2))).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    user = { uid: 'client' };
    await expect(service.restock('local', sale(3, 2))).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
    user = { uid: 'owner' };
    await expect(service.restock('otro', sale(3, 2))).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
    expect(sdk.set).not.toHaveBeenCalled();
    user = { uid: 'root' };
    await service.saveProduct('local', {
      ...input(),
      productId: otherProduct,
      operationId: op(10),
      priceCents: 1,
      costCents: 0,
      initialStock: 1,
    });
    await service.sell('local', { ...sale(11, 1), productId: otherProduct, paymentMethod: 'plin' });
    expect(records.get(movementPath(11))).toMatchObject({
      totalCents: 1,
      costTotalCents: 0,
      profitCents: 1,
      paymentMethod: 'plin',
    });
    sdk.set.mockClear();
    records.get('establishments/local')!['status'] = 'suspended';
    await expect(service.restock('local', sale(3, 2))).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    await expect(service.listMovements('local')).resolves.toEqual([]);
    user = { uid: 'owner' };
    await expect(service.listMovements('local')).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
    expect(sdk.set).not.toHaveBeenCalled();
    expect(kioskError({ code: 'permission-denied' })).toContain('no tiene acceso');
  });
});
