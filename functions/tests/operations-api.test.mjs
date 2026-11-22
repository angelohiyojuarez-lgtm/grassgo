import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { makeBookingApi } from '../booking-api.js';
import { makeOperationsApi } from '../operations-api.js';
const projectId = 'demo-grassgo-operations-tests';
const date = '2030-01-20';
const time = (hour, minute = 0) =>
  new Date(`${date}T00:00:00-05:00`).getTime() + hour * 3600000 + minute * 60000;
let db, booking, operations, now;
const input = (hour, requestId = `r-${hour}`) => ({
  establishmentId: 'uno',
  courtId: 'principal',
  date,
  hour,
  requestId,
});
before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Solo ejecutar con emulador.');
  db = getFirestore(initializeApp({ projectId }));
  booking = makeBookingApi(db, { allowDemo: true, now: () => now });
  operations = makeOperationsApi(db, { now: () => now });
});
beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  now = time(8);
  await db
    .doc('establishments/uno')
    .set({
      name: 'Local prueba',
      status: 'published',
      businessRevision: 0,
      bookingPolicy: { enabled: true, advanceCents: 1000, holdMinutes: 30 },
      payment: { mode: 'demo', qr: '/assets/demo-payment-qr.svg' },
    });
  await db
    .doc('establishments/uno/courts/principal')
    .set({
      name: 'Cancha',
      status: 'active',
      openHour: 8,
      closeHour: 24,
      openDays: [0, 1, 2, 3, 4, 5, 6],
      dayPriceCents: 3000,
      nightPriceCents: 4000,
      nightStartsAt: 18,
    });
  await db.doc('establishments/uno/members/admin').set({ role: 'admin', status: 'active' });
});
async function confirmed(hour, uid = 'client') {
  const r = await booking.createReservation(uid, input(hour));
  await booking.markProof(uid, r.id, { generation: '1' });
  await booking.reviewPayment('admin', {
    reservationId: r.id,
    action: 'confirm',
    paymentVerified: true,
    amountCents: 1000,
  });
  return r;
}
const start = (r, uid = 'admin') =>
  operations.recordSession(uid, { reservationId: r.id, action: 'start' });
const finish = (r) => operations.recordSession('admin', { reservationId: r.id, action: 'finish' });
test('inicio tardío: hora completa, estimaciones encadenadas y datos originales intactos', async () => {
  const a = await confirmed(20),
    b = await confirmed(21, 'other');
  now = time(20, 20);
  await start(a);
  const mine = await booking.myReservations('other');
  assert.equal(mine[0].estimatedStartAt, time(21, 20));
  assert.equal(mine[0].estimatedEndAt, time(22, 20));
  assert.equal(mine[0].hour, 21);
  assert.equal(mine[0].totalCents, 4000);
  const active = (await booking.myReservations('client'))[0];
  assert.equal(active.actualStartAt, time(20, 20));
  assert.equal(active.estimatedEndAt, time(21, 20));
  const availability = await booking.getAvailability('visitor', input(22));
  assert.equal(availability.slots.find((s) => s.hour === 22).available, false);
  assert.equal(availability.slots.find((s) => s.hour === 23).available, true);
  assert.ok(availability.schedule.every((s) => !('reservationId' in s) && !('clientUid' in s)));
  await assert.rejects(booking.createReservation('third', input(22, 'overlap')), {
    code: 'already-exists',
  });
  assert.equal((await db.doc(`reservations/${b.id}`).get()).data().hour, 21);
});
test('finalización conserva retraso y permite iniciar siguiente sin duplicar pagos', async () => {
  const a = await confirmed(20),
    b = await confirmed(21, 'other');
  now = time(20, 20);
  await start(a);
  now = time(21, 25);
  await finish(a);
  await finish(a);
  assert.equal((await booking.myReservations('other'))[0].estimatedStartAt, time(21, 25));
  await start(b);
  assert.equal((await booking.myReservations('other'))[0].estimatedEndAt, time(22, 25));
  assert.equal((await booking.myReservations('client'))[0].serviceStatus, 'completed');
  assert.equal((await db.collection('payments').get()).size, 2);
  assert.equal(
    (
      await db
        .collection(`reservations/${a.id}/events`)
        .where('action', '==', 'session_finished')
        .get()
    ).size,
    1,
  );
});
test('permisos: cliente, administrador ajeno y membresía revocada no operan', async () => {
  const a = await confirmed(20);
  now = time(20);
  for (const uid of ['client', 'other-admin'])
    await assert.rejects(start(a, uid), { code: 'permission-denied' });
  await db.doc('establishments/uno/members/admin').update({ status: 'suspended' });
  await assert.rejects(start(a), { code: 'permission-denied' });
  await assert.rejects(operations.getAdminSettings('other-admin', { establishmentId: 'uno' }), {
    code: 'permission-denied',
  });
});
test('inicio exige confirmación, fecha actual y hora; no acepta reloj enviado por cliente', async () => {
  const a = await confirmed(20);
  await assert.rejects(start(a), { code: 'failed-precondition' });
  now = time(20);
  await assert.rejects(
    operations.recordSession('admin', {
      reservationId: a.id,
      action: 'start',
      actualStartAt: time(19),
    }),
    { code: 'invalid-argument' },
  );
  now = time(24);
  await assert.rejects(start(a), { code: 'failed-precondition' });
  now = time(8);
  const pending = await booking.createReservation('pending', input(10));
  now = time(10);
  await assert.rejects(start(pending), { code: 'failed-precondition' });
});
test('concurrencia e idempotencia: un solo partido en juego y un solo inicio', async () => {
  const a = await confirmed(20),
    b = await confirmed(21, 'other');
  now = time(21);
  const results = await Promise.allSettled([start(a), start(a), start(b)]);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(
    (
      await db
        .collection(`reservations/${a.id}/events`)
        .where('action', '==', 'session_started')
        .get()
    ).size,
    1,
  );
  now = time(21, 10);
  await start(a);
  assert.equal((await booking.myReservations('client'))[0].actualStartAt, time(21));
});
test('no inicia la siguiente mientras una reserva anterior está pendiente', async () => {
  await confirmed(20);
  const b = await confirmed(21, 'other');
  now = time(21);
  await assert.rejects(start(b), { code: 'failed-precondition' });
  await assert.rejects(finish(b), { code: 'failed-precondition' });
});
test('partido que superó su estimación mantiene cierre hasta finalizar', async () => {
  const a = await confirmed(20);
  now = time(20);
  await start(a);
  now = time(21, 10);
  const availability = await booking.getAvailability('visitor', input(22));
  assert.equal(availability.awaitingFinish, true);
  assert.ok(availability.slots.every((s) => !s.available));
  await assert.rejects(booking.createReservation('visitor', input(22)), { code: 'already-exists' });
  await finish(a);
  assert.equal(
    (await booking.getAvailability('visitor', input(22))).slots.find((s) => s.hour === 22)
      .available,
    true,
  );
});
test('mantenimiento bloquea reservas nuevas, conserva confirmadas y requiere pertenencia', async () => {
  const a = await confirmed(20);
  const args = { establishmentId: 'uno', courtId: 'principal', maintenance: true };
  await assert.rejects(operations.setCourtMaintenance('other-admin', args), {
    code: 'permission-denied',
  });
  await operations.setCourtMaintenance('admin', args);
  assert.ok((await booking.getAvailability('visitor', input(22))).slots.every((s) => !s.available));
  await assert.rejects(booking.createReservation('visitor', input(22)), { code: 'already-exists' });
  now = time(20);
  await start(a);
  await operations.setCourtMaintenance('admin', { ...args, maintenance: false });
  assert.equal((await db.doc(`reservations/${a.id}`).get()).data().status, 'confirmed');
});
const settings = () => ({
  description: 'Datos públicos actualizados',
  reference: 'Frente a la plaza',
  phone: '999111222',
  openHour: 8,
  closeHour: 24,
  days: [0, 1, 2, 3, 4, 5, 6],
  courts: [{ id: 'principal', dayPriceCents: 3500, nightPriceCents: 4500, nightStartsAt: 18 }],
});
const save = (s = settings(), expectedRevision = 0, uid = 'admin') =>
  operations.saveAdminSettings(uid, { establishmentId: 'uno', expectedRevision, settings: s });
test('configuración aplica precios nuevos y conserva adelanto y precios históricos', async () => {
  const a = await confirmed(20);
  await save();
  const b = await booking.createReservation('other', input(21));
  assert.equal(b.totalCents, 4500);
  assert.equal(b.advanceCents, 1000);
  assert.equal((await booking.myReservations('client'))[0].totalCents, 4000);
  const loaded = await operations.getAdminSettings('admin', { establishmentId: 'uno' });
  assert.equal(loaded.reference, 'Frente a la plaza');
  assert.equal(loaded.revision, 1);
  await assert.rejects(save(), { code: 'aborted' });
});
test('configuración no permite roles, QR, adelanto, tarifas inválidas ni canchas ajenas', async () => {
  await assert.rejects(save(settings(), 0, 'other'), { code: 'permission-denied' });
  for (const extra of [
    { advanceCents: 1 },
    { adminEmail: 'evil@test.com' },
    { payment: { qr: 'bad' } },
  ])
    await assert.rejects(save({ ...settings(), ...extra }), { code: 'invalid-argument' });
  await assert.rejects(
    save({ ...settings(), courts: [{ ...settings().courts[0], id: 'foreign' }] }),
    { code: 'invalid-argument' },
  );
  await assert.rejects(
    save({ ...settings(), courts: [{ ...settings().courts[0], dayPriceCents: 500 }] }),
    { code: 'invalid-argument' },
  );
});
test('horarios no dejan confirmadas o retenciones vigentes fuera de atención', async () => {
  await confirmed(20);
  await assert.rejects(save({ ...settings(), closeHour: 20 }), { code: 'failed-precondition' });
  await assert.rejects(save({ ...settings(), days: [1] }), { code: 'failed-precondition' });
});
test('agenda administrativa filtra fecha y cliente solo recibe sus estimaciones', async () => {
  await confirmed(20);
  await confirmed(21, 'other');
  assert.equal(
    (await booking.adminOverview('admin', { establishmentId: 'uno', date })).reservations.length,
    2,
  );
  assert.equal(
    (await booking.adminOverview('admin', { establishmentId: 'uno', date: '2030-01-21' }))
      .reservations.length,
    0,
  );
  assert.equal((await booking.myReservations('client')).length, 1);
});
test('inicio próximo a medianoche bloquea el cruce al día siguiente', async () => {
  await db.doc('establishments/uno/courts/principal').update({ openHour: 0 });
  const a = await confirmed(23);
  const b = await booking.createReservation('next-day', {
    ...input(0, 'next-day'),
    date: '2030-01-21',
  });
  await booking.markProof('next-day', b.id, { generation: '1' });
  await booking.reviewPayment('admin', {
    reservationId: b.id,
    action: 'confirm',
    paymentVerified: true,
    amountCents: 1000,
  });
  now = time(23, 40);
  await start(a);
  const availability = await booking.getAvailability('visitor', {
    ...input(8),
    date: '2030-01-21',
  });
  assert.equal(availability.activeUntil, time(24, 40));
  now = time(24, 20);
  await finish(a);
  assert.equal((await booking.myReservations('client'))[0].actualEndAt, time(24, 20));
  assert.equal((await booking.myReservations('next-day'))[0].estimatedStartAt, time(24, 20));
  assert.equal(
    (await booking.getAvailability('visitor', { ...input(1), date: '2030-01-21' })).slots.find(
      (s) => s.hour === 1,
    ).available,
    false,
  );
});
test('configuración conserva galería, QR y administrador al actualizar la ficha publicada', async () => {
  const configuration = {
    description: 'Anterior',
    reference: 'Antes',
    phone: '',
    adminEmail: 'owner@test.com',
    images: ['business-media/uno/portada'],
    payment: { mode: 'demo', qr: 'business-media/uno/qr' },
    days: [0, 1, 2, 3, 4, 5, 6],
    openHour: 8,
    closeHour: 24,
    courts: [{ ...settings().courts[0], images: ['business-media/uno/court'], sport: 'Vóley' }],
  };
  await db.doc('establishments/uno').update({ configuration });
  await save();
  const saved = (await db.doc('establishments/uno').get()).data().configuration;
  assert.deepEqual(saved.images, configuration.images);
  assert.deepEqual(saved.payment, configuration.payment);
  assert.equal(saved.adminEmail, configuration.adminEmail);
  assert.equal(saved.courts[0].sport, 'Vóley');
  assert.deepEqual(saved.courts[0].images, configuration.courts[0].images);
  assert.equal(saved.description, settings().description);
});
test('reserva e inicio concurrentes siempre producen un horario estimado sin solapamientos', async () => {
  const a = await confirmed(20);
  now = time(20, 20);
  const results = await Promise.allSettled([
    start(a),
    booking.createReservation('next', input(21, 'race')),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  if (results[1].status === 'fulfilled') {
    const b = results[1].value;
    await booking.markProof('next', b.id, { generation: '1' });
    await booking.reviewPayment('admin', {
      reservationId: b.id,
      action: 'confirm',
      paymentVerified: true,
      amountCents: 1000,
    });
    assert.equal((await booking.myReservations('next'))[0].estimatedStartAt, time(21, 20));
  } else assert.equal(results[1].reason.code, 'already-exists');
});
