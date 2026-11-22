import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, orderBy,
  limit, writeBatch, runTransaction, serverTimestamp, Timestamp,
} from 'firebase/firestore';

let env;
const payment = { mode: 'demo', qr: '', methods: ['Yape', 'Plin'], recipient: '', phone: '' };
const court = {
  name: 'Cancha principal', status: 'active', openHour: 8, closeHour: 24,
  dayPriceCents: 3000, nightPriceCents: 4000, nightStartsAt: 18,
  openDays: [], maintenance: false, runtime: null,
};
const dbFor = (uid) => env.authenticatedContext(uid).firestore();
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const startOfDate = (date) => Timestamp.fromDate(new Date(`${date}T00:00:00-05:00`));
const configPath = (kind, id, date) => kind === 'schedule'
  ? `establishments/${id}/settings/schedule` : `establishments/${id}/closures/${date}`;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-grassgo-schedule-tests',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    const b = writeBatch(db);
    for (const id of ['puma', 'other']) {
      b.set(doc(db, `establishments/${id}`), {
        status: 'published', bookingEngine: 'direct', bookingPolicy: { enabled: true },
      });
      b.set(doc(db, `establishments/${id}/courts/one`), court);
      b.set(doc(db, `catalog/${id}`), {
        status: 'published', name: id === 'puma' ? 'Grass El Puma' : 'Otro local',
        booking: { enabled: true, engine: 'direct', holdMinutes: 15, payment },
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

async function previousData(path) {
  let value = null;
  await env.withSecurityRulesDisabled(async (c) => { value = (await getDoc(doc(c.firestore(), path))).data() ?? null; });
  return value;
}
// Construye el mismo conjunto atómico de tres escrituras que el servicio real.
// El preestado se conoce fuera de las reglas para poder ensayar actores maliciosos.
async function change(db, changes = {}, options = {}) {
  const { kind = 'schedule', id = 'puma', date = tomorrow(), actor = 'admin' } = options;
  const path = configPath(kind, id, date);
  const previous = options.previous !== undefined ? options.previous : await previousData(path);
  const d = {
    ...(kind === 'schedule' ? { days: [0, 1, 2, 3, 4, 5, 6], openHour: 8, closeHour: 24 }
      : { date, dateStart: startOfDate(date), closed: true, reason: 'Mantenimiento privado' }),
    establishmentId: id, revision: (previous?.revision ?? 0) + 1,
    updatedAt: serverTimestamp(), updatedBy: actor, ...changes,
  };
  const projection = kind === 'schedule'
    ? { days: d.days, openHour: d.openHour, closeHour: d.closeHour,
      scheduleRevision: d.revision, scheduleUpdatedAt: d.updatedAt }
    : { establishmentId: d.establishmentId, date: d.date, dateStart: d.dateStart,
      closed: d.closed, revision: d.revision, updatedAt: d.updatedAt };
  const event = {
    establishmentId: id, kind, revision: d.revision, actorUid: actor,
    at: serverTimestamp(), before: previous, after: d, ...options.historyExtra,
  };
  const b = writeBatch(db);
  if (!options.omitPrivate) b.set(doc(db, path), d);
  if (!options.omitPublic) {
    if (kind === 'schedule') b.update(doc(db, `catalog/${id}`), { ...projection, ...options.publicExtra });
    else b.set(doc(db, `catalog/${id}/closures/${date}`), { ...projection, ...options.publicExtra });
  }
  if (!options.omitHistory) b.set(doc(db, `${path}/history/${options.historyId ?? d.revision}`), event);
  options.extraWrite?.(b, db);
  return b.commit();
}
const schedule = (db, d = {}, o = {}) => change(db, d, o);
const closure = (db, d = {}, o = {}) => change(db, d, { ...o, kind: 'closure' });

function booking(uid = 'alice', hour = 14) {
  const date = tomorrow();
  const startsAt = Timestamp.fromDate(new Date(`${date}T${String(hour).padStart(2, '0')}:00:00-05:00`));
  return {
    clientUid: uid, establishmentId: 'puma', establishmentName: 'Grass El Puma',
    courtId: 'one', courtName: court.name, date, hour, startsAt,
    endsAt: Timestamp.fromMillis(startsAt.toMillis() + 3600000),
    totalCents: hour >= 18 ? 4000 : 3000, advanceCents: 1000,
    createdAt: serverTimestamp(), status: 'pending_payment', paymentStatus: 'unpaid', paymentSnapshot: payment,
  };
}
function addHold(writer, db, id, d, count = 1) {
  writer.set(doc(db, `direct_requests/${id}`), d);
  writer.set(doc(db, `direct_slots/puma/courts/one/days/${d.date}/hours/${d.hour}`), {
    reservationId: id, lockedAt: serverTimestamp(), status: 'held',
  });
  writer.set(doc(db, `direct_limits/${d.clientUid}/days/${d.date}`), {
    count, lastRequestId: id, updatedAt: serverTimestamp(),
  });
}
async function hold(db, id = 'valid', d = booking()) {
  const previous = await getDoc(doc(db, `direct_limits/${d.clientUid}/days/${d.date}`));
  const b = writeBatch(db);
  addHold(b, db, id, d, (previous.data()?.count ?? 0) + 1);
  return b.commit();
}
function sendProof(db, id = 'valid') {
  const b = writeBatch(db);
  b.set(doc(db, `direct_proofs/${id}`), {
    reservationId: id, clientUid: 'alice', establishmentId: 'puma', contentType: 'image/jpeg',
    imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(100), sha256: 'a'.repeat(64), createdAt: serverTimestamp(),
  });
  b.update(doc(db, `direct_requests/${id}`), {
    status: 'pending_verification', paymentStatus: 'submitted', proofSubmittedAt: serverTimestamp(),
  });
  return b.commit();
}

test('administrador guarda semana, catálogo e historia juntos sin modificar otros datos', async () => {
  const db = dbFor('admin');
  await assertSucceeds(schedule(db, { days: [1, 2, 3], openHour: 9, closeHour: 22 }));
  const saved = (await getDoc(doc(db, configPath('schedule', 'puma')))).data();
  const event = (await getDoc(doc(db, 'establishments/puma/settings/schedule/history/1'))).data();
  const publicData = (await getDoc(doc(dbFor('alice'), 'catalog/puma'))).data();
  assert.deepEqual(event.after, saved);
  assert.equal(event.before, null);
  assert.equal(event.actorUid, 'admin');
  assert.deepEqual(publicData.days, [1, 2, 3]);
  assert.equal(publicData.scheduleRevision, 1);
  assert.equal(publicData.name, 'Grass El Puma');
  assert.deepEqual(publicData.booking.payment, payment);
  assert.equal(publicData.updatedBy, undefined);
  assert.equal(publicData.actorUid, undefined);
});

test('cliente, anónimo, otro establecimiento y superadmin sin membresía no configuran', async () => {
  for (const uid of ['alice', 'other-admin', 'super']) {
    await assertFails(schedule(dbFor(uid), {}, { actor: uid }));
    await assertFails(closure(dbFor(uid), {}, { actor: uid }));
  }
  await assertFails(schedule(env.unauthenticatedContext().firestore()));
  await assertFails(closure(env.unauthenticatedContext().firestore()));
  await assertSucceeds(schedule(dbFor('other-admin'), {}, { id: 'other', actor: 'other-admin' }));
  assert.equal(await previousData(configPath('schedule', 'puma')), null);
});

test('documentos privados e historia son solo del establecimiento o superadmin', async () => {
  await schedule(dbFor('admin'));
  await closure(dbFor('admin'));
  const paths = ['establishments/puma/settings/schedule',
    'establishments/puma/settings/schedule/history/1', `establishments/puma/closures/${tomorrow()}`,
    `establishments/puma/closures/${tomorrow()}/history/1`];
  for (const path of paths) {
    await assertSucceeds(getDoc(doc(dbFor('admin'), path)));
    await assertSucceeds(getDoc(doc(dbFor('super'), path)));
    for (const outsider of [dbFor('alice'), dbFor('other-admin'), env.unauthenticatedContext().firestore()])
      await assertFails(getDoc(doc(outsider, path)));
  }
  // Leer la configuración todavía inexistente permite cargar el formulario inicial.
  await assertSucceeds(getDoc(doc(dbFor('other-admin'), configPath('schedule', 'other'))));
});

test('ninguna de las tres escrituras se admite por separado ni con proyección o historia falsas', async () => {
  for (const options of [
    { omitPrivate: true }, { omitPublic: true }, { omitHistory: true },
    { publicExtra: { openHour: 12 } }, { historyExtra: { before: {} } },
    { historyExtra: { actorUid: 'other-admin' } }, { historyExtra: { kind: 'closure' } },
    { historyExtra: { at: Timestamp.fromMillis(1) } }, { historyExtra: { extra: true } },
    { historyId: '01' },
  ]) await assertFails(schedule(dbFor('admin'), {}, options));
  for (const options of [
    { omitPrivate: true }, { omitPublic: true }, { omitHistory: true },
    { publicExtra: { closed: false } }, { publicExtra: { reason: 'dato privado' } },
    { publicExtra: { updatedBy: 'admin' } }, { historyExtra: { after: {} } },
  ]) await assertFails(closure(dbFor('admin'), {}, options));
});

test('semana valida tipos, días únicos, límites, autor, reloj y esquema cerrado', async () => {
  const variants = [
    { days: [1, 1] }, { days: [-1] }, { days: [7] }, { days: ['1'] }, { days: [1.5] },
    { days: [0, 1, 2, 3, 4, 5, 6, 0] }, { days: null },
    { openHour: -1 }, { openHour: 24 }, { openHour: 8.5 },
    { closeHour: 25 }, { closeHour: 0 }, { closeHour: 8 }, { closeHour: '24' },
    { establishmentId: 'other' }, { revision: 0 }, { revision: 2 }, { revision: 1.5 },
    { updatedBy: 'other-admin' }, { updatedAt: Timestamp.fromMillis(1) },
    { role: 'superadmin' }, { payment: payment },
  ];
  for (const d of variants) await assertFails(schedule(dbFor('admin'), d));
  await assertSucceeds(schedule(dbFor('admin'), { days: [], openHour: 0, closeHour: 24 }));
});

test('solo cinco campos del catálogo cambian; roles, publicación, tarifas y pagos siguen protegidos', async () => {
  for (const extra of [
    { status: 'suspended' }, { name: 'Falsificado' }, { booking: { enabled: false } },
    { dayPriceCents: 1 }, { updatedBy: 'admin' }, { role: 'superadmin' },
  ]) await assertFails(schedule(dbFor('admin'), {}, { publicExtra: extra }));
  await assertFails(updateDoc(doc(dbFor('admin'), 'catalog/puma'), { days: [] }));
  await assertFails(updateDoc(doc(dbFor('admin'), 'establishments/puma'), { status: 'suspended' }));
  await assertFails(setDoc(doc(dbFor('admin'), 'establishments/puma/settings/schedule'), {
    establishmentId: 'puma', days: [], openHour: 0, closeHour: 24,
    revision: 1, updatedBy: 'admin', updatedAt: serverTimestamp(),
  }));
});

test('actualizaciones consecutivas conservan preestado e historia inmutable', async () => {
  const db = dbFor('admin');
  await schedule(db);
  const previous = await previousData(configPath('schedule', 'puma'));
  await assertFails(schedule(db, { revision: 1 }));
  await assertFails(schedule(db, { revision: 3 }));
  await assertSucceeds(schedule(db, { openHour: 10 }));
  const event = (await getDoc(doc(db, 'establishments/puma/settings/schedule/history/2'))).data();
  assert.deepEqual(event.before, previous);
  assert.equal(event.after.openHour, 10);
  for (const path of [configPath('schedule', 'puma'), 'establishments/puma/settings/schedule/history/1'])
    await assertFails(deleteDoc(doc(db, path)));
  await assertFails(updateDoc(doc(db, 'establishments/puma/settings/schedule/history/1'), { actorUid: 'second-admin' }));
  await assertFails(setDoc(doc(db, 'establishments/puma/settings/schedule/history/3'), {
    ...event, revision: 3, actorUid: 'admin', at: serverTimestamp(), before: event.after,
  }));
  await assertFails(deleteDoc(doc(db, 'catalog/puma')));
});

test('dos administradores con revisión vieja no sobrescriben silenciosamente sus cambios', async () => {
  await schedule(dbFor('admin'));
  const previous = await previousData(configPath('schedule', 'puma'));
  const results = await Promise.allSettled([
    schedule(dbFor('admin'), { openHour: 9 }, { previous }),
    schedule(dbFor('second-admin'), { openHour: 10 }, { previous, actor: 'second-admin' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await previousData(configPath('schedule', 'puma'))).revision, 2);
  const history = await getDocs(collection(dbFor('admin'), 'establishments/puma/settings/schedule/history'));
  assert.equal(history.size, 2);
});

test('transacción real puede leer configuración privada inexistente y guardar tres documentos', async () => {
  const db = dbFor('admin');
  await assertSucceeds(runTransaction(db, async (tx) => {
    const ref = doc(db, configPath('schedule', 'puma'));
    const previous = (await tx.get(ref)).data() ?? null;
    const d = { establishmentId: 'puma', days: [0], openHour: 0, closeHour: 24,
      revision: 1, updatedAt: serverTimestamp(), updatedBy: 'admin' };
    tx.set(ref, d);
    tx.update(doc(db, 'catalog/puma'), { days: d.days, openHour: d.openHour, closeHour: d.closeHour,
      scheduleRevision: 1, scheduleUpdatedAt: d.updatedAt });
    tx.set(doc(db, 'establishments/puma/settings/schedule/history/1'), {
      establishmentId: 'puma', kind: 'schedule', revision: 1, actorUid: 'admin',
      at: serverTimestamp(), before: previous, after: d,
    });
  }));
});

test('cierre valida fecha real y medianoche de Lima; no admite campos, reloj ni tipos falsos', async () => {
  const variants = [
    { date: '2026-02-31' }, { dateStart: Timestamp.fromDate(new Date('2026-03-03T00:00:00-05:00')) },
    { dateStart: Timestamp.fromDate(new Date(`${tomorrow()}T00:00:00Z`)) },
    { dateStart: Timestamp.fromDate(new Date(`${tomorrow()}T00:00:01-05:00`)) },
    { dateStart: 'mañana' }, { closed: 'true' }, { closed: null },
    { reason: 'x'.repeat(161) }, { reason: null }, { establishmentId: 'other' },
    { updatedAt: Timestamp.fromMillis(1) }, { updatedBy: 'other-admin' },
    { revision: 0 }, { revision: 2 }, { paymentsVerified: true },
  ];
  for (const d of variants) await assertFails(closure(dbFor('admin'), d));
  await assertFails(closure(dbFor('admin'), {
    dateStart: Timestamp.fromDate(new Date('2026-03-03T00:00:00-05:00')),
  }, { date: '2026-02-31' }));
  // Sin una política comercial nueva de horizonte: la fecha pasada también es válida.
  await assertSucceeds(closure(dbFor('admin'), { reason: '' }, { date: '2024-02-29' }));
});

test('reabrir conserva documento y revisiones; público nunca incluye motivo ni autor', async () => {
  const db = dbFor('admin'), date = tomorrow();
  await closure(db);
  const client = dbFor('alice');
  const projection = (await getDoc(doc(client, `catalog/puma/closures/${date}`))).data();
  assert.deepEqual(Object.keys(projection).sort(), ['closed', 'date', 'dateStart', 'establishmentId', 'revision', 'updatedAt']);
  assert.equal(projection.closed, true);
  await assertFails(closure(db, { closed: false, revision: 1 }));
  await assertSucceeds(closure(db, { closed: false, reason: '' }));
  assert.equal((await getDoc(doc(client, `catalog/puma/closures/${date}`))).data().closed, false);
  const history = await getDocs(collection(db, `establishments/puma/closures/${date}/history`));
  assert.equal(history.size, 2);
  for (const path of [`establishments/puma/closures/${date}`, `catalog/puma/closures/${date}`,
    `establishments/puma/closures/${date}/history/1`]) await assertFails(deleteDoc(doc(db, path)));
});

test('consultas reales de cierres y lecturas públicas respetan publicación y autenticación', async () => {
  await closure(dbFor('admin'));
  const privateQuery = (db) => query(collection(db, 'establishments/puma/closures'), orderBy('dateStart'), limit(100));
  assert.equal((await assertSucceeds(getDocs(privateQuery(dbFor('admin'))))).size, 1);
  await assertFails(getDocs(privateQuery(dbFor('other-admin'))));
  await assertSucceeds(getDocs(query(collection(dbFor('alice'), 'catalog/puma/closures'), orderBy('dateStart'), limit(100))));
  await assertSucceeds(getDoc(doc(dbFor('alice'), 'catalog/puma/closures/2030-01-01')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `catalog/puma/closures/${tomorrow()}`)));
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'catalog/puma'), { status: 'draft' }));
  await assertFails(getDoc(doc(dbFor('alice'), `catalog/puma/closures/${tomorrow()}`)));
});

test('suspensión de miembro/local, motor legacy y catálogo faltante impiden cambios', async () => {
  const variants = [
    ['establishments/puma/members/admin', { status: 'suspended' }],
    ['establishments/puma', { status: 'suspended' }],
    ['establishments/puma', { bookingEngine: 'functions' }],
  ];
  for (const [path, fields] of variants) {
    await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), path), fields));
    await assertFails(schedule(dbFor('admin')));
    await assertFails(closure(dbFor('admin')));
    await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), path),
      path.endsWith('/admin') ? { status: 'active' } : { status: 'published', bookingEngine: 'direct' }));
  }
  await env.withSecurityRulesDisabled((c) => deleteDoc(doc(c.firestore(), 'catalog/puma')));
  await assertFails(closure(dbFor('admin')));
  await assertFails(schedule(dbFor('admin')));
});

test('sin semana global conserva el horario legacy; semana nueva manda sobre la cancha', async () => {
  const client = dbFor('alice');
  await assertFails(hold(client, 'legacy-early', booking('alice', 7)));
  await assertSucceeds(schedule(dbFor('admin'), { openHour: 6, closeHour: 10 }));
  await assertSucceeds(hold(client, 'new-early', booking('alice', 7)));
  await assertFails(hold(client, 'after-close', booking('alice', 14)));
});

test('semana vacía cierra todos los días y solo admite días seleccionados', async () => {
  const day = new Date(`${tomorrow()}T00:00:00Z`).getUTCDay();
  const db = dbFor('admin'), client = dbFor('alice');
  await schedule(db, { days: [] });
  await assertFails(hold(client, 'closed-week'));
  await schedule(db, { days: [(day + 1) % 7] });
  await assertFails(hold(client, 'other-day'));
  await schedule(db, { days: [day], openHour: 14, closeHour: 15 });
  await assertSucceeds(hold(client, 'selected-day'));
});

test('cierre canónico bloquea nuevas solicitudes aunque el cliente ignore la interfaz; reabrir habilita', async () => {
  await closure(dbFor('admin'));
  await assertFails(hold(dbFor('alice'), 'closed-date'));
  await closure(dbFor('admin'), { closed: false });
  await assertSucceeds(hold(dbFor('alice'), 'reopened-date'));
});

test('semana existente y fecha reabierta permiten sustituir una retención vencida dentro del límite de lecturas', async () => {
  const admin = dbFor('admin'), alice = dbFor('alice'), bob = dbFor('bob');
  const date = tomorrow();
  await schedule(admin);
  await hold(alice, 'expired-request');
  await closure(admin);
  await closure(admin, { closed: false });
  const expiredAt = Timestamp.fromMillis(Date.now() - 16 * 60000);
  const slotPath = `direct_slots/puma/courts/one/days/${date}/hours/14`;
  await env.withSecurityRulesDisabled(async (c) => {
    const b = writeBatch(c.firestore());
    b.update(doc(c.firestore(), 'direct_requests/expired-request'), { createdAt: expiredAt });
    b.update(doc(c.firestore(), slotPath), { lockedAt: expiredAt });
    await b.commit();
  });

  // Recorre horario, cierre abierto y solicitud anterior además de la cuota/bloqueo.
  await assertSucceeds(hold(bob, 'replacement-request', booking('bob')));
  const slot = (await getDoc(doc(bob, slotPath))).data();
  const previous = (await getDoc(doc(alice, 'direct_requests/expired-request'))).data();
  assert.equal(slot.reservationId, 'replacement-request');
  assert.equal(slot.status, 'held');
  assert.equal(previous.clientUid, 'alice');
  assert.equal(previous.status, 'pending_payment');
  assert.ok(previous.createdAt.isEqual(expiredAt));
  assert.equal((await getDoc(doc(bob, `direct_limits/bob/days/${date}`))).data().count, 1);
});

test('cambios horarios y cierres respetan comprobantes y reservas ya solicitadas', async () => {
  const client = dbFor('alice'), admin = dbFor('admin');
  await hold(client);
  await schedule(admin, { days: [] });
  await closure(admin);
  await assertSucceeds(sendProof(client));
  const source = (await getDoc(doc(admin, 'direct_requests/valid'))).data();
  const b = writeBatch(admin);
  b.update(doc(admin, 'direct_requests/valid'), {
    status: 'confirmed', paymentStatus: 'verified', reviewedBy: 'admin',
    reviewedAt: serverTimestamp(), verifiedAdvanceCents: 1000,
  });
  b.update(doc(admin, `direct_slots/puma/courts/one/days/${tomorrow()}/hours/14`), { status: 'confirmed' });
  b.set(doc(admin, 'establishments/puma/court_income/valid'), {
    reservationId: 'valid', courtId: source.courtId, courtName: source.courtName,
    date: source.date, hour: source.hour, totalCents: source.totalCents,
    advanceCents: source.advanceCents, advanceAt: serverTimestamp(), advanceBy: 'admin',
    balanceCents: 0, balanceAt: null, balanceBy: null, balanceMethod: null,
  });
  await assertSucceeds(b.commit());
  const saved = (await getDoc(doc(client, 'direct_requests/valid'))).data();
  assert.equal(saved.totalCents, 3000);
  assert.deepEqual(saved.paymentSnapshot, payment);
  assert.equal(saved.status, 'confirmed');
  await assertFails(hold(dbFor('bob'), 'new-request', booking('bob', 15)));
});

test('solicitud y configuración en un mismo batch usan el horario y cierre posteriores', async () => {
  const admin = dbFor('admin');
  await assertFails(schedule(admin, { days: [] }, {
    extraWrite: (b, db) => addHold(b, db, 'same-batch-closed', booking('admin')),
  }));
  // Apertura nueva a las 6 también rige en la misma operación atómica.
  await assertSucceeds(schedule(admin, { openHour: 6, closeHour: 10 }, {
    extraWrite: (b, db) => addHold(b, db, 'same-batch-open', booking('admin', 7)),
  }));
  await assertFails(closure(admin, {}, {
    extraWrite: (b, db) => addHold(b, db, 'same-batch-closure', booking('admin', 8), 2),
  }));
});

test('transacción cliente desactualizada no crea una solicitud después del cierre confirmado', { timeout: 20000 }, async () => {
  const client = dbFor('alice');
  let releaseRead;
  let signalRead;
  let rejectRead;
  const hasRead = new Promise((resolve, reject) => { signalRead = resolve; rejectRead = reject; });
  const resume = new Promise((resolve) => { releaseRead = resolve; });
  async function within(promise, step) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tiempo agotado: ${step}`)), 5000);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }
  let attempts = 0;
  const pending = runTransaction(client, async (tx) => {
    const closureRef = doc(client, `catalog/puma/closures/${tomorrow()}`);
    await tx.get(closureRef);
    if (++attempts === 1) {
      signalRead();
      await resume;
    }
    // Un cliente manipulado sigue intentando reservar aunque ya haya un cierre.
    addHold(tx, client, 'racing-request', booking());
  });
  // Un error antes de signalRead debe fallar el test, no dejar la barrera esperando.
  const settled = pending.then(() => undefined, (error) => { rejectRead(error); });
  let failure;
  try {
    await within(hasRead, 'lectura inicial de la transacción');
    await within(assertSucceeds(closure(dbFor('admin'))), 'cierre del administrador');
    releaseRead();
    await within(assertFails(pending), 'rechazo de la reserva desactualizada');
    assert.equal(await previousData('direct_requests/racing-request'), null);
    assert.equal((await previousData(`establishments/puma/closures/${tomorrow()}`)).closed, true);
  } catch (error) {
    failure = error;
  } finally {
    releaseRead();
    try {
      await within(settled, 'finalización de la transacción liberada');
    } catch (error) {
      failure = failure ? new AggregateError([failure, error], 'Falló la carrera y su finalización') : error;
    }
  }
  if (failure) throw failure;
});
