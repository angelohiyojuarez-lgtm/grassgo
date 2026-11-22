import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { makeRatingsApi } from '../ratings-api.js';
import { makeBusinessApi } from '../business-api.js';
const projectId = 'demo-grassgo-ratings-tests';
let db, api;
before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Solo ejecutar con emulador.');
  db = getFirestore(initializeApp({ projectId }));
  api = makeRatingsApi(db, { now: () => 2000000 });
});
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  await db.doc('establishments/uno').set({ name: 'Local uno' });
  await db.doc('establishments/otro').set({ name: 'Local otro' });
  await db.doc('reservations/partido').set({
    establishmentId: 'uno', clientUid: 'client', status: 'confirmed', paymentStatus: 'verified',
    serviceStatus: 'completed', actualEndAt: Timestamp.fromMillis(1000000), demo: false,
  });
});
const rate = (uid = 'client', stars = 4, extra = {}) => api.rateEstablishment(uid, { reservationId: 'partido', stars, ...extra });
test('solo el titular puede calificar; no basta ser administrador o conocer el ID', async () => {
  await assert.rejects(rate(null), { code: 'unauthenticated' });
  await assert.rejects(rate('other'), { code: 'permission-denied' });
  assert.equal((await db.doc('establishments/uno').get()).data().ratingSummary, undefined);
});
test('impide calificar antes de finalizar y reservas sin adelanto verificado', async () => {
  for (const patch of [{ serviceStatus: 'running' }, { status: 'rejected' }, { paymentStatus: 'submitted' }, { actualEndAt: Timestamp.fromMillis(3000000) }]) {
    await db.doc('reservations/partido').update({ serviceStatus: 'completed', status: 'confirmed', paymentStatus: 'verified', actualEndAt: Timestamp.fromMillis(1000000), ...patch });
    await assert.rejects(rate(), { code: 'failed-precondition' });
  }
});
test('valida estrellas y rechaza la selección de otro establecimiento desde el cliente', async () => {
  for (const stars of [0, 6, 1.5, '5', null]) await assert.rejects(rate('client', stars), { code: 'invalid-argument' });
  await assert.rejects(rate('client', 4, { establishmentId: 'otro' }), { code: 'invalid-argument' });
});
test('reintentos concurrentes no duplican votos, ni permiten reemplazar la calificación', async () => {
  await Promise.all([rate(), rate(), rate()]);
  assert.deepEqual((await db.doc('establishments/uno').get()).data().ratingSummary, { count: 1, sum: 4, average: 4 });
  assert.equal((await db.doc('establishments/otro').get()).data().ratingSummary, undefined);
  await assert.rejects(rate('client', 5), { code: 'already-exists' });
  assert.equal((await db.collection('audit_logs').get()).size, 1);
});
test('separa puntuaciones de demostración y reales; agrega reservas distintas', async () => {
  const original = (await db.doc('reservations/partido').get()).data();
  await db.doc('reservations/demo').set({ ...original, demo: true });
  await db.doc('reservations/segunda').set(original);
  await Promise.all([rate(), api.rateEstablishment('client', { reservationId: 'segunda', stars: 2 }), api.rateEstablishment('client', { reservationId: 'demo', stars: 5 })]);
  const venue = (await db.doc('establishments/uno').get()).data();
  assert.deepEqual(venue.ratingSummary, { count: 2, sum: 6, average: 3 });
  assert.deepEqual(venue.demoRatingSummary, { count: 1, sum: 5, average: 5 });
});

test('catálogo publica solo el promedio, sin votos privados; demo solo en emuladores', async () => {
  await db.doc('establishments/uno').update({ status: 'published' });
  await db.doc('reservations/partido').update({ demo: true });
  await rate('client', 5);
  const live = await makeBusinessApi(db).listPublishedBusinesses('visitor');
  assert.equal(live.establishments[0].rating, null);
  const demo = await makeBusinessApi(db, { allowDemo: true }).listPublishedBusinesses('visitor');
  assert.deepEqual(demo.establishments[0].rating, { average: 5, count: 1, demo: true });
  assert.ok(!JSON.stringify(demo).includes('clientUid'));
});
