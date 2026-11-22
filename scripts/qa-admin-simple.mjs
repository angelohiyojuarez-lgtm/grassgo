// Datos ficticios acotados a los emuladores; nunca usa un proyecto remoto.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const action = process.argv[2];
if (!['setup', 'verify', 'cleanup'].includes(action)) throw Error('Usa setup, verify o cleanup.');
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080')
  throw Error('Este fixture solo admite Firestore local en 127.0.0.1:8080.');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-grassgo' }, 'qa-admin-simple');
const db = getFirestore(app);
const tenant = 'direct-demo',
  uid = 'direct-cliente-demo';
const ids = ['qa-admin-simple-tomorrow', 'qa-admin-simple-later', 'qa-admin-simple-expired'];
const own = (data) => data?.establishmentId === tenant && data?.clientUid === uid;
const slotPath = (data) =>
  'direct_slots/' + tenant + '/courts/principal/days/' + data.date + '/hours/' + data.hour;
try {
  if (action === 'setup') {
    const venue = (await db.doc('catalog/' + tenant).get()).data();
    const court = (await db.doc('establishments/' + tenant + '/courts/principal').get()).data();
    if (!venue?.demo || !court || venue.booking?.payment?.mode !== 'demo')
      throw Error('Prepara primero seed:direct-emulators.');
    const now = Date.now();
    const bytes = readFileSync(new URL('../docs/screenshots/logo-movil.jpg', import.meta.url));
    const imageData = 'data:image/jpeg;base64,' + bytes.toString('base64');
    const sha256 = createHash('sha256').update(imageData).digest('hex');
    const specs = [
      [1, 16, 3],
      [2, 17, 1],
      [1, 18, 20],
    ];
    await db.runTransaction(async (tx) => {
      const data = specs.map(([days, hour, minutes]) => {
        const date = new Date(now - 5 * 3600000 + days * 86400000).toISOString().slice(0, 10);
        const startsAt = Date.parse(date + 'T' + hour + ':00:00-05:00');
        const createdAt = Timestamp.fromMillis(now - minutes * 60000);
        return {
          clientUid: uid,
          establishmentId: tenant,
          establishmentName: venue.name,
          courtId: 'principal',
          courtName: court.name,
          date,
          hour,
          startsAt: Timestamp.fromMillis(startsAt),
          endsAt: Timestamp.fromMillis(startsAt + 3600000),
          createdAt,
          totalCents: hour >= court.nightStartsAt ? court.nightPriceCents : court.dayPriceCents,
          advanceCents: 1000,
          status: 'pending_verification',
          paymentStatus: 'submitted',
          paymentSnapshot: venue.booking.payment,
          proofSubmittedAt: Timestamp.fromMillis(createdAt.toMillis() + 5000),
        };
      });
      const refs = ids.map((id) => db.doc('direct_requests/' + id));
      const locks = data.map((item) => db.doc(slotPath(item)));
      const existing = await tx.getAll(...refs, ...locks);
      if (existing.some((item) => item.exists))
        throw Error('Ya existe una solicitud o bloqueo. No se sobrescribieron datos.');
      data.forEach((item, index) => {
        tx.create(refs[index], item);
        tx.create(locks[index], {
          reservationId: ids[index],
          lockedAt: item.createdAt,
          status: 'held',
        });
        tx.create(db.doc('direct_proofs/' + ids[index]), {
          reservationId: ids[index],
          clientUid: uid,
          establishmentId: tenant,
          contentType: 'image/jpeg',
          imageData,
          sha256,
          createdAt: item.proofSubmittedAt,
        });
      });
    });
    console.log(
      'Tres solicitudes DEMO preparadas: dos vigentes de otras fechas y una vencida. La foto es una captura de la marca, sin pago real.',
    );
  } else if (action === 'verify') {
    for (const id of ids) {
      const data = (await db.doc('direct_requests/' + id).get()).data();
      if (data && !own(data)) throw Error('El fixture no pertenece a esta prueba.');
      console.log(
        JSON.stringify({
          id,
          exists: !!data,
          date: data?.date,
          status: data?.status,
          paymentStatus: data?.paymentStatus,
        }),
      );
    }
  } else {
    for (const id of ids)
      await db.runTransaction(async (tx) => {
        const reference = db.doc('direct_requests/' + id);
        const current = await tx.get(reference);
        if (!current.exists) return;
        if (!own(current.data())) throw Error('No se eliminarán solicitudes ajenas al fixture.');
        const lockRef = db.doc(slotPath(current.data()));
        const proofRef = db.doc('direct_proofs/' + id);
        const [lock, proof] = await tx.getAll(lockRef, proofRef);
        if (proof.exists && !own(proof.data()))
          throw Error('El comprobante no pertenece al fixture.');
        if (lock.data()?.reservationId === id) tx.delete(lockRef);
        if (proof.exists) tx.delete(proofRef);
        tx.delete(reference);
      });
    console.log('Solo se retiraron las solicitudes, fotos y bloqueos del fixture qa-admin-simple.');
  }
} finally {
  await deleteApp(app);
}
