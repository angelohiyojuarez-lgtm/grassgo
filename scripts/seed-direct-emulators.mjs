// Fixture aislado del recorrido cliente Firestore directo. Nunca apunta a producción.
// Ejecutar con los emuladores listos: node scripts/seed-direct-emulators.mjs --seed-demo
import { createRequire } from 'node:module';

if (process.argv[2] !== '--seed-demo' || process.argv.length !== 3) {
  throw new Error('Usa --seed-demo para preparar únicamente datos DEMO locales.');
}

const projectId = 'demo-grassgo';
const hosts = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
};
for (const [key, host] of Object.entries(hosts)) {
  if (process.env[key] && process.env[key] !== host) {
    throw new Error(`${key} debe ser ${host}. No se modificarán servicios externos.`);
  }
  process.env[key] = host;
}

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId }, 'seed-direct-demo');
const db = getFirestore(app);
const auth = getAuth(app);
const establishmentId = 'direct-demo';
const password = 'GrassGoDirectDemo2026!';
const accounts = [
  { uid: 'direct-cliente-demo', email: 'cliente.directo@grassgo.test', name: 'Cliente Directo DEMO' },
  { uid: 'direct-admin-demo', email: 'admin.directo@grassgo.test', name: 'Administrador Directo DEMO' },
];

try {
  // Solo puede reabrir su propio fixture; nunca sobreescribe un local ajeno.
  const existing = await db.doc(`establishments/${establishmentId}`).get();
  if (existing.exists && existing.data().directDemoFixture !== true) {
    throw new Error('direct-demo ya existe y no pertenece a este fixture. No se sobrescribió.');
  }

  for (const account of accounts) {
    let current;
    try {
      current = await auth.getUser(account.uid);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
    if (current && current.email !== account.email) {
      throw new Error(`La cuenta ${account.uid} no coincide con el fixture DEMO.`);
    }
    const data = {
      email: account.email,
      displayName: account.name,
      password,
      emailVerified: true,
      disabled: false,
    };
    if (current) await auth.updateUser(account.uid, data);
    else await auth.createUser({ uid: account.uid, ...data });
  }

  const days = [0, 1, 2, 3, 4, 5, 6];
  const payment = {
    mode: 'demo',
    qr: '/assets/demo-payment-qr.svg',
    methods: ['Yape', 'Plin'],
    recipient: 'DEMO — NO PAGAR',
    phone: '000000000',
  };
  const court = {
    name: 'Cancha principal DEMO',
    sport: 'Fútbol',
    surface: 'Grass sintético de demostración',
    images: [],
    status: 'active',
    openHour: 8,
    closeHour: 24,
    openDays: days,
    dayPriceCents: 3000,
    nightPriceCents: 4000,
    nightStartsAt: 18,
    maintenance: false,
    runtime: null,
  };
  const batch = db.batch();
  batch.set(db.doc(`establishments/${establishmentId}`), {
    directDemoFixture: true,
    name: 'GrassGo Directo · DEMO',
    location: 'Entorno local de demostración',
    status: 'published',
    bookingEngine: 'direct',
    bookingPolicy: { enabled: true, advanceCents: 1000, holdMinutes: 15 },
    payment,
  });
  batch.set(db.doc(`establishments/${establishmentId}/courts/principal`), court);
  batch.set(db.doc(`establishments/${establishmentId}/members/direct-admin-demo`), {
    role: 'admin',
    status: 'active',
  });
  batch.set(db.doc(`users/direct-admin-demo/memberships/${establishmentId}`), {
    name: 'GrassGo Directo · DEMO',
    role: 'admin',
    status: 'active',
  });
  batch.set(db.doc(`catalog/${establishmentId}`), {
    status: 'published',
    demo: true,
    name: 'GrassGo Directo · DEMO',
    location: 'Entorno local de demostración',
    description: 'Negocio ficticio para verificar reservas y comprobantes. No realizar pagos.',
    reference: 'Solo emuladores locales',
    district: 'Demostración',
    phone: '',
    images: [],
    openHour: 8,
    closeHour: 24,
    days,
    advanceCents: 1000,
    rating: null,
    courts: [{ id: 'principal', ...court }],
    booking: { enabled: true, engine: 'direct', holdMinutes: 15, payment },
  });
  batch.set(db.doc(`catalog/${establishmentId}/courts/principal`), court);
  for (const account of accounts) {
    const profileRef = db.doc(`profiles/${account.uid}`);
    const profile = await profileRef.get();
    batch.set(profileRef, {
      uid: account.uid,
      displayName: account.name,
      phone: '',
      createdAt: profile.data()?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log('Fixture DEMO local direct-demo preparado. El Puma y sus reservas permanecen intactos.');
  console.log(`Cliente: ${accounts[0].email} / ${password}`);
  console.log(`Administrador del fixture: ${accounts[1].email} / ${password}`);
  console.log('Horarios, tarifas y comprobantes son exclusivamente de prueba. No realizar pagos.');
} finally {
  await deleteApp(app);
}
