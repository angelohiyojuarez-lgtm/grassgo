import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getStorage, connectStorageEmulator, ref, uploadBytes, getBytes } from 'firebase/storage';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const adminApp = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const adminStorage = require('firebase-admin/storage');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
const backend = adminApp.initializeApp(
  { projectId: 'demo-grassgo', storageBucket: 'demo-grassgo.firebasestorage.app' },
  'business-smoke-cleanup',
);
const db = getFirestore(backend),
  bucket = adminStorage.getStorage(backend).bucket();
const app = initializeApp(
  {
    projectId: 'demo-grassgo',
    apiKey: 'demo-key',
    storageBucket: 'demo-grassgo.firebasestorage.app',
  },
  'business-smoke',
);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app, 'us-central1');
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const storage = getStorage(app);
connectStorageEmulator(storage, '127.0.0.1', 9199);
storage.maxOperationRetryTime = 10000;
storage.maxUploadRetryTime = 15000;
const call = async (name, data = {}) =>
  (await httpsCallable(functions, name, { timeout: 120000 })(data)).data;
const login = (email) => signInWithEmailAndPassword(auth, email, 'GrassGoDemo2026!');
let id = '',
  reservation;
const paths = [];
try {
  await login('equipo@grassgo.test');
  const base = await call('createEstablishment', {
    requestId: randomUUID(),
    name: 'SMOKE temporal deportes',
    location: 'Talavera, ubicación ficticia',
    description: 'Prueba automatizada, no es un negocio real.',
  });
  id = base.id;
  const photo = await readFile(new URL('../public/assets/login-estadio.png', import.meta.url));
  for (const name of ['foto-futbol', 'foto-voley', 'qr', 'portada-local']) {
    const path = `business-media/${id}/${name}`;
    await uploadBytes(ref(storage, path), photo, { contentType: 'image/png' });
    paths.push(path);
  }
  const config = {
    name: base.name,
    district: 'Talavera',
    address: 'Dirección ficticia',
    reference: 'Referencia QA',
    description: 'Prueba temporal',
    phone: '',
    images: [paths[3]],
    adminEmail: 'admin@grassgo.test',
    days: [0, 1, 2, 3, 4, 5, 6],
    openHour: 8,
    closeHour: 24,
    holdMinutes: 45,
    courts: [
      {
        id: 'futbol',
        name: 'Grass de prueba',
        sport: 'Fútbol',
        surface: 'Grass sintético',
        dayPriceCents: 3000,
        nightPriceCents: 4000,
        nightStartsAt: 18,
        images: [paths[0]],
      },
      {
        id: 'voley',
        name: 'Vóley de prueba',
        sport: 'Vóley',
        surface: 'Losa deportiva',
        dayPriceCents: 2000,
        nightPriceCents: 2500,
        nightStartsAt: 18,
        images: [paths[1]],
      },
    ],
    payment: { mode: 'demo', methods: ['Yape', 'Plin'], recipient: '', phone: '', qr: paths[2] },
  };
  const saved = await call('saveBusinessConfiguration', {
    establishmentId: id,
    revision: 0,
    configuration: config,
  });
  assert.equal(saved.revision, 1);
  assert.equal(
    (await call('getBusinessConfiguration', { establishmentId: id })).configuration.courts.length,
    2,
  );
  await call('publishBusiness', { establishmentId: id, revision: 1 });
  await login('cliente@grassgo.test');
  const local = (await call('listPublishedBusinesses')).establishments.find(
    (item) => item.id === id,
  );
  assert.equal(local.courts.length, 2);
  assert.deepEqual(local.images, [paths[3]]);
  assert.notEqual(local.images[0], local.courts[0].images[0]);
  assert.equal(local.openHour, 8);
  assert.equal(local.closeHour, 24);
  assert.equal(local.adminEmail, undefined);
  assert.ok((await getBytes(ref(storage, paths[1]))).byteLength);
  assert.ok((await getBytes(ref(storage, local.images[0]))).byteLength);
  await assert.rejects(
    call('saveBusinessConfiguration', { establishmentId: id, revision: 1, configuration: config }),
  );
  const date = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', {
    timeZone: 'America/Lima',
  });
  const availability = await call('getAvailability', {
    establishmentId: id,
    courtId: 'voley',
    date,
  });
  assert.equal(availability.slots.find((s) => s.hour === 19).priceCents, 2500);
  reservation = await call('createReservation', {
    establishmentId: id,
    courtId: 'voley',
    date,
    hour: 19,
    requestId: randomUUID(),
  });
  assert.equal(reservation.advanceCents, 1000);
  assert.equal(reservation.demo, true);
  const proof = `proofs/${reservation.clientUid}/${reservation.id}/receipt`;
  await uploadBytes(ref(storage, proof), photo, { contentType: 'image/png' });
  paths.push(proof);
  await call('submitPaymentProof', { reservationId: reservation.id });
  await login('admin@grassgo.test');
  const overview = await call('adminOverview', { establishmentId: id });
  assert.equal(overview.courts.length, 2);
  await call('reviewPayment', {
    reservationId: reservation.id,
    action: 'confirm',
    paymentVerified: true,
    amountCents: 1000,
  });
  await login('cliente@grassgo.test');
  assert.equal(
    (await call('myReservations')).find((item) => item.id === reservation.id).status,
    'confirmed',
  );
  console.log(
    'OK: alta → portada del local y fotos de canchas separadas → 4 archivos validados → borrador reabrible → publicación → catálogo → vóley con su tarifa → adelanto S/ 10 → comprobante privado → admin asignado → confirmación.',
  );
} finally {
  if (id) {
    const snapshot = await db.doc(`establishments/${id}`).get();
    if (
      snapshot.data()?.name !== 'SMOKE temporal deportes' ||
      snapshot.data()?.createdBy !== 'equipo-demo'
    )
      throw Error('Limpieza detenida: fixture no coincide.');
    for (const record of (
      await db.collection('reservations').where('establishmentId', '==', id).get()
    ).docs) {
      await db.recursiveDelete(record.ref);
      await db.doc(`payments/${record.id}`).delete();
    }
    if (reservation)
      await db.doc(`occupancy/${id}_voley_${reservation.date}_${reservation.hour}`).delete();
    for (const record of (
      await db.collection('audit_logs').where('establishmentId', '==', id).get()
    ).docs)
      await record.ref.delete();
    await db.recursiveDelete(db.doc(`establishments/${id}`));
    await db.doc(`users/admin-demo/memberships/${id}`).delete();
    for (const path of paths) await bucket.file(path).delete({ ignoreNotFound: true });
    console.log('Fixture y archivos temporales retirados; negocios del usuario conservados.');
  }
  await deleteApp(app);
  await adminApp.deleteApp(backend);
}
