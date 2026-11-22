// Partido simulado para revisar las estrellas, exclusivamente en emuladores.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-grassgo' }, 'demo-rating-reservation');
const db = getFirestore(app);
try {
  const ref = db.doc('reservations/demo-calificacion-el-puma');
  const venue = (await db.doc('establishments/el-puma').get()).data();
  if (!venue || venue.payment?.mode !== 'demo') throw Error('Se requiere el piloto con pagos demo.');
  if (!(await ref.get()).exists) {
    const date = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    const start = new Date(`${date}T17:00:00-05:00`).getTime();
    await ref.create({
      establishmentId: 'el-puma', establishmentName: venue.name,
      courtId: 'principal', courtName: 'Cancha principal · partido de prueba',
      clientUid: 'equipo-demo', date, hour: 17, totalCents: 3000, advanceCents: 1000,
      status: 'confirmed', paymentStatus: 'verified', serviceStatus: 'completed', demo: true,
      startsAt: Timestamp.fromMillis(start), endsAt: Timestamp.fromMillis(start + 3600000),
      actualStartAt: Timestamp.fromMillis(start), actualEndAt: Timestamp.fromMillis(start + 3600000),
      createdAt: FieldValue.serverTimestamp(), demoFixture: 'rating-preview',
    });
  }
  console.log('Partido finalizado SIMULADO listo en Mis reservas de equipo@grassgo.test. No se tocó ninguna reserva existente.');
} finally { await deleteApp(app); }
