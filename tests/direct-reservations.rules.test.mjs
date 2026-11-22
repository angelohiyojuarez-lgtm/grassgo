import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  Timestamp,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  deleteField,
} from 'firebase/firestore';

let env;
const payment = {
  mode: 'demo',
  qr: '',
  methods: ['Yape', 'Plin'],
  recipient: '',
  phone: '',
};
const court = {
  name: 'Cancha principal',
  status: 'active',
  openHour: 8,
  closeHour: 24,
  dayPriceCents: 3000,
  nightPriceCents: 4000,
  nightStartsAt: 18,
  openDays: [],
  maintenance: false,
  runtime: null,
};
const identities = new WeakMap();
const dbFor = (uid) => {
  const db = env.authenticatedContext(uid).firestore();
  identities.set(db, uid);
  return db;
};
const requestRef = (db, id) => doc(db, `direct_requests/${id}`);
const proofRef = (db, id) => doc(db, `direct_proofs/${id}`);
const lockRef = (db, d = data()) => doc(db, path(d));
const limitRef = (db, d = data(), uid = identities.get(db) || d.clientUid) =>
  doc(db, `direct_limits/${uid}/days/${d.date}`);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-grassgo-direct-tests',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const id of ['puma', 'other']) {
      await setDoc(doc(db, `establishments/${id}`), {
        status: 'published',
        bookingEngine: 'direct',
        bookingPolicy: { enabled: true },
      });
      await setDoc(doc(db, `establishments/${id}/courts/one`), court);
      await setDoc(doc(db, `catalog/${id}`), {
        status: 'published',
        name: id === 'puma' ? 'Grass El Puma' : 'Otro local',
        booking: { enabled: true, engine: 'direct', holdMinutes: 15, payment },
      });
      await setDoc(doc(db, `catalog/${id}/courts/one`), court);
    }
    await setDoc(doc(db, 'establishments/puma/members/admin'), {
      role: 'admin',
      status: 'active',
    });
    await setDoc(doc(db, 'establishments/other/members/other-admin'), {
      role: 'admin',
      status: 'active',
    });
  });
});

function data(uid = 'alice') {
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const startsAt = Timestamp.fromDate(new Date(`${date}T14:00:00-05:00`));
  return {
    clientUid: uid,
    establishmentId: 'puma',
    establishmentName: 'Grass El Puma',
    courtId: 'one',
    courtName: court.name,
    date,
    hour: 14,
    startsAt,
    endsAt: Timestamp.fromMillis(startsAt.toMillis() + 3600000),
    totalCents: 3000,
    advanceCents: 1000,
    createdAt: serverTimestamp(),
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    paymentSnapshot: payment,
  };
}
function path(d) {
  return `direct_slots/${d.establishmentId}/courts/${d.courtId}/days/${d.date}/hours/${d.hour}`;
}
async function hold(db, id, d = data(), lockedAt = serverTimestamp(), withCounter = true) {
  const b = writeBatch(db);
  b.set(requestRef(db, id), d);
  b.set(lockRef(db, d), { reservationId: id, lockedAt, status: 'held' });
  if (withCounter) {
    const counter = limitRef(db, d);
    const previous = await getDoc(counter);
    b.set(counter, {
      count: (previous.data()?.count || 0) + 1,
      lastRequestId: id,
      updatedAt: serverTimestamp(),
    });
  }
  return b.commit();
}
function proof(id = 'valid', uid = 'alice') {
  return {
    reservationId: id,
    clientUid: uid,
    establishmentId: 'puma',
    contentType: 'image/jpeg',
    imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(100),
    sha256: 'a'.repeat(64),
    createdAt: serverTimestamp(),
  };
}
function sendProof(db, id = 'valid', p = proof(id)) {
  const b = writeBatch(db);
  b.set(proofRef(db, id), p);
  b.update(requestRef(db, id), {
    status: 'pending_verification',
    paymentStatus: 'submitted',
    proofSubmittedAt: serverTimestamp(),
  });
  return b.commit();
}
async function review(db, action = 'confirm', id = 'valid', extra = {}) {
  const source = action === 'confirm' ? (await getDoc(requestRef(db, id))).data() : null;
  const b = writeBatch(db);
  b.update(requestRef(db, id), {
    status: action === 'confirm' ? 'confirmed' : 'rejected',
    paymentStatus: action === 'confirm' ? 'verified' : 'unpaid',
    reviewedAt: serverTimestamp(),
    reviewedBy: 'admin',
    ...(action === 'confirm' ? { verifiedAdvanceCents: 1000 } : {}),
    ...extra,
  });
  b.update(lockRef(db), { status: action === 'confirm' ? 'confirmed' : 'released' });
  if (action === 'confirm' && source) b.set(doc(db, `establishments/${source.establishmentId}/court_income/${id}`), {
    reservationId: id, courtId: source.courtId, courtName: source.courtName,
    date: source.date, hour: source.hour, totalCents: source.totalCents,
    advanceCents: source.advanceCents, advanceAt: serverTimestamp(), advanceBy: 'admin',
    balanceCents: 0, balanceAt: null, balanceBy: null, balanceMethod: null,
  });
  return b.commit();
}
async function ageHold(id = 'valid', minutes = 16) {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    const createdAt = Timestamp.fromMillis(Date.now() - minutes * 60000);
    await updateDoc(requestRef(db, id), { createdAt });
    await updateDoc(lockRef(db), { lockedAt: createdAt });
  });
}

test('solicitud y bloqueo se crean juntos; escrituras incompletas se rechazan', async () => {
  const db = dbFor('alice');
  await assertFails(setDoc(requestRef(db, 'alone'), data()));
  await assertSucceeds(hold(db, 'valid'));
  await assertFails(
    setDoc(doc(db, 'direct_slots/puma/courts/one/days/2030-01-01/hours/8'), {
      reservationId: 'fake',
      lockedAt: serverTimestamp(),
      status: 'held',
    }),
  );
});
test('dos clientes simultáneos: solo uno ocupa el horario', async () => {
  const results = await Promise.allSettled(
    ['alice', 'bob'].map((uid) => hold(dbFor(uid), uid, data(uid))),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});
test('no se falsifica dueño, tarifa, fecha, aprobación, destinatario ni campos extra', async () => {
  const variants = [
    { clientUid: 'bob' },
    { totalCents: 1 },
    { advanceCents: 0 },
    { date: '2026-02-31' },
    { hour: 23 },
    { status: 'confirmed', paymentStatus: 'verified' },
    { role: 'superadmin' },
    { establishmentName: 'Nombre inventado' },
    { courtName: 'Cancha inventada' },
    { paymentSnapshot: { ...payment, phone: '999999999' } },
    { createdAt: Timestamp.fromMillis(Date.now() - 10000) },
  ];
  for (let i = 0; i < variants.length; i++)
    await assertFails(hold(dbFor('alice'), 'invalid-' + i, { ...data(), ...variants[i] }));
});
test('el reloj del cliente no decide la duración del bloqueo', async () => {
  const db = dbFor('alice');
  await assertFails(hold(db, 'past-lock', data(), Timestamp.fromMillis(Date.now() - 3600000)));
  await assertFails(hold(db, 'future-lock', data(), Timestamp.fromMillis(Date.now() + 3600000)));
  await assertSucceeds(hold(db, 'valid'));
  await assertFails(hold(dbFor('bob'), 'second', data('bob')));
  await assertFails(updateDoc(lockRef(db), { lockedAt: serverTimestamp() }));
});
test('al vencer puede reservar otra persona sin alterar la solicitud histórica', async () => {
  const db = dbFor('alice');
  await assertSucceeds(hold(db, 'valid'));
  await ageHold();
  await assertSucceeds(hold(dbFor('bob'), 'new', data('bob')));
  await assertSucceeds(getDoc(requestRef(db, 'valid')));
  await assertFails(sendProof(db));
});
test('una retención confirmada nunca se libera por cumplir 15 minutos', async () => {
  const db = dbFor('alice');
  await assertSucceeds(hold(db, 'valid'));
  await assertSucceeds(sendProof(db));
  await assertSucceeds(review(dbFor('admin')));
  await ageHold();
  await assertFails(hold(dbFor('bob'), 'steal', data('bob')));
});
test('solicitudes privadas; visitantes, otros clientes y otros locales no acceden', async () => {
  const db = dbFor('alice');
  await hold(db, 'valid');
  await assertSucceeds(getDoc(requestRef(db, 'valid')));
  await assertSucceeds(getDoc(requestRef(dbFor('admin'), 'valid')));
  for (const outsider of [dbFor('bob'), dbFor('other-admin'), env.unauthenticatedContext().firestore()])
    await assertFails(getDoc(requestRef(outsider, 'valid')));
  await assertFails(getDoc(lockRef(env.unauthenticatedContext().firestore())));
  await assertSucceeds(getDoc(lockRef(dbFor('bob'))));
  await assertFails(getDocs(collection(db, 'direct_requests')));
});
test('las consultas reales de historial y disponibilidad son autorizadas sin PII', async () => {
  const db = dbFor('alice');
  await hold(db, 'valid');
  const own = await assertSucceeds(getDocs(query(
    collection(db, 'direct_requests'), where('clientUid', '==', 'alice'),
    orderBy('createdAt', 'desc'), limit(100),
  )));
  assert.equal(own.size, 1);
  await assertFails(getDocs(query(collection(dbFor('bob'), 'direct_requests'), where('clientUid', '==', 'alice'))));
  const slots = await assertSucceeds(getDocs(collection(dbFor('bob'), path(data()).replace(/\/hours\/14$/, '/hours'))));
  assert.deepEqual(Object.keys(slots.docs[0].data()).sort(), ['lockedAt', 'reservationId', 'status']);
});
test('publicación/configuración canónica, horarios, mantenimiento y motor son obligatorios', async () => {
  const variants = [
    ['establishments/puma', { status: 'suspended' }],
    ['establishments/puma', { bookingEngine: 'functions' }],
    ['establishments/puma/courts/one', { maintenance: true }],
    ['establishments/puma/courts/one', { runtime: { reservationId: 'running' } }],
    ['establishments/puma/courts/one', { openHour: 15 }],
    ['catalog/puma', { 'booking.enabled': false }],
    ['catalog/puma', { 'booking.payment': { ...payment, mode: 'live' } }],
    ['catalog/puma/courts/one', { status: 'inactive' }],
  ];
  for (let i = 0; i < variants.length; i++) {
    const [target, changes] = variants[i];
    await env.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), target), changes);
    });
    await assertFails(hold(dbFor('alice'), 'blocked-' + i));
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      if (target === 'establishments/puma')
        await setDoc(doc(db, target), { status: 'published', bookingEngine: 'direct', bookingPolicy: { enabled: true } });
      else if (target === 'catalog/puma')
        await setDoc(doc(db, target), { status: 'published', name: 'Grass El Puma', booking: { enabled: true, engine: 'direct', holdMinutes: 15, payment } });
      else await setDoc(doc(db, target), court);
    });
  }
  await assertSucceeds(hold(dbFor('alice'), 'valid'));
});
test('los clientes solo leen proyecciones publicadas y no configuran pagos ni roles', async () => {
  const db = dbFor('alice');
  await assertSucceeds(getDoc(doc(db, 'catalog/puma/courts/one')));
  await assertFails(getDoc(doc(db, 'establishments/puma')));
  await assertFails(updateDoc(doc(db, 'catalog/puma'), { 'booking.enabled': true }));
  await assertFails(setDoc(doc(db, 'platform_roles/alice'), { role: 'superadmin', status: 'active' }));
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'catalog/puma'), { status: 'draft' }));
  await assertFails(getDoc(doc(db, 'catalog/puma/courts/one')));
});
test('foto y transición a revisión requieren una escritura atómica del propietario', async () => {
  const db = dbFor('alice');
  await hold(db, 'valid');
  await assertFails(setDoc(proofRef(db, 'valid'), proof()));
  await assertFails(updateDoc(requestRef(db, 'valid'), {
    status: 'pending_verification', paymentStatus: 'submitted', proofSubmittedAt: serverTimestamp(),
  }));
  await assertFails(sendProof(dbFor('bob')));
  await assertSucceeds(sendProof(db));
  const saved = (await getDoc(requestRef(db, 'valid'))).data();
  assert.equal(saved.status, 'pending_verification');
  assert.equal(saved.paymentStatus, 'submitted');
  assert.equal(saved.verifiedAdvanceCents, undefined);
});
test('comprobantes rechazan HTML, URLs, tipos falsos, sobredimensión y esquema extra', async () => {
  const db = dbFor('alice');
  await hold(db, 'valid');
  const variants = [
    { imageData: '<html>fraude</html>' },
    { imageData: 'https://example.com/receipt.jpg' },
    { contentType: 'image/png' },
    { imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(700000) },
    { sha256: 'fake' },
    { clientUid: 'bob' },
    { establishmentId: 'other' },
    { reservationId: 'other' },
    { role: 'admin' },
    { createdAt: Timestamp.fromMillis(Date.now() - 1000) },
  ];
  for (const variant of variants) await assertFails(sendProof(db, 'valid', { ...proof(), ...variant }));
  await assertSucceeds(sendProof(db));
});
test('la foto queda privada e inmutable para cliente, otros locales y administrador', async () => {
  const db = dbFor('alice');
  await hold(db, 'valid');
  await sendProof(db);
  await assertSucceeds(getDoc(proofRef(db, 'valid')));
  await assertSucceeds(getDoc(proofRef(dbFor('admin'), 'valid')));
  for (const outsider of [dbFor('bob'), dbFor('other-admin'), env.unauthenticatedContext().firestore()])
    await assertFails(getDoc(proofRef(outsider, 'valid')));
  await assertFails(getDocs(collection(db, 'direct_proofs')));
  await assertFails(updateDoc(proofRef(db, 'valid'), { imageData: proof().imageData + 'A' }));
  await assertFails(deleteDoc(proofRef(dbFor('admin'), 'valid')));
});
test('los clientes no se confirman; administrador ajeno o suspendido no revisa', async () => {
  const db = dbFor('alice');
  await hold(db, 'valid');
  await sendProof(db);
  await assertFails(review(db));
  await assertFails(review(dbFor('other-admin')));
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'establishments/puma/members/admin'), { status: 'suspended' }));
  await assertFails(review(dbFor('admin')));
});
test('confirmar exige comprobante, importe y transición conjunta del bloqueo', async () => {
  const db = dbFor('alice'), admin = dbFor('admin');
  await hold(db, 'valid');
  await assertFails(review(admin));
  await sendProof(db);
  await assertFails(updateDoc(requestRef(admin, 'valid'), {
    status: 'confirmed', paymentStatus: 'verified', reviewedAt: serverTimestamp(),
    reviewedBy: 'admin', verifiedAdvanceCents: 1000,
  }));
  await assertFails(updateDoc(lockRef(admin), { status: 'confirmed' }));
  await assertFails(review(admin, 'confirm', 'valid', { verifiedAdvanceCents: 1 }));
  await assertSucceeds(review(admin));
  assert.equal((await getDoc(lockRef(db))).data().status, 'confirmed');
});
test('rechazar libera inmediatamente y conserva comprobante e historial', async () => {
  const db = dbFor('alice');
  await hold(db, 'valid');
  await sendProof(db);
  await assertSucceeds(review(dbFor('admin'), 'reject'));
  await assertSucceeds(hold(dbFor('bob'), 'replacement', data('bob')));
  assert.equal((await getDoc(requestRef(db, 'valid'))).data().status, 'rejected');
  await assertSucceeds(getDoc(proofRef(db, 'valid')));
  await assertFails(review(dbFor('admin')));
});
test('al vencer no se envían fotos ni se confirma una revisión pendiente', async () => {
  const db = dbFor('alice');
  await hold(db, 'valid');
  await sendProof(db);
  await ageHold();
  await assertFails(review(dbFor('admin')));
  await assertSucceeds(hold(dbFor('bob'), 'replacement', data('bob')));
  await assertFails(review(dbFor('admin')));
});
test('las transiciones no alteran dueño, precio, snapshot, fecha ni campos requeridos', async () => {
  const db = dbFor('alice');
  await hold(db, 'valid');
  await sendProof(db);
  for (const changes of [
    { clientUid: 'admin' }, { totalCents: 9999 }, { date: '2030-01-01' },
    { paymentSnapshot: { ...payment, phone: '999999999' } }, { createdAt: serverTimestamp() },
    { courtName: deleteField() }, { extra: 'x'.repeat(10000) },
  ]) await assertFails(review(dbFor('admin'), 'confirm', 'valid', changes));
  await assertSucceeds(review(dbFor('admin')));
});
test('la revisión conserva los precios e instrucciones históricos ante cambios de configuración', async () => {
  const db = dbFor('alice');
  await hold(db, 'valid');
  await sendProof(db);
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), 'catalog/puma'), { 'booking.payment': { ...payment, phone: '999999999' } });
    await updateDoc(doc(c.firestore(), 'establishments/puma/courts/one'), { dayPriceCents: 5000 });
  });
  await assertSucceeds(review(dbFor('admin')));
  const saved = (await getDoc(requestRef(db, 'valid'))).data();
  assert.equal(saved.totalCents, 3000);
  assert.equal(saved.paymentSnapshot.phone, '');
});
test('cada solicitud consume exactamente un registro del contador privado del día', async () => {
  const db = dbFor('alice');
  await assertFails(hold(db, 'without-counter', data(), serverTimestamp(), false));
  await assertSucceeds(hold(db, 'valid'));
  const saved = (await getDoc(limitRef(db))).data();
  assert.equal(saved.count, 1);
  assert.equal(saved.lastRequestId, 'valid');
  await assertFails(getDoc(limitRef(dbFor('bob'), data(), 'alice')));
  await assertFails(deleteDoc(limitRef(db)));
  await assertFails(setDoc(limitRef(db), { count: 1, lastRequestId: 'valid', updatedAt: serverTimestamp() }));
  // Reintentar una solicitud ya encontrada es una lectura; no consume otra cuota.
  await assertSucceeds(getDoc(requestRef(db, 'valid')));
  assert.equal((await getDoc(limitRef(db))).data().count, 1);
});
test('el contador no se crea, incrementa ni reinicia sin una solicitud nueva atómica', async () => {
  const db = dbFor('alice');
  await assertFails(setDoc(limitRef(db), { count: 1, lastRequestId: 'missing', updatedAt: serverTimestamp() }));
  await hold(db, 'valid');
  for (const changes of [
    { count: 0 }, { count: 2 }, { count: 1, lastRequestId: 'missing' },
    { updatedAt: Timestamp.fromMillis(Date.now() - 10000) }, { extra: 'admin' },
  ]) await assertFails(updateDoc(limitRef(db), { updatedAt: serverTimestamp(), ...changes }));
});
test('conserva el límite técnico de veinte solicitudes por usuario y fecha', async () => {
  const db = dbFor('alice');
  await hold(db, 'first');
  await env.withSecurityRulesDisabled((c) => updateDoc(limitRef(c.firestore()), { count: 19 }));
  const next = (hour) => {
    const d = data();
    const startsAt = Timestamp.fromDate(new Date(`${d.date}T${hour}:00:00-05:00`));
    return { ...d, hour, startsAt, endsAt: Timestamp.fromMillis(startsAt.toMillis() + 3600000) };
  };
  await assertSucceeds(hold(db, 'twentieth', next(15)));
  assert.equal((await getDoc(limitRef(db))).data().count, 20);
  await assertFails(hold(db, 'over-limit', next(16)));
  assert.equal((await getDoc(limitRef(db))).data().count, 20);
  await assertSucceeds(hold(dbFor('bob'), 'other-user', { ...next(16), clientUid: 'bob' }));
});
