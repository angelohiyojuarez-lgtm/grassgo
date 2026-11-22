import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  millis,
  readSchedule,
  conflictsWithSchedule,
  enrichReservations,
} from './court-schedule.js';

const fail = (code, message) => {
  throw new HttpsError(code, message);
};
const id = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)
    ? value
    : fail('invalid-argument', 'Identificador inválido.');
export function validateDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    fail('invalid-argument', 'Fecha inválida.');
  const instant = new Date(`${date}T00:00:00-05:00`);
  if (
    !Number.isFinite(instant.getTime()) ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant) !== date
  )
    fail('invalid-argument', 'Fecha inválida.');
  return date;
}
const startMillis = (date, hour) => new Date(`${date}T00:00:00-05:00`).getTime() + hour * 3600000;
const reservationView = (snapshot, now) => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    ...data,
    status:
      data.status !== 'confirmed' && data.status !== 'rejected' && data.expiresAt?.toMillis() <= now
        ? 'expired'
        : data.status,
    createdAt: data.createdAt?.toMillis() || null,
    expiresAt: data.expiresAt?.toMillis() || null,
    startsAt: data.startsAt?.toMillis() || null,
    endsAt: millis(data.endsAt),
    actualStartAt: millis(data.actualStartAt),
    actualEndAt: millis(data.actualEndAt),
    rating: data.rating ? { stars: data.rating.stars, ratedAt: millis(data.rating.ratedAt) } : null,
    estimatedEndAt: millis(data.estimatedEndAt),
  };
};
export function makeBookingApi(db, { now = () => Date.now(), allowDemo = false } = {}) {
  function user(uid) {
    if (!uid) fail('unauthenticated', 'Inicia sesión para continuar.');
    return uid;
  }
  async function superadmin(uid, transaction) {
    user(uid);
    const ref = db.doc(`platform_roles/${uid}`);
    const role = await (transaction ? transaction.get(ref) : ref.get());
    if (role.data()?.role !== 'superadmin' || role.data()?.status !== 'active')
      fail('permission-denied', 'Acceso exclusivo de superadministración.');
  }
  async function member(uid, establishmentId, transaction) {
    user(uid);
    const refs = [
      db.doc(`establishments/${establishmentId}`),
      db.doc(`establishments/${establishmentId}/members/${uid}`),
    ];
    const [venue, membership] = await Promise.all(
      refs.map((ref) => (transaction ? transaction.get(ref) : ref.get())),
    );
    if (
      !['approved', 'published'].includes(venue.data()?.status) ||
      membership.data()?.role !== 'admin' ||
      membership.data()?.status !== 'active'
    )
      fail('permission-denied', 'No tienes acceso a este establecimiento.');
    return venue.data();
  }
  function configured(venue, court) {
    if (venue?.bookingEngine === 'direct')
      fail('failed-precondition', 'Este local utiliza el motor de reservas Firestore. Actualiza la aplicación para continuar.');
    const policy = venue?.bookingPolicy;
    if (venue?.status !== 'published' || court?.status !== 'active' || !policy?.enabled)
      fail('failed-precondition', 'La agenda del local todavía no está habilitada.');
    if (
      !Number.isInteger(court.openHour) ||
      !Number.isInteger(court.closeHour) ||
      court.openHour < 0 ||
      court.closeHour > 24 ||
      court.openHour >= court.closeHour
    )
      fail('failed-precondition', 'El local aún debe publicar su horario de atención.');
    if (
      !Number.isInteger(court.dayPriceCents) ||
      !Number.isInteger(court.nightPriceCents) ||
      court.dayPriceCents < 100 ||
      court.nightPriceCents < 100 ||
      court.dayPriceCents > 1000000 ||
      court.nightPriceCents > 1000000 ||
      !Number.isInteger(court.nightStartsAt) ||
      court.nightStartsAt < 0 ||
      court.nightStartsAt > 23
    )
      fail('failed-precondition', 'Las tarifas del local están pendientes de configuración.');
    if (
      !Number.isInteger(policy.advanceCents) ||
      policy.advanceCents < 100 ||
      policy.advanceCents !== 1000 ||
      policy.advanceCents > Math.min(court.dayPriceCents, court.nightPriceCents) ||
      !Number.isInteger(policy.holdMinutes) ||
      policy.holdMinutes < 1 ||
      policy.holdMinutes > 1440
    )
      fail('failed-precondition', 'Las condiciones de la solicitud aún deben publicarse.');
    if (
      !['demo', 'live'].includes(venue.payment?.mode) ||
      (!allowDemo && venue.payment.mode !== 'live') ||
      typeof venue.payment.qr !== 'string' ||
      venue.payment.qr.length > 1500 ||
      !/^(https:\/\/|\/assets\/|business-media\/)/.test(venue.payment.qr)
    )
      fail(
        'failed-precondition',
        'Los datos de pago del propietario todavía no están habilitados.',
      );
    return policy;
  }
  const lockPath = (establishmentId, courtId, date, hour) =>
    `occupancy/${establishmentId}_${courtId}_${date}_${hour}`;
  return {
    async getAvailability(uid, input) {
      user(uid);
      const establishmentId = id(input.establishmentId),
        courtId = id(input.courtId),
        date = validateDate(input.date);
      const [venueDoc, courtDoc] = await Promise.all([
        db.doc(`establishments/${establishmentId}`).get(),
        db.doc(`establishments/${establishmentId}/courts/${courtId}`).get(),
      ]);
      const venue = venueDoc.data(),
        court = courtDoc.data();
      const policy = configured(venue, court);
      const schedule = await readSchedule(db, establishmentId, courtId, date, court, now());
      const openToday =
        !court.openDays || court.openDays.includes(new Date(`${date}T12:00:00-05:00`).getUTCDay());
      if (!openToday)
        return {
          demo: venue.payment.mode === 'demo',
          paymentMode: venue.payment.mode,
          paymentQr: venue.payment.qr,
          paymentMethods: venue.payment.methods || ['Yape', 'Plin'],
          paymentRecipient: venue.payment.recipient || '',
          paymentPhone: venue.payment.phone || '',
          advanceCents: 1000,
          holdMinutes: policy.holdMinutes,
          slots: [],
        };
      const hours = Array.from(
        { length: court.closeHour - court.openHour },
        (_, index) => court.openHour + index,
      );
      const locks = await db.getAll(
        ...hours.map((hour) => db.doc(lockPath(establishmentId, courtId, date, hour))),
      );
      return {
        schedule: schedule.map(({ reservationId, ...publicItem }) => publicItem),
        maintenance: court.maintenance === true,
        awaitingFinish: !!court.runtime && now() > millis(court.runtime.estimatedEndAt),
        activeUntil: millis(court.runtime?.estimatedEndAt),
        demo: venue.payment.mode === 'demo',
        paymentMode: venue.payment.mode,
        paymentQr: venue.payment.qr,
        paymentMethods: venue.payment.methods || ['Yape', 'Plin'],
        paymentRecipient: venue.payment.recipient || '',
        paymentPhone: venue.payment.phone || '',
        advanceCents: 1000,
        holdMinutes: policy.holdMinutes,
        slots: hours.map((hour, index) => ({
          hour,
          priceCents: hour >= court.nightStartsAt ? court.nightPriceCents : court.dayPriceCents,
          available:
            !court.maintenance &&
            !conflictsWithSchedule(
              schedule,
              court.runtime,
              startMillis(date, hour),
              startMillis(date, hour + 1),
              now(),
            ) &&
            startMillis(date, hour) > now() &&
            (!locks[index].exists || locks[index].data().expiresAt.toMillis() <= now()),
        })),
      };
    },
    async createReservation(uid, input) {
      user(uid);
      const establishmentId = id(input.establishmentId),
        courtId = id(input.courtId),
        date = validateDate(input.date),
        requestId = id(input.requestId),
        hour = input.hour;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23)
        fail('invalid-argument', 'Horario inválido.');
      const reservationId = createHash('sha256')
        .update(`${uid}:${requestId}`)
        .digest('hex')
        .slice(0, 40);
      const reservationRef = db.doc(`reservations/${reservationId}`),
        lockRef = db.doc(lockPath(establishmentId, courtId, date, hour));
      const rateRef = db.doc(
        `booking_limits/${createHash('sha256').update(uid).digest('hex')}_${date}`,
      );
      await db.runTransaction(async (transaction) => {
        const [venueDoc, courtDoc, existing, lock, rate] = await transaction.getAll(
          db.doc(`establishments/${establishmentId}`),
          db.doc(`establishments/${establishmentId}/courts/${courtId}`),
          reservationRef,
          lockRef,
          rateRef,
        );
        if (existing.exists) {
          const previous = existing.data();
          if (
            previous.establishmentId !== establishmentId ||
            previous.courtId !== courtId ||
            previous.date !== date ||
            previous.hour !== hour
          )
            fail('invalid-argument', 'Este intento ya corresponde a otra solicitud.');
          return;
        }
        const venue = venueDoc.data(),
          court = courtDoc.data(),
          policy = configured(venue, court);
        const startsAt = startMillis(date, hour);
        const schedule = await readSchedule(
          db,
          establishmentId,
          courtId,
          date,
          court,
          now(),
          transaction,
        );
        if (
          court.maintenance ||
          conflictsWithSchedule(schedule, court.runtime, startsAt, startsAt + 3600000, now())
        )
          fail(
            'already-exists',
            'La cancha está ocupada, tiene un retraso o está en mantenimiento. Consulta la agenda actualizada.',
          );
        if (
          hour < court.openHour ||
          (court.openDays &&
            !court.openDays.includes(new Date(`${date}T12:00:00-05:00`).getUTCDay())) ||
          hour >= court.closeHour ||
          startsAt <= now() ||
          startsAt > now() + 91 * 86400000
        )
          fail('failed-precondition', 'Ese horario no está disponible para reservar.');
        if (lock.exists && lock.data().expiresAt.toMillis() > now())
          fail('already-exists', 'Este horario ya está ocupado.');
        if ((rate.data()?.count || 0) >= 20)
          fail('resource-exhausted', 'Alcanzaste el límite de solicitudes para esa fecha.');
        const expiresAt = Timestamp.fromMillis(
          Math.min(now() + policy.holdMinutes * 60000, startsAt),
        );
        const data = {
          establishmentId,
          establishmentName: venue.name,
          courtId,
          courtName: court.name,
          clientUid: uid,
          date,
          hour,
          totalCents: hour >= court.nightStartsAt ? court.nightPriceCents : court.dayPriceCents,
          advanceCents: policy.advanceCents,
          status: 'pending_payment',
          paymentStatus: 'unpaid',
          startsAt: Timestamp.fromMillis(startsAt),
          endsAt: Timestamp.fromMillis(startsAt + 3600000),
          expiresAt,
          createdAt: FieldValue.serverTimestamp(),
          demo: venue.payment.mode === 'demo',
          paymentSnapshot: {
            mode: venue.payment.mode,
            qr: venue.payment.qr,
            methods: venue.payment.methods || ['Yape', 'Plin'],
            recipient: venue.payment.recipient || '',
            phone: venue.payment.phone || '',
          },
        };
        transaction.create(reservationRef, data);
        transaction.set(lockRef, { reservationId, expiresAt });
        transaction.set(rateRef, { count: (rate.data()?.count || 0) + 1 });
        transaction.create(reservationRef.collection('events').doc(), {
          action: 'requested',
          actorUid: uid,
          at: FieldValue.serverTimestamp(),
        });
      });
      return reservationView(await reservationRef.get(), now());
    },
    async myReservations(uid) {
      user(uid);
      const result = await db
        .collection('reservations')
        .where('clientUid', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
      return enrichReservations(
        db,
        result.docs
          .map((doc) => reservationView(doc, now()))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
        now(),
      );
    },
    async markProof(uid, reservationId, metadata) {
      user(uid);
      id(reservationId);
      const reference = db.doc(`reservations/${reservationId}`);
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const reservation = snapshot.data();
        if (reservation?.clientUid !== uid)
          fail('permission-denied', 'Esta solicitud no pertenece a tu cuenta.');
        if (reservation.status === 'pending_verification') return;
        if (reservation.status !== 'pending_payment' || reservation.expiresAt.toMillis() <= now())
          fail('failed-precondition', 'La solicitud ya no admite comprobantes.');
        const path = `proofs/${uid}/${reservationId}/receipt`;
        transaction.update(reference, {
          status: 'pending_verification',
          paymentStatus: 'submitted',
          proofPath: path,
          proofGeneration: metadata.generation,
          proofSubmittedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(reference.collection('events').doc(), {
          action: 'proof_submitted',
          actorUid: uid,
          at: FieldValue.serverTimestamp(),
        });
      });
      return { success: true };
    },
    async adminOverview(uid, input) {
      const establishmentId = id(input.establishmentId);
      const venue = await member(uid, establishmentId);
      const [requests, courts] = await Promise.all([
        db
          .collection('reservations')
          .where('establishmentId', '==', establishmentId)
          .where(
            'date',
            '==',
            validateDate(
              input.date ||
                new Intl.DateTimeFormat('en-CA', {
                  timeZone: 'America/Lima',
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                }).format(new Date(now())),
            ),
          )
          .get(),
        db.collection(`establishments/${establishmentId}/courts`).get(),
      ]);
      return {
        name: venue.name,
        reservations: await enrichReservations(
          db,
          requests.docs.map((doc) => reservationView(doc, now())).sort((a, b) => a.hour - b.hour),
          now(),
        ),
        courts: courts.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          runtime: doc.data().runtime
            ? {
                reservationId: doc.data().runtime.reservationId,
                date: doc.data().runtime.date,
                actualStartAt: millis(doc.data().runtime.actualStartAt),
                estimatedEndAt: millis(doc.data().runtime.estimatedEndAt),
              }
            : null,
        })),
      };
    },
    async reviewPayment(uid, input) {
      user(uid);
      const reservationId = id(input.reservationId);
      if (!['confirm', 'reject'].includes(input.action))
        fail('invalid-argument', 'Acción inválida.');
      const reference = db.doc(`reservations/${reservationId}`);
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const reservation = snapshot.data();
        if (!reservation) fail('not-found', 'Solicitud no encontrada.');
        await member(uid, reservation.establishmentId, transaction);
        if (reservation.status !== 'pending_verification')
          fail(
            'failed-precondition',
            'Esta solicitud no tiene un comprobante pendiente de revisión.',
          );
        const lockRef = db.doc(
          lockPath(
            reservation.establishmentId,
            reservation.courtId,
            reservation.date,
            reservation.hour,
          ),
        );
        const lock = await transaction.get(lockRef);
        if (
          reservation.expiresAt.toMillis() <= now() ||
          lock.data()?.reservationId !== reservationId
        )
          fail('failed-precondition', 'La retención de este horario ya venció.');
        if (
          input.action === 'confirm' &&
          (input.paymentVerified !== true || input.amountCents !== reservation.advanceCents)
        )
          fail('invalid-argument', 'Debes verificar el ingreso real del adelanto completo.');
        const audit = db.collection('audit_logs').doc();
        if (input.action === 'confirm') {
          transaction.update(reference, {
            status: 'confirmed',
            paymentStatus: 'verified',
            verifiedAdvanceCents: reservation.advanceCents,
            verifiedBy: uid,
            verifiedAt: FieldValue.serverTimestamp(),
          });
          transaction.update(lockRef, { expiresAt: reservation.endsAt });
          transaction.create(db.doc(`payments/${reservationId}`), {
            reservationId,
            establishmentId: reservation.establishmentId,
            amountCents: reservation.advanceCents,
            kind: 'advance',
            status: 'verified',
            verifiedBy: uid,
            at: FieldValue.serverTimestamp(),
          });
        } else {
          transaction.update(reference, { status: 'rejected', paymentStatus: 'unpaid' });
          transaction.delete(lockRef);
        }
        transaction.create(reference.collection('events').doc(), {
          action: input.action === 'confirm' ? 'payment_verified' : 'rejected',
          actorUid: uid,
          at: FieldValue.serverTimestamp(),
        });
        transaction.create(audit, {
          action: input.action === 'confirm' ? 'payment_verified' : 'reservation_rejected',
          reservationId,
          establishmentId: reservation.establishmentId,
          actorUid: uid,
          at: FieldValue.serverTimestamp(),
        });
      });
      return { success: true };
    },
    async platformOverview(uid) {
      await superadmin(uid);
      const result = await db.collection('establishments').limit(100).get();
      return {
        establishments: result.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name,
          status: doc.data().status,
          location: doc.data().location || '',
          description: doc.data().description || '',
          bookingEnabled: doc.data().bookingPolicy?.enabled === true,
        })),
      };
    },
    async platformActivity(uid) {
      await superadmin(uid);
      const result = await db.collection('audit_logs').orderBy('at', 'desc').limit(30).get();
      return {
        events: result.docs.map((snapshot) => {
          const data = snapshot.data();
          return {
            id: snapshot.id,
            action: data.action,
            establishmentId: data.establishmentId || '',
            actorUid: data.actorUid,
            at: data.at?.toMillis() || null,
            status: data.status || null,
          };
        }),
      };
    },
    async createEstablishment(uid, input) {
      user(uid);
      const allowed = ['requestId', 'name', 'location', 'description'];
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => !allowed.includes(key))
      )
        fail('invalid-argument', 'Envía solamente los datos del formulario.');
      const requestId = id(input.requestId);
      const text = (value, label, min, max, multiline = false) => {
        if (typeof value !== 'string')
          fail('invalid-argument', `${label}: escribe un texto válido.`);
        const result = value.trim();
        if (
          result.length < min ||
          result.length > max ||
          (multiline
            ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
            : /[\u0000-\u001f\u007f]/
          ).test(result)
        )
          fail('invalid-argument', `${label}: usa entre ${min} y ${max} caracteres.`);
        return result;
      };
      const data = {
        name: text(input.name, 'Nombre', 2, 100),
        location: text(input.location, 'Ubicación', 2, 200),
        description: text(input.description ?? '', 'Descripción', 0, 1000, true),
      };
      // El identificador estable permite reintentar sin duplicar negocios.
      const establishmentId = createHash('sha256')
        .update(`establishment:${uid}:${requestId}`)
        .digest('hex')
        .slice(0, 40);
      const reference = db.doc(`establishments/${establishmentId}`);
      await db.runTransaction(async (transaction) => {
        await superadmin(uid, transaction);
        const existing = await transaction.get(reference);
        if (existing.exists) {
          if (
            existing.data().createdBy !== uid ||
            Object.entries(data).some(([key, value]) => existing.data()[key] !== value)
          )
            fail('invalid-argument', 'Este intento ya corresponde a otro negocio.');
          return;
        }
        transaction.create(reference, {
          ...data,
          status: 'draft',
          bookingPolicy: { enabled: false },
          createdBy: uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(db.collection('audit_logs').doc(), {
          action: 'establishment_created',
          establishmentId,
          actorUid: uid,
          at: FieldValue.serverTimestamp(),
        });
      });
      return { id: establishmentId, ...data, status: (await reference.get()).data().status };
    },
    async setEstablishmentStatus(uid, input) {
      const establishmentId = id(input.establishmentId);
      if (!['approved', 'suspended'].includes(input.status))
        fail('invalid-argument', 'Estado inválido.');
      await db.runTransaction(async (transaction) => {
        await superadmin(uid, transaction);
        const reference = db.doc(`establishments/${establishmentId}`),
          snapshot = await transaction.get(reference);
        if (!snapshot.exists) fail('not-found', 'Establecimiento no encontrado.');
        transaction.update(reference, { status: input.status });
        transaction.create(db.collection('audit_logs').doc(), {
          action: 'establishment_status_changed',
          establishmentId,
          status: input.status,
          actorUid: uid,
          at: FieldValue.serverTimestamp(),
        });
      });
      return { success: true };
    },
  };
}
