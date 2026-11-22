import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { makeBusinessApi } from '../business-api.js';
import { makeBookingApi } from '../booking-api.js';
const projectId = 'demo-grassgo-business-tests';
let db, api, booking;
const configuration = () => ({
  name: 'Centro deportivo de prueba',
  district: 'Talavera',
  address: 'Dirección ficticia',
  reference: 'Referencia ficticia',
  description: 'Pruebas del módulo',
  phone: '',
  images: ['business-media/uno/portada'],
  adminEmail: 'admin@grassgo.test',
  days: [0, 1, 2, 3, 4, 5, 6],
  openHour: 8,
  closeHour: 24,
  holdMinutes: 45,
  courts: [
    {
      id: 'futbol',
      name: 'Grass principal',
      sport: 'Fútbol',
      surface: 'Grass sintético',
      dayPriceCents: 3500,
      nightPriceCents: 4500,
      nightStartsAt: 18,
      images: ['business-media/uno/foto-1'],
    },
    {
      id: 'voley',
      name: 'Cancha de vóley',
      sport: 'Vóley',
      surface: 'Losa deportiva',
      dayPriceCents: 2000,
      nightPriceCents: 2500,
      nightStartsAt: 19,
      images: ['business-media/uno/foto-2'],
    },
  ],
  payment: { mode: 'demo', methods: ['Yape', 'Plin'], recipient: '', phone: '', qr: '' },
});
const save = (config = configuration(), revision = 0) =>
  api.saveBusinessConfiguration('root', {
    establishmentId: 'uno',
    revision,
    configuration: config,
  });
before(() => {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
    throw Error('Solo Firestore Emulator local.');
  db = getFirestore(initializeApp({ projectId }, 'business-tests'));
  api = makeBusinessApi(db, {
    allowDemo: true,
    verifyAsset: async (path) => {
      if (path.includes('corrupta')) throw Error('Imagen corrupta');
    },
    resolveAdmin: async (email) =>
      email === 'admin@grassgo.test'
        ? { uid: 'admin-a', emailVerified: true, disabled: false }
        : null,
  });
  booking = makeBookingApi(db, {
    allowDemo: true,
    now: () => new Date('2030-01-19T12:00:00-05:00').getTime(),
  });
});
beforeEach(async () => {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  assert.ok(response.ok);
  await db.doc('platform_roles/root').set({ role: 'superadmin', status: 'active' });
  await db
    .doc('establishments/uno')
    .set({ name: 'Borrador', status: 'draft', bookingPolicy: { enabled: false } });
});
test('configurar y publicar requiere superadmin activo, nunca admin de local', async () => {
  for (const method of [
    'getBusinessConfiguration',
    'saveBusinessConfiguration',
    'publishBusiness',
  ]) {
    await assert.rejects(
      api[method]('admin-local', {
        establishmentId: 'uno',
        revision: 0,
        configuration: configuration(),
      }),
      { code: 'permission-denied' },
    );
    await assert.rejects(api[method](null, { establishmentId: 'uno' }), {
      code: 'unauthenticated',
    });
  }
});
test('borrador acepta datos incompletos; publicar enumera faltantes y no habilita agenda', async () => {
  const c = configuration();
  c.courts = [];
  c.adminEmail = '';
  c.holdMinutes = null;
  c.days = [];
  await save(c);
  await assert.rejects(api.publishBusiness('root', { establishmentId: 'uno', revision: 1 }), {
    code: 'failed-precondition',
  });
  assert.equal((await db.doc('establishments/uno').get()).data().bookingPolicy.enabled, false);
});
test('valida tipos, precios, deporte, horario, IDs y no permite fotos de otro negocio', async () => {
  const invalid = [
    (c) => (c.openHour = 24),
    (c) => (c.closeHour = 7),
    (c) => (c.days = [7]),
    (c) => (c.courts[0].sport = 'inventado'),
    (c) => (c.courts[0].dayPriceCents = 999),
    (c) => (c.courts[0].images = ['proofs/cliente/uno/receipt']),
    (c) => (c.courts[0].images = ['business-media/otro/foto']),
    (c) => (c.courts[0].id = '../otro'),
    (c) => (c.payment.qr = 'https://externo/qr'),
    (c) => (c.status = 'published'),
    (c) => c.courts.push({ ...c.courts[0] }),
  ];
  for (const mutate of invalid) {
    const c = configuration();
    mutate(c);
    await assert.rejects(save(c), { code: 'invalid-argument' });
  }
});
test('rechaza referencias a archivos que no superen verificación binaria', async () => {
  const c = configuration();
  c.courts[0].images = ['business-media/uno/corrupta'];
  await assert.rejects(save(c));
  assert.equal((await db.doc('establishments/uno').get()).data().configuration, undefined);
});
test('reintento idempotente de guardado; versión vieja con datos distintos no sobrescribe', async () => {
  const first = await save();
  assert.equal(first.revision, 1);
  const retry = await save();
  assert.equal(retry.revision, 1);
  assert.equal((await db.collection('audit_logs').get()).size, 1);
  const c = configuration();
  c.reference = 'Cambio en otra pestaña';
  await assert.rejects(save(c), { code: 'aborted' });
  await save(c, 1);
  assert.equal(
    (await api.getBusinessConfiguration('root', { establishmentId: 'uno' })).revision,
    2,
  );
});
test('publicación crea dos canchas, precios distintos, adelanto 10 y membresía de admin', async () => {
  await save();
  await api.publishBusiness('root', { establishmentId: 'uno', revision: 1 });
  const venue = (await db.doc('establishments/uno').get()).data();
  assert.equal(venue.status, 'published');
  assert.equal(venue.bookingPolicy.advanceCents, 1000);
  assert.equal((await db.doc('establishments/uno/members/admin-a').get()).data().role, 'admin');
  assert.equal((await db.doc('users/admin-a/memberships/uno').get()).data().status, 'active');
  const availability = await booking.getAvailability('cliente', {
    establishmentId: 'uno',
    courtId: 'voley',
    date: '2030-01-20',
  });
  assert.equal(availability.slots.find((s) => s.hour === 18).priceCents, 2000);
  assert.equal(availability.slots.find((s) => s.hour === 19).priceCents, 2500);
  const reservation = await booking.createReservation('cliente', {
    establishmentId: 'uno',
    courtId: 'voley',
    date: '2030-01-20',
    hour: 19,
    requestId: 'test',
  });
  assert.equal(reservation.advanceCents, 1000);
  assert.equal(reservation.courtName, 'Cancha de vóley');
  assert.equal(reservation.totalCents, 2500);
  assert.equal(reservation.paymentSnapshot.mode, 'demo');
});
test('día cerrado no devuelve horarios ni permite reservar', async () => {
  const c = configuration();
  c.days = [1];
  await save(c);
  await api.publishBusiness('root', { establishmentId: 'uno', revision: 1 });
  const input = { establishmentId: 'uno', courtId: 'voley', date: '2030-01-20' };
  assert.deepEqual((await booking.getAvailability('cliente', input)).slots, []);
  await assert.rejects(
    booking.createReservation('cliente', { ...input, hour: 12, requestId: 'domingo' }),
    { code: 'failed-precondition' },
  );
});
test('no publica si el administrador no existe, está suspendido o su correo no está verificado', async () => {
  const c = configuration();
  c.adminEmail = 'noexiste@grassgo.test';
  await save(c);
  await assert.rejects(api.publishBusiness('root', { establishmentId: 'uno', revision: 1 }), {
    code: 'failed-precondition',
  });
  for (const admin of [
    { uid: 'a', disabled: true, emailVerified: true },
    { uid: 'a', disabled: false, emailVerified: false },
  ]) {
    const invalid = makeBusinessApi(db, {
      allowDemo: true,
      verifyAsset: async () => {},
      resolveAdmin: async () => admin,
    });
    await assert.rejects(invalid.publishBusiness('root', { establishmentId: 'uno', revision: 1 }), {
      code: 'failed-precondition',
    });
  }
});
test('pago real exige QR, titular y número; modo demo está prohibido fuera del emulador', async () => {
  const c = configuration();
  c.payment.mode = 'live';
  await save(c);
  await assert.rejects(api.publishBusiness('root', { establishmentId: 'uno', revision: 1 }), {
    code: 'failed-precondition',
  });
  c.payment = {
    mode: 'live',
    methods: ['Yape'],
    recipient: 'Titular ficticio',
    phone: '999000111',
    qr: 'business-media/uno/qr',
  };
  await save(c, 1);
  await api.publishBusiness('root', { establishmentId: 'uno', revision: 2 });
  assert.equal(
    (await db.doc('establishments/uno').get()).data().payment.qr,
    'business-media/uno/qr',
  );
  await db.doc('establishments/uno').update({ status: 'draft' });
  c.payment.mode = 'demo';
  await save(c, 2);
  const production = makeBusinessApi(db, {
    verifyAsset: async () => {},
    resolveAdmin: async () => ({ uid: 'a', emailVerified: true }),
  });
  await assert.rejects(
    production.publishBusiness('root', { establishmentId: 'uno', revision: 3 }),
    { code: 'failed-precondition' },
  );
});
test('catálogo excluye borradores y datos privados; rechaza consulta anónima', async () => {
  await save();
  assert.equal((await api.listPublishedBusinesses('cliente')).establishments.length, 0);
  await api.publishBusiness('root', { establishmentId: 'uno', revision: 1 });
  const local = (await api.listPublishedBusinesses('cliente')).establishments[0];
  assert.equal(local.courts.length, 2);
  assert.equal(local.reference, 'Referencia ficticia');
  assert.equal(local.adminEmail, undefined);
  assert.equal(local.configuration, undefined);
  assert.equal(local.payment, undefined);
  await assert.rejects(api.listPublishedBusinesses(null), { code: 'unauthenticated' });
});
test('no edita negocio publicado; cambiar responsable revoca solo la asignación anterior', async () => {
  await save();
  await api.publishBusiness('root', { establishmentId: 'uno', revision: 1 });
  await assert.rejects(save(configuration(), 1), { code: 'failed-precondition' });
  await db.doc('establishments/uno').update({ status: 'approved' });
  const c = configuration();
  c.adminEmail = 'nuevo@grassgo.test';
  c.courts = c.courts.slice(1);
  await save(c, 1);
  const next = makeBusinessApi(db, {
    allowDemo: true,
    verifyAsset: async () => {},
    resolveAdmin: async () => ({ uid: 'admin-b', emailVerified: true }),
  });
  await next.publishBusiness('root', { establishmentId: 'uno', revision: 2 });
  assert.equal((await db.doc('establishments/uno/members/admin-a').get()).exists, false);
  assert.equal((await db.doc('establishments/uno/members/admin-b').get()).data().role, 'admin');
  assert.equal((await db.doc('establishments/uno/courts/futbol').get()).data().status, 'inactive');
});
test('configurar un local anterior conserva los identificadores de sus canchas existentes', async () => {
  await db.doc('establishments/uno/courts/principal').set({
    name: 'Cancha existente',
    sport: 'Fútbol',
    status: 'active',
    dayPriceCents: 3000,
    nightPriceCents: 4000,
    nightStartsAt: 18,
  });
  const result = await api.getBusinessConfiguration('root', { establishmentId: 'uno' });
  assert.equal(result.legacyCourts[0].id, 'principal');
  assert.equal(result.legacyCourts[0].dayPriceCents, 3000);
});
test('no permite retirar una cancha con reservas vigentes al republicar', async () => {
  await save();
  await api.publishBusiness('root', { establishmentId: 'uno', revision: 1 });
  await booking.createReservation('cliente', {
    establishmentId: 'uno',
    courtId: 'futbol',
    date: '2030-01-20',
    hour: 19,
    requestId: 'conservar',
  });
  await db.doc('establishments/uno').update({ status: 'approved' });
  const c = configuration();
  c.courts = c.courts.slice(1);
  await save(c, 1);
  await assert.rejects(api.publishBusiness('root', { establishmentId: 'uno', revision: 2 }), {
    code: 'failed-precondition',
  });
  assert.equal((await db.doc('establishments/uno/courts/futbol').get()).data().status, 'active');
});
test('exige portada propia y no la reemplaza por la primera foto de una cancha', async () => {
  const config = configuration();
  delete config.images;
  const draft = await save(config);
  assert.deepEqual(draft.configuration.images, []);
  await assert.rejects(api.publishBusiness('root', { establishmentId: 'uno', revision: 1 }), {
    code: 'failed-precondition',
    message: /portada del establecimiento/,
  });
  config.images = ['business-media/uno/portada'];
  await save(config, 1);
  await api.publishBusiness('root', { establishmentId: 'uno', revision: 2 });
  const local = (await api.listPublishedBusinesses('cliente')).establishments[0];
  assert.deepEqual(local.images, ['business-media/uno/portada']);
  assert.deepEqual(local.courts[0].images, ['business-media/uno/foto-1']);
  assert.equal(local.openHour, 8);
  assert.equal(local.closeHour, 24);
});
test('galería del establecimiento valida pertenencia, cantidad y archivo antes de guardar', async () => {
  for (const images of [
    ['business-media/otro/portada'],
    ['https://externo/portada'],
    Array.from({ length: 6 }, (_, i) => `business-media/uno/foto-${i}`),
  ]) {
    const config = configuration();
    config.images = images;
    await assert.rejects(save(config), { code: 'invalid-argument' });
  }
  const config = configuration();
  config.images = ['business-media/uno/corrupta'];
  await assert.rejects(save(config));
  assert.equal((await db.doc('establishments/uno').get()).data().configuration, undefined);
});
