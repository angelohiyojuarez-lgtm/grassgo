import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

let env;
const title = 'Grass multideporte';
const stamp = Timestamp.fromMillis(1000);
const dbFor = (uid) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
const meta = (id, actor = 'root') => ({ lifecycleChangeId: id, lifecycleUpdatedAt: serverTimestamp(), lifecycleUpdatedBy: actor });
const lifecycleEvent = (id, actor, action, status, publicationStatus) => ({ action, establishmentId: id, actorUid: actor, at: serverTimestamp(), status, publicationStatus });
const pricingEvent = (id, courtId, revision, actor) => ({ action: 'business_setting_changed', establishmentId: id, actorUid: actor, at: serverTimestamp(), kind: 'pricing', referenceId: courtId, revision });
const courtPath = (id, courtId, prefix = 'establishments') => `${prefix}/${id}/courts/${courtId}`;
const pricingPath = (id, courtId) => `${courtPath(id, courtId)}/settings/pricing`;
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-grassgo-multicourt-tests', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'platform_roles/root'), { role: 'superadmin', status: 'active' }));
});
async function trusted(path) {
  let data;
  await env.withSecurityRulesDisabled(async (context) => { data = (await getDoc(doc(context.firestore(), path))).data() ?? null; });
  return data;
}
async function createBusiness() {
  const id = randomUUID(), db = dbFor('root'), b = writeBatch(db);
  b.set(doc(db, 'establishments', id), { name: title, location: 'Andahuaylas', status: 'approved', bookingEngine: 'direct', bookingPolicy: { enabled: false, advanceCents: 1500, holdMinutes: 15 }, ownerInvitationId: id, createdBy: 'root', createdAt: serverTimestamp(), ...meta(id) });
  b.set(doc(db, 'catalog', id), { name: title, location: 'Andahuaylas', status: 'draft', description: '', reference: '', district: '', phone: '', images: [], courts: [], advanceCents: 1500, booking: { engine: 'direct', enabled: false, holdMinutes: 15 }, ...meta(id) });
  b.set(doc(db, 'establishment_invitations', id), { establishmentId: id, establishmentName: title, targetEmail: 'owner@example.com', status: 'pending', createdBy: 'root', createdAt: serverTimestamp() });
  b.set(doc(db, 'audit_logs', id), lifecycleEvent(id, 'root', 'establishment_created', 'approved', 'draft'));
  await b.commit(); return id;
}
async function addCourt(id, courtId, options = {}) {
  const { actor = 'root', sport = 'Fútbol', name = `${sport} ${courtId === 'principal' ? 'principal' : 'secundaria'}`, day = 3000, omit = [], parentExtra = {} } = options;
  const db = dbFor(actor), old = await trusted(`catalog/${id}`), b = writeBatch(db), auditId = randomUUID();
  const prices = { dayPriceCents: day, nightPriceCents: 4000, nightStartsAt: 18 };
  const cert = { pricingRevision: 1, pricingUpdatedAt: serverTimestamp() };
  const c = { name, sport, surface: 'Sintético', images: [], ...prices, status: 'active', maintenance: false, runtime: null, ...cert };
  const d = { establishmentId: id, courtId, ...prices, revision: 1, updatedAt: serverTimestamp(), updatedBy: actor };
  if (!omit.includes('private')) b.set(doc(db, courtPath(id, courtId)), c);
  if (!omit.includes('public')) b.set(doc(db, courtPath(id, courtId, 'catalog')), c);
  if (!omit.includes('canonical')) b.set(doc(db, pricingPath(id, courtId)), d);
  if (!omit.includes('parent')) b.update(doc(db, 'catalog', id), { courts: [...old.courts, { id: courtId, name, sport, surface: 'Sintético', images: [], ...prices, pricingRevision: 1, pricingConfirmed: true }], pricingCourtId: courtId, pricingCourtIndex: old.courts.length, pricingRevision: 1, pricingUpdatedAt: serverTimestamp(), courtAdditionId: auditId, courtAdditionAt: serverTimestamp(), courtAdditionBy: actor, ...parentExtra });
  if (!omit.includes('history')) b.set(doc(db, pricingPath(id, courtId) + '/history/1'), { establishmentId: id, kind: 'pricing', revision: 1, actorUid: actor, at: serverTimestamp(), before: null, after: d });
  if (!omit.includes('audit')) b.set(doc(db, 'audit_logs', auditId), pricingEvent(id, courtId, 1, actor));
  await b.commit(); return courtId;
}
async function price(id, courtId, options = {}) {
  const { actor = 'owner', day = 3500, privateExtra = {}, parentExtra = {}, omit = [] } = options;
  const db = dbFor(actor), old = await trusted(`catalog/${id}`), previous = await trusted(pricingPath(id, courtId));
  const index = old.courts.findIndex((c) => c.id === courtId), revision = (previous?.revision ?? 0) + 1;
  const prices = { dayPriceCents: day, nightPriceCents: 4500, nightStartsAt: 19 };
  const cert = { pricingRevision: revision, pricingUpdatedAt: serverTimestamp() };
  const current = { establishmentId: id, courtId, ...prices, revision, updatedAt: serverTimestamp(), updatedBy: actor };
  const b = writeBatch(db);
  b.set(doc(db, pricingPath(id, courtId)), current);
  b.update(doc(db, courtPath(id, courtId)), { ...prices, ...cert, ...privateExtra });
  b.update(doc(db, courtPath(id, courtId, 'catalog')), { ...prices, ...cert });
  if (!omit.includes('certificate')) b.update(doc(db, 'catalog', id), { courts: old.courts.map((c, i) => i === index ? { ...c, ...prices, pricingRevision: revision, pricingConfirmed: true } : c), pricingCourtId: courtId, pricingCourtIndex: index, pricingRevision: revision, pricingUpdatedAt: serverTimestamp(), ...parentExtra });
  b.set(doc(db, `${pricingPath(id, courtId)}/history/${revision}`), { establishmentId: id, kind: 'pricing', revision, actorUid: actor, at: serverTimestamp(), before: previous, after: current });
  b.set(doc(db, 'audit_logs', randomUUID()), pricingEvent(id, courtId, revision, actor));
  return b.commit();
}
const paymentFor = (id) => ({ mode: 'live', qr: `payment-qrs/${id}/real-qr`, methods: ['Yape'], recipient: 'Responsable real', phone: '999888777' });
async function ready(id) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(), b = writeBatch(db), payment = paymentFor(id);
    b.update(doc(db, 'establishments', id), { managedAdminUid: 'owner' });
    b.set(doc(db, 'establishments', id, 'members', 'owner'), { role: 'admin', status: 'active' });
    b.set(doc(db, 'establishments', id, 'settings', 'schedule'), { establishmentId: id, days: [0, 1, 2, 3, 4, 5, 6], openHour: 0, closeHour: 24, revision: 1, updatedAt: stamp, updatedBy: 'owner' });
    b.set(doc(db, 'establishments', id, 'settings', 'payment'), { establishmentId: id, ...payment, revision: 1, updatedAt: stamp, updatedBy: 'owner' });
    b.set(doc(db, 'catalog', id, 'paymentQrs', 'real-qr'), { establishmentId: id, id: 'real-qr', imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(100), contentType: 'image/jpeg', width: 800, height: 800, sha256: 'a'.repeat(64), createdAt: stamp });
    b.update(doc(db, 'catalog', id), { 'booking.payment': payment, days: [0, 1, 2, 3, 4, 5, 6], openHour: 0, closeHour: 24, scheduleRevision: 1, scheduleUpdatedAt: stamp, paymentRevision: 1, paymentUpdatedAt: stamp });
    await b.commit();
  });
}
function publish(id) {
  const db = dbFor('root'), auditId = randomUUID(), b = writeBatch(db);
  b.update(doc(db, 'establishments', id), { status: 'published', 'bookingPolicy.enabled': true, 'bookingPolicy.advanceCents': 1500, 'bookingPolicy.holdMinutes': 15, ...meta(auditId) });
  b.update(doc(db, 'catalog', id), { status: 'published', 'booking.enabled': true, 'booking.engine': 'direct', 'booking.holdMinutes': 15, ...meta(auditId) });
  b.set(doc(db, 'audit_logs', auditId), lifecycleEvent(id, 'root', 'business_published', 'published', 'published'));
  return b.commit();
}
async function hold(id, courtId, requestId, uid = 'client') {
  const db = dbFor(uid), c = await trusted(courtPath(id, courtId)), date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const startsAt = Timestamp.fromDate(new Date(`${date}T14:00:00-05:00`));
  const quota = (await getDoc(doc(db, 'direct_limits', uid, 'days', date))).data();
  const b = writeBatch(db);
  b.set(doc(db, 'direct_requests', requestId), { clientUid: uid, establishmentId: id, establishmentName: title, courtId, courtName: c.name, date, hour: 14, startsAt, endsAt: Timestamp.fromMillis(startsAt.toMillis() + 3600000), totalCents: c.dayPriceCents, advanceCents: 1500, createdAt: serverTimestamp(), status: 'pending_payment', paymentStatus: 'unpaid', paymentSnapshot: paymentFor(id) });
  b.set(doc(db, 'direct_slots', id, 'courts', courtId, 'days', date, 'hours', '14'), { reservationId: requestId, lockedAt: serverTimestamp(), status: 'held', reviewPending: false });
  b.set(doc(db, 'direct_limits', uid, 'days', date), { count: (quota?.count ?? 0) + 1, lastRequestId: requestId, updatedAt: serverTimestamp() });
  return b.commit();
}

test('1. Alta base y dos deportes se añaden secuencialmente; no duplica ni altera canchas previas y limita a veinte', async () => {
  const id = await createBusiness();
  assert.deepEqual((await trusted(`catalog/${id}`)).courts, []);
  await assertSucceeds(addCourt(id, 'principal'));
  const second = randomUUID(); await assertSucceeds(addCourt(id, second, { sport: 'Vóley' }));
  assert.deepEqual((await trusted(`catalog/${id}`)).courts.map((c) => c.sport), ['Fútbol', 'Vóley']);
  await assertFails(addCourt(id, second, { sport: 'Vóley' }));
  for (const omit of [['audit'], ['canonical'], ['public']]) await assertFails(addCourt(id, randomUUID(), { omit }));
  for (let i = 2; i < 20; i++) await assertSucceeds(addCourt(id, randomUUID(), { name: `Cancha ${i + 1}`, sport: i % 2 ? 'Vóley' : 'Fútbol' }));
  assert.equal((await trusted(`catalog/${id}`)).courts.length, 20);
  await assertFails(addCourt(id, randomUUID()));
  await assertFails(addCourt(id, randomUUID(), { actor: 'client' }));
});

test('2. Dueño propio y superadmin guardan precios certificados; otros roles, campos, montos y sobrescrituras quedan bloqueados', async () => {
  const id = await createBusiness(); await addCourt(id, 'principal'); const otherCourt = randomUUID(); await addCourt(id, otherCourt, { sport: 'Vóley' }); await ready(id);
  const originalOther = (await trusted(`catalog/${id}`)).courts[1];
  await assertSucceeds(price(id, 'principal'));
  await assertSucceeds(price(id, 'principal', { actor: 'root', day: 3700 }));
  assert.deepEqual((await trusted(`catalog/${id}`)).courts[1], originalOther);
  assert.equal((await trusted(`catalog/${id}`)).courts[0].pricingRevision, 3);
  await assertFails(price(id, 'principal', { actor: 'client' }));
  await assertFails(price(id, 'principal', { actor: 'other-owner' }));
  await assertFails(price(id, 'principal', { day: 1400 }));
  await assertFails(price(id, 'principal', { actor: 'root', privateExtra: { runtime: { started: true }, name: 'Usurpada' } }));
  await assertFails(price(id, 'principal', { parentExtra: { advanceCents: 2000 } }));
  await assertFails(price(id, 'principal', { omit: ['certificate'] }));
  await assertFails(addCourt(id, randomUUID(), { actor: 'owner' }));
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'establishments', id), { status: 'suspended', 'bookingPolicy.enabled': false });
    await updateDoc(doc(context.firestore(), 'catalog', id), { status: 'suspended', 'booking.enabled': false });
  });
  await assertFails(price(id, 'principal'));
  await assertSucceeds(price(id, 'principal', { actor: 'root', day: 3900 }));
  assert.equal((await trusted(`catalog/${id}`)).status, 'suspended');
  assert.equal((await trusted(`catalog/${id}`)).booking.enabled, false);
});

test('3. Publicar verifica certificados de ambas canchas y de veinte sin leer cuarenta documentos ni aceptar una tarifa incompleta', async () => {
  const id = await createBusiness(); await addCourt(id, 'principal'); await addCourt(id, randomUUID(), { sport: 'Vóley' }); await ready(id);
  const original = (await trusted(`catalog/${id}`)).courts;
  for (const bad of [{ pricingRevision: 0 }, { dayPriceCents: 1400 }, { pricingConfirmed: false }]) {
    await env.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'catalog', id), { courts: original.map((c, i) => i === 1 ? { ...c, ...bad } : c) }));
    await assertFails(publish(id));
  }
  await env.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'catalog', id), { courts: original }));
  await assertSucceeds(publish(id));
  const many = await createBusiness();
  for (let i = 0; i < 20; i++) await addCourt(many, i ? randomUUID() : 'principal', { name: `Cancha ${i + 1}`, sport: i % 2 ? 'Vóley' : 'Fútbol' });
  await ready(many);
  const originalTwenty = (await trusted(`catalog/${many}`)).courts;
  await env.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'catalog', many), {
    courts: originalTwenty.map((c, i) => i === 19 ? { ...c, pricingConfirmed: false } : c),
  }));
  await assertFails(publish(many));
  await env.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'catalog', many), { courts: originalTwenty }));
  await assertSucceeds(publish(many));
  assert.equal((await trusted(`catalog/${many}`)).booking.enabled, true);
  const lastCourtId = (await trusted(`catalog/${many}`)).courts.at(-1).id;
  await assertSucceeds(price(many, lastCourtId, { actor: 'root' }));
});

test('4. Fútbol y vóley reservan la misma hora con bloqueos independientes, conservando el bloqueo de cada cancha', async () => {
  const id = await createBusiness(); await addCourt(id, 'principal'); const volley = randomUUID(); await addCourt(id, volley, { sport: 'Vóley' }); await ready(id); await publish(id);
  await assertSucceeds(hold(id, 'principal', 'football-request'));
  await assertSucceeds(hold(id, volley, 'volley-request'));
  await assertFails(hold(id, 'principal', 'football-conflict', 'another-client'));
  assert.equal((await getDoc(doc(dbFor('client'), 'direct_requests/football-request'))).data().courtId, 'principal');
  assert.equal((await getDoc(doc(dbFor('client'), 'direct_requests/volley-request'))).data().courtId, volley);
});
