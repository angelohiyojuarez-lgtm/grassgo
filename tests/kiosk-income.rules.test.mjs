import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

let env;
const dbFor = (uid) => env.authenticatedContext(uid).firestore();
const productPath = (id, productId) => `establishments/${id}/kiosk_products/${productId}`;
const movementPath = (id, operationId) => `establishments/${id}/kiosk_movements/${operationId}`;
const incomePath = (id, reservationId) => `establishments/${id}/court_income/${reservationId}`;
const snapshot = (p) => ({ name: p.name, category: p.category, priceCents: p.priceCents, costCents: p.costCents, active: p.active });
const payment = { mode: 'demo', qr: '', methods: ['Yape'], recipient: '', phone: '' };
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-grassgo-kiosk-tests', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(), b = writeBatch(db);
    b.set(doc(db, 'platform_roles/root'), { role: 'superadmin', status: 'active' });
    b.set(doc(db, 'platform_roles/suspended-root'), { role: 'superadmin', status: 'suspended' });
    for (const id of ['a', 'b']) {
      b.set(doc(db, 'establishments', id), { name: `Grass ${id}`, status: 'published', bookingEngine: 'direct', bookingPolicy: { enabled: true, advanceCents: 1500, holdMinutes: 15 } });
      b.set(doc(db, 'establishments', id, 'members', `admin-${id}`), { role: 'admin', status: 'active' });
      const court = { name: 'Principal', status: 'active', maintenance: false, runtime: null, openHour: 0, closeHour: 24, openDays: [], dayPriceCents: 3000, nightPriceCents: 4000, nightStartsAt: 18 };
      b.set(doc(db, 'establishments', id, 'courts', 'principal'), court);
      b.set(doc(db, 'catalog', id, 'courts', 'principal'), court);
      b.set(doc(db, 'catalog', id), { name: `Grass ${id}`, status: 'published', advanceCents: 1500, booking: { enabled: true, engine: 'direct', holdMinutes: 15, payment } });
    }
    b.set(doc(db, 'establishments/a/members/seller-two'), { role: 'admin', status: 'active' });
    b.set(doc(db, 'profiles/customer'), { uid: 'customer', displayName: 'Cliente', phone: '999111222' });
    await b.commit();
  });
});
async function trusted(path) {
  let result;
  await env.withSecurityRulesDisabled(async (context) => { result = (await getDoc(doc(context.firestore(), path))).data() ?? null; });
  return result;
}
function createProduct({ id = 'a', actor = 'admin-a', productId = randomUUID(), operationId = randomUUID(), values = {}, movementExtra = {}, omit = [] } = {}) {
  const db = dbFor(actor), b = writeBatch(db);
  const p = { name: 'Agua', category: 'Bebidas', priceCents: 500, costCents: 200, stock: 5, active: true, revision: 1, createdAt: serverTimestamp(), createdBy: actor, updatedAt: serverTimestamp(), updatedBy: actor, lastMovementId: operationId, ...values };
  const m = { productId, kind: 'create', quantity: p.stock, stockBefore: 0, stockAfter: p.stock, productSnapshot: snapshot(p), totalCents: 0, costTotalCents: null, profitCents: null, paymentMethod: null, paymentReceived: false, revision: 1, actorUid: actor, at: serverTimestamp(), ...movementExtra };
  if (!omit.includes('product')) b.set(doc(db, productPath(id, productId)), p);
  if (!omit.includes('movement')) b.set(doc(db, movementPath(id, operationId)), m);
  return { productId, operationId, commit: () => b.commit() };
}
async function operation(productId, kind, quantity = 0, { id = 'a', actor = 'admin-a', changes = {}, movementExtra = {}, operationId = randomUUID(), before, omit = [] } = {}) {
  const previous = before ?? await trusted(productPath(id, productId));
  const stock = kind === 'restock' ? previous.stock + quantity : kind === 'sale' ? previous.stock - quantity : previous.stock;
  const current = { ...previous, ...changes, stock, revision: previous.revision + 1, updatedAt: serverTimestamp(), updatedBy: actor, lastMovementId: operationId };
  const cost = previous.costCents == null ? null : previous.costCents * quantity;
  const m = { productId, kind, quantity, stockBefore: previous.stock, stockAfter: current.stock, productSnapshot: snapshot(kind === 'edit' ? current : previous), totalCents: kind === 'sale' ? previous.priceCents * quantity : 0, costTotalCents: kind === 'sale' ? cost : null, profitCents: kind === 'sale' && cost != null ? (previous.priceCents - previous.costCents) * quantity : null, paymentMethod: kind === 'sale' ? 'cash' : null, paymentReceived: kind === 'sale', revision: current.revision, actorUid: actor, at: serverTimestamp(), ...movementExtra };
  const db = dbFor(actor), b = writeBatch(db);
  if (!omit.includes('product')) b.set(doc(db, productPath(id, productId)), current);
  if (!omit.includes('movement')) b.set(doc(db, movementPath(id, operationId)), m);
  return { operationId, commit: () => b.commit() };
}
async function seedRequest(reservationId, { id = 'a', confirmed = false, advance = 1500, reviewedBy = 'admin-a', totalCents = 3000, courtName = 'Principal' } = {}) {
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const startsAt = Timestamp.fromDate(new Date(`${date}T14:00:00-05:00`));
  const createdAt = Timestamp.fromMillis(Date.now() - 2000);
  const r = { clientUid: 'customer', establishmentId: id, establishmentName: `Grass ${id}`, courtId: 'principal', courtName, date, hour: 14, startsAt, endsAt: Timestamp.fromMillis(startsAt.toMillis() + 3600000), totalCents, advanceCents: advance, createdAt, status: confirmed ? 'confirmed' : 'pending_verification', paymentStatus: confirmed ? 'verified' : 'submitted', paymentSnapshot: payment, proofSubmittedAt: createdAt,
    ...(confirmed ? { reviewedAt: Timestamp.fromMillis(1000), reviewedBy, verifiedAdvanceCents: advance } : {}) };
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(), b = writeBatch(db);
    b.set(doc(db, 'direct_requests', reservationId), r);
    b.set(doc(db, `direct_slots/${id}/courts/principal/days/${date}/hours/14`), { reservationId, lockedAt: createdAt, status: confirmed ? 'confirmed' : 'held', reviewPending: !confirmed });
    b.set(doc(db, 'direct_proofs', reservationId), { reservationId, clientUid: 'customer', establishmentId: id, contentType: 'image/jpeg', imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(100), sha256: 'a'.repeat(64), createdAt });
    await b.commit();
  });
  return r;
}
function initialIncome(reservationId, r) {
  return { reservationId, courtId: r.courtId, courtName: r.courtName, date: r.date, hour: r.hour, totalCents: r.totalCents, advanceCents: r.verifiedAdvanceCents, advanceAt: r.reviewedAt, advanceBy: r.reviewedBy, balanceCents: 0, balanceAt: null, balanceBy: null, balanceMethod: null };
}
function review(reservationId, r, { actor = 'admin-a', action = 'confirm', omitIncome = false, incomeExtra = {} } = {}) {
  const db = dbFor(actor), b = writeBatch(db), confirms = action === 'confirm';
  const after = { ...r, status: confirms ? 'confirmed' : 'rejected', paymentStatus: confirms ? 'verified' : 'unpaid', reviewedAt: serverTimestamp(), reviewedBy: actor, ...(confirms ? { verifiedAdvanceCents: r.advanceCents } : {}) };
  b.update(doc(db, 'direct_requests', reservationId), { status: after.status, paymentStatus: after.paymentStatus, reviewedAt: after.reviewedAt, reviewedBy: actor, ...(confirms ? { verifiedAdvanceCents: r.advanceCents } : {}) });
  b.update(doc(db, `direct_slots/${r.establishmentId}/courts/${r.courtId}/days/${r.date}/hours/${r.hour}`), { status: confirms ? 'confirmed' : 'released', reviewPending: false });
  if (confirms && !omitIncome) b.set(doc(db, incomePath(r.establishmentId, reservationId)), { ...initialIncome(reservationId, after), ...incomeExtra });
  return b.commit();
}

test('1. Productos e historial pertenecen al negocio; dueño y superadmin operan, clientes y otros locales no obtienen acceso', async () => {
  const created = createProduct(); await assertSucceeds(created.commit());
  await assertSucceeds((await operation(created.productId, 'edit', 0, { changes: { name: 'Agua mineral', category: 'Sin alcohol' } })).commit());
  await assertSucceeds(getDocs(collection(dbFor('admin-a'), 'establishments/a/kiosk_products')));
  await assertSucceeds(getDoc(doc(dbFor('root'), movementPath('a', created.operationId))));
  for (const uid of ['customer', 'admin-b', 'suspended-root']) {
    await assertFails(getDoc(doc(dbFor(uid), productPath('a', created.productId))));
    await assertFails(getDocs(collection(dbFor(uid), 'establishments/a/kiosk_movements')));
    await assertFails(createProduct({ actor: uid }).commit());
  }
  await assertSucceeds(createProduct({ id: 'b', actor: 'root' }).commit());
  await assertFails(createProduct({ id: 'b', actor: 'admin-a' }).commit());
  await assertFails(createProduct({ id: 'missing', actor: 'root' }).commit());
  for (const omit of [['movement'], ['product']]) await assertFails(createProduct({ omit }).commit());
  await assertFails(deleteDoc(doc(dbFor('root'), productPath('a', created.productId))));
  await assertFails(deleteDoc(doc(dbFor('root'), movementPath('a', created.operationId))));
  await env.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'establishments/a'), { status: 'suspended' }));
  await assertSucceeds(getDoc(doc(dbFor('root'), productPath('a', created.productId))));
  await assertFails(createProduct({ actor: 'root' }).commit());
  await assertFails(getDoc(doc(dbFor('admin-a'), productPath('a', created.productId))));
});

test('2. Reposición, venta y dos vendedores mantienen stock no negativo y operaciones inmutables sin doble venta por reintento', async () => {
  const created = createProduct({ values: { stock: 1 } }); await created.commit();
  await assertSucceeds((await operation(created.productId, 'restock', 2)).commit());
  const firstSale = await operation(created.productId, 'sale', 2); await assertSucceeds(firstSale.commit());
  assert.equal((await trusted(productPath('a', created.productId))).stock, 1);
  const previous = await trusted(productPath('a', created.productId));
  const one = await operation(created.productId, 'sale', 1, { before: previous });
  const two = await operation(created.productId, 'sale', 1, { actor: 'seller-two', before: previous });
  const results = await Promise.allSettled([one.commit(), two.commit()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await trusted(productPath('a', created.productId))).stock, 0);
  await assertFails((await operation(created.productId, 'sale', 1)).commit());
  await assertFails((await operation(created.productId, 'restock', -1)).commit());
  await assertFails((await operation(created.productId, 'restock', 1, { operationId: firstSale.operationId })).commit());
  await assertFails(updateDoc(doc(dbFor('root'), movementPath('a', firstSale.operationId)), { quantity: 20, totalCents: 10000 }));
  assert.equal((await trusted(movementPath('a', firstSale.operationId))).totalCents, 1000);
});

test('3. Cada venta usa precio y costo anteriores; conserva costo desconocido, pérdidas, revisiones y archivos sin aceptar falsificaciones', async () => {
  const created = createProduct({ values: { costCents: 600 } }); await created.commit();
  const loss = await operation(created.productId, 'sale', 2); await assertSucceeds(loss.commit());
  assert.equal((await trusted(movementPath('a', loss.operationId))).profitCents, -200);
  await assertSucceeds((await operation(created.productId, 'edit', 0, { changes: { priceCents: 700, costCents: null } })).commit());
  const unknownCost = await operation(created.productId, 'sale', 1); await assertSucceeds(unknownCost.commit());
  assert.equal((await trusted(movementPath('a', unknownCost.operationId))).totalCents, 700);
  assert.equal((await trusted(movementPath('a', unknownCost.operationId))).profitCents, null);
  for (const movementExtra of [{ totalCents: 1 }, { costTotalCents: 0 }, { profitCents: 700 }, { paymentReceived: false }, { actorUid: 'admin-b' }])
    await assertFails((await operation(created.productId, 'sale', 1, { movementExtra })).commit());
  await assertFails((await operation(created.productId, 'sale', 1, { changes: { priceCents: 1 } })).commit());
  for (const changes of [{ priceCents: 0 }, { costCents: -1 }, { role: 'superadmin' }, { createdBy: 'admin-b' }, { name: 'x'.repeat(101) }])
    await assertFails((await operation(created.productId, 'edit', 0, { changes })).commit());
  await assertSucceeds((await operation(created.productId, 'edit', 0, { changes: { active: false } })).commit());
  await assertFails((await operation(created.productId, 'sale', 1)).commit());
  await assertSucceeds((await operation(created.productId, 'restock', 1)).commit());
  assert.equal((await trusted(productPath('a', created.productId))).active, false);
  assert.equal((await trusted(movementPath('a', loss.operationId))).productSnapshot.priceCents, 500);
});

test('4. Confirmar exige ingreso atómico; rechazo no cobra y el respaldo histórico deriva únicamente del pago verificado original', async () => {
  const r = await seedRequest('reservation-live');
  await assertFails(review('reservation-live', r, { omitIncome: true }));
  await assertFails(review('reservation-live', r, { incomeExtra: { advanceCents: 1000 } }));
  await assertFails(review('reservation-live', r, { incomeExtra: { clientUid: 'customer' } }));
  await assertSucceeds(review('reservation-live', r));
  const ledger = (await getDoc(doc(dbFor('root'), incomePath('a', 'reservation-live')))).data();
  assert.equal(ledger.advanceCents, 1500); assert.equal(ledger.balanceCents, 0);
  assert.equal('clientUid' in ledger, false); assert.equal('paymentSnapshot' in ledger, false);
  await assertFails(getDoc(doc(dbFor('root'), 'direct_requests/reservation-live')));
  await assertFails(getDoc(doc(dbFor('root'), 'direct_proofs/reservation-live')));
  await assertFails(getDoc(doc(dbFor('root'), 'profiles/customer')));
  const rejected = await seedRequest('reservation-reject');
  await assertSucceeds(review('reservation-reject', rejected, { action: 'reject' }));
  assert.equal(await trusted(incomePath('a', 'reservation-reject')), null);
  await assertFails(setDoc(doc(dbFor('root'), incomePath('a', 'reservation-reject')), initialIncome('reservation-reject', { ...rejected, reviewedAt: Timestamp.now(), reviewedBy: 'admin-a', verifiedAdvanceCents: 1500 })));
  const historical = await seedRequest('reservation-historical', { confirmed: true, reviewedBy: 'original-admin' });
  const backup = initialIncome('reservation-historical', historical);
  await assertSucceeds(setDoc(doc(dbFor('root'), incomePath('a', 'reservation-historical')), backup));
  assert.equal((await trusted(incomePath('a', 'reservation-historical'))).advanceAt.toMillis(), 1000);
  assert.equal((await trusted(incomePath('a', 'reservation-historical'))).advanceBy, 'original-admin');
  await assertFails(setDoc(doc(dbFor('root'), incomePath('a', 'reservation-historical')), backup));
  await assertFails(setDoc(doc(dbFor('root'), incomePath('b', 'reservation-historical')), backup));
  const historicalLarge = await seedRequest('historical-large', { confirmed: true, totalCents: 100000000, courtName: 'x'.repeat(120) });
  await assertSucceeds(setDoc(doc(dbFor('root'), incomePath('a', 'historical-large')), initialIncome('historical-large', historicalLarge)));
  assert.equal((await trusted(incomePath('a', 'historical-large'))).totalCents, 100000000);
});

test('5. El saldo cobra solo el resto real una vez, conserva adelanto y datos históricos y mantiene aislamiento por negocio', async () => {
  const source = await seedRequest('balance-source', { confirmed: true });
  await setDoc(doc(dbFor('admin-a'), incomePath('a', 'balance-source')), initialIncome('balance-source', source));
  const ref = doc(dbFor('admin-a'), incomePath('a', 'balance-source'));
  const balance = { balanceCents: 1500, balanceAt: serverTimestamp(), balanceBy: 'admin-a', balanceMethod: 'cash' };
  for (const changes of [{ balanceCents: 1499 }, { balanceCents: 1501 }, { balanceCents: 0 }, { balanceBy: 'admin-b' }, { balanceMethod: 'card' }, { advanceCents: 1000 }, { courtName: 'Otra cancha' }])
    await assertFails(updateDoc(ref, { ...balance, ...changes }));
  await assertFails(updateDoc(doc(dbFor('admin-b'), incomePath('a', 'balance-source')), { ...balance, balanceBy: 'admin-b' }));
  await assertFails(getDoc(doc(dbFor('customer'), incomePath('a', 'balance-source'))));
  await assertSucceeds(updateDoc(ref, balance));
  await assertFails(updateDoc(ref, balance));
  const saved = (await getDoc(doc(dbFor('root'), incomePath('a', 'balance-source')))).data();
  assert.equal(saved.advanceCents + saved.balanceCents, saved.totalCents);
  assert.equal(saved.advanceAt.toMillis(), 1000);
  await assertFails(deleteDoc(doc(dbFor('root'), incomePath('a', 'balance-source'))));
  const prepaid = await seedRequest('fully-prepaid', { confirmed: true, advance: 3000 });
  await setDoc(doc(dbFor('root'), incomePath('a', 'fully-prepaid')), initialIncome('fully-prepaid', prepaid));
  await assertFails(updateDoc(doc(dbFor('root'), incomePath('a', 'fully-prepaid')), { balanceCents: 0, balanceAt: serverTimestamp(), balanceBy: 'root', balanceMethod: 'cash' }));
});
