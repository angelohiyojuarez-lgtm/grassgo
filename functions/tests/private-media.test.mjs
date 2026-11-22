import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { firestoreMedia, authorizeMedia } from '../private-media.js';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
  throw Error('Estas pruebas requieren un emulador local.');
const app = initializeApp({ projectId: 'demo-grassgo-media-tests' }, 'media-tests');
const db = getFirestore(app),
  store = firestoreMedia(db);
after(() => deleteApp(app));
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(800000)]);
test('archivos: bloques persistentes, reintento inmutable y recuperación íntegra', async () => {
  const path = 'business-media/test/' + Date.now();
  const first = await store.put(path, png, 'image/png');
  const second = await store.put(path, png, 'image/png');
  assert.equal(first.generation, second.generation);
  assert.deepEqual((await store.bucket().file(path).download())[0], png);
  await assert.rejects(
    store.put(path, Buffer.concat([png, Buffer.from('different')]), 'image/png'),
    { code: 'already-exists' },
  );
});
test('archivos: rechaza HTML, tipos falsos, vacíos y exceso de tamaño', async () => {
  for (const [bytes, type] of [
    [Buffer.from('<html>'), 'image/png'],
    [png, 'image/jpeg'],
    [Buffer.alloc(0), 'image/png'],
    [Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'],
  ])
    await assert.rejects(store.put('test', bytes, type), { code: 'invalid-argument' });
});
test('comprobantes: titular y administrador del local; nunca otro cliente ni otro local', async () => {
  await db.doc('establishments/local').set({ status: 'published' });
  await db.doc('establishments/local/members/admin').set({ role: 'admin', status: 'active' });
  await db
    .doc('reservations/reserva')
    .set({
      clientUid: 'cliente',
      establishmentId: 'local',
      status: 'pending_payment',
      expiresAt: Timestamp.fromMillis(Date.now() + 60000),
    });
  const path = 'proofs/cliente/reserva/receipt';
  await authorizeMedia(db, 'cliente', path, true);
  await authorizeMedia(db, 'admin', path, false);
  await assert.rejects(authorizeMedia(db, 'otro', path, false), { code: 'permission-denied' });
  await assert.rejects(authorizeMedia(db, 'admin', path, true), { code: 'permission-denied' });
  await db.doc('establishments/local/members/admin').update({ status: 'suspended' });
  await assert.rejects(authorizeMedia(db, 'admin', path, false), { code: 'permission-denied' });
  await db.doc('reservations/reserva').update({ status: 'pending_verification' });
  await assert.rejects(authorizeMedia(db, 'cliente', path, true), { code: 'permission-denied' });
});
test('fotos: solo superadmin puede subir a un borrador y rutas arbitrarias se rechazan', async () => {
  await db.doc('establishments/draft').set({ status: 'draft' });
  await db.doc('platform_roles/super').set({ role: 'superadmin', status: 'active' });
  await authorizeMedia(db, 'super', 'business-media/draft/photo', true);
  await assert.rejects(authorizeMedia(db, 'cliente', 'business-media/draft/photo', true), {
    code: 'permission-denied',
  });
  await assert.rejects(authorizeMedia(db, 'cliente', 'business-media/draft/photo', false), {
    code: 'permission-denied',
  });
  await assert.rejects(authorizeMedia(db, 'super', '../profiles/private', true), {
    code: 'permission-denied',
  });
});
