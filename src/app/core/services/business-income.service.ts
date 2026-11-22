import { Injectable, inject } from '@angular/core';
import type { DocumentData, Firestore, QueryDocumentSnapshot } from 'firebase/firestore';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import {
  BusinessIncomeReport,
  CourtIncome,
  IncomeMethod,
  IncomePeriod,
  IncomeSale,
  incomeRange,
  summarizeIncome,
} from '../models/business-income';
import { platformError } from '../models/platform';

const identifier = (value: string) => {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(value))
    platformError('invalid-argument', 'Identificador inválido.');
};
const timestamp = (value: unknown): number | null => {
  const time = value as { toMillis?: () => number } | null;
  return time && typeof time.toMillis === 'function' ? time.toMillis() : null;
};
const courtView = (value: DocumentData): CourtIncome => ({
  ...(value as CourtIncome),
  advanceAt: timestamp(value['advanceAt']) || 0,
  balanceAt: timestamp(value['balanceAt']),
});

/** Ingresos efectivos: cada adelanto y saldo se cuenta una sola vez. */
@Injectable({ providedIn: 'root' })
export class BusinessIncomeService {
  private readonly firebase = inject(FirebaseService);
  private readonly auth = inject(AuthService);
  private sdk?: Promise<typeof import('firebase/firestore')>;
  private firestore() {
    return (this.sdk ??= import('firebase/firestore'));
  }
  private async access(establishmentId: string) {
    identifier(establishmentId);
    await this.auth.ready;
    const user = this.auth.user();
    if (!user) platformError('unauthenticated', 'Inicia sesión para consultar los ingresos.');
    const db = await this.firebase.getDb();
    const { doc, getDocFromServer } = await this.firestore();
    const role = (await getDocFromServer(doc(db, 'platform_roles', user.uid))).data();
    const superadmin = role?.['role'] === 'superadmin' && role['status'] === 'active';
    const venue = (await getDocFromServer(doc(db, 'establishments', establishmentId))).data();
    if (!venue || venue['bookingEngine'] !== 'direct')
      platformError('failed-precondition', 'Este local todavía no usa los ingresos conectados.');
    if (!superadmin) {
      const member = (
        await getDocFromServer(doc(db, 'establishments', establishmentId, 'members', user.uid))
      ).data();
      if (
        !['approved', 'published'].includes(venue['status']) ||
        member?.['role'] !== 'admin' ||
        member['status'] !== 'active'
      )
        platformError('permission-denied', 'No tienes permiso para consultar este local.');
    }
    return { db, uid: user.uid, venue };
  }
  private async rangeRows(
    db: Firestore,
    path: string,
    field: string,
    start: number,
    end: number,
  ): Promise<DocumentData[]> {
    const { collection, query, where, orderBy, limit, startAfter, Timestamp, getDocsFromServer } =
      await this.firestore();
    const rows: DocumentData[] = [];
    let cursor: QueryDocumentSnapshot | undefined;
    do {
      const page = await getDocsFromServer(
        query(
          collection(db, path),
          where(field, '>=', Timestamp.fromMillis(start)),
          where(field, '<', Timestamp.fromMillis(end)),
          orderBy(field, 'asc'),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(250),
        ),
      );
      rows.push(...page.docs.map((item) => ({ ...item.data(), id: item.id })));
      if (page.docs.length < 250) break;
      cursor = page.docs.at(-1);
    } while (cursor);
    return rows;
  }
  async report(
    establishmentId: string,
    period: IncomePeriod,
    anchor: string,
  ): Promise<BusinessIncomeReport> {
    let range;
    try {
      range = incomeRange(period, anchor);
    } catch {
      platformError('invalid-argument', 'Elige una fecha y un periodo válidos.');
    }
    const { db } = await this.access(establishmentId);
    const path = `establishments/${establishmentId}`;
    const { collection, query, where, getDocsFromServer } = await this.firestore();
    const [advanceRows, balanceRows, movements, pending] = await Promise.all([
      this.rangeRows(db, path + '/court_income', 'advanceAt', range.startMs, range.endMs),
      this.rangeRows(db, path + '/court_income', 'balanceAt', range.startMs, range.endMs),
      this.rangeRows(db, path + '/kiosk_movements', 'at', range.startMs, range.endMs),
      getDocsFromServer(
        query(collection(db, path + '/court_income'), where('balanceCents', '==', 0)),
      ),
    ]);
    const advances = advanceRows.map(courtView),
      balances = balanceRows.map(courtView);
    const sales: IncomeSale[] = movements
      .filter((item) => item['kind'] === 'sale')
      .map((item) => ({
        id: item['id'],
        productId: item['productId'],
        name: item['productSnapshot'].name,
        quantity: item['quantity'],
        totalCents: item['totalCents'],
        costTotalCents: item['costTotalCents'],
        profitCents: item['profitCents'],
        paymentMethod: item['paymentMethod'],
        at: timestamp(item['at']) || 0,
      }));
    const products = new Map<string, BusinessIncomeReport['topProducts'][number]>();
    for (const sale of sales) {
      const old = products.get(sale.productId) || {
        productId: sale.productId,
        name: sale.name,
        quantity: 0,
        totalCents: 0,
      };
      products.set(sale.productId, {
        ...old,
        name: sale.name,
        quantity: old.quantity + sale.quantity,
        totalCents: old.totalCents + sale.totalCents,
      });
    }
    return {
      range,
      summary: summarizeIncome(advances, balances, sales),
      sales: sales.sort((a, b) => b.at - a.at),
      topProducts: [...products.values()].sort((a, b) => b.quantity - a.quantity),
      outstanding: pending.docs
        .map((item) => courtView(item.data()))
        .filter(
          (item) =>
            item.date >= range.startDate &&
            item.date < range.endDate &&
            item.totalCents > item.advanceCents,
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour),
    };
  }
  async receiveBalance(
    establishmentId: string,
    reservationId: string,
    method: IncomeMethod,
    received: boolean,
  ): Promise<{ alreadyRecorded: boolean }> {
    identifier(reservationId);
    if (!['cash', 'yape', 'plin'].includes(method) || received !== true)
      platformError('invalid-argument', 'Confirma que recibiste el saldo y elige cómo te pagaron.');
    const { db, uid, venue } = await this.access(establishmentId);
    if (!['approved', 'published'].includes(venue['status']))
      platformError('failed-precondition', 'El establecimiento está suspendido.');
    const { doc, runTransaction, serverTimestamp } = await this.firestore();
    return runTransaction(db, async (tx) => {
      const ref = doc(db, 'establishments', establishmentId, 'court_income', reservationId);
      const data = (await tx.get(ref)).data();
      if (!data)
        platformError('not-found', 'Primero debe verificarse el adelanto de esta reserva.');
      if (data['balanceCents'] > 0) return { alreadyRecorded: true };
      const amount = data['totalCents'] - data['advanceCents'];
      if (!Number.isSafeInteger(amount) || amount <= 0)
        platformError('failed-precondition', 'Esta reserva no tiene saldo pendiente.');
      tx.update(ref, {
        balanceCents: amount,
        balanceAt: serverTimestamp(),
        balanceBy: uid,
        balanceMethod: method,
      });
      return { alreadyRecorded: false };
    });
  }
}
