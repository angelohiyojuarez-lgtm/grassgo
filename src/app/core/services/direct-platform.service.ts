import { Injectable, inject } from '@angular/core';
import type { DocumentData, Firestore } from 'firebase/firestore';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import { paymentQrParts } from '../models/establishment-business';
import {
  PlatformAuditEvent,
  PlatformCourt,
  PlatformOverview,
  PlatformVenue,
  platformError,
} from '../models/platform';

const BUSINESS_LIMIT = 100;
const COURT_LIMIT = 20;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
const identifier = (value: string): void => {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(value))
    platformError('invalid-argument', 'Identificador del negocio inválido.');
};
const activeLocal = (data: DocumentData): boolean =>
  ['approved', 'published'].includes(data['status']);
const validPrice = (value: number | null): boolean =>
  value !== null && value >= 1000 && value <= 1000000;
const validHour = (value: number | null): boolean => value !== null && value >= 0 && value <= 23;
const validDays = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length <= 7 &&
  new Set(value).size === value.length &&
  value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
const sameDays = (first: number[], second: unknown): boolean =>
  validDays(second) && JSON.stringify([...first].sort()) === JSON.stringify([...second].sort());

/** Panel de plataforma con el mismo Firestore que usan cliente y dueño del local. */
@Injectable({ providedIn: 'root' })
export class DirectPlatformService {
  private readonly firebase = inject(FirebaseService);
  private readonly auth = inject(AuthService);
  private sdk?: Promise<typeof import('firebase/firestore')>;
  private firestore(): Promise<typeof import('firebase/firestore')> {
    this.sdk ??= import('firebase/firestore');
    return this.sdk;
  }

  private async access(): Promise<{ db: Firestore; uid: string }> {
    await this.auth.ready;
    const uid = this.auth.user()?.uid;
    if (!uid) platformError('unauthenticated', 'Inicia sesión para continuar.');
    const { doc, getDocFromServer } = await this.firestore();
    const db = await this.firebase.getDb();
    const role = (await getDocFromServer(doc(db, 'platform_roles', uid))).data();
    if (role?.['role'] !== 'superadmin' || role?.['status'] !== 'active')
      platformError('permission-denied', 'Acceso exclusivo de superadministración.');
    return { db, uid };
  }

  async overview(): Promise<PlatformOverview> {
    const { db } = await this.access();
    const { collection, getDocsFromServer, getCountFromServer, query, limit } =
      await this.firestore();
    const businesses = collection(db, 'establishments');
    const [loaded, count] = await Promise.all([
      getDocsFromServer(query(businesses, limit(BUSINESS_LIMIT + 1))),
      getCountFromServer(businesses),
    ]);
    const establishments = await Promise.all(
      loaded.docs.slice(0, BUSINESS_LIMIT).map((item) => this.venue(db, item.id, item.data())),
    );
    return {
      establishments,
      totalBusinessCount: count.data().count,
      limitReached:
        loaded.docs.length > BUSINESS_LIMIT || count.data().count > establishments.length,
      totals: {
        businesses: establishments.length,
        published: establishments.filter((item) => item.publicationStatus === 'published').length,
        enabled: establishments.filter((item) => item.bookingEnabled).length,
        suspended: establishments.filter((item) => item.status === 'suspended').length,
        courts: establishments.reduce((total, item) => total + item.courtCount, 0),
      },
    };
  }

  private async venue(db: Firestore, id: string, local: DocumentData): Promise<PlatformVenue> {
    const {
      collection,
      doc,
      query,
      where,
      limit,
      getDocFromServer,
      getDocsFromServer,
      getCountFromServer,
    } = await this.firestore();
    const ownerUid = text(local['managedAdminUid']);
    const courtCollection = collection(db, 'establishments', id, 'courts');
    const [parent, schedule, payment, owner, savedCourts, courtCount] = await Promise.all([
      getDocFromServer(doc(db, 'catalog', id)),
      getDocFromServer(doc(db, 'establishments', id, 'settings', 'schedule')),
      getDocFromServer(doc(db, 'establishments', id, 'settings', 'payment')),
      ownerUid
        ? getDocFromServer(doc(db, 'establishments', id, 'members', ownerUid))
        : Promise.resolve(null),
      getDocsFromServer(
        query(courtCollection, where('status', '==', 'active'), limit(COURT_LIMIT + 1)),
      ),
      getCountFromServer(courtCollection),
    ]);
    const catalog = parent.data();
    const weekly = schedule.data();
    const savedPayment = payment.data();
    const membership = owner?.data();
    const ownerAssigned = membership?.['role'] === 'admin' && membership?.['status'] === 'active';
    const days = weekly?.['days'];
    const openHour = integer(weekly?.['openHour']);
    const closeHour = integer(weekly?.['closeHour']);
    const scheduleConfigured =
      !!weekly &&
      validDays(days) &&
      validHour(openHour) &&
      closeHour !== null &&
      closeHour >= 1 &&
      closeHour <= 24 &&
      openHour! < closeHour &&
      sameDays(days, catalog?.['days']) &&
      openHour === catalog?.['openHour'] &&
      closeHour === catalog?.['closeHour'] &&
      weekly['revision'] === catalog?.['scheduleRevision'];
    const projectedPayment = catalog?.['booking']?.payment;
    const qr = paymentQrParts(text(savedPayment?.['qr']));
    const methods = savedPayment?.['methods'];
    const paymentConfigured =
      !!savedPayment &&
      savedPayment['mode'] === 'live' &&
      qr?.establishmentId === id &&
      Array.isArray(methods) &&
      methods.length >= 1 &&
      methods.length <= 2 &&
      new Set(methods).size === methods.length &&
      methods.every((method) => method === 'Yape' || method === 'Plin') &&
      text(savedPayment['recipient']).trim().length >= 2 &&
      /^\+?[0-9][0-9 ()-]{7,19}$/.test(text(savedPayment['phone'])) &&
      projectedPayment?.mode === 'live' &&
      projectedPayment?.qr === savedPayment['qr'] &&
      projectedPayment?.recipient === savedPayment['recipient'] &&
      projectedPayment?.phone === savedPayment['phone'] &&
      JSON.stringify(projectedPayment?.methods) === JSON.stringify(methods) &&
      savedPayment['revision'] === catalog?.['paymentRevision'];
    const courts: PlatformCourt[] = savedCourts.docs.slice(0, COURT_LIMIT).map((court) => {
      const data = court.data();
      return {
        id: court.id,
        name: text(data['name']),
        sport: text(data['sport']),
        status: text(data['status']),
        dayPriceCents: integer(data['dayPriceCents']),
        nightPriceCents: integer(data['nightPriceCents']),
        nightStartsAt: integer(data['nightStartsAt']),
      };
    });
    const publishedCourts: DocumentData[] = Array.isArray(catalog?.['courts'])
      ? catalog!['courts']
      : [];
    const bookableCourt =
      courts.length > 0 &&
      courts.length === publishedCourts.length &&
      courts.every((court) => {
        const projection = publishedCourts.filter((item) => item['id'] === court.id);
        const source = savedCourts.docs.find((item) => item.id === court.id)?.data();
        return (
          validPrice(court.dayPriceCents) &&
          validPrice(court.nightPriceCents) &&
          validHour(court.nightStartsAt) &&
          source?.['maintenance'] !== true &&
          Number.isInteger(source?.['pricingRevision']) &&
          source!['pricingRevision'] >= 1 &&
          projection.length === 1 &&
          projection[0]['dayPriceCents'] === court.dayPriceCents &&
          projection[0]['nightPriceCents'] === court.nightPriceCents &&
          projection[0]['nightStartsAt'] === court.nightStartsAt &&
          projection[0]['pricingRevision'] === source!['pricingRevision'] &&
          projection[0]['pricingConfirmed'] === true
        );
      });
    const missing: string[] = [];
    if (!ownerAssigned) missing.push('Dueño asignado');
    if (!bookableCourt) {
      const needsPriceConfirmation = courts.some(
        (court) =>
          validPrice(court.dayPriceCents) &&
          validPrice(court.nightPriceCents) &&
          (!savedCourts.docs.find((item) => item.id === court.id)?.data()['pricingRevision'] ||
            publishedCourts.find((item) => item['id'] === court.id)?.['pricingConfirmed'] !== true),
      );
      missing.push(
        needsPriceConfirmation
          ? 'Guardar o confirmar los precios de cada cancha'
          : 'Cancha activa con precios publicados',
      );
    }
    if (!scheduleConfigured) missing.push('Horarios guardados y sincronizados');
    else if (!days.length) missing.push('Días de atención abiertos');
    if (!paymentConfigured) missing.push('QR y datos reales de pago');
    if (!parent.exists()) missing.push('Ficha del negocio en el catálogo');
    if (!activeLocal(local))
      missing.push(
        local['status'] === 'suspended' ? 'Negocio suspendido' : 'Aprobación del negocio',
      );
    const ready = missing.length === 0;
    const rawPublication = catalog?.['status'];
    const publicationStatus: PlatformVenue['publicationStatus'] = !parent.exists()
      ? 'missing'
      : rawPublication === 'published'
        ? 'published'
        : rawPublication === 'suspended'
          ? 'suspended'
          : 'draft';
    return {
      id,
      name: text(local['name']),
      location: text(local['location']),
      description: text(catalog?.['description'] ?? local['description']),
      status: text(local['status']),
      publicationStatus,
      bookingEnabled:
        ready &&
        publicationStatus === 'published' &&
        local['bookingPolicy']?.enabled === true &&
        catalog?.['booking']?.enabled === true &&
        local['bookingEngine'] === 'direct' &&
        catalog?.['booking']?.engine === 'direct',
      courtCount: courtCount.data().count,
      courts,
      courtLimitReached: savedCourts.docs.length > COURT_LIMIT,
      ownerAssigned,
      scheduleConfigured,
      paymentConfigured,
      ready,
      missing,
    };
  }

  async activity(): Promise<{ events: PlatformAuditEvent[] }> {
    const { db } = await this.access();
    const { collection, query, orderBy, limit, getDocsFromServer } = await this.firestore();
    const result = await getDocsFromServer(
      query(collection(db, 'audit_logs'), orderBy('at', 'desc'), limit(30)),
    );
    return {
      events: result.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          action: text(data['action']),
          establishmentId: text(data['establishmentId']),
          actorUid: text(data['actorUid']),
          at: typeof data['at']?.toMillis === 'function' ? data['at'].toMillis() : null,
          status: typeof data['status'] === 'string' ? data['status'] : null,
          kind: typeof data['kind'] === 'string' ? data['kind'] : undefined,
        };
      }),
    };
  }

  async setStatus(input: {
    establishmentId: string;
    status: 'approved' | 'suspended';
  }): Promise<{ success: true }> {
    identifier(input.establishmentId);
    if (!['approved', 'suspended'].includes(input.status))
      platformError('invalid-argument', 'Elige aprobar o suspender el negocio.');
    const { db, uid } = await this.access();
    const { doc, runTransaction, serverTimestamp } = await this.firestore();
    const localRef = doc(db, 'establishments', input.establishmentId);
    const catalogRef = doc(db, 'catalog', input.establishmentId);
    const eventRef = doc(db, 'audit_logs', crypto.randomUUID());
    await runTransaction(db, async (tx) => {
      const [role, local, catalog] = await Promise.all([
        tx.get(doc(db, 'platform_roles', uid)),
        tx.get(localRef),
        tx.get(catalogRef),
      ]);
      if (role.data()?.['role'] !== 'superadmin' || role.data()?.['status'] !== 'active')
        platformError('permission-denied', 'Tu permiso de superadministración ya no está activo.');
      if (!local.exists())
        platformError('not-found', 'El negocio ya no existe. Actualiza la lista.');
      if (local.data()!['status'] === input.status) return;
      const publicationStatus = catalog.exists()
        ? input.status === 'suspended'
          ? 'suspended'
          : 'draft'
        : 'missing';
      const metadata = {
        platformStatusChangeId: eventRef.id,
        platformStatusUpdatedAt: serverTimestamp(),
        platformStatusUpdatedBy: uid,
      };
      tx.update(localRef, { status: input.status, 'bookingPolicy.enabled': false, ...metadata });
      if (catalog.exists())
        tx.update(catalogRef, { status: publicationStatus, 'booking.enabled': false, ...metadata });
      tx.set(eventRef, {
        action: 'establishment_status_changed',
        establishmentId: input.establishmentId,
        actorUid: uid,
        at: serverTimestamp(),
        status: input.status,
        previousStatus: local.data()!['status'],
        publicationStatus,
      });
    });
    return { success: true };
  }

  /** El dueño actualiza el catálogo al guardar horarios, QR, contacto o precios. */
  async observeChanges(
    onChange: () => void,
    onError: (error: unknown) => void,
  ): Promise<() => void> {
    const { db } = await this.access();
    const { collection, query, orderBy, limit, onSnapshot } = await this.firestore();
    let active = true;
    const stops = ['establishments', 'catalog'].map((path) =>
      onSnapshot(
        query(collection(db, path), limit(BUSINESS_LIMIT)),
        () => {
          if (active) onChange();
        },
        (error) => {
          if (active) onError(error);
        },
      ),
    );
    stops.push(
      onSnapshot(
        query(collection(db, 'audit_logs'), orderBy('at', 'desc'), limit(30)),
        () => {
          if (active) onChange();
        },
        (error) => {
          if (active) onError(error);
        },
      ),
    );
    return () => {
      active = false;
      stops.forEach((stop) => stop());
    };
  }
}
