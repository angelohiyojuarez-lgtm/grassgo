import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let env;
const prefix = 'data:image/jpeg;base64,/9j/';
const photo = prefix + 'A'.repeat(100);
const replacement = prefix + 'B'.repeat(100);
const dbFor = (uid) => env.authenticatedContext(uid).firestore();
const productPath = (id, productId) => `establishments/${id}/kiosk_products/${productId}`;
const movementPath = (id, movementId) => `establishments/${id}/kiosk_movements/${movementId}`;
const snapshot = (p) => ({ name: p.name, category: p.category, priceCents: p.priceCents, costCents: p.costCents, active: p.active });
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-grassgo-kiosk-photo-tests', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(), b = writeBatch(db);
    b.set(doc(db, 'platform_roles/root'), { role: 'superadmin', status: 'active' });
    for (const id of ['a', 'b']) {
      b.set(doc(db, 'establishments', id), { name: `Grass ${id}`, status: 'published', bookingEngine: 'direct' });
      b.set(doc(db, 'establishments', id, 'members', `admin-${id}`), { role: 'admin', status: 'active' });
    }
    await b.commit();
  });
});
async function trusted(path) {
  let data;
  await env.withSecurityRulesDisabled(async (context) => { data = (await getDoc(doc(context.firestore(), path))).data() ?? null; });
  return data;
}
function create({ id = 'a', actor = 'admin-a', values = {}, movementExtra = {} } = {}) {
  const productId = randomUUID(), movementId = randomUUID(), db = dbFor(actor), b = writeBatch(db);
  const p = { name: 'Agua', category: 'Bebidas', priceCents: 500, costCents: 200, stock: 5, active: true, revision: 1, createdAt: serverTimestamp(), createdBy: actor, updatedAt: serverTimestamp(), updatedBy: actor, lastMovementId: movementId, ...values };
  b.set(doc(db, productPath(id, productId)), p);
  b.set(doc(db, movementPath(id, movementId)), { productId, kind: 'create', quantity: p.stock, stockBefore: 0, stockAfter: p.stock, productSnapshot: snapshot(p), totalCents: 0, costTotalCents: null, profitCents: null, paymentMethod: null, paymentReceived: false, revision: 1, actorUid: actor, at: serverTimestamp(), ...movementExtra });
  return { productId, movementId, commit: () => b.commit() };
}
async function change(productId, kind, { id = 'a', actor = 'admin-a', quantity = 0, changes = {}, dropPhoto = false, movementExtra = {}, omitMovement = false } = {}) {
  const previous = await trusted(productPath(id, productId)), movementId = randomUUID(), db = dbFor(actor), b = writeBatch(db);
  const stock = kind === 'sale' ? previous.stock - quantity : kind === 'restock' ? previous.stock + quantity : previous.stock;
  const current = { ...previous, ...changes, stock, revision: previous.revision + 1, updatedAt: serverTimestamp(), updatedBy: actor, lastMovementId: movementId };
  if (dropPhoto) delete current.photo;
  const sale = kind === 'sale', cost = previous.costCents == null ? null : previous.costCents * quantity;
  const movement = { productId, kind, quantity, stockBefore: previous.stock, stockAfter: stock, productSnapshot: snapshot(kind === 'edit' ? current : previous), totalCents: sale ? previous.priceCents * quantity : 0, costTotalCents: sale ? cost : null, profitCents: sale && cost != null ? (previous.priceCents - previous.costCents) * quantity : null, paymentMethod: sale ? 'cash' : null, paymentReceived: sale, revision: current.revision, actorUid: actor, at: serverTimestamp(), ...movementExtra };
  b.set(doc(db, productPath(id, productId)), current);
  if (!omitMovement) b.set(doc(db, movementPath(id, movementId)), movement);
  return { movementId, commit: () => b.commit() };
}

test('1. Foto JPEG opcional admite legado, null, dueño y superadmin; reemplazar o quitar no cambia stock ni importes', async () => {
  const withPhoto = create({ values: { photo } }); await assertSucceeds(withPhoto.commit());
  const legacy = create(); await assertSucceeds(legacy.commit());
  const empty = create({ values: { photo: null } }); await assertSucceeds(empty.commit());
  const otherBusiness = create({ id: 'b', actor: 'root', values: { photo } }); await assertSucceeds(otherBusiness.commit());
  assert.equal(Object.hasOwn(await trusted(productPath('a', legacy.productId)), 'photo'), false);
  assert.equal((await trusted(productPath('a', empty.productId))).photo, null);
  const before = await trusted(productPath('a', withPhoto.productId));
  await assertSucceeds((await change(withPhoto.productId, 'edit', { actor: 'root', changes: { photo: replacement } })).commit());
  const replaced = await trusted(productPath('a', withPhoto.productId));
  assert.equal(replaced.photo, replacement);
  for (const key of ['stock', 'priceCents', 'costCents', 'active']) assert.equal(replaced[key], before[key]);
  await assertSucceeds((await change(withPhoto.productId, 'edit', { changes: { photo: null } })).commit());
  assert.equal((await trusted(productPath('a', withPhoto.productId))).photo, null);
  await assertSucceeds((await change(legacy.productId, 'edit', { changes: { photo } })).commit());
  const storedMovement = await trusted(movementPath('a', withPhoto.movementId));
  assert.deepEqual(Object.keys(storedMovement.productSnapshot).sort(), ['active', 'category', 'costCents', 'name', 'priceCents']);
});

test('2. Rechaza URL, SVG, PNG sin convertir, tipos o tamaños inválidos y permisos ajenos con la misma transacción', async () => {
  const invalid = [
    'https://example.com/product.jpg', 'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=', 'data:text/html;base64,PHNjcmlwdD4=',
    prefix, prefix + '@'.repeat(100), prefix + 'A'.repeat(180000), {}, 123, false,
  ];
  for (const value of invalid) await assertFails(create({ values: { photo: value } }).commit());
  const maxPhoto = prefix + 'A'.repeat(180000 - prefix.length);
  await assertSucceeds(create({ actor: 'root', values: { photo: maxPhoto } }).commit());
  await assertFails(create({ actor: 'customer', values: { photo } }).commit());
  await assertFails(create({ actor: 'admin-b', values: { photo } }).commit());
  const existing = create({ values: { photo } }); await existing.commit();
  await assertFails((await change(existing.productId, 'edit', { actor: 'admin-b', changes: { photo: replacement } })).commit());
  await assertFails((await change(existing.productId, 'edit', { changes: { photo: invalid[0] } })).commit());
  await assertFails(getDoc(doc(dbFor('customer'), productPath('a', existing.productId))));
  assert.equal((await trusted(productPath('a', existing.productId))).photo, photo);
});

test('3. Venta y reposición conservan foto o ausencia exacta; el historial nunca acepta imágenes ni cambios sin movimiento', async () => {
  const created = create({ values: { photo } }); await created.commit();
  const sale = await change(created.productId, 'sale', { quantity: 1 }); await assertSucceeds(sale.commit());
  const refill = await change(created.productId, 'restock', { quantity: 2 }); await assertSucceeds(refill.commit());
  assert.equal((await trusted(productPath('a', created.productId))).photo, photo);
  assert.equal((await trusted(productPath('a', created.productId))).stock, 6);
  for (const movementId of [created.movementId, sale.movementId, refill.movementId]) {
    const m = await trusted(movementPath('a', movementId));
    assert.deepEqual(Object.keys(m.productSnapshot).sort(), ['active', 'category', 'costCents', 'name', 'priceCents']);
    assert.equal(JSON.stringify(m).includes('data:image/'), false);
  }
  for (const kind of ['sale', 'restock']) {
    await assertFails((await change(created.productId, kind, { quantity: 1, changes: { photo: replacement } })).commit());
    await assertFails((await change(created.productId, kind, { quantity: 1, changes: { photo: null } })).commit());
    await assertFails((await change(created.productId, kind, { quantity: 1, dropPhoto: true })).commit());
  }
  await assertFails(updateDoc(doc(dbFor('admin-a'), productPath('a', created.productId)), { photo: replacement }));
  await assertFails((await change(created.productId, 'edit', { changes: { photo: replacement }, omitMovement: true })).commit());
  await assertFails((await change(created.productId, 'sale', { quantity: 1, movementExtra: { productSnapshot: { ...(await trusted(movementPath('a', sale.movementId))).productSnapshot, photo } } })).commit());
  const legacy = create(); await legacy.commit();
  await assertSucceeds((await change(legacy.productId, 'sale', { quantity: 1 })).commit());
  await assertSucceeds((await change(legacy.productId, 'restock', { quantity: 1 })).commit());
  assert.equal(Object.hasOwn(await trusted(productPath('a', legacy.productId)), 'photo'), false);
  await assertFails((await change(legacy.productId, 'restock', { quantity: 1, changes: { photo: null } })).commit());
  assert.equal((await trusted(movementPath('a', sale.movementId))).totalCents, 500);
});
