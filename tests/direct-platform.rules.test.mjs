import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

let environment;
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-grassgo-platform-direct-rules-tests',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => {
  await environment?.cleanup();
});
const dbFor = (uid) =>
  uid
    ? environment.authenticatedContext(uid).firestore()
    : environment.unauthenticatedContext().firestore();
const policy = { enabled: true, advanceCents: 1000, holdMinutes: 15 };
const payment = {
  mode: 'live',
  methods: ['Yape'],
  phone: '999111222',
  recipient: 'Titular',
  qr: 'payment-qrs/a/version',
};
const booking = { enabled: true, engine: 'direct', payment };
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'platform_roles/root'), { role: 'superadmin', status: 'active' }),
      setDoc(doc(db, 'platform_roles/suspended-root'), { role: 'superadmin', status: 'suspended' }),
      setDoc(doc(db, 'establishments/a'), {
        name: 'Grass A',
        status: 'published',
        bookingEngine: 'direct',
        bookingPolicy: policy,
        managedAdminUid: 'owner',
        createdAt: Timestamp.fromMillis(1),
      }),
      setDoc(doc(db, 'establishments/b'), {
        name: 'Grass B',
        status: 'draft',
        bookingPolicy: { enabled: false },
      }),
      setDoc(doc(db, 'establishments/no-catalog'), { name: 'Negocio sin ficha', status: 'draft' }),
      setDoc(doc(db, 'establishments/a/members/owner'), { role: 'admin', status: 'active' }),
      setDoc(doc(db, 'establishments/a/courts/principal'), {
        name: 'Principal',
        status: 'active',
        dayPriceCents: 3000,
      }),
      setDoc(doc(db, 'establishments/a/settings/schedule'), {
        days: [1],
        openHour: 8,
        closeHour: 22,
        revision: 1,
      }),
      setDoc(doc(db, 'establishments/a/settings/payment'), { ...payment, revision: 1 }),
      setDoc(doc(db, 'catalog/a'), {
        name: 'Grass A',
        status: 'published',
        booking,
        courts: [{ id: 'principal', dayPriceCents: 3000 }],
      }),
      setDoc(doc(db, 'catalog/b'), { name: 'Grass B', status: 'draft' }),
      setDoc(doc(db, 'audit_logs/old-event'), {
        action: 'establishment_created',
        establishmentId: 'a',
        actorUid: 'root',
        at: Timestamp.fromMillis(1),
      }),
      setDoc(doc(db, 'profiles/alice'), {
        uid: 'alice',
        displayName: 'Cliente',
        phone: '999888777',
      }),
      setDoc(doc(db, 'direct_requests/private-booking'), {
        clientUid: 'alice',
        establishmentId: 'a',
        status: 'confirmed',
      }),
      setDoc(doc(db, 'direct_proofs/private-booking'), {
        clientUid: 'alice',
        establishmentId: 'a',
        imageData: 'privada',
      }),
    ]);
  });
});

function statusBatch(
  db,
  {
    venueId = 'a',
    status = 'suspended',
    previousStatus = 'published',
    changeId = randomUUID(),
    hasCatalog = true,
    omit = [],
    privatePatch = {},
    catalogPatch = {},
    auditPatch = {},
  } = {},
) {
  const batch = writeBatch(db);
  const metadata = {
    platformStatusChangeId: changeId,
    platformStatusUpdatedAt: serverTimestamp(),
    platformStatusUpdatedBy: 'root',
  };
  if (!omit.includes('private'))
    batch.update(doc(db, 'establishments', venueId), {
      status,
      'bookingPolicy.enabled': false,
      ...metadata,
      ...privatePatch,
    });
  if (hasCatalog && !omit.includes('catalog'))
    batch.update(doc(db, 'catalog', venueId), {
      status: status === 'suspended' ? 'suspended' : 'draft',
      'booking.enabled': false,
      ...metadata,
      ...catalogPatch,
    });
  if (!omit.includes('audit'))
    batch.set(doc(db, 'audit_logs', changeId), {
      action: 'establishment_status_changed',
      establishmentId: venueId,
      actorUid: 'root',
      at: serverTimestamp(),
      status,
      previousStatus,
      publicationStatus: hasCatalog ? (status === 'suspended' ? 'suspended' : 'draft') : 'missing',
      ...auditPatch,
    });
  return { commit: () => batch.commit(), changeId };
}

test('superadmin activo consulta negocios reales, canchas, ajustes y catálogo incluso ausente', async () => {
  const db = dbFor('root');
  assert.equal(
    (await assertSucceeds(getDocs(query(collection(db, 'establishments'), limit(100))))).size,
    3,
  );
  assert.equal(
    (await assertSucceeds(getCountFromServer(collection(db, 'establishments')))).data().count,
    3,
  );
  assert.equal(
    (
      await assertSucceeds(
        getCountFromServer(query(collection(db, 'establishments'), where('status', '==', 'draft'))),
      )
    ).data().count,
    2,
  );
  for (const path of [
    'establishments/a/courts/principal',
    'establishments/a/settings/payment',
    'establishments/a/settings/schedule',
    'catalog/a',
    'catalog/b',
    'catalog/no-catalog',
  ])
    await assertSucceeds(getDoc(doc(db, path)));
});

test('listener global de catálogo exige superadmin y límite explícito de cien', async () => {
  const db = dbFor('root');
  assert.equal((await assertSucceeds(getDocs(query(collection(db, 'catalog'), limit(100))))).size, 2);
  await assertFails(getDocs(query(collection(db, 'catalog'), limit(101))));
  await assertFails(getDocs(collection(db, 'catalog')));
  for (const uid of ['alice', 'owner', 'suspended-root', null])
    await assertFails(getDocs(query(collection(dbFor(uid), 'catalog'), limit(100))));
});

test('cliente, dueño, superadmin suspendido y visitante no listan todos los negocios', async () => {
  for (const uid of ['alice', 'owner', 'suspended-root', null]) {
    const db = dbFor(uid);
    await assertFails(getDocs(query(collection(db, 'establishments'), limit(100))));
    await assertFails(getCountFromServer(collection(db, 'establishments')));
    await assertFails(getDoc(doc(db, 'catalog/b')));
  }
});

test('actividad global solo permite superadmin y consulta acotada hasta treinta', async () => {
  const activity = (db, count) =>
    query(collection(db, 'audit_logs'), orderBy('at', 'desc'), limit(count));
  await assertSucceeds(getDocs(activity(dbFor('root'), 30)));
  await assertFails(getDocs(activity(dbFor('root'), 31)));
  await assertFails(getDocs(collection(dbFor('root'), 'audit_logs')));
  for (const uid of ['alice', 'owner', 'suspended-root', null]) {
    await assertFails(getDocs(activity(dbFor(uid), 30)));
    await assertFails(getDoc(doc(dbFor(uid), 'audit_logs/old-event')));
  }
});

test('el permiso global no abre perfiles de clientes, reservas ni imágenes privadas', async () => {
  const db = dbFor('root');
  for (const path of [
    'profiles/alice',
    'direct_requests/private-booking',
    'direct_proofs/private-booking',
  ])
    await assertFails(getDoc(doc(db, path)));
  await assertFails(getDocs(collection(db, 'profiles')));
  await assertFails(getDocs(collection(db, 'direct_requests')));
});

test('una misma cuenta con dueño y superadmin conserva la edición de horarios, QR y precios de su local', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'establishments/a/members/root'), {
      role: 'admin',
      status: 'active',
    });
    await setDoc(doc(context.firestore(), 'catalog/a/courts/principal'), {
      name: 'Principal',
      status: 'active',
      dayPriceCents: 3000,
    });
  });
  const db = dbFor('root');
  const previous = (await getDoc(doc(db, 'establishments/a/settings/schedule'))).data();
  const current = {
    establishmentId: 'a',
    days: [0, 1, 2, 3, 4, 5, 6],
    openHour: 9,
    closeHour: 23,
    revision: 2,
    updatedAt: serverTimestamp(),
    updatedBy: 'root',
  };
  const scheduleBatch = writeBatch(db);
  scheduleBatch.set(doc(db, 'establishments/a/settings/schedule'), current);
  scheduleBatch.update(doc(db, 'catalog/a'), {
    days: current.days,
    openHour: 9,
    closeHour: 23,
    scheduleRevision: 2,
    scheduleUpdatedAt: serverTimestamp(),
  });
  scheduleBatch.set(doc(db, 'establishments/a/settings/schedule/history/2'), {
    establishmentId: 'a',
    kind: 'schedule',
    revision: 2,
    actorUid: 'root',
    at: serverTimestamp(),
    before: previous,
    after: current,
  });
  await assertSucceeds(scheduleBatch.commit());
  assert.equal((await getDoc(doc(db, 'catalog/a'))).data().status, 'published');
  assert.equal((await getDoc(doc(db, 'catalog/a'))).data().booking.enabled, true);

  const oldPayment = (await getDoc(doc(db, 'establishments/a/settings/payment'))).data();
  const newPayment = {
    establishmentId: 'a',
    mode: 'live',
    qr: 'payment-qrs/a/new-qr',
    methods: ['Yape', 'Plin'],
    phone: '999888777',
    recipient: 'Titular actualizado',
    revision: 2,
    updatedAt: serverTimestamp(),
    updatedBy: 'root',
  };
  const paymentBatch = writeBatch(db);
  paymentBatch.set(doc(db, 'establishments/a/settings/payment'), newPayment);
  paymentBatch.set(doc(db, 'catalog/a/paymentQrs/new-qr'), {
    establishmentId: 'a',
    id: 'new-qr',
    imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(100),
    contentType: 'image/jpeg',
    width: 800,
    height: 800,
    sha256: 'a'.repeat(64),
    createdAt: serverTimestamp(),
  });
  paymentBatch.update(doc(db, 'catalog/a'), {
    'booking.payment': {
      mode: 'live',
      qr: newPayment.qr,
      methods: newPayment.methods,
      phone: newPayment.phone,
      recipient: newPayment.recipient,
    },
    paymentRevision: 2,
    paymentUpdatedAt: serverTimestamp(),
  });
  paymentBatch.set(doc(db, 'establishments/a/settings/payment/history/2'), {
    establishmentId: 'a',
    kind: 'payment',
    revision: 2,
    actorUid: 'root',
    at: serverTimestamp(),
    before: oldPayment,
    after: newPayment,
  });
  await assertSucceeds(paymentBatch.commit());
  assert.equal((await getDoc(doc(db, 'catalog/a'))).data().booking.payment.phone, '999888777');
  assert.equal((await getDoc(doc(db, 'catalog/a'))).data().booking.enabled, true);

  const currentPricing = {
    establishmentId: 'a',
    courtId: 'principal',
    dayPriceCents: 3500,
    nightPriceCents: 4500,
    nightStartsAt: 18,
    revision: 1,
    updatedAt: serverTimestamp(),
    updatedBy: 'root',
  };
  const pricingBatch = writeBatch(db);
  pricingBatch.set(doc(db, 'establishments/a/courts/principal/settings/pricing'), currentPricing);
  for (const prefix of ['establishments', 'catalog'])
    pricingBatch.update(doc(db, `${prefix}/a/courts/principal`), {
      dayPriceCents: 3500,
      nightPriceCents: 4500,
      nightStartsAt: 18,
      pricingRevision: 1,
      pricingUpdatedAt: serverTimestamp(),
    });
  pricingBatch.update(doc(db, 'catalog/a'), {
    courts: [{ id: 'principal', dayPriceCents: 3500, nightPriceCents: 4500, nightStartsAt: 18 }],
    pricingCourtId: 'principal',
    pricingCourtIndex: 0,
    pricingRevision: 1,
    pricingUpdatedAt: serverTimestamp(),
  });
  pricingBatch.set(doc(db, 'establishments/a/courts/principal/settings/pricing/history/1'), {
    establishmentId: 'a',
    kind: 'pricing',
    revision: 1,
    actorUid: 'root',
    at: serverTimestamp(),
    before: null,
    after: currentPricing,
  });
  await assertSucceeds(pricingBatch.commit());
  assert.equal((await getDoc(doc(db, 'catalog/a'))).data().courts[0].dayPriceCents, 3500);
  assert.equal((await getDoc(doc(db, 'catalog/a'))).data().booking.payment.phone, '999888777');
});

test('suspender sincroniza las dos fichas, deshabilita reservas y audita conservando todo lo demás', async () => {
  const db = dbFor('root');
  const before = (await getDoc(doc(db, 'establishments/a'))).data();
  const originalCatalog = (await getDoc(doc(db, 'catalog/a'))).data();
  const change = statusBatch(db);
  await assertSucceeds(change.commit());
  const venue = (await getDoc(doc(db, 'establishments/a'))).data();
  const catalog = (await getDoc(doc(db, 'catalog/a'))).data();
  assert.equal(venue.status, 'suspended');
  assert.equal(catalog.status, 'suspended');
  assert.deepEqual(venue.bookingPolicy, { ...policy, enabled: false });
  assert.deepEqual(catalog.booking, { ...booking, enabled: false });
  assert.equal(venue.managedAdminUid, before.managedAdminUid);
  assert.deepEqual(venue.createdAt, before.createdAt);
  assert.deepEqual(catalog.courts, originalCatalog.courts);
  assert.equal(venue.platformStatusChangeId, change.changeId);
  assert.equal(catalog.platformStatusChangeId, change.changeId);
  assert.equal(
    venue.platformStatusUpdatedAt.toMillis(),
    catalog.platformStatusUpdatedAt.toMillis(),
  );
  const event = (await getDoc(doc(db, 'audit_logs', change.changeId))).data();
  assert.equal(event.actorUid, 'root');
  assert.equal(event.previousStatus, 'published');
  assert.equal(event.publicationStatus, 'suspended');
  await assertFails(getDoc(doc(dbFor('alice'), 'catalog/a')));
});

test('aprobar un suspendido deja borrador público y reservas deshabilitadas', async () => {
  const db = dbFor('root');
  await statusBatch(db).commit();
  await assertSucceeds(
    statusBatch(db, { status: 'approved', previousStatus: 'suspended' }).commit(),
  );
  assert.equal((await getDoc(doc(db, 'establishments/a'))).data().status, 'approved');
  assert.equal((await getDoc(doc(db, 'catalog/a'))).data().status, 'draft');
  assert.equal((await getDoc(doc(db, 'catalog/a'))).data().booking.enabled, false);
  assert.equal((await getDoc(doc(db, 'establishments/a'))).data().bookingPolicy.enabled, false);
});

test('aprobar local sin catálogo guarda solo estado y auditoría sin inventar ficha ni política', async () => {
  const db = dbFor('root');
  await assertSucceeds(
    statusBatch(db, {
      venueId: 'no-catalog',
      status: 'approved',
      previousStatus: 'draft',
      hasCatalog: false,
    }).commit(),
  );
  assert.equal((await getDoc(doc(db, 'catalog/no-catalog'))).exists(), false);
  assert.deepEqual((await getDoc(doc(db, 'establishments/no-catalog'))).data().bookingPolicy, {
    enabled: false,
  });
});

test('ningún rol inferior puede cambiar el estado aunque copie el commit completo', async () => {
  for (const uid of ['alice', 'owner', 'suspended-root', null])
    await assertFails(statusBatch(dbFor(uid)).commit());
});

test('privado, catálogo y auditoría no pueden escribirse por separado', async () => {
  for (const omit of [
    ['audit'],
    ['catalog'],
    ['private'],
    ['private', 'catalog'],
    ['private', 'audit'],
    ['catalog', 'audit'],
  ])
    await assertFails(statusBatch(dbFor('root'), { omit }).commit());
});

test('auditoría no admite actor, negocio, origen, destino o publicación falsificados', async () => {
  for (const auditPatch of [
    { actorUid: 'owner' },
    { establishmentId: 'b' },
    { previousStatus: 'draft' },
    { status: 'approved' },
    { publicationStatus: 'draft' },
    { extra: 'inventado' },
    { at: Timestamp.fromMillis(1) },
    { action: 'payment_verified' },
  ])
    await assertFails(statusBatch(dbFor('root'), { auditPatch }).commit());
});

test('metadatos exigen identificador válido, mismo actor y reloj servidor', async () => {
  for (const privatePatch of [
    { platformStatusChangeId: '../otra-ruta' },
    { platformStatusChangeId: 'x'.repeat(10000) },
    { platformStatusUpdatedBy: 'owner' },
    { platformStatusUpdatedBy: 1 },
    { platformStatusUpdatedAt: Timestamp.fromMillis(1) },
    { platformStatusUpdatedAt: deleteField() },
  ])
    await assertFails(statusBatch(dbFor('root'), { privatePatch }).commit());
  for (const catalogPatch of [
    { platformStatusChangeId: randomUUID() },
    { platformStatusUpdatedBy: 'owner' },
    { platformStatusUpdatedAt: Timestamp.fromMillis(1) },
    { status: 'published' },
  ])
    await assertFails(statusBatch(dbFor('root'), { catalogPatch }).commit());
});

test('no permite activar reservas, borrar políticas ni modificar tarifas, titular o membresías', async () => {
  for (const privatePatch of [
    { 'bookingPolicy.enabled': true },
    { bookingPolicy: { enabled: false } },
    { 'bookingPolicy.advanceCents': 2000 },
    { 'bookingPolicy.enabled': 'false' },
    { bookingPolicy: deleteField() },
    { managedAdminUid: 'root' },
    { name: 'Otro nombre' },
    { createdAt: serverTimestamp() },
    { role: 'superadmin' },
    { status: 'published' },
  ])
    await assertFails(statusBatch(dbFor('root'), { privatePatch }).commit());
  for (const catalogPatch of [
    { 'booking.enabled': true },
    { booking: { enabled: false } },
    { 'booking.payment.phone': '999999999' },
    { courts: [] },
    { status: 'published' },
    { name: 'Cambio no autorizado' },
  ])
    await assertFails(statusBatch(dbFor('root'), { catalogPatch }).commit());
});

test('no se puede repetir una acción anterior, reescribir auditoría ni emitir cambio sin transición', async () => {
  const db = dbFor('root');
  const change = statusBatch(db);
  await change.commit();
  await assertFails(
    statusBatch(db, {
      status: 'approved',
      previousStatus: 'suspended',
      changeId: change.changeId,
    }).commit(),
  );
  await assertFails(statusBatch(db, { status: 'suspended', previousStatus: 'suspended' }).commit());
  await assertFails(updateDoc(doc(db, 'audit_logs', change.changeId), { status: 'approved' }));
  await assertFails(deleteDoc(doc(db, 'audit_logs', change.changeId)));
});

test('catálogo no existente no se puede crear durante una aprobación', async () => {
  const db = dbFor('root');
  const batch = writeBatch(db);
  batch.set(doc(db, 'catalog/no-catalog'), { status: 'draft', booking: { enabled: false } });
  await assertFails(batch.commit());
});

test('ni superadmin ni cliente pueden asignarse roles, cambiar membresías o fabricar pagos', async () => {
  for (const uid of ['root', 'alice']) {
    const db = dbFor(uid);
    for (const path of [
      'platform_roles/new-root',
      'establishments/b/members/new-root',
      'users/new-root/memberships/b',
    ])
      await assertFails(setDoc(doc(db, path), { role: 'superadmin', status: 'active' }));
    await assertFails(
      updateDoc(doc(db, 'direct_requests/private-booking'), { paymentStatus: 'verified' }),
    );
  }
});

test('subcolecciones huérfanas no abren perfiles ni permiten crear negocios por auditoría', async () => {
  const db = dbFor('root');
  await assertFails(
    setDoc(doc(db, 'audit_logs', randomUUID()), {
      action: 'establishment_status_changed',
      establishmentId: 'inexistente',
      actorUid: 'root',
      at: serverTimestamp(),
      status: 'approved',
      previousStatus: 'draft',
      publicationStatus: 'missing',
    }),
  );
  await assertFails(
    setDoc(doc(db, 'establishments/inexistente'), {
      status: 'approved',
      bookingPolicy: { enabled: false },
    }),
  );
});
