import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getStorage, connectStorageEmulator, ref, uploadBytes, getBytes } from 'firebase/storage';
const app = initializeApp(
  {
    projectId: 'demo-grassgo',
    apiKey: 'demo-key',
    authDomain: 'localhost',
    storageBucket: 'demo-grassgo.firebasestorage.app',
  },
  'smoke',
);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const functions = getFunctions(app, 'us-central1');
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
const storage = getStorage(app);
connectStorageEmulator(storage, '127.0.0.1', 9199);
const call = async (name, data = {}) => (await httpsCallable(functions, name)(data)).data;
const login = (email) => signInWithEmailAndPassword(auth, email, 'GrassGoDemo2026!');
const date = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', {
  timeZone: 'America/Lima',
});
try {
  await login('cliente@grassgo.test');
  const availability = await call('getAvailability', {
    establishmentId: 'el-puma',
    courtId: 'principal',
    date,
  });
  const slot = availability.slots.find((slot) => slot.available);
  assert.ok(slot, 'Debe existir un horario de demostración libre');
  const data = {
    establishmentId: 'el-puma',
    courtId: 'principal',
    date,
    hour: slot.hour,
    requestId: randomUUID(),
  };
  const reservation = await call('createReservation', data);
  assert.equal(reservation.advanceCents, 1000);
  assert.equal(reservation.status, 'pending_payment');
  assert.equal((await call('createReservation', data)).id, reservation.id);
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6X8AAAAASUVORK5CYII=',
    'base64',
  );
  await uploadBytes(
    ref(storage, `proofs/${reservation.clientUid}/${reservation.id}/receipt`),
    image,
    { contentType: 'image/png' },
  );
  await call('submitPaymentProof', { reservationId: reservation.id });
  let items = await call('myReservations');
  assert.equal(items.find((item) => item.id === reservation.id).paymentStatus, 'submitted');
  await signOut(auth);
  await login('admin@grassgo.test');
  const overview = await call('adminOverview', { establishmentId: 'el-puma' });
  assert.ok(overview.reservations.find((item) => item.id === reservation.id));
  const blob = await getBytes(
    ref(storage, `proofs/${reservation.clientUid}/${reservation.id}/receipt`),
  );
  assert.ok(blob.byteLength > 0);
  await call('reviewPayment', {
    reservationId: reservation.id,
    action: 'confirm',
    paymentVerified: true,
    amountCents: 1000,
  });
  await signOut(auth);
  await login('cliente@grassgo.test');
  items = await call('myReservations');
  assert.equal(items.find((item) => item.id === reservation.id).status, 'confirmed');
  await assert.rejects(call('platformOverview'));
  await signOut(auth);
  await login('superadmin@grassgo.test');
  assert.ok((await call('platformOverview')).establishments.length);
  console.log(
    'OK: flujo local completo Auth → disponibilidad → solicitud idempotente → archivo privado → revisión admin → reserva confirmada; permisos superadmin comprobados.',
  );
} finally {
  await deleteApp(app);
}
