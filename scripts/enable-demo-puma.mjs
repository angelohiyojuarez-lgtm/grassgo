// Habilita únicamente el piloto existente en el emulador local, sin reiniciar sus datos.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-grassgo' }, 'enable-demo-puma');
const db = getFirestore(app);
try {
  await db.runTransaction(async (tx) => {
    const venueRef = db.doc('establishments/el-puma');
    const courtRef = db.doc('establishments/el-puma/courts/principal');
    const [venueSnapshot, courtSnapshot] = await Promise.all([tx.get(venueRef), tx.get(courtRef)]);
    const venue = venueSnapshot.data(), court = courtSnapshot.data();
    if (!venue || !court) throw new Error('Falta el piloto. No se crearán datos automáticamente.');
    if (venue.payment?.mode !== 'demo') throw new Error('El piloto debe usar pagos de demostración.');
    if (!['approved', 'published'].includes(venue.status)) throw new Error('Revisa el estado del piloto antes de habilitarlo.');
    if (!venue.bookingPolicy?.enabled || court.status !== 'active' || court.maintenance)
      throw new Error('La agenda o la cancha están deshabilitadas. Revisa su configuración.');
    if (venue.status === 'published') return;
    tx.update(venueRef, { status: 'published', publishedAt: FieldValue.serverTimestamp() });
    tx.create(db.collection('audit_logs').doc(), {
      action: 'demo_puma_published', establishmentId: 'el-puma',
      actorUid: 'local-demo-setup', previousStatus: venue.status,
      at: FieldValue.serverTimestamp(),
    });
  });
  console.log('Grass El Puma publicado solo en demo-grassgo local. Configuración y reservas conservadas.');
} finally {
  await deleteApp(app);
}
