import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { makeBookingApi } from '../booking-api.js';

// Proyecto separado para no borrar la demostración que usa el navegador.
const projectId = 'demo-grassgo-platform-tests';
let db, api;
const input = (requestId = 'negocio-1') => ({
  requestId,
  name: '  Negocio de prueba  ',
  location: 'Andahuaylas, Apurímac',
  description: 'Descripción de prueba.\nSegunda línea.',
});
before(() => {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
    throw Error('Usa exclusivamente Firestore Emulator local.');
  db = getFirestore(initializeApp({ projectId }, 'platform-tests'));
  api = makeBookingApi(db);
});
beforeEach(async () => {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.ok(response.ok);
  await db.doc('platform_roles/root').set({ role: 'superadmin', status: 'active' });
  await db.doc('platform_roles/inactivo').set({ role: 'superadmin', status: 'suspended' });
});
test('alta: solo superadmin activo, nunca cliente, admin local o rol suspendido', async () => {
  for (const uid of [null, 'cliente', 'admin-local', 'inactivo']) {
    await assert.rejects(api.createEstablishment(uid, input()), {
      code: uid ? 'permission-denied' : 'unauthenticated',
    });
  }
  assert.equal((await db.collection('establishments').get()).size, 0);
});
test('alta: valida campos, límites y rechaza permisos o políticas inyectadas', async () => {
  for (const extra of [
    { name: ' ' },
    { name: 42 },
    { name: 'a'.repeat(101) },
    { location: '' },
    { location: 'a'.repeat(201) },
    { description: 'a'.repeat(1001) },
    { name: 'Negocio\nInyectado' },
    { status: 'published' },
    { createdBy: 'otra-persona' },
    { bookingPolicy: { enabled: true } },
    { requestId: '../otro' },
  ])
    await assert.rejects(api.createEstablishment('root', { ...input(), ...extra }), {
      code: 'invalid-argument',
    });
  assert.equal((await db.collection('establishments').get()).size, 0);
});
test('alta: borrador con agenda apagada y auditoría; no inventa canchas, pagos ni tarifas', async () => {
  const result = await api.createEstablishment('root', input());
  const data = (await db.doc(`establishments/${result.id}`).get()).data();
  assert.equal(data.name, 'Negocio de prueba');
  assert.equal(data.status, 'draft');
  assert.deepEqual(data.bookingPolicy, { enabled: false });
  assert.equal(data.createdBy, 'root');
  assert.ok(data.createdAt.toMillis());
  assert.equal(data.payment, undefined);
  assert.equal((await db.collection(`establishments/${result.id}/courts`).get()).size, 0);
  assert.equal((await db.collection('catalog').get()).size, 0);
  const events = (await api.platformActivity('root')).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'establishment_created');
  assert.equal(events[0].actorUid, 'root');
});
test('reintentos concurrentes: un solo negocio y una sola acción; no se sobrescribe', async () => {
  const results = await Promise.all([
    api.createEstablishment('root', input()),
    api.createEstablishment('root', input()),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal((await db.collection('establishments').get()).size, 1);
  assert.equal((await db.collection('audit_logs').get()).size, 1);
  await assert.rejects(api.createEstablishment('root', { ...input(), name: 'Otro nombre' }), {
    code: 'invalid-argument',
  });
  await api.createEstablishment('root', input('negocio-2'));
  assert.equal((await db.collection('establishments').get()).size, 2);
});
test('auditoría: privada; perder rol bloquea también reintentos de alta', async () => {
  await api.createEstablishment('root', input());
  await db.doc('platform_roles/root').update({ status: 'suspended' });
  await assert.rejects(api.createEstablishment('root', input()), { code: 'permission-denied' });
  for (const uid of ['root', 'cliente', 'admin-local'])
    await assert.rejects(api.platformActivity(uid), { code: 'permission-denied' });
});
test('aprobar borrador no publica ni activa reservas, y registra ambas acciones', async () => {
  const result = await api.createEstablishment('root', input());
  await api.setEstablishmentStatus('root', { establishmentId: result.id, status: 'approved' });
  const data = (await db.doc(`establishments/${result.id}`).get()).data();
  assert.equal(data.status, 'approved');
  assert.equal(data.bookingPolicy.enabled, false);
  assert.equal((await api.platformActivity('root')).events.length, 2);
  await assert.rejects(
    api.getAvailability('cliente', {
      establishmentId: result.id,
      courtId: 'principal',
      date: '2030-01-20',
    }),
    { code: 'failed-precondition' },
  );
});
