import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { limaDate, millis, readSchedule } from './court-schedule.js';

const fail = (code, message) => {
  throw new HttpsError(code, message);
};
const id = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)
    ? value
    : fail('invalid-argument', 'Identificador inválido.');
const strict = (value, keys) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail('invalid-argument', 'Campos de configuración inválidos.');
};
const text = (value, max) =>
  typeof value === 'string' && value.trim().length <= max
    ? value.trim()
    : fail('invalid-argument', 'Revisa los textos de la configuración.');
const integer = (value, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max)
    fail('invalid-argument', 'Revisa los horarios y las tarifas.');
  return value;
};
export function makeOperationsApi(db, { now = () => Date.now() } = {}) {
  async function member(uid, establishmentId, transaction) {
    if (!uid) fail('unauthenticated', 'Inicia sesión para continuar.');
    const read = (ref) => (transaction ? transaction.get(ref) : ref.get());
    const [venue, membership] = await Promise.all([
      read(db.doc(`establishments/${establishmentId}`)),
      read(db.doc(`establishments/${establishmentId}/members/${uid}`)),
    ]);
    if (
      !['approved', 'published'].includes(venue.data()?.status) ||
      membership.data()?.role !== 'admin' ||
      membership.data()?.status !== 'active'
    )
      fail('permission-denied', 'No administras este establecimiento.');
    return venue.data();
  }
  function audit(transaction, uid, establishmentId, action, extra = {}) {
    transaction.create(db.collection('audit_logs').doc(), {
      action,
      establishmentId,
      actorUid: uid,
      at: FieldValue.serverTimestamp(),
      ...extra,
    });
  }
  return {
    async recordSession(uid, input) {
      strict(input, ['reservationId', 'action']);
      const ref = db.doc(`reservations/${id(input.reservationId)}`);
      if (!['start', 'finish'].includes(input.action)) fail('invalid-argument', 'Acción inválida.');
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref),
          r = snapshot.data();
        if (!r) fail('not-found', 'Reserva no encontrada.');
        await member(uid, r.establishmentId, tx);
        if (r.status !== 'confirmed' || r.paymentStatus !== 'verified')
          fail('failed-precondition', 'Primero verifica el adelanto y confirma la reserva.');
        const courtRef = db.doc(`establishments/${r.establishmentId}/courts/${r.courtId}`);
        const court = (await tx.get(courtRef)).data();
        if (!court) fail('not-found', 'Cancha no encontrada.');
        const instant = now();
        if (input.action === 'start') {
          if (r.actualStartAt) return; // Reintentos no cambian la hora ni duplican eventos.
          if (court.runtime)
            fail('failed-precondition', 'Finaliza primero el partido que está en curso.');
          if (
            r.serviceStatus === 'completed' ||
            limaDate(instant) !== r.date ||
            instant < millis(r.startsAt)
          )
            fail(
              'failed-precondition',
              'Solo puedes iniciar una reserva de hoy cuando llegue su hora.',
            );
          const schedule = await readSchedule(
            db,
            r.establishmentId,
            r.courtId,
            r.date,
            court,
            instant,
            tx,
          );
          if (schedule[0]?.reservationId !== snapshot.id)
            fail(
              'failed-precondition',
              'Hay una reserva anterior pendiente de iniciar o finalizar.',
            );
          const actualStartAt = Timestamp.fromMillis(instant),
            estimatedEndAt = Timestamp.fromMillis(instant + 3600000);
          tx.update(ref, {
            serviceStatus: 'running',
            actualStartAt,
            estimatedEndAt,
            startedBy: uid,
          });
          tx.update(courtRef, {
            runtime: { reservationId: snapshot.id, date: r.date, actualStartAt, estimatedEndAt },
          });
        } else {
          if (r.serviceStatus === 'completed') return;
          if (court.runtime?.reservationId !== snapshot.id || r.serviceStatus !== 'running')
            fail('failed-precondition', 'La reserva todavía no está en juego.');
          tx.update(ref, {
            serviceStatus: 'completed',
            actualEndAt: Timestamp.fromMillis(instant),
            finishedBy: uid,
          });
          tx.update(courtRef, {
            runtime: FieldValue.delete(),
            lastEndedAt: Timestamp.fromMillis(instant),
          });
        }
        const action = input.action === 'start' ? 'session_started' : 'session_finished';
        tx.create(ref.collection('events').doc(), {
          action,
          actorUid: uid,
          at: Timestamp.fromMillis(instant),
        });
        audit(tx, uid, r.establishmentId, action, { reservationId: snapshot.id });
      });
      return { success: true };
    },
    async setCourtMaintenance(uid, input) {
      strict(input, ['establishmentId', 'courtId', 'maintenance']);
      const establishmentId = id(input.establishmentId),
        courtId = id(input.courtId);
      if (typeof input.maintenance !== 'boolean') fail('invalid-argument', 'Estado inválido.');
      await db.runTransaction(async (tx) => {
        await member(uid, establishmentId, tx);
        const ref = db.doc(`establishments/${establishmentId}/courts/${courtId}`);
        const court = await tx.get(ref);
        if (!court.exists || court.data().status !== 'active')
          fail('failed-precondition', 'Cancha inactiva.');
        if (court.data().maintenance === input.maintenance) return;
        tx.update(ref, { maintenance: input.maintenance });
        audit(
          tx,
          uid,
          establishmentId,
          input.maintenance ? 'maintenance_started' : 'maintenance_finished',
          { courtId },
        );
      });
      return { success: true };
    },
    async getAdminSettings(uid, input) {
      const establishmentId = id(input.establishmentId);
      const venue = await member(uid, establishmentId);
      const courts = await db
        .collection(`establishments/${establishmentId}/courts`)
        .where('status', '==', 'active')
        .get();
      const first = courts.docs[0]?.data(),
        config = venue.configuration || {};
      return {
        revision: venue.businessRevision || 0,
        name: venue.name,
        location: venue.location || '',
        description: config.description || venue.description || '',
        reference: config.reference || venue.reference || '',
        phone: config.phone || venue.phone || '',
        openHour: config.openHour ?? first?.openHour ?? null,
        closeHour: config.closeHour ?? first?.closeHour ?? null,
        days: config.days || first?.openDays || [0, 1, 2, 3, 4, 5, 6],
        payment: venue.payment || {},
        holdMinutes: venue.bookingPolicy?.holdMinutes ?? null,
        courts: courts.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name,
          dayPriceCents: doc.data().dayPriceCents,
          nightPriceCents: doc.data().nightPriceCents,
          nightStartsAt: doc.data().nightStartsAt,
        })),
      };
    },
    async saveAdminSettings(uid, input) {
      strict(input, ['establishmentId', 'expectedRevision', 'settings']);
      const establishmentId = id(input.establishmentId),
        s = input.settings;
      strict(s, ['description', 'reference', 'phone', 'openHour', 'closeHour', 'days', 'courts']);
      const description = text(s.description, 1000),
        reference = text(s.reference, 300),
        phone = text(s.phone, 20);
      if (!/^[+0-9 ()-]*$/.test(phone)) fail('invalid-argument', 'Teléfono inválido.');
      const openHour = integer(s.openHour, 0, 23),
        closeHour = integer(s.closeHour, 1, 24);
      if (
        closeHour <= openHour ||
        !Array.isArray(s.days) ||
        !s.days.length ||
        s.days.length > 7 ||
        new Set(s.days).size !== s.days.length
      )
        fail(
          'invalid-argument',
          'Selecciona los días y un horario de apertura anterior al cierre.',
        );
      s.days.forEach((day) => integer(day, 0, 6));
      if (!Array.isArray(s.courts) || !s.courts.length || s.courts.length > 20)
        fail('invalid-argument', 'Revisa las canchas.');
      s.courts.forEach((c) => {
        strict(c, ['id', 'dayPriceCents', 'nightPriceCents', 'nightStartsAt']);
        id(c.id);
        integer(c.dayPriceCents, 1000, 1000000);
        integer(c.nightPriceCents, 1000, 1000000);
        integer(c.nightStartsAt, 0, 23);
      });
      await db.runTransaction(async (tx) => {
        const venue = await member(uid, establishmentId, tx);
        if (input.expectedRevision !== (venue.businessRevision || 0))
          fail('aborted', 'La configuración cambió. Vuelve a cargarla antes de guardar.');
        const courts = await tx.get(
          db.collection(`establishments/${establishmentId}/courts`).where('status', '==', 'active'),
        );
        if (
          new Set(s.courts.map((c) => c.id)).size !== courts.size ||
          s.courts.length !== courts.size ||
          s.courts.some((c) => !courts.docs.some((d) => d.id === c.id))
        )
          fail('invalid-argument', 'Las canchas no corresponden a este local.');
        // Leer todas las reservas futuras afectadas; sin un límite que omita conflictos.
        const requests = await tx.get(
          db
            .collection('reservations')
            .where('establishmentId', '==', establishmentId)
            .where('date', '>=', limaDate(now())),
        );
        if (
          requests.docs.some((doc) => {
            const r = doc.data();
            const held =
              ['pending_payment', 'pending_verification'].includes(r.status) &&
              millis(r.expiresAt) > now();
            const confirmed = r.status === 'confirmed' && r.serviceStatus !== 'completed';
            return (
              (held || confirmed) &&
              (r.hour < openHour ||
                r.hour >= closeHour ||
                !s.days.includes(new Date(`${r.date}T12:00:00-05:00`).getUTCDay()))
            );
          })
        )
          fail(
            'failed-precondition',
            'Ese horario dejaría reservas existentes fuera de atención. Conserva sus días y horas.',
          );
        for (const court of courts.docs) {
          const prices = s.courts.find((c) => c.id === court.id);
          tx.update(court.ref, {
            openHour,
            closeHour,
            openDays: s.days,
            dayPriceCents: prices.dayPriceCents,
            nightPriceCents: prices.nightPriceCents,
            nightStartsAt: prices.nightStartsAt,
          });
        }
        const update = {
          description,
          businessRevision: (venue.businessRevision || 0) + 1,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (venue.configuration)
          update.configuration = {
            ...venue.configuration,
            description,
            reference,
            phone,
            openHour,
            closeHour,
            days: s.days,
            courts: venue.configuration.courts.map((c) => ({
              ...c,
              ...s.courts.find((p) => p.id === c.id),
            })),
          };
        else Object.assign(update, { phone, reference });
        tx.update(db.doc(`establishments/${establishmentId}`), update);
        audit(tx, uid, establishmentId, 'admin_settings_updated');
      });
      return { success: true };
    },
  };
}
