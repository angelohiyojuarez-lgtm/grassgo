import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, deleteField,
  collection, query, where, writeBatch, serverTimestamp, Timestamp,
} from 'firebase/firestore';

let env;
const dbFor = (uid) => env.authenticatedContext(uid).firestore();
const oldPayment = { mode: 'demo', qr: '', methods: ['Yape'], recipient: '', phone: '' };
const configPath = (kind, id = 'puma') => `establishments/${id}/settings/${kind}`;
const qrPath = (qrId, id = 'puma') => `catalog/${id}/paymentQrs/${qrId}`;
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const court = {
  name: 'Cancha principal', status: 'active', openHour: 8, closeHour: 24,
  dayPriceCents: 3000, nightPriceCents: 4000, nightStartsAt: 18,
  openDays: [], maintenance: false, runtime: null,
};

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-grassgo-business-settings-tests',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore(), b = writeBatch(db);
    for (const id of ['puma', 'other']) {
      b.set(doc(db, `establishments/${id}`), {
        status: 'published', bookingEngine: 'direct', bookingPolicy: { enabled: true },
      });
      b.set(doc(db, `establishments/${id}/courts/one`), court);
      b.set(doc(db, `catalog/${id}`), {
        status: 'published', name: id === 'puma' ? 'Grass El Puma' : 'Otro local',
        phone: '', description: '', reference: '', advanceCents: 1000,
        booking: { enabled: true, engine: 'direct', holdMinutes: 15, payment: oldPayment },
      });
      b.set(doc(db, `catalog/${id}/courts/one`), court);
    }
    b.set(doc(db, 'establishments/puma/members/admin'), { role: 'admin', status: 'active' });
    b.set(doc(db, 'establishments/puma/members/second-admin'), { role: 'admin', status: 'active' });
    b.set(doc(db, 'establishments/other/members/other-admin'), { role: 'admin', status: 'active' });
    b.set(doc(db, 'platform_roles/super'), { role: 'superadmin', status: 'active' });
    await b.commit();
  });
});

async function trustedRead(path) {
  let data = null;
  await env.withSecurityRulesDisabled(async (c) => {
    data = (await getDoc(doc(c.firestore(), path))).data() ?? null;
  });
  return data;
}
async function trustedUpdate(path, changes) {
  return env.withSecurityRulesDisabled(async (c) => updateDoc(doc(c.firestore(), path), changes));
}
function qrData(qrId = 'qr-one', id = 'puma') {
  return {
    establishmentId: id, id: qrId, imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(100),
    contentType: 'image/jpeg', width: 800, height: 800, sha256: 'a'.repeat(64),
    createdAt: serverTimestamp(),
  };
}
// Espejo, canónico e historia tienen exactamente el mismo contenido que el servicio.
// Las opciones permiten ensayar clientes que omiten o manipulan escrituras.
async function change(db, kind = 'contact', changes = {}, options = {}) {
  const { id = 'puma', actor = 'admin', qrId = 'qr-one' } = options;
  const path = configPath(kind, id);
  const previous = options.previous !== undefined ? options.previous : await trustedRead(path);
  const data = {
    ...(kind === 'contact'
      ? { phone: '987654321', description: 'Grass y quiosco.', reference: 'A una cuadra de la plaza.' }
      : { mode: 'live', qr: `payment-qrs/${id}/${qrId}`, methods: ['Yape', 'Plin'], recipient: 'Negocio DEMO', phone: '987654321' }),
    establishmentId: id, revision: (previous?.revision ?? 0) + 1,
    updatedAt: serverTimestamp(), updatedBy: actor, ...changes,
  };
  const event = {
    establishmentId: id, kind, revision: data.revision, actorUid: actor,
    at: serverTimestamp(), before: previous, after: data, ...options.historyExtra,
  };
  const projection = kind === 'contact'
    ? { phone: data.phone, description: data.description, reference: data.reference,
      contactRevision: data.revision, contactUpdatedAt: data.updatedAt }
    : { 'booking.payment': {
      mode: data.mode, qr: data.qr, methods: data.methods, recipient: data.recipient, phone: data.phone,
    }, paymentRevision: data.revision, paymentUpdatedAt: data.updatedAt };
  const batch = writeBatch(db);
  if (!options.omitPrivate) batch.set(doc(db, path), data);
  if (!options.omitPublic) batch.update(doc(db, `catalog/${id}`), { ...projection, ...options.publicExtra });
  if (!options.omitHistory) batch.set(doc(db, `${path}/history/${options.historyId ?? data.revision}`), event);
  if (kind === 'payment' && options.newQr !== false)
    batch.set(doc(db, qrPath(qrId, id)), { ...qrData(qrId, id), ...options.qrExtra });
  options.extraWrite?.(batch, db);
  return batch.commit();
}
const contact = (db, d = {}, options = {}) => change(db, 'contact', d, options);
const payment = (db, d = {}, options = {}) => change(db, 'payment', d, options);

function requestData(snapshot, hour = 14, uid = 'alice') {
  const date = tomorrow();
  const startsAt = Timestamp.fromDate(new Date(`${date}T${hour}:00:00-05:00`));
  return {
    clientUid: uid, establishmentId: 'puma', establishmentName: 'Grass El Puma',
    courtId: 'one', courtName: court.name, date, hour, startsAt,
    endsAt: Timestamp.fromMillis(startsAt.toMillis() + 3600000),
    totalCents: hour >= 18 ? 4000 : 3000, advanceCents: 1000,
    createdAt: serverTimestamp(), status: 'pending_payment', paymentStatus: 'unpaid',
    paymentSnapshot: snapshot,
  };
}
async function hold(db, id, data) {
  const limit = doc(db, `direct_limits/${data.clientUid}/days/${data.date}`);
  const previous = (await getDoc(limit)).data();
  const b = writeBatch(db);
  addHold(b, db, id, data, (previous?.count || 0) + 1);
  return b.commit();
}
function addHold(b, db, id, data, count = 1) {
  b.set(doc(db, `direct_requests/${id}`), data);
  b.set(doc(db, `direct_slots/puma/courts/one/days/${data.date}/hours/${data.hour}`), {
    reservationId: id, lockedAt: serverTimestamp(), status: 'held',
  });
  b.set(doc(db, `direct_limits/${data.clientUid}/days/${data.date}`), {
    count, lastRequestId: id, updatedAt: serverTimestamp(),
  });
}

test('contacto guarda canónico, proyección pública e historia privada atómicos', async () => {
  const db = dbFor('admin');
  await assertSucceeds(contact(db));
  const saved = await trustedRead(configPath('contact'));
  const event = (await getDoc(doc(db, `${configPath('contact')}/history/1`))).data();
  const publicData = (await getDoc(doc(dbFor('alice'), 'catalog/puma'))).data();
  assert.equal(publicData.phone, '987654321');
  assert.equal(publicData.description, saved.description);
  assert.equal(publicData.reference, saved.reference);
  assert.equal(publicData.contactRevision, 1);
  assert.deepEqual(publicData.booking.payment, oldPayment);
  assert.equal(publicData.updatedBy, undefined);
  assert.deepEqual(event.after, saved);
  assert.equal(event.before, null);
  await assertSucceeds(contact(db, { phone: '', description: '', reference: '' }));
  assert.deepEqual((await trustedRead(`${configPath('contact')}/history/2`)).before, saved);
});

test('pago crea QR separado y no altera habilitación, motor, tarifas ni adelanto', async () => {
  const db = dbFor('admin');
  await assertSucceeds(payment(db));
  const saved = await trustedRead(configPath('payment'));
  const publicData = (await getDoc(doc(dbFor('alice'), 'catalog/puma'))).data();
  assert.deepEqual(publicData.booking, {
    enabled: true, engine: 'direct', holdMinutes: 15,
    payment: { mode: 'live', qr: saved.qr, methods: saved.methods, recipient: saved.recipient, phone: saved.phone },
  });
  assert.equal(publicData.paymentRevision, 1);
  assert.equal(publicData.advanceCents, 1000);
  assert.equal(publicData.imageData, undefined);
  assert.equal(publicData.booking.payment.imageData, undefined);
  assert.equal((await getDoc(doc(dbFor('alice'), qrPath('qr-one')))).data().imageData, qrData().imageData);
  assert.deepEqual((await trustedRead(`${configPath('payment')}/history/1`)).after, saved);
});

test('editar datos reutiliza QR existente y cambiar foto conserva versiones anteriores', async () => {
  const db = dbFor('admin');
  await payment(db);
  const original = await trustedRead(qrPath('qr-one'));
  await assertSucceeds(payment(db, { recipient: 'Titular actualizado', methods: ['Plin'] }, { newQr: false }));
  await assertSucceeds(payment(db, {}, { qrId: 'qr-two', qrExtra: { sha256: 'b'.repeat(64) } }));
  assert.deepEqual(await trustedRead(qrPath('qr-one')), original);
  await assertSucceeds(getDoc(doc(dbFor('alice'), qrPath('qr-one'))));
  await assertSucceeds(getDoc(doc(dbFor('alice'), qrPath('qr-two'))));
  assert.equal((await trustedRead(configPath('payment'))).revision, 3);
  assert.equal((await trustedRead(`${configPath('payment')}/history/3`)).before.recipient, 'Titular actualizado');
});

test('dueño carga su borrador, conserva listado filtrado y pago inicial no activa reservas', async () => {
  await trustedUpdate('catalog/puma', { status: 'draft', booking: deleteField() });
  const admin = dbFor('admin');
  await assertSucceeds(getDoc(doc(admin, 'catalog/puma')));
  await assertFails(getDoc(doc(dbFor('alice'), 'catalog/puma')));
  await assertFails(getDoc(doc(dbFor('other-admin'), 'catalog/puma')));
  await assertFails(getDocs(collection(admin, 'catalog')));
  await assertSucceeds(getDocs(query(collection(admin, 'catalog'), where('status', '==', 'published'))));
  await assertSucceeds(payment(admin));
  const published = await trustedRead('catalog/puma');
  assert.equal(published.status, 'draft');
  assert.deepEqual(Object.keys(published.booking), ['payment']);
  assert.equal(published.booking.enabled, undefined);
  await assertSucceeds(getDoc(doc(admin, qrPath('qr-one'))));
  await assertSucceeds(getDoc(doc(admin, qrPath('not-yet-created'))));
  await assertSucceeds(getDoc(doc(dbFor('super'), qrPath('qr-one'))));
  await assertFails(getDoc(doc(dbFor('alice'), qrPath('qr-one'))));
  await assertFails(getDocs(collection(admin, 'catalog/puma/paymentQrs')));
});

test('cliente, anónimo, administrador ajeno y superadmin sin membresía no editan', async () => {
  for (const actor of ['alice', 'other-admin', 'super']) {
    await assertFails(contact(dbFor(actor), {}, { actor }));
    await assertFails(payment(dbFor(actor), {}, { actor }));
  }
  const anonymous = env.unauthenticatedContext().firestore();
  await assertFails(contact(anonymous));
  await assertFails(payment(anonymous));
  await assertSucceeds(contact(dbFor('other-admin'), {}, { id: 'other', actor: 'other-admin' }));
  await assertSucceeds(payment(dbFor('other-admin'), {}, { id: 'other', actor: 'other-admin' }));
});

test('suspensión, miembro revocado y local sin motor directo revocan edición', async () => {
  await trustedUpdate('establishments/puma', { status: 'suspended' });
  await assertFails(contact(dbFor('admin')));
  await assertFails(payment(dbFor('admin')));
  await trustedUpdate('establishments/puma', { status: 'published' });
  await trustedUpdate('establishments/puma/members/admin', { status: 'suspended' });
  await assertFails(contact(dbFor('admin')));
  await assertFails(payment(dbFor('admin')));
  await trustedUpdate('establishments/puma/members/admin', { status: 'active' });
  await trustedUpdate('establishments/puma', { bookingEngine: 'legacy' });
  await assertFails(contact(dbFor('admin')));
  await assertFails(payment(dbFor('admin')));
});

test('configuración e historia privadas; QR publicado requiere sesión y conserva pertenencia', async () => {
  const admin = dbFor('admin');
  await contact(admin);
  await payment(admin);
  const paths = [configPath('contact'), configPath('payment'),
    `${configPath('contact')}/history/1`, `${configPath('payment')}/history/1`];
  for (const path of paths) {
    await assertSucceeds(getDoc(doc(admin, path)));
    await assertSucceeds(getDoc(doc(dbFor('super'), path)));
    for (const db of [dbFor('alice'), dbFor('other-admin'), env.unauthenticatedContext().firestore()])
      await assertFails(getDoc(doc(db, path)));
  }
  await assertSucceeds(getDoc(doc(dbFor('alice'), qrPath('qr-one'))));
  for (const uid of ['alice', 'admin', 'super'])
    await assertFails(getDocs(collection(dbFor(uid), 'catalog/puma/paymentQrs')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), qrPath('qr-one'))));
  await assertSucceeds(getDoc(doc(dbFor('other-admin'), configPath('contact', 'other'))));
  await assertSucceeds(getDoc(doc(dbFor('other-admin'), configPath('payment', 'other'))));
  await env.withSecurityRulesDisabled(async (c) => deleteDoc(doc(c.firestore(), 'establishments/puma')));
  await assertFails(getDoc(doc(admin, configPath('payment'))));
  await assertFails(contact(admin));
  await assertFails(payment(admin, {}, { qrId: 'orphan' }));
});

test('contacto y pago no admiten escrituras separadas ni proyección/historia falsificadas', async () => {
  for (const fn of [contact, payment]) {
    for (const options of [
      { omitPrivate: true }, { omitPublic: true }, { omitHistory: true },
      { historyExtra: { before: {} } }, { historyExtra: { after: {} } },
      { historyExtra: { actorUid: 'other-admin' } }, { historyExtra: { at: Timestamp.fromMillis(1) } },
      { historyExtra: { extra: true } }, { historyExtra: { kind: 'schedule' } }, { historyId: '01' },
    ]) await assertFails(fn(dbFor('admin'), {}, options));
  }
  await assertFails(contact(dbFor('admin'), {}, { publicExtra: { phone: '123456789' } }));
  await assertFails(payment(dbFor('admin'), {}, { publicExtra: { 'booking.payment.recipient': 'Otro titular' } }));
  assert.equal(await trustedRead(qrPath('qr-one')), null);
});

test('contacto valida tamaños, tipos, campos requeridos, reloj y autor en create/update', async () => {
  const invalid = [
    { phone: 123456789 }, { phone: 'javascript:alert(1)' }, { phone: '1'.repeat(21) },
    { description: false }, { description: 'x'.repeat(1001) },
    { reference: [] }, { reference: 'x'.repeat(301) },
    { establishmentId: 'other' }, { updatedBy: 'other-admin' }, { updatedAt: Timestamp.fromMillis(1) },
    { role: 'superadmin' }, { revision: 0 }, { revision: 2 }, { revision: 1.5 },
  ];
  for (const data of invalid) await assertFails(contact(dbFor('admin'), data));
  await contact(dbFor('admin'));
  for (const data of invalid.filter((d) => !('revision' in d)))
    await assertFails(contact(dbFor('admin'), data));
  for (const field of ['phone', 'reference', 'description'])
    await assertFails(updateDoc(doc(dbFor('admin'), configPath('contact')), { [field]: deleteField() }));
});

test('pago valida métodos únicos, titular, celular, rutas y esquema en create/update', async () => {
  const invalid = [
    { mode: 'demo' }, { methods: [] }, { methods: ['Yape', 'Yape'] }, { methods: ['Tarjeta'] },
    { methods: ['Yape', 'Plin', 'Yape'] }, { methods: ['Yape', 1] }, { methods: 'Yape' },
    { recipient: ' ' }, { recipient: 'x' }, { recipient: 'x'.repeat(101) }, { recipient: 99 },
    { phone: '1234567' }, { phone: '1'.repeat(21) }, { phone: 'tel:123456789' }, { phone: false },
    { qr: 'payment-qrs/other/qr-one' }, { qr: '../other/qr-one' },
    { qr: 'https://evil.test/qr.jpg' }, { qr: 'payment-qrs/puma/qr-one/more' }, { qr: 33 },
    { establishmentId: 'other' }, { updatedBy: 'other-admin' }, { updatedAt: Timestamp.fromMillis(1) },
    { enabled: true }, { revision: 0 }, { revision: 2 }, { revision: 1.5 },
  ];
  for (const data of invalid) await assertFails(payment(dbFor('admin'), data));
  await payment(dbFor('admin'));
  for (const data of invalid.filter((d) => !('revision' in d)))
    await assertFails(payment(dbFor('admin'), data, { newQr: false }));
});

test('QR exige formato, tamaños, dimensiones, hash, autoría tenant e inmutabilidad', async () => {
  const invalid = [
    { establishmentId: 'other' }, { id: 'other' }, { contentType: 'image/svg+xml' },
    { imageData: 'data:image/svg+xml;base64,AAA' }, { imageData: 'https://evil.test/qr.jpg' },
    { imageData: 'data:image/jpeg;base64,/9j/' },
    { imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(420001) },
    { imageData: 'data:image/jpeg;base64,/9j/%%%malformed' },
    { width: 63 }, { width: 1601 }, { height: 0 }, { height: '800' }, { width: 800.5 },
    { sha256: 'b'.repeat(63) }, { sha256: 'z'.repeat(64) },
    { createdAt: Timestamp.fromMillis(1) }, { createdBy: 'other-admin' },
  ];
  for (const qrExtra of invalid) await assertFails(payment(dbFor('admin'), {}, { qrExtra }));
  await assertFails(payment(dbFor('admin'), {}, { newQr: false }));
  await assertFails(setDoc(doc(dbFor('admin'), qrPath('qr-one')), qrData()));
  await payment(dbFor('admin'));
  await assertFails(updateDoc(doc(dbFor('admin'), qrPath('qr-one')), { imageData: qrData().imageData }));
  await assertFails(deleteDoc(doc(dbFor('admin'), qrPath('qr-one'))));
  await assertFails(setDoc(doc(dbFor('admin'), qrPath('standalone')), qrData('standalone')));
});

test('catálogo protege publicación, roles, precios y otros campos de booking', async () => {
  for (const fn of [contact, payment]) {
    for (const publicExtra of [
      { status: 'draft' }, { name: 'Local falsificado' }, { role: 'superadmin' },
      { advanceCents: 1 }, { dayPriceCents: 1 }, { images: [] },
      { 'booking.enabled': false }, { 'booking.engine': 'legacy' }, { 'booking.holdMinutes': 1 },
      { 'booking.someOtherSetting': true },
    ]) await assertFails(fn(dbFor('admin'), {}, { publicExtra }));
  }
  await assertFails(updateDoc(doc(dbFor('admin'), 'catalog/puma'), { phone: '987654321' }));
  await assertFails(updateDoc(doc(dbFor('admin'), 'catalog/puma'), { 'booking.payment': oldPayment }));
  await assertFails(updateDoc(doc(dbFor('admin'), 'establishments/puma'), { bookingPolicy: { enabled: true } }));
  await assertFails(payment(dbFor('admin'), {}, { extraWrite: (b, db) => {
    b.update(doc(db, 'catalog/puma/courts/one'), { dayPriceCents: 1 });
  } }));
});

test('historia no se edita/borra y una versión antigua no sobrescribe cambios recientes', async () => {
  const db = dbFor('admin');
  for (const [kind, fn] of [['contact', contact], ['payment', payment]]) {
    await fn(db);
    const previous = await trustedRead(configPath(kind));
    await fn(db, kind === 'contact' ? { reference: 'Referencia nueva' } : { recipient: 'Nuevo titular' }, { newQr: false });
    await assertFails(fn(db, {}, { previous, newQr: false }));
    await assertFails(updateDoc(doc(db, `${configPath(kind)}/history/1`), { actorUid: 'other-admin' }));
    await assertFails(deleteDoc(doc(db, `${configPath(kind)}/history/1`)));
    await assertFails(deleteDoc(doc(db, configPath(kind))));
    const event = await trustedRead(`${configPath(kind)}/history/2`);
    assert.deepEqual(event.before, previous);
  }
});

test('dos administradores con la misma revisión: solo uno confirma, sin QR huérfano', async () => {
  const results = await Promise.allSettled([
    payment(dbFor('admin'), {}, { previous: null, qrId: 'first' }),
    payment(dbFor('second-admin'), {}, { previous: null, qrId: 'second', actor: 'second-admin' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  const saved = await trustedRead(configPath('payment'));
  const winner = saved.qr.split('/')[2];
  assert.ok(await trustedRead(qrPath(winner)));
  assert.equal(await trustedRead(qrPath(winner === 'first' ? 'second' : 'first')), null);
  assert.equal(saved.revision, 1);
});

test('nuevas solicitudes usan datos actuales y las existentes conservan QR y revisión manual', async () => {
  const admin = dbFor('admin'), alice = dbFor('alice');
  await payment(admin);
  const initialPayment = (await trustedRead('catalog/puma')).booking.payment;
  const initialRequest = requestData(initialPayment);
  await assertSucceeds(hold(alice, 'old-request', initialRequest));
  await payment(admin, { recipient: 'Segundo titular', phone: '912345678', methods: ['Plin'] }, { qrId: 'qr-two' });
  assert.deepEqual((await getDoc(doc(alice, 'direct_requests/old-request'))).data().paymentSnapshot, initialPayment);
  await assertSucceeds(getDoc(doc(alice, qrPath('qr-one'))));
  await assertFails(hold(alice, 'stale-request', requestData(initialPayment, 15)));
  const latestPayment = (await trustedRead('catalog/puma')).booking.payment;
  await assertSucceeds(hold(alice, 'new-request', requestData(latestPayment, 15)));
  const proof = writeBatch(alice);
  proof.set(doc(alice, 'direct_proofs/old-request'), {
    reservationId: 'old-request', clientUid: 'alice', establishmentId: 'puma',
    contentType: 'image/jpeg', imageData: qrData().imageData, sha256: 'a'.repeat(64), createdAt: serverTimestamp(),
  });
  proof.update(doc(alice, 'direct_requests/old-request'), {
    status: 'pending_verification', paymentStatus: 'submitted', proofSubmittedAt: serverTimestamp(),
  });
  await assertSucceeds(proof.commit());
  assert.equal((await getDoc(doc(alice, 'direct_requests/old-request'))).data().paymentStatus, 'submitted');
  const confirm = writeBatch(admin);
  confirm.update(doc(admin, 'direct_requests/old-request'), {
    status: 'confirmed', paymentStatus: 'verified', reviewedAt: serverTimestamp(),
    reviewedBy: 'admin', verifiedAdvanceCents: 1000,
  });
  confirm.update(doc(admin, `direct_slots/puma/courts/one/days/${initialRequest.date}/hours/14`), { status: 'confirmed' });
  confirm.set(doc(admin, 'establishments/puma/court_income/old-request'), {
    reservationId: 'old-request', courtId: initialRequest.courtId, courtName: initialRequest.courtName,
    date: initialRequest.date, hour: initialRequest.hour, totalCents: initialRequest.totalCents,
    advanceCents: initialRequest.advanceCents, advanceAt: serverTimestamp(), advanceBy: 'admin',
    balanceCents: 0, balanceAt: null, balanceBy: null, balanceMethod: null,
  });
  await assertSucceeds(confirm.commit());
  const final = (await getDoc(doc(alice, 'direct_requests/old-request'))).data();
  assert.equal(final.status, 'confirmed');
  assert.deepEqual(final.paymentSnapshot, initialPayment);
});

test('cambio de pago y reserva en un mismo batch exigen el snapshot posterior', async () => {
  const admin = dbFor('admin');
  await assertFails(payment(admin, {}, {
    extraWrite: (b, db) => addHold(b, db, 'old-in-same-batch', requestData(oldPayment, 14, 'admin')),
  }));
  assert.equal(await trustedRead(qrPath('qr-one')), null);
  const nextPayment = {
    mode: 'live', qr: 'payment-qrs/puma/qr-one', methods: ['Yape', 'Plin'],
    recipient: 'Negocio DEMO', phone: '987654321',
  };
  await assertSucceeds(payment(admin, {}, {
    extraWrite: (b, db) => addHold(b, db, 'new-in-same-batch', requestData(nextPayment, 14, 'admin')),
  }));
  const saved = (await getDoc(doc(admin, 'direct_requests/new-in-same-batch'))).data();
  assert.deepEqual(saved.paymentSnapshot, nextPayment);
});
