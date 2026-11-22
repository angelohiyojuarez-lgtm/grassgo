import { Injectable, inject } from '@angular/core';
import type { DocumentData } from 'firebase/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { Availability, Reservation } from '../models/booking';
import { environment } from '../../environments/environment';
import { prepareReceipt } from './receipt-image';
import {
  DirectCourtOperation,
  DirectScheduleItem,
  DirectScheduleSlot,
  DIRECT_GAME_MS,
  directDayStart,
  operationAffectsDate,
  operationEndedAt,
  overlapsDirectSchedule,
  projectDirectSchedule,
} from './direct-court-schedule';

const HOLD_MS = 15 * 60 * 1000;
const pending = (status: string): boolean =>
  ['pending_payment', 'pending_verification'].includes(status);
const millis = (value: { toMillis(): number } | undefined): number => value?.toMillis() || 0;
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code: 'functions/' + code });
};
const identifier = (value: string): string => {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(value))
    fail('invalid-argument', 'Identificador de reserva inválido.');
  return value;
};
export function directStart(date: string, hour: number): number {
  const start = Date.parse(date + 'T' + String(hour).padStart(2, '0') + ':00:00-05:00');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isFinite(start) ||
    new Date(start - 5 * 3600000).toISOString().slice(0, 10) !== date
  )
    fail('invalid-argument', 'Elige una fecha y una hora válidas.');
  return start;
}
export function directReservation(id: string, data: DocumentData, now = Date.now()): Reservation {
  const startsAt = millis(data['startsAt']);
  const expiresAt = Math.min(millis(data['createdAt']) + HOLD_MS, startsAt);
  const actualStartAt = millis(data['actualStartAt']);
  const endedAutomatically =
    data['serviceStatus'] === 'running' &&
    actualStartAt > 0 &&
    now >= actualStartAt + DIRECT_GAME_MS;
  return {
    id,
    engine: 'direct',
    establishmentId: data['establishmentId'],
    establishmentName: data['establishmentName'],
    courtId: data['courtId'],
    courtName: data['courtName'],
    clientUid: data['clientUid'],
    date: data['date'],
    hour: data['hour'],
    totalCents: data['totalCents'],
    advanceCents: data['advanceCents'],
    status: pending(data['status']) && expiresAt <= now ? 'expired' : data['status'],
    paymentStatus: data['paymentStatus'],
    demo: data['paymentSnapshot']?.mode === 'demo',
    paymentSnapshot: data['paymentSnapshot'],
    startsAt,
    endsAt: millis(data['endsAt']),
    expiresAt,
    ...(data['serviceStatus']
      ? { serviceStatus: endedAutomatically ? 'completed' : data['serviceStatus'] }
      : {}),
    ...(data['actualStartAt'] ? { actualStartAt } : {}),
    ...(endedAutomatically
      ? { actualEndAt: actualStartAt + DIRECT_GAME_MS }
      : data['actualEndAt']
        ? { actualEndAt: millis(data['actualEndAt']) }
        : {}),
    ...(data['proofSubmittedAt'] ? { proofPath: 'direct-proofs/' + id } : {}),
  };
}
function operationView(data: DocumentData | undefined): DirectCourtOperation | null {
  return data
    ? {
        activeReservationId: data['activeReservationId'] || null,
        activeDate: data['activeDate'] || null,
        actualStartAt: millis(data['actualStartAt']) || null,
        lastEndedAt: millis(data['lastEndedAt']) || null,
      }
    : null;
}
function scheduleSlots(items: { id: string; data(): DocumentData }[]): DirectScheduleSlot[] {
  return items.map((item) => {
    const data = item.data();
    return {
      hour: Number(item.id),
      reservationId: data['reservationId'],
      status: data['status'],
      serviceStatus: data['serviceStatus'],
      actualStartAt: millis(data['actualStartAt']) || null,
      actualEndAt: millis(data['actualEndAt']) || null,
    };
  });
}
function enabled(venue: DocumentData, court: DocumentData | undefined): void {
  if (
    venue['status'] !== 'published' ||
    venue['booking']?.engine !== 'direct' ||
    !venue['booking']?.enabled
  )
    fail(
      'failed-precondition',
      'Las reservas de este local estarán disponibles cuando publique sus horarios y datos de pago.',
    );
  if (
    !court ||
    court['status'] !== 'active' ||
    !Number.isInteger(court['openHour']) ||
    !Number.isInteger(court['closeHour']) ||
    court['openHour'] < 0 ||
    court['closeHour'] > 24 ||
    court['openHour'] >= court['closeHour']
  )
    fail('failed-precondition', 'El local todavía debe configurar el horario de esta cancha.');
  const payment = venue['booking'].payment;
  if (
    venue['booking'].holdMinutes !== 15 ||
    !Number.isInteger(venue['advanceCents']) ||
    venue['advanceCents'] <= 0 ||
    venue['advanceCents'] > 1000000 ||
    !payment ||
    (!environment.useEmulators && payment.mode !== 'live') ||
    !Array.isArray(payment.methods) ||
    !payment.methods.length ||
    !payment.recipient ||
    !payment.phone
  )
    fail('failed-precondition', 'Los datos para enviar el adelanto todavía no están publicados.');
}

function scheduledCourt(
  venue: DocumentData,
  court: DocumentData | undefined,
): DocumentData | undefined {
  return court && venue['scheduleRevision'] > 0
    ? {
        ...court,
        openHour: venue['openHour'],
        closeHour: venue['closeHour'],
        openDays: venue['days'],
      }
    : court;
}
function openOn(venue: DocumentData, court: DocumentData, date: string): boolean {
  const days = court['openDays'];
  const day = new Date(date + 'T12:00:00-05:00').getUTCDay();
  // En el motor anterior [] significaba todos; un horario publicado vacío significa cerrado.
  if (venue['scheduleRevision'] > 0) return Array.isArray(days) && days.includes(day);
  return !days?.length || days.includes(day);
}

/** Recorrido Spark: transacciones del SDK, autorizadas y validadas por Firestore Rules. */
@Injectable({ providedIn: 'root' })
export class DirectBookingService {
  private readonly firebase = inject(FirebaseService);
  private uid(): string {
    return (
      this.firebase.auth.currentUser?.uid ||
      fail('unauthenticated', 'Inicia sesión para continuar.')
    );
  }
  private slotPath(venue: string, court: string, date: string, hour: number): string {
    return 'direct_slots/' + venue + '/courts/' + court + '/days/' + date + '/hours/' + hour;
  }
  private operationPath(venue: string, court: string, privateData = false): string {
    return `${privateData ? 'establishments' : 'catalog'}/${venue}/courts/${court}/operations/current`;
  }
  private async courtSchedule(
    venue: string,
    court: string,
    date: string,
  ): Promise<{
    operation: DirectCourtOperation | null;
    schedule: DirectScheduleItem[];
  }> {
    const { doc, collection, getDocFromServer, getDocsFromServer } =
      await import('firebase/firestore');
    const db = await this.firebase.getDb();
    const [state, slots] = await Promise.all([
      getDocFromServer(doc(db, this.operationPath(venue, court))),
      getDocsFromServer(collection(db, this.slotPath(venue, court, date, 0).replace(/\/0$/, ''))),
    ]);
    const operation = operationView(state.data());
    return {
      operation,
      schedule: projectDirectSchedule(date, scheduleSlots(slots.docs), operation, Date.now()),
    };
  }
  private async enrichReservations(items: Reservation[]): Promise<Reservation[]> {
    const schedules = new Map<string, Promise<DirectScheduleItem[]>>();
    return Promise.all(
      items.map(async (item) => {
        if (item.status !== 'confirmed' || item.serviceStatus === 'completed') return item;
        const key = `${item.establishmentId}/${item.courtId}/${item.date}`;
        if (!schedules.has(key))
          schedules.set(
            key,
            this.courtSchedule(item.establishmentId, item.courtId, item.date).then(
              (data) => data.schedule,
            ),
          );
        try {
          const forecast = (await schedules.get(key)!).find(
            (entry) => entry.reservationId === item.id,
          );
          return forecast
            ? {
                ...item,
                estimatedStartAt: forecast.estimatedStartAt,
                estimatedEndAt: forecast.estimatedEndAt,
                awaitingFinish: forecast.awaitingFinish,
              }
            : item;
        } catch {
          // La reserva privada sigue siendo consultable aunque el local deje de estar publicado.
          return item;
        }
      }),
    );
  }
  async availability(venueId: string, courtId: string, date: string): Promise<Availability> {
    this.uid();
    identifier(venueId);
    identifier(courtId);
    directStart(date, 0);
    const { doc, getDocFromServer, collection, getDocsFromServer } =
      await import('firebase/firestore');
    const db = await this.firebase.getDb();
    const parent = await getDocFromServer(doc(db, 'catalog', venueId));
    if (!parent.exists())
      fail('failed-precondition', 'Este local no está disponible para reservas.');
    const venue = parent.data()!;
    if (!venue['booking']?.enabled || venue['booking']?.engine !== 'direct')
      enabled(venue, undefined);
    const [courtSnapshot, closure, state] = await Promise.all([
      getDocFromServer(doc(db, 'catalog', venueId, 'courts', courtId)),
      getDocFromServer(doc(db, 'catalog', venueId, 'closures', date)),
      getDocFromServer(doc(db, this.operationPath(venueId, courtId))),
    ]);
    const config = scheduledCourt(venue, courtSnapshot.data());
    enabled(venue, config);
    const open = openOn(venue, config!, date);
    const closedDate = closure.data()?.['closed'] === true;
    const locks = await getDocsFromServer(
      collection(db, this.slotPath(venueId, courtId, date, 0).replace(/\/0$/, '')),
    );
    const byHour = new Map(locks.docs.map((item) => [Number(item.id), item.data()]));
    const now = Date.now();
    const maintenance = config!['maintenance'] === true;
    const operation = operationView(state.data());
    const running = !!config!['runtime'] || operationAffectsDate(operation, date, now);
    const schedule = projectDirectSchedule(date, scheduleSlots(locks.docs), operation, now);
    const payment = venue['booking'].payment;
    return {
      slots:
        open && !closedDate
          ? Array.from({ length: config!['closeHour'] - config!['openHour'] }, (_, index) => {
              const hour = config!['openHour'] + index;
              const lock = byHour.get(hour);
              const occupied =
                lock &&
                (lock['status'] === 'confirmed' ||
                  (lock['status'] === 'held' && millis(lock['lockedAt']) + HOLD_MS > now));
              return {
                hour,
                available:
                  !maintenance &&
                  !running &&
                  !occupied &&
                  directStart(date, hour) > now &&
                  directStart(date, hour) >= operationEndedAt(operation, now) &&
                  !overlapsDirectSchedule(schedule, directStart(date, hour)),
                priceCents:
                  hour >= config!['nightStartsAt']
                    ? config!['nightPriceCents']
                    : config!['dayPriceCents'],
              };
            })
          : [],
      demo: payment.mode === 'demo',
      paymentMode: payment.mode,
      paymentQr: payment.qr || '',
      paymentMethods: payment.methods,
      paymentRecipient: payment.recipient,
      paymentPhone: payment.phone,
      advanceCents: venue['advanceCents'],
      holdMinutes: 15,
      maintenance,
      awaitingFinish: false,
      activeUntil:
        running && operation?.activeReservationId && operation.actualStartAt
          ? operation.actualStartAt + 3600000
          : null,
      schedule: schedule.map(({ reservationId: _privateId, ...item }) => item),
      closedDate,
      weeklyClosed: !open,
    };
  }
  async create(
    venueId: string,
    courtId: string,
    date: string,
    hour: number,
    requestId: string,
  ): Promise<Reservation> {
    const uid = this.uid();
    identifier(venueId);
    identifier(courtId);
    identifier(requestId);
    const start = directStart(date, hour);
    const { doc, runTransaction, serverTimestamp, Timestamp, getDocFromServer } =
      await import('firebase/firestore');
    const db = await this.firebase.getDb();
    const request = doc(db, 'direct_requests', requestId);
    await runTransaction(db, async (tx) => {
      const previous = await tx.get(request);
      if (previous.exists()) {
        const old = previous.data();
        if (
          old['clientUid'] !== uid ||
          old['establishmentId'] !== venueId ||
          old['courtId'] !== courtId ||
          old['date'] !== date ||
          old['hour'] !== hour
        )
          fail(
            'invalid-argument',
            'Este intento ya pertenece a otra solicitud. Vuelve a elegir el horario.',
          );
        return;
      }
      const venue = (await tx.get(doc(db, 'catalog', venueId))).data();
      if (!venue) fail('failed-precondition', 'Este local todavía no está publicado.');
      if (!venue!['booking']?.enabled || venue!['booking']?.engine !== 'direct')
        enabled(venue!, undefined);
      const court = scheduledCourt(
        venue!,
        (await tx.get(doc(db, 'catalog', venueId, 'courts', courtId))).data(),
      );
      const closure = (await tx.get(doc(db, 'catalog', venueId, 'closures', date))).data();
      const operation = operationView(
        (await tx.get(doc(db, this.operationPath(venueId, courtId)))).data(),
      );
      enabled(venue!, court);
      if (closure?.['closed'] === true)
        fail('failed-precondition', 'El local estará cerrado en esta fecha. Elige otro día.');
      if (
        start <= Date.now() ||
        start > Date.now() + 91 * 86400000 ||
        hour < court!['openHour'] ||
        hour >= court!['closeHour'] ||
        !openOn(venue!, court!, date) ||
        court!['maintenance'] ||
        court!['runtime'] ||
        operationAffectsDate(operation, date, Date.now()) ||
        start < operationEndedAt(operation, Date.now())
      )
        fail('failed-precondition', 'Ese horario no está disponible. Actualiza la agenda.');
      const slot = doc(db, this.slotPath(venueId, courtId, date, hour));
      const lock = (await tx.get(slot)).data();
      if (
        lock &&
        (lock['status'] === 'confirmed' ||
          (lock['status'] === 'held' && millis(lock['lockedAt']) + HOLD_MS > Date.now()))
      )
        fail('already-exists', 'Ese horario acaba de ocuparse. Elige otro.');
      // Conserva el límite técnico del motor anterior: 20 solicitudes por cuenta y fecha.
      const counter = doc(db, 'direct_limits', uid, 'days', date);
      const count = (await tx.get(counter)).data()?.['count'] || 0;
      if (count >= 20)
        fail('resource-exhausted', 'Alcanzaste el límite de solicitudes para esta fecha.');
      tx.set(request, {
        clientUid: uid,
        establishmentId: venueId,
        establishmentName: venue!['name'],
        courtId,
        courtName: court!['name'],
        date,
        hour,
        startsAt: Timestamp.fromMillis(start),
        endsAt: Timestamp.fromMillis(start + 3600000),
        totalCents:
          hour >= court!['nightStartsAt'] ? court!['nightPriceCents'] : court!['dayPriceCents'],
        advanceCents: venue!['advanceCents'],
        createdAt: serverTimestamp(),
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        paymentSnapshot: venue!['booking'].payment,
      });
      tx.set(slot, {
        reservationId: requestId,
        lockedAt: serverTimestamp(),
        status: 'held',
        reviewPending: false,
      });
      tx.set(counter, { count: count + 1, lastRequestId: requestId, updatedAt: serverTimestamp() });
    });
    return directReservation(requestId, (await getDocFromServer(request)).data()!);
  }
  async mine(): Promise<Reservation[]> {
    const uid = this.uid();
    const { collection, query, where, orderBy, limit, getDocsFromServer } =
      await import('firebase/firestore');
    const db = await this.firebase.getDb();
    const result = await getDocsFromServer(
      query(
        collection(db, 'direct_requests'),
        where('clientUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(100),
      ),
    );
    return this.enrichReservations(
      result.docs.map((item) => directReservation(item.id, item.data())),
    );
  }
  async submitProof(reservation: Reservation, file: File): Promise<void> {
    const uid = this.uid();
    identifier(reservation.id);
    if (reservation.clientUid !== uid)
      fail('permission-denied', 'Esta solicitud no pertenece a tu cuenta.');
    const image = await prepareReceipt(file);
    const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    await runTransaction(db, async (tx) => {
      const reference = doc(db, 'direct_requests', reservation.id);
      const request = (await tx.get(reference)).data();
      if (!request || request['clientUid'] !== uid)
        fail('permission-denied', 'No tienes acceso a esta solicitud.');
      const proofRef = doc(db, 'direct_proofs', reservation.id);
      const existing = (await tx.get(proofRef)).data();
      if (existing) {
        if (existing['sha256'] === image.sha256 && request!['status'] !== 'pending_payment') return;
        fail(
          'failed-precondition',
          'Ya enviaste un comprobante para esta solicitud. Consulta su estado en Mis reservas.',
        );
      }
      const view = directReservation(reservation.id, request!);
      if (view.status !== 'pending_payment')
        fail(
          'failed-precondition',
          'La solicitud venció o ya no admite comprobantes. Consulta Mis reservas.',
        );
      const slotRef = doc(
        db,
        this.slotPath(
          request!['establishmentId'],
          request!['courtId'],
          request!['date'],
          request!['hour'],
        ),
      );
      const slot = (await tx.get(slotRef)).data();
      if (slot?.['reservationId'] !== reservation.id || slot['status'] !== 'held')
        fail(
          'failed-precondition',
          'Este horario ya no pertenece a tu solicitud. Actualiza Mis reservas.',
        );
      tx.set(proofRef, {
        reservationId: reservation.id,
        clientUid: uid,
        establishmentId: request!['establishmentId'],
        contentType: 'image/jpeg',
        imageData: image.dataUrl,
        sha256: image.sha256,
        createdAt: serverTimestamp(),
      });
      tx.update(reference, {
        status: 'pending_verification',
        paymentStatus: 'submitted',
        proofSubmittedAt: serverTimestamp(),
      });
      tx.update(slotRef, { reviewPending: true });
    });
  }
  async readProof(path: string): Promise<Blob> {
    this.uid();
    const id = identifier(path.replace(/^direct-proofs\//, ''));
    const { doc, getDocFromServer } = await import('firebase/firestore');
    const proof = (
      await getDocFromServer(doc(await this.firebase.getDb(), 'direct_proofs', id))
    ).data();
    if (!proof || !/^data:image\/jpeg;base64,\/9j\//.test(proof['imageData']))
      fail('not-found', 'No encontramos el comprobante.');
    const bytes = Uint8Array.from(atob(proof!['imageData'].split(',')[1]), (char) =>
      char.charCodeAt(0),
    );
    return new Blob([bytes], { type: 'image/jpeg' });
  }
  // Puente mínimo para revisar el recorrido cliente; el panel operativo se amplía en su etapa.
  private async settleExpiredCourt(establishmentId: string, courtId: string): Promise<void> {
    const { doc, getDocFromServer } = await import('firebase/firestore');
    const state = (
      await getDocFromServer(
        doc(await this.firebase.getDb(), this.operationPath(establishmentId, courtId, true)),
      )
    ).data();
    if (
      state?.['activeReservationId'] &&
      state['actualStartAt'] &&
      Date.now() >= millis(state['actualStartAt']) + DIRECT_GAME_MS
    )
      await this.recordSession({ reservationId: state['activeReservationId'], action: 'finish' });
  }
  async adminOverview(establishmentId: string, date: string): Promise<unknown> {
    this.uid();
    identifier(establishmentId);
    directStart(date, 0);
    const { collection, doc, query, where, limit, getDocsFromServer, getDocFromServer } =
      await import('firebase/firestore');
    const db = await this.firebase.getDb();
    const venue = (await getDocFromServer(doc(db, 'establishments', establishmentId))).data();
    const [requests, courts] = await Promise.all([
      getDocsFromServer(
        query(
          collection(db, 'direct_requests'),
          where('establishmentId', '==', establishmentId),
          where('date', '==', date),
          limit(500),
        ),
      ),
      getDocsFromServer(collection(db, 'establishments', establishmentId, 'courts')),
    ]);
    const projections = await Promise.all(
      courts.docs.map(async (court) => {
        await this.settleExpiredCourt(establishmentId, court.id);
        return { id: court.id, ...(await this.courtSchedule(establishmentId, court.id, date)) };
      }),
    );
    const reservations = requests.docs
      .map((item) => directReservation(item.id, item.data()))
      .sort((a, b) => a.hour - b.hour)
      .map((reservation) => {
        const projection = projections
          .find((item) => item.id === reservation.courtId)
          ?.schedule.find((item) => item.reservationId === reservation.id);
        return projection
          ? {
              ...reservation,
              estimatedStartAt: projection.estimatedStartAt,
              estimatedEndAt: projection.estimatedEndAt,
              awaitingFinish: projection.awaitingFinish,
            }
          : reservation;
      });
    return {
      engine: 'direct',
      name: venue?.['name'],
      reservations,
      courts: courts.docs.map((item) => {
        const operation = projections.find((projection) => projection.id === item.id)?.operation;
        return {
          ...item.data(),
          id: item.id,
          ...(operation?.activeReservationId &&
          operation.actualStartAt &&
          Date.now() < operation.actualStartAt + DIRECT_GAME_MS
            ? {
                runtime: {
                  reservationId: operation.activeReservationId,
                  date: operation.activeDate,
                  actualStartAt: operation.actualStartAt,
                  estimatedEndAt: operation.actualStartAt + 3600000,
                },
              }
            : { runtime: null }),
        };
      }),
    };
  }
  /** Inicio y finalización reales. Las reglas validan reloj, miembro y las cinco escrituras. */
  async recordSession(input: {
    reservationId: string;
    action: 'start' | 'finish';
  }): Promise<{ success: true }> {
    const uid = this.uid();
    identifier(input.reservationId);
    if (
      !['start', 'finish'].includes(input.action) ||
      Object.keys(input).some((key) => !['reservationId', 'action'].includes(key))
    )
      fail('invalid-argument', 'Acción de partido inválida.');
    const { doc, runTransaction, serverTimestamp, Timestamp, getDocFromServer } =
      await import('firebase/firestore');
    const db = await this.firebase.getDb();
    // Primero persiste una expiración previa en su propia transacción. Reintentos
    // acotados permiten que dos administradores coincidan sin reemplazar historia.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (input.action === 'start') {
        const source = (
          await getDocFromServer(doc(db, 'direct_requests', input.reservationId))
        ).data();
        if (!source) fail('not-found', 'No encontramos la reserva.');
        await this.settleExpiredCourt(
          identifier(source!['establishmentId']),
          identifier(source!['courtId']),
        );
      }
      try {
        await runTransaction(db, async (tx) => {
          const requestRef = doc(db, 'direct_requests', input.reservationId);
          const request = (await tx.get(requestRef)).data();
          if (!request) fail('not-found', 'No encontramos la reserva.');
          const establishmentId = identifier(request!['establishmentId']);
          const courtId = identifier(request!['courtId']);
          // Leer el local privado exige su membresía canónica aun al reintentar.
          const venue = (await tx.get(doc(db, 'establishments', establishmentId))).data();
          const court = (
            await tx.get(doc(db, 'establishments', establishmentId, 'courts', courtId))
          ).data();
          if (!venue || venue['bookingEngine'] !== 'direct' || !court)
            fail(
              'failed-precondition',
              'Este local todavía no tiene habilitado el control de partidos.',
            );
          if (request!['status'] !== 'confirmed' || request!['paymentStatus'] !== 'verified')
            fail('failed-precondition', 'Primero verifica el adelanto y confirma la reserva.');
          if (input.action === 'start' && request!['actualStartAt']) return;
          if (input.action === 'finish' && request!['serviceStatus'] === 'completed') return;
          const stateRef = doc(db, this.operationPath(establishmentId, courtId, true));
          const previous = (await tx.get(stateRef)).data() || null;
          const slotRef = doc(
            db,
            this.slotPath(establishmentId, courtId, request!['date'], request!['hour']),
          );
          const slot = (await tx.get(slotRef)).data();
          if (slot?.['reservationId'] !== input.reservationId || slot['status'] !== 'confirmed')
            fail(
              'failed-precondition',
              'La reserva no tiene su horario confirmado. Actualiza la agenda.',
            );
          const now = Date.now();
          if (input.action === 'start') {
            if (previous?.['activeReservationId']) {
              if (now >= millis(previous['actualStartAt']) + DIRECT_GAME_MS)
                fail('session-expired', 'Actualizando la finalización automática.');
              fail(
                'failed-precondition',
                'Ya hay un partido en curso. Su turno termina automáticamente al cumplirse una hora.',
              );
            }
            const dayStart = directDayStart(request!['date']);
            if (
              court!['status'] !== 'active' ||
              request!['serviceStatus'] ||
              now < millis(request!['startsAt']) ||
              now < dayStart ||
              now >= dayStart + 86400000
            )
              fail(
                'failed-precondition',
                'Solo puedes empezar una reserva de hoy cuando llegue su hora.',
              );
          } else if (
            request!['serviceStatus'] !== 'running' ||
            previous?.['activeReservationId'] !== input.reservationId
          ) {
            fail('failed-precondition', 'Esta reserva todavía no está en juego.');
          }
          if (input.action === 'finish' && now < millis(request!['actualStartAt']) + DIRECT_GAME_MS)
            fail(
              'failed-precondition',
              'El turno termina automáticamente una hora después de su inicio real.',
            );
          const deadline =
            input.action === 'finish'
              ? new Timestamp(
                  request!['actualStartAt'].seconds + 3600,
                  request!['actualStartAt'].nanoseconds,
                )
              : null;
          const at = serverTimestamp(),
            revision = (previous?.['revision'] || 0) + 1;
          const after = {
            establishmentId,
            courtId,
            activeReservationId: input.action === 'start' ? input.reservationId : null,
            activeDate: input.action === 'start' ? request!['date'] : null,
            actualStartAt: input.action === 'start' ? at : null,
            lastEndedAt: input.action === 'finish' ? deadline : previous?.['lastEndedAt'] || null,
            revision,
            updatedAt: at,
            updatedBy: uid,
          };
          const publicState = {
            establishmentId,
            courtId,
            activeReservationId: after.activeReservationId,
            activeDate: after.activeDate,
            actualStartAt: after.actualStartAt,
            lastEndedAt: after.lastEndedAt,
            revision,
            updatedAt: at,
          };
          const transition =
            input.action === 'start'
              ? { serviceStatus: 'running', actualStartAt: at }
              : {
                  serviceStatus: 'completed',
                  actualStartAt: request!['actualStartAt'],
                  actualEndAt: deadline,
                };
          tx.update(requestRef, transition);
          tx.update(slotRef, transition);
          tx.set(stateRef, after);
          tx.set(doc(db, this.operationPath(establishmentId, courtId)), publicState);
          tx.set(
            doc(
              db,
              this.operationPath(establishmentId, courtId, true),
              'history',
              String(revision),
            ),
            {
              establishmentId,
              courtId,
              kind: 'session',
              revision,
              actorUid: uid,
              at,
              action: input.action,
              reservationId: input.reservationId,
              before: previous,
              after,
            },
          );
        });
        return { success: true };
      } catch (error) {
        if ((error as { code?: string }).code !== 'functions/session-expired' || attempt === 2)
          throw error;
      }
    }
    return fail('aborted', 'La agenda cambió. Vuelve a consultarla para empezar el partido.');
  }
  async adminPendingProofs(establishmentId: string): Promise<{
    engine: 'direct';
    name: string;
    reservations: Reservation[];
    courts: (DocumentData & { id: string })[];
    pendingLimitReached: boolean;
  }> {
    this.uid();
    identifier(establishmentId);
    const {
      collection,
      doc,
      query,
      where,
      orderBy,
      limit,
      Timestamp,
      getDocsFromServer,
      getDocFromServer,
    } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    // Esta lectura privada exige la membresía canónica antes de consultar la bandeja.
    const venue = (await getDocFromServer(doc(db, 'establishments', establishmentId))).data();
    if (!venue) fail('not-found', 'No encontramos el establecimiento asignado.');
    const now = Date.now();
    const [requests, courts] = await Promise.all([
      getDocsFromServer(
        query(
          collection(db, 'direct_requests'),
          where('establishmentId', '==', establishmentId),
          where('status', '==', 'pending_verification'),
          where('createdAt', '>', Timestamp.fromMillis(now - HOLD_MS)),
          orderBy('createdAt', 'asc'),
          limit(100),
        ),
      ),
      getDocsFromServer(collection(db, 'establishments', establishmentId, 'courts')),
    ]);
    return {
      engine: 'direct',
      name: venue!['name'],
      reservations: requests.docs
        .map((item) => directReservation(item.id, item.data(), now))
        .filter((item) => item.status === 'pending_verification')
        .sort((a, b) => (a.expiresAt || 0) - (b.expiresAt || 0)),
      courts: courts.docs.map((item) => ({ ...item.data(), id: item.id })),
      pendingLimitReached: requests.docs.length === 100,
    };
  }
  async reviewPayment(input: {
    reservationId: string;
    action: 'confirm' | 'reject';
    paymentVerified?: boolean;
    amountCents?: number;
  }): Promise<{ success: true }> {
    const uid = this.uid();
    identifier(input.reservationId);
    if (!['confirm', 'reject'].includes(input.action)) fail('invalid-argument', 'Acción inválida.');
    const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    await runTransaction(db, async (tx) => {
      const reference = doc(db, 'direct_requests', input.reservationId);
      const data = (await tx.get(reference)).data();
      if (!data || directReservation(input.reservationId, data).status !== 'pending_verification')
        fail('failed-precondition', 'Esta solicitud no tiene un comprobante vigente para revisar.');
      if (
        input.action === 'confirm' &&
        (input.paymentVerified !== true || input.amountCents !== data!['advanceCents'])
      )
        fail('invalid-argument', 'Debes verificar que recibiste el adelanto completo.');
      const slot = doc(
        db,
        this.slotPath(data!['establishmentId'], data!['courtId'], data!['date'], data!['hour']),
      );
      const lock = (await tx.get(slot)).data();
      if (lock?.['reservationId'] !== input.reservationId || lock['status'] !== 'held')
        fail('failed-precondition', 'El horario ya no pertenece a esta solicitud.');
      tx.update(reference, {
        status: input.action === 'confirm' ? 'confirmed' : 'rejected',
        paymentStatus: input.action === 'confirm' ? 'verified' : 'unpaid',
        reviewedAt: serverTimestamp(),
        reviewedBy: uid,
        ...(input.action === 'confirm' ? { verifiedAdvanceCents: data!['advanceCents'] } : {}),
      });
      tx.update(slot, {
        status: input.action === 'confirm' ? 'confirmed' : 'released',
        reviewPending: false,
      });
      if (input.action === 'confirm') {
        tx.set(
          doc(db, 'establishments', data!['establishmentId'], 'court_income', input.reservationId),
          {
            reservationId: input.reservationId,
            courtId: data!['courtId'],
            courtName: data!['courtName'],
            date: data!['date'],
            hour: data!['hour'],
            totalCents: data!['totalCents'],
            advanceCents: data!['advanceCents'],
            advanceAt: serverTimestamp(),
            advanceBy: uid,
            balanceCents: 0,
            balanceAt: null,
            balanceBy: null,
            balanceMethod: null,
          },
        );
      }
    });
    return { success: true };
  }
}
