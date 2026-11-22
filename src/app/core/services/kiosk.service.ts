import { Injectable, inject } from '@angular/core';
import type { DocumentData, Firestore, Transaction } from 'firebase/firestore';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import {
  KioskMovement,
  KioskMovementKind,
  KioskProduct,
  KioskProductInput,
  KioskProductSnapshot,
  KioskSaleInput,
  KioskStockInput,
  validKioskPhoto,
} from '../models/kiosk';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_STOCK = 1_000_000;
const MAX_MONEY = 1_000_000;
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code: 'functions/' + code });
};
const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
const tenantId = (id: string) => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(id))
    fail('invalid-argument', 'El establecimiento no es válido.');
};
const operationIds = (input: KioskStockInput | KioskProductInput) => {
  if (!input || !UUID.test(input.productId) || !UUID.test(input.operationId))
    fail('invalid-argument', 'Vuelve a abrir el formulario de esta operación.');
  if (!integer(input.expectedRevision, 0, 999_999_999))
    fail('invalid-argument', 'Actualiza los datos del producto antes de continuar.');
};
const text = (value: unknown, minimum: number, maximum: number): string => {
  if (
    typeof value !== 'string' ||
    value.trim().length < minimum ||
    value.trim().length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    fail('invalid-argument', 'Revisa el nombre y la categoría del producto.');
  return (value as string).trim();
};
const productSnapshot = (value: DocumentData): KioskProductSnapshot => ({
  name: value['name'],
  category: value['category'],
  priceCents: value['priceCents'],
  costCents: value['costCents'],
  active: value['active'],
});
const millis = (value: unknown): number | null => {
  const result = value as { toMillis?: () => number } | null;
  return typeof result?.toMillis === 'function' ? result.toMillis() : null;
};
const sameSnapshot = (a: KioskProductSnapshot | undefined, b: KioskProductSnapshot): boolean =>
  !!a &&
  a.name === b.name &&
  a.category === b.category &&
  a.priceCents === b.priceCents &&
  a.costCents === b.costCents &&
  a.active === b.active;

/** No redondea fracciones de céntimo; el cero se admite para un costo conocido. */
export function kioskMoneyInput(value: string): number | null {
  if (typeof value !== 'string' || !/^[0-9]{1,5}([.,][0-9]{1,2})?$/.test(value.trim())) return null;
  const [whole, decimal = ''] = value.trim().replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return integer(cents, 0, MAX_MONEY) ? cents : null;
}

export function kioskError(error: unknown): string {
  const value = error as { code?: string; message?: string };
  const code = value?.code?.split('/').pop();
  if (['invalid-argument', 'failed-precondition', 'aborted', 'already-exists'].includes(code || ''))
    return value.message || 'Actualiza el producto antes de continuar.';
  if (code === 'unauthenticated') return 'Tu sesión terminó. Vuelve a ingresar.';
  if (code === 'permission-denied') return 'Tu cuenta no tiene acceso al kiosko de este local.';
  return 'No pudimos completar la operación. Revisa tu conexión y vuelve a intentarlo.';
}

/** Cada operación conserva un movimiento inmutable y su stock en el mismo commit. */
@Injectable({ providedIn: 'root' })
export class KioskService {
  private readonly firebase = inject(FirebaseService);
  private readonly auth = inject(AuthService);
  private sdk?: Promise<typeof import('firebase/firestore')>;
  private firestore() {
    return (this.sdk ??= import('firebase/firestore'));
  }
  private async session(establishmentId: string) {
    tenantId(establishmentId);
    await this.auth.ready;
    const uid = this.auth.user()?.uid;
    if (!uid) fail('unauthenticated', 'Inicia sesión para usar el kiosko.');
    return { uid: uid!, db: await this.firebase.getDb() };
  }
  private async access(
    db: Firestore,
    uid: string,
    establishmentId: string,
    write: boolean,
    tx?: Transaction,
  ): Promise<void> {
    const { doc, getDocFromServer } = await this.firestore();
    const read = (path: string[]) => {
      const ref = doc(db, path[0], ...path.slice(1));
      return tx ? tx.get(ref) : getDocFromServer(ref);
    };
    const role = (await read(['platform_roles', uid])).data();
    const isSuper = role?.['role'] === 'superadmin' && role?.['status'] === 'active';
    if (!isSuper) {
      const member = (await read(['establishments', establishmentId, 'members', uid])).data();
      if (member?.['role'] !== 'admin' || member?.['status'] !== 'active')
        fail('permission-denied', 'No administras este establecimiento.');
    }
    const venue = (await read(['establishments', establishmentId])).data();
    if (!venue || venue['bookingEngine'] !== 'direct')
      fail('failed-precondition', 'Este establecimiento todavía no tiene habilitado el kiosko.');
    if ((write || !isSuper) && !['approved', 'published'].includes(venue!['status']))
      fail(
        'failed-precondition',
        'El establecimiento debe estar activo para registrar operaciones.',
      );
  }
  async observeProducts(
    establishmentId: string,
    onItems: (items: KioskProduct[]) => void,
    onError: (error: unknown) => void,
  ): Promise<() => void> {
    const { uid, db } = await this.session(establishmentId);
    await this.access(db, uid, establishmentId, false);
    const { collection, onSnapshot } = await this.firestore();
    let active = true;
    const stop = onSnapshot(
      collection(db, 'establishments', establishmentId, 'kiosk_products'),
      (result) => {
        if (!active) return;
        onItems(
          result.docs
            .map((item): KioskProduct => {
              const value = item.data();
              return {
                id: item.id,
                ...productSnapshot(value),
                photo: value['photo'] ?? null,
                stock: value['stock'],
                revision: value['revision'],
                createdAt: millis(value['createdAt']),
                createdBy: value['createdBy'],
                updatedAt: millis(value['updatedAt']),
                updatedBy: value['updatedBy'],
                lastMovementId: value['lastMovementId'],
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'es')),
        );
      },
      (error) => {
        if (active) onError(error);
      },
    );
    return () => {
      active = false;
      stop();
    };
  }
  async listMovements(establishmentId: string): Promise<KioskMovement[]> {
    const { uid, db } = await this.session(establishmentId);
    await this.access(db, uid, establishmentId, false);
    const { collection, query, orderBy, limit, getDocsFromServer } = await this.firestore();
    const result = await getDocsFromServer(
      query(
        collection(db, 'establishments', establishmentId, 'kiosk_movements'),
        orderBy('at', 'desc'),
        limit(30),
      ),
    );
    return result.docs.map((item) => {
      const data = item.data();
      return { ...data, id: item.id, at: millis(data['at']) } as KioskMovement;
    });
  }
  async saveProduct(establishmentId: string, input: KioskProductInput): Promise<void> {
    operationIds(input);
    if (input.photo !== undefined && !validKioskPhoto(input.photo))
      fail(
        'invalid-argument',
        'La foto no es válida. Elige otra imagen o guarda el producto sin foto.',
      );
    const snapshot: KioskProductSnapshot = {
      name: text(input.name, 2, 100),
      category: text(input.category, 0, 40),
      priceCents: input.priceCents,
      costCents: input.costCents,
      active: input.active,
    };
    if (
      !integer(snapshot.priceCents, 1, MAX_MONEY) ||
      !(snapshot.costCents === null || integer(snapshot.costCents, 0, MAX_MONEY)) ||
      typeof snapshot.active !== 'boolean' ||
      !integer(input.initialStock, 0, MAX_STOCK)
    )
      fail('invalid-argument', 'Revisa el precio, el costo y las unidades iniciales del producto.');
    await this.mutate(
      establishmentId,
      input,
      input.expectedRevision === 0 ? 'create' : 'edit',
      snapshot,
    );
  }
  async restock(establishmentId: string, input: KioskStockInput): Promise<void> {
    this.stockInput(input);
    await this.mutate(establishmentId, input, 'restock');
  }
  async sell(establishmentId: string, input: KioskSaleInput): Promise<void> {
    this.stockInput(input);
    if (!['cash', 'yape', 'plin'].includes(input.paymentMethod) || input.paymentReceived !== true)
      fail('invalid-argument', 'Confirma el pago recibido y elige cómo te pagaron.');
    await this.mutate(establishmentId, input, 'sale');
  }
  private stockInput(input: KioskStockInput): void {
    operationIds(input);
    if (!integer(input.quantity, 1, MAX_STOCK) || input.expectedRevision < 1)
      fail('invalid-argument', 'Indica una cantidad válida de unidades.');
  }
  private async mutate(
    establishmentId: string,
    input: KioskProductInput | KioskStockInput | KioskSaleInput,
    kind: KioskMovementKind,
    changed?: KioskProductSnapshot,
  ): Promise<void> {
    const { uid, db } = await this.session(establishmentId);
    const changesPhoto =
      (kind === 'create' || kind === 'edit') && (input as KioskProductInput).photo !== undefined;
    const photo = changesPhoto ? (input as KioskProductInput).photo : undefined;
    const { doc, runTransaction, serverTimestamp } = await this.firestore();
    const productRef = doc(
      db,
      'establishments',
      establishmentId,
      'kiosk_products',
      input.productId,
    );
    const movementRef = doc(
      db,
      'establishments',
      establishmentId,
      'kiosk_movements',
      input.operationId,
    );
    await runTransaction(db, async (tx) => {
      await this.access(db, uid, establishmentId, true, tx);
      const [productDoc, movementDoc] = await Promise.all([
        tx.get(productRef),
        tx.get(movementRef),
      ]);
      const before = productDoc.data();
      const previousMovement = movementDoc.data();
      const quantity =
        kind === 'create'
          ? (input as KioskProductInput).initialStock
          : kind === 'edit'
            ? 0
            : (input as KioskStockInput).quantity;
      // Se reconoce el mismo intento incluso si una operación posterior ya cambió
      // el precio o el stock. Nunca se reaplica la venta ni la reposición.
      if (previousMovement) {
        if (
          previousMovement['actorUid'] === uid &&
          previousMovement['productId'] === input.productId &&
          previousMovement['kind'] === kind &&
          previousMovement['quantity'] === quantity &&
          previousMovement['revision'] === input.expectedRevision + 1 &&
          (!changed || sameSnapshot(previousMovement['productSnapshot'], changed)) &&
          (!changesPhoto || (before?.['photo'] ?? null) === photo) &&
          (kind !== 'sale' ||
            (previousMovement['paymentMethod'] === (input as KioskSaleInput).paymentMethod &&
              previousMovement['paymentReceived'] === true))
        )
          return;
        fail(
          'already-exists',
          'Este intento ya corresponde a otra operación. Abre un formulario nuevo.',
        );
      }
      if (kind === 'create' ? productDoc.exists() : !productDoc.exists())
        fail(
          'failed-precondition',
          kind === 'create' ? 'Este producto ya existe.' : 'El producto ya no está disponible.',
        );
      if (before && before['revision'] !== input.expectedRevision)
        fail(
          'aborted',
          'Otra persona actualizó este producto. Consulta el stock actual y vuelve a intentarlo.',
        );
      const snapshot = changed || productSnapshot(before!);
      const stockBefore = before?.['stock'] ?? 0;
      const stockAfter =
        kind === 'create'
          ? quantity
          : kind === 'restock'
            ? stockBefore + quantity
            : kind === 'sale'
              ? stockBefore - quantity
              : stockBefore;
      if (!integer(stockBefore, 0, MAX_STOCK) || !integer(stockAfter, 0, MAX_STOCK))
        fail(
          'failed-precondition',
          kind === 'sale'
            ? 'No quedan suficientes unidades de este producto.'
            : 'La reposición supera el stock admitido.',
        );
      if (kind === 'sale' && !snapshot.active)
        fail('failed-precondition', 'Este producto está archivado. Actívalo antes de venderlo.');
      const revision = input.expectedRevision + 1;
      const totalCents = kind === 'sale' ? snapshot.priceCents * quantity : 0;
      const costTotalCents =
        kind === 'sale' && snapshot.costCents !== null ? snapshot.costCents * quantity : null;
      const at = serverTimestamp();
      tx.set(productRef, {
        ...snapshot,
        ...(changesPhoto
          ? { photo }
          : before && Object.hasOwn(before, 'photo')
            ? { photo: before['photo'] }
            : {}),
        stock: stockAfter,
        revision,
        createdAt: before?.['createdAt'] ?? at,
        createdBy: before?.['createdBy'] ?? uid,
        updatedAt: at,
        updatedBy: uid,
        lastMovementId: input.operationId,
      });
      tx.set(movementRef, {
        productId: input.productId,
        kind,
        quantity,
        stockBefore,
        stockAfter,
        productSnapshot: snapshot,
        totalCents,
        costTotalCents,
        profitCents: costTotalCents === null ? null : totalCents - costTotalCents,
        paymentMethod: kind === 'sale' ? (input as KioskSaleInput).paymentMethod : null,
        paymentReceived: kind === 'sale',
        revision,
        actorUid: uid,
        at,
      });
    });
  }
}
