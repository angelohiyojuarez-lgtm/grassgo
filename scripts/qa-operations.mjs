// Datos efímeros exclusivamente en el emulador local. Nunca modifica negocios existentes.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const app = initializeApp({ projectId: 'demo-grassgo' });
const db = getFirestore(app);
const fixtureFile = new URL('../.firebase/ops-ui-fixture.json', import.meta.url);
const mode = process.argv[2];
try {
  if (mode === 'setup') {
    try {
      await readFile(fixtureFile);
      throw Error('Limpia primero la prueba anterior.');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const id = `ops-qa-${randomUUID()}`,
      now = Date.now();
    const lima = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(now));
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Lima',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(now)),
    );
    if (hour === 23) throw Error('Ejecuta esta prueba visual antes de las 23:00 de Lima.');
    await writeFile(fixtureFile, JSON.stringify({ id, date: lima, hour }));
    await db
      .doc(`establishments/${id}`)
      .set({
        name: 'QA · Operación temporal',
        status: 'published',
        qaOperations: true,
        bookingPolicy: { enabled: true, advanceCents: 1000, holdMinutes: 30 },
        payment: { mode: 'demo', qr: '/assets/demo-payment-qr.svg' },
      });
    await db
      .doc(`establishments/${id}/courts/principal`)
      .set({
        name: 'Cancha de prueba',
        status: 'active',
        sport: 'Fútbol',
        surface: 'Grass sintético',
        openHour: 0,
        closeHour: 24,
        openDays: [0, 1, 2, 3, 4, 5, 6],
        dayPriceCents: 3000,
        nightPriceCents: 4000,
        nightStartsAt: 18,
      });
    await db
      .doc(`establishments/${id}/members/equipo-demo`)
      .set({ role: 'admin', status: 'active' });
    await db
      .doc(`users/equipo-demo/memberships/${id}`)
      .set({ name: 'QA · Operación temporal', role: 'admin', status: 'active' });
    for (let i = 0; i < 2; i++) {
      const start = new Date(`${lima}T00:00:00-05:00`).getTime() + (hour + i) * 3600000;
      const reservationId = `${id}-${i}`;
      await db
        .doc(`reservations/${reservationId}`)
        .set({
          establishmentId: id,
          establishmentName: 'QA · Operación temporal',
          courtId: 'principal',
          courtName: 'Cancha de prueba',
          clientUid: 'equipo-demo',
          date: lima,
          hour: hour + i,
          totalCents: 3000,
          advanceCents: 1000,
          status: 'confirmed',
          paymentStatus: 'verified',
          demo: true,
          createdAt: Timestamp.fromMillis(now),
          startsAt: Timestamp.fromMillis(start),
          endsAt: Timestamp.fromMillis(start + 3600000),
          expiresAt: Timestamp.fromMillis(start),
        });
      await db
        .doc(`occupancy/${id}_principal_${lima}_${hour + i}`)
        .set({ reservationId, expiresAt: Timestamp.fromMillis(start + 3600000) });
    }
    console.log('Prueba visual lista:', id, lima, hour);
  } else if (mode === 'verify' || mode === 'cleanup') {
    const { id } = JSON.parse(await readFile(fixtureFile));
    if (
      !id.startsWith('ops-qa-') ||
      (await db.doc(`establishments/${id}`).get()).data()?.qaOperations !== true
    )
      throw Error('Fixture no reconocido.');
    const reservations = await db
      .collection('reservations')
      .where('establishmentId', '==', id)
      .get();
    if (mode === 'verify')
      console.log(
        reservations.docs.map((d) => ({
          id: d.id,
          serviceStatus: d.data().serviceStatus,
          actualStartAt: d.data().actualStartAt?.toDate(),
          actualEndAt: d.data().actualEndAt?.toDate(),
        })),
      );
    else {
      for (const r of reservations.docs) await db.recursiveDelete(r.ref);
      for (const collection of ['audit_logs', 'payments']) {
        const docs = await db.collection(collection).where('establishmentId', '==', id).get();
        for (const d of docs.docs) await d.ref.delete();
      }
      const locks = await db.collection('occupancy').get();
      for (const d of locks.docs) if (d.id.startsWith(`${id}_`)) await d.ref.delete();
      await db.doc(`users/equipo-demo/memberships/${id}`).delete();
      await db.recursiveDelete(db.doc(`establishments/${id}`));
      await unlink(fixtureFile);
      console.log('Prueba visual eliminada; negocios existentes conservados.');
    }
  } else throw Error('Usa setup, verify o cleanup.');
} finally {
  await deleteApp(app);
}
