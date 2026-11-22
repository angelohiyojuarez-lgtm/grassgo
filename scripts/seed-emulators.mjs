import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
// Este script solo trabaja con servicios locales y proyecto demo, nunca con producción.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
initializeApp({ projectId: 'demo-grassgo', storageBucket: 'demo-grassgo.firebasestorage.app' });
const db = getFirestore(),
  auth = getAuth();
for (const [uid, email] of [
  ['cliente-demo', 'cliente@grassgo.test'],
  ['admin-demo', 'admin@grassgo.test'],
  ['super-demo', 'superadmin@grassgo.test'],
  ['equipo-demo', 'equipo@grassgo.test'],
]) {
  try {
    await auth.getUser(uid);
    if (uid === 'equipo-demo') {
      await auth.updateUser(uid, { email, password: 'GrassGoDemo2026!', disabled: false });
    }
  } catch {
    await auth.createUser({
      uid,
      email,
      password: 'GrassGoDemo2026!',
      displayName:
        uid === 'cliente-demo'
          ? 'Equipo Demo'
          : uid === 'admin-demo'
            ? 'Admin Demo'
            : uid === 'equipo-demo'
              ? 'Equipo GrassGo Demo'
              : 'Superadmin Demo',
      emailVerified: true,
    });
  }
}
await db
  .doc('establishments/el-puma')
  .set({
    name: 'Grass El Puma',
    location: 'Salinas, Andahuaylas',
    status: 'published',
    bookingPolicy: { enabled: true, advanceCents: 1000, holdMinutes: 30 },
    payment: { mode: 'demo', qr: '/assets/demo-payment-qr.svg' },
  });
// 08–24 y 30 minutos son DATOS DE PRUEBA. No representan políticas del local real.
await db
  .doc('establishments/el-puma/courts/principal')
  .set({
    name: 'Cancha principal',
    sport: 'Fútbol',
    status: 'active',
    openHour: 8,
    closeHour: 24,
    dayPriceCents: 3000,
    nightPriceCents: 4000,
    nightStartsAt: 18,
  });
await db.doc('establishments/el-puma/members/admin-demo').set({ role: 'admin', status: 'active' });
await db
  .doc('users/admin-demo/memberships/el-puma')
  .set({ name: 'Grass El Puma', role: 'admin', status: 'active' });
await db.doc('platform_roles/super-demo').set({ role: 'superadmin', status: 'active' });
// Cuenta común solicitada para recorrer los tres portales, solo en emuladores.
await db.doc('establishments/el-puma/members/equipo-demo').set({ role: 'admin', status: 'active' });
await db.doc('users/equipo-demo/memberships/el-puma').set({
  name: 'Grass El Puma', role: 'admin', status: 'active',
});
await db.doc('platform_roles/equipo-demo').set({ role: 'superadmin', status: 'active' });
console.log(
  'Datos DEMO locales preparados. Acceso a los tres portales: equipo@grassgo.test / GrassGoDemo2026! Las cuentas separadas de cliente, admin y superadmin siguen disponibles.',
);
process.exit(0);
