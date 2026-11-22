// Datos desechables de verificación. Solo Auth/Firestore loopback, proyecto DEMO.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
const action = process.argv[2];
if (!['setup', 'verify', 'cleanup'].includes(action)) throw Error('Usa setup, verify o cleanup.');
for (const [key, expected] of Object.entries({
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
})) {
  if (process.env[key] && process.env[key] !== expected) throw Error('Solo emuladores loopback.');
  process.env[key] = expected;
}
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: 'demo-grassgo' }, 'qa-business-settings');
const db = getFirestore(app),
  auth = getAuth(app);
const id = 'qa-business-settings',
  uid = 'qa-business-client';
const privateRef = db.doc('establishments/' + id),
  publicRef = db.doc('catalog/' + id);
const membershipRef = db.doc('users/direct-admin-demo/memberships/' + id);
const owns = (data) => data?.businessSettingsQaFixture === true;
try {
  const [local, catalog] = await db.getAll(privateRef, publicRef);
  if ([local, catalog].some((snapshot) => snapshot.exists && !owns(snapshot.data())))
    throw Error('La ruta contiene datos ajenos al fixture. No se modificaron.');
  if (action === 'setup') {
    if (local.exists || catalog.exists || (await membershipRef.get()).exists)
      throw Error('El fixture ya existe. Usa verify o cleanup; no se sobrescribe.');
    const source = (await db.doc('catalog/direct-demo').get()).data();
    const court = (await db.doc('establishments/direct-demo/courts/principal').get()).data();
    if (!source?.demo || source.booking?.payment?.mode !== 'demo' || !court)
      throw Error('Prepara primero seed:direct-emulators.');
    for (const version of [1, 2])
      await QRCode.toFile(
        fileURLToPath(new URL('../.firebase/qa-business-qr-' + version + '.png', import.meta.url)),
        'GRASSGO DEMO - NO PAGAR - VERSION ' + version,
        { width: 700, margin: 4, errorCorrectionLevel: 'H' },
      );
    let user;
    try {
      user = await auth.getUser(uid);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
    if (user) throw Error('La cuenta de prueba ya existe. Revisa antes de continuar.');
    await auth.createUser({
      uid,
      email: 'qr.cliente@grassgo.test',
      password: 'GrassGoQrDemo2026!',
      emailVerified: true,
      displayName: 'Cliente QR DEMO',
    });
    const name = 'PRUEBAS QR · NO PAGAR';
    const batch = db.batch();
    batch.create(privateRef, {
      businessSettingsQaFixture: true,
      name,
      location: 'Solo emuladores',
      status: 'published',
      bookingEngine: 'direct',
      bookingPolicy: { enabled: true, holdMinutes: 15, advanceCents: 1000 },
    });
    batch.create(publicRef, {
      ...source,
      name,
      businessSettingsQaFixture: true,
      location: 'Solo emuladores',
      reference: 'Datos desechables de prueba',
      phone: '',
      description: 'Local DEMO para revisar QR y contacto. No realizar pagos.',
    });
    batch.create(db.doc('establishments/' + id + '/members/direct-admin-demo'), {
      role: 'admin',
      status: 'active',
    });
    batch.create(membershipRef, { name, role: 'admin', status: 'active' });
    batch.create(db.doc('establishments/' + id + '/courts/principal'), court);
    batch.create(db.doc('catalog/' + id + '/courts/principal'), court);
    batch.create(db.doc('profiles/' + uid), {
      uid,
      displayName: 'Cliente QR DEMO',
      phone: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    console.log('Local DEMO y cliente QR preparados. Fotos: .firebase/qa-business-qr-{1,2}.png.');
  } else if (action === 'verify') {
    const [contact, payment] = await db.getAll(
      db.doc('establishments/' + id + '/settings/contact'),
      db.doc('establishments/' + id + '/settings/payment'),
    );
    const requests = await db
      .collection('direct_requests')
      .where('establishmentId', '==', id)
      .get();
    const qrs = await db.collection('catalog/' + id + '/paymentQrs').get();
    const data = catalog.data();
    console.log(
      JSON.stringify({
        exists: local.exists,
        contact: contact.data(),
        payment: payment.data(),
        publicPayment: data?.booking?.payment,
        bookingEnabled: data?.booking?.enabled,
        qrVersions: qrs.docs.map((s) => s.id),
        reservations: requests.docs.map((s) => ({
          id: s.id,
          status: s.data().status,
          paymentStatus: s.data().paymentStatus,
          qr: s.data().paymentSnapshot?.qr,
        })),
      }),
    );
  } else {
    const requests = await db
      .collection('direct_requests')
      .where('establishmentId', '==', id)
      .get();
    if (requests.docs.some((s) => s.data().clientUid !== uid))
      throw Error('Hay solicitudes ajenas al cliente de prueba.');
    // Cada destino es un identificador literal de este fixture y requiere su marca.
    if (local.exists) await db.recursiveDelete(privateRef);
    if (catalog.exists) await db.recursiveDelete(publicRef);
    await membershipRef.delete();
    if (requests.size) {
      const batch = db.batch();
      for (const request of requests.docs) {
        batch.delete(request.ref);
        batch.delete(db.doc('direct_proofs/' + request.id));
      }
      await batch.commit();
    }
    await db.recursiveDelete(db.doc('direct_slots/' + id));
    await db.recursiveDelete(db.doc('direct_limits/' + uid));
    const user = await auth.getUser(uid).catch((error) => {
      if (error.code === 'auth/user-not-found') return null;
      throw error;
    });
    if (user && user.email !== 'qr.cliente@grassgo.test')
      throw Error('La cuenta no pertenece al fixture.');
    if (user) await auth.deleteUser(uid);
    await db.doc('profiles/' + uid).delete();
    console.log('Fixture QR retirado. Los otros establecimientos y sus reservas se conservan.');
  }
} finally {
  await deleteApp(app);
}
