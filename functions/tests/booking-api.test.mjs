import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { makeBookingApi, validateDate } from '../booking-api.js';

let db, api;
const date = '2030-01-20',
  now = new Date('2030-01-19T12:00:00-05:00').getTime();
before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error('Estas pruebas requieren Firestore Emulator.');
  initializeApp({ projectId: 'demo-grassgo-booking-tests' });
  db = getFirestore();
  api = makeBookingApi(db, { now: () => now, allowDemo: true });
});
beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-grassgo-booking-tests/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await db.doc('establishments/el-puma').set({
    name: 'El Puma',
    status: 'published',
    bookingPolicy: { enabled: true, advanceCents: 1000, holdMinutes: 30 },
    payment: { mode: 'demo', qr: '/assets/demo-payment-qr.svg' },
  });
  await db.doc('establishments/el-puma/courts/principal').set({
    name: 'Principal',
    status: 'active',
    openHour: 8,
    closeHour: 24,
    dayPriceCents: 3000,
    nightPriceCents: 4000,
    nightStartsAt: 18,
  });
  await db.doc('establishments/el-puma/members/admin-a').set({ role: 'admin', status: 'active' });
  await db.doc('establishments/otro').set({ name: 'Otro', status: 'published' });
  await db.doc('establishments/otro/members/admin-b').set({ role: 'admin', status: 'active' });
  await db.doc('platform_roles/root').set({ role: 'superadmin', status: 'active' });
});
const input = (hour = 13, requestId = 'request-1') => ({
  establishmentId: 'el-puma',
  courtId: 'principal',
  date,
  hour,
  requestId,
});
test('motor directo: el backend anterior no puede crear una segunda ocupación', async () => {
  await db.doc('establishments/el-puma').update({ bookingEngine: 'direct' });
  await assert.rejects(api.createReservation('alice', input()), { code: 'failed-precondition' });
  await assert.rejects(api.getAvailability('alice', input()), { code: 'failed-precondition' });
  assert.equal((await db.collection('reservations').get()).size, 0);
});
test('fecha: rechaza fechas imposibles y rutas inyectadas', async () => {
  assert.throws(() => validateDate('2030-02-31'));
  await assert.rejects(api.getAvailability('alice', { ...input(), establishmentId: '../otro' }), {
    code: 'invalid-argument',
  });
});
test('disponibilidad: noche desde 18:00, precio y adelanto del servidor', async () => {
  const availability = await api.getAvailability('alice', input());
  assert.equal(availability.slots.find((slot) => slot.hour === 17).priceCents, 3000);
  assert.equal(availability.slots.find((slot) => slot.hour === 18).priceCents, 4000);
  const request = await api.createReservation('alice', {
    ...input(18),
    totalCents: 1,
    advanceCents: 1,
  });
  assert.equal(request.totalCents, 4000);
  assert.equal(request.advanceCents, 1000);
  assert.equal(request.status, 'pending_payment');
  assert.equal(request.paymentStatus, 'unpaid');
});
test('concurrencia: solo una solicitud ocupa el mismo horario', async () => {
  const results = await Promise.allSettled([
    api.createReservation('alice', input(13, 'first')),
    api.createReservation('bob', input(13, 'second')),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter((item) => item.status === 'rejected' && item.reason.code === 'already-exists')
      .length,
    1,
  );
});
test('reintento idempotente no duplica; cambiar datos con el mismo ID falla', async () => {
  const first = await api.createReservation('alice', input());
  const retry = await api.createReservation('alice', input());
  assert.equal(first.id, retry.id);
  assert.equal((await db.collection('reservations').get()).size, 1);
  await assert.rejects(api.createReservation('alice', input(14)), { code: 'invalid-argument' });
});
test('usuario sin sesión, fuera de horario o en fecha pasada no crea reservas', async () => {
  await assert.rejects(api.createReservation(null, input()), { code: 'unauthenticated' });
  await assert.rejects(api.createReservation('alice', input(5)), { code: 'failed-precondition' });
  await assert.rejects(api.createReservation('alice', { ...input(), date: '2029-12-01' }), {
    code: 'failed-precondition',
  });
});
test('QR demo no se acepta para reservas fuera de emuladores', async () => {
  const live = makeBookingApi(db, { now: () => now, allowDemo: false });
  await assert.rejects(live.createReservation('alice', input()), { code: 'failed-precondition' });
});
test('agenda sin horarios configurados se bloquea', async () => {
  await db.doc('establishments/el-puma/courts/principal').update({ openHour: null });
  await assert.rejects(api.getAvailability('alice', input()), { code: 'failed-precondition' });
});
test('comprobante: enviar no verifica; usuario ajeno y admin de otro tenant no acceden', async () => {
  const reservation = await api.createReservation('alice', input());
  await assert.rejects(api.markProof('bob', reservation.id, { generation: '1' }), {
    code: 'permission-denied',
  });
  await api.markProof('alice', reservation.id, { generation: '1' });
  const stored = (await db.doc(`reservations/${reservation.id}`).get()).data();
  assert.equal(stored.status, 'pending_verification');
  assert.equal(stored.paymentStatus, 'submitted');
  await assert.rejects(api.adminOverview('admin-b', { establishmentId: 'el-puma' }), {
    code: 'permission-denied',
  });
  await assert.rejects(
    api.reviewPayment('admin-b', {
      reservationId: reservation.id,
      action: 'confirm',
      paymentVerified: true,
      amountCents: 1000,
    }),
    { code: 'permission-denied' },
  );
});
test('confirmar exige ingreso real; el adelanto se registra una sola vez', async () => {
  const reservation = await api.createReservation('alice', input());
  await api.markProof('alice', reservation.id, { generation: '1' });
  await assert.rejects(
    api.reviewPayment('admin-a', {
      reservationId: reservation.id,
      action: 'confirm',
      paymentVerified: false,
      amountCents: 1000,
    }),
    { code: 'invalid-argument' },
  );
  await assert.rejects(
    api.reviewPayment('admin-a', {
      reservationId: reservation.id,
      action: 'confirm',
      paymentVerified: true,
      amountCents: 3000,
    }),
    { code: 'invalid-argument' },
  );
  await api.reviewPayment('admin-a', {
    reservationId: reservation.id,
    action: 'confirm',
    paymentVerified: true,
    amountCents: 1000,
  });
  assert.equal((await db.doc(`reservations/${reservation.id}`).get()).data().status, 'confirmed');
  assert.equal((await db.collection('payments').get()).size, 1);
  await assert.rejects(
    api.reviewPayment('admin-a', {
      reservationId: reservation.id,
      action: 'confirm',
      paymentVerified: true,
      amountCents: 1000,
    }),
    { code: 'failed-precondition' },
  );
  assert.equal((await db.collection('payments').get()).size, 1);
});
test('retención vencida se libera; un pago viejo no puede confirmar', async () => {
  const reservation = await api.createReservation('alice', input());
  await api.markProof('alice', reservation.id, { generation: '1' });
  const later = makeBookingApi(db, { now: () => now + 31 * 60000, allowDemo: true });
  await later.createReservation('bob', input(13, 'new'));
  await assert.rejects(
    later.reviewPayment('admin-a', {
      reservationId: reservation.id,
      action: 'confirm',
      paymentVerified: true,
      amountCents: 1000,
    }),
    { code: 'failed-precondition' },
  );
  assert.equal((await later.myReservations('alice'))[0].status, 'expired');
});
test('superadmin: solo rol activo puede aprobar/suspender y queda auditoría', async () => {
  await assert.rejects(api.platformOverview('admin-a'), { code: 'permission-denied' });
  await assert.rejects(
    api.setEstablishmentStatus('admin-a', { establishmentId: 'el-puma', status: 'suspended' }),
    { code: 'permission-denied' },
  );
  await api.setEstablishmentStatus('root', { establishmentId: 'el-puma', status: 'suspended' });
  assert.equal((await db.doc('establishments/el-puma').get()).data().status, 'suspended');
  assert.equal((await db.collection('audit_logs').get()).size, 1);
  await assert.rejects(api.createReservation('alice', input()), { code: 'failed-precondition' });
});
test('cada cliente solo recibe sus solicitudes', async () => {
  await api.createReservation('alice', input(13, 'a'));
  await api.createReservation('bob', input(14, 'b'));
  assert.equal((await api.myReservations('alice')).length, 1);
  assert.equal((await api.myReservations('alice'))[0].clientUid, 'alice');
});
