import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';

let env;
const name = 'Grass Nuevo';
const dbFor = (uid, email = `${uid}@example.com`, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const stamp = Timestamp.fromMillis(1000);
const court = { name: 'Principal', sport: 'Fútbol', surface: 'Sintético', images: [], dayPriceCents: null, nightPriceCents: null, nightStartsAt: null, status: 'active', maintenance: false, runtime: null };
const card = { id: 'principal', name: court.name, sport: court.sport, surface: court.surface, images: [], dayPriceCents: null, nightPriceCents: null, nightStartsAt: null };
const meta = (id, actor) => ({ lifecycleChangeId: id, lifecycleUpdatedAt: serverTimestamp(), lifecycleUpdatedBy: actor });
const event = (id, actor, action, status, publicationStatus) => ({ action, establishmentId: id, actorUid: actor, at: serverTimestamp(), status, publicationStatus });
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-grassgo-connected-flow-tests', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'platform_roles/root'), { role: 'superadmin', status: 'active' });
  });
});
function create(db, options = {}) {
  const { id = randomUUID(), actor = 'root', venueExtra = {}, catalogExtra = {}, invitationExtra = {}, omit = [] } = options;
  const b = writeBatch(db);
  const venue = { name, location: 'Andahuaylas', status: 'approved', bookingEngine: 'direct', bookingPolicy: { enabled: false, advanceCents: 1500, holdMinutes: 15 }, ownerInvitationId: id, createdBy: actor, createdAt: serverTimestamp(), ...meta(id, actor), ...venueExtra };
  if (!omit.includes('venue')) b.set(doc(db, 'establishments', id), venue);
  if (!omit.includes('catalog')) b.set(doc(db, 'catalog', id), { name, location: 'Andahuaylas', status: 'draft', description: '', reference: '', district: '', phone: '', images: [], courts: [card], advanceCents: 1500, booking: { engine: 'direct', enabled: false, holdMinutes: 15 }, ...meta(id, actor), ...catalogExtra });
  if (!omit.includes('court')) b.set(doc(db, 'establishments', id, 'courts', 'principal'), court);
  if (!omit.includes('public-court')) b.set(doc(db, 'catalog', id, 'courts', 'principal'), court);
  if (!omit.includes('invite')) b.set(doc(db, 'establishment_invitations', id), { establishmentId: id, establishmentName: name, targetEmail: 'owner@example.com', status: 'pending', createdBy: actor, createdAt: serverTimestamp(), ...invitationExtra });
  if (!omit.includes('audit')) b.set(doc(db, 'audit_logs', id), event(id, actor, 'establishment_created', 'approved', 'draft'));
  return { id, commit: () => b.commit() };
}
function accept(db, id, options = {}) {
  const { actor = 'owner', memberExtra = {}, indexExtra = {}, venueExtra = {}, omit = [] } = options;
  const auditId = randomUUID(), b = writeBatch(db);
  if (!omit.includes('invite')) b.update(doc(db, 'establishment_invitations', id), { status: 'accepted', acceptedBy: actor, acceptedAt: serverTimestamp() });
  if (!omit.includes('venue')) b.update(doc(db, 'establishments', id), { managedAdminUid: actor, ...meta(auditId, actor), ...venueExtra });
  if (!omit.includes('member')) b.set(doc(db, 'establishments', id, 'members', actor), { role: 'admin', status: 'active', ...memberExtra });
  if (!omit.includes('index')) b.set(doc(db, 'users', actor, 'memberships', id), { name, role: 'admin', status: 'active', ...indexExtra });
  if (!omit.includes('audit')) b.set(doc(db, 'audit_logs', auditId), event(id, actor, 'owner_invitation_accepted', 'approved', 'draft'));
  return b.commit();
}
const paymentFor = (id) => ({ mode: 'live', qr: `payment-qrs/${id}/real-qr`, methods: ['Yape'], phone: '999888777', recipient: 'Responsable real' });
const qrFor = (id) => ({ establishmentId: id, id: 'real-qr', imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(100), contentType: 'image/jpeg', width: 800, height: 800, sha256: 'a'.repeat(64), createdAt: stamp });
async function ready(id, { qr = true, published = false } = {}) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(), b = writeBatch(db), p = paymentFor(id);
    const prices = { dayPriceCents: 3000, nightPriceCents: 4000, nightStartsAt: 18 };
    const currentCourt = { ...court, ...prices, pricingRevision: 1, pricingUpdatedAt: stamp };
    b.set(doc(db, 'establishments', id), { name, location: 'Andahuaylas', status: published ? 'published' : 'approved', bookingEngine: 'direct', bookingPolicy: { enabled: published, advanceCents: 1500, holdMinutes: 15 }, managedAdminUid: 'owner', ownerInvitationId: id, lifecycleChangeId: id, lifecycleUpdatedAt: stamp, lifecycleUpdatedBy: 'root' });
    b.set(doc(db, 'establishments', id, 'members', 'owner'), { role: 'admin', status: 'active' });
    b.set(doc(db, 'establishments', id, 'settings', 'schedule'), { establishmentId: id, days: [0, 1, 2, 3, 4, 5, 6], openHour: 0, closeHour: 24, revision: 1, updatedAt: stamp, updatedBy: 'owner' });
    b.set(doc(db, 'establishments', id, 'settings', 'payment'), { establishmentId: id, ...p, revision: 1, updatedAt: stamp, updatedBy: 'owner' });
    b.set(doc(db, 'establishments', id, 'courts', 'principal'), currentCourt);
    b.set(doc(db, 'catalog', id, 'courts', 'principal'), currentCourt);
    b.set(doc(db, 'catalog', id), { name, location: 'Andahuaylas', status: published ? 'published' : 'draft', advanceCents: 1500, courts: [{ ...card, ...prices }], booking: { engine: 'direct', enabled: published, holdMinutes: 15, payment: p }, days: [0, 1, 2, 3, 4, 5, 6], openHour: 0, closeHour: 24, scheduleRevision: 1, scheduleUpdatedAt: stamp, paymentRevision: 1, paymentUpdatedAt: stamp, lifecycleChangeId: id, lifecycleUpdatedAt: stamp, lifecycleUpdatedBy: 'root' });
    if (qr) b.set(doc(db, 'catalog', id, 'paymentQrs', 'real-qr'), qrFor(id));
    await b.commit();
  });
}
function publish(db, id, options = {}) {
  const { actor = 'root', omit = [], catalogExtra = {} } = options, auditId = randomUUID(), b = writeBatch(db);
  if (!omit.includes('venue')) b.update(doc(db, 'establishments', id), { status: 'published', 'bookingPolicy.enabled': true, 'bookingPolicy.holdMinutes': 15, 'bookingPolicy.advanceCents': 1500, ...meta(auditId, actor) });
  if (!omit.includes('catalog')) b.update(doc(db, 'catalog', id), { status: 'published', 'booking.enabled': true, 'booking.engine': 'direct', 'booking.holdMinutes': 15, ...meta(auditId, actor), ...catalogExtra });
  if (!omit.includes('audit')) b.set(doc(db, 'audit_logs', auditId), event(id, actor, 'business_published', 'published', 'published'));
  return b.commit();
}
function reservation(id, advanceCents = 1500) {
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const startsAt = Timestamp.fromDate(new Date(`${date}T14:00:00-05:00`));
  return { clientUid: 'client', establishmentId: id, establishmentName: name, courtId: 'principal', courtName: 'Principal', date, hour: 14, startsAt, endsAt: Timestamp.fromMillis(startsAt.toMillis() + 3600000), totalCents: 3000, advanceCents, createdAt: serverTimestamp(), status: 'pending_payment', paymentStatus: 'unpaid', paymentSnapshot: paymentFor(id) };
}
const slotPath = (r) => `direct_slots/${r.establishmentId}/courts/principal/days/${r.date}/hours/${r.hour}`;
function hold(db, requestId, r) {
  const b = writeBatch(db);
  b.set(doc(db, 'direct_requests', requestId), r);
  b.set(doc(db, slotPath(r)), { reservationId: requestId, lockedAt: serverTimestamp(), status: 'held', reviewPending: false });
  b.set(doc(db, 'direct_limits', 'client', 'days', r.date), { count: 1, lastRequestId: requestId, updatedAt: serverTimestamp() });
  return b.commit();
}
function submit(db, requestId, r, { omitSlot = false, verify = false } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, 'direct_proofs', requestId), { reservationId: requestId, clientUid: 'client', establishmentId: r.establishmentId, contentType: 'image/jpeg', imageData: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(100), sha256: 'a'.repeat(64), createdAt: serverTimestamp() });
  b.update(doc(db, 'direct_requests', requestId), { status: verify ? 'confirmed' : 'pending_verification', paymentStatus: verify ? 'verified' : 'submitted', proofSubmittedAt: serverTimestamp() });
  if (!omitSlot) b.update(doc(db, slotPath(r)), { reviewPending: true });
  return b.commit();
}

test('1. Alta conectada crea seis documentos, conserva precios vacíos y rechaza roles, publicación u omisiones', async () => {
  const root = dbFor('root'), created = create(root);
  await assertSucceeds(created.commit());
  const v = (await getDoc(doc(root, 'establishments', created.id))).data();
  assert.equal(v.bookingPolicy.advanceCents, 1500);
  assert.equal(v.bookingPolicy.enabled, false);
  assert.equal(v.managedAdminUid, undefined);
  assert.equal((await getDoc(doc(root, 'catalog', created.id, 'courts', 'principal'))).data().dayPriceCents, null);
  await assertFails(create(dbFor('client'), { actor: 'client' }).commit());
  await assertFails(create(root, { venueExtra: { managedAdminUid: 'root', role: 'superadmin' } }).commit());
  await assertFails(create(root, { catalogExtra: { status: 'published' } }).commit());
  await assertFails(create(root, { omit: ['audit'] }).commit());
  await assertFails(setDoc(doc(root, 'platform_roles/new-owner'), { role: 'superadmin', status: 'active' }));
});

test('2. Solo el correo verificado acepta su invitación atómica y no reemplaza dueño, membresías ni roles', async () => {
  const root = dbFor('root'), created = create(root);
  await created.commit();
  const owner = dbFor('owner', 'OWNER@example.com');
  await assertSucceeds(getDocs(query(collection(owner, 'establishment_invitations'), where('targetEmail', '==', 'owner@example.com'), limit(100))));
  await assertFails(getDocs(query(collection(dbFor('other'), 'establishment_invitations'), limit(100))));
  await assertFails(accept(dbFor('owner', 'owner@example.com', false), created.id));
  await assertFails(accept(dbFor('wrong', 'wrong@example.com'), created.id, { actor: 'wrong' }));
  await assertFails(accept(owner, created.id, { memberExtra: { role: 'superadmin' } }));
  await assertFails(accept(owner, created.id, { omit: ['index'] }));
  await assertSucceeds(accept(owner, created.id));
  assert.equal((await getDoc(doc(owner, 'establishments', created.id))).data().managedAdminUid, 'owner');
  assert.equal((await getDoc(doc(owner, 'users/owner/memberships', created.id))).data().role, 'admin');
  await assertFails(accept(owner, created.id));
  const occupied = create(root); await occupied.commit();
  await env.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'establishments', occupied.id), { managedAdminUid: 'previous-owner' }));
  await assertFails(accept(owner, occupied.id));
});

test('3. Publicar exige QR, dueño, horarios y precios reales; el historial común solo admite eventos de ajustes auténticos', async () => {
  const root = dbFor('root'), id = randomUUID();
  await ready(id, { qr: false });
  await assertFails(publish(root, id));
  await assertFails(publish(dbFor('client'), id, { actor: 'client' }));
  await env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'catalog', id, 'paymentQrs', 'real-qr'), qrFor(id)));
  await assertFails(publish(root, id, { omit: ['audit'] }));
  await assertFails(publish(root, id, { catalogExtra: { advanceCents: 1000 } }));
  await env.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'catalog', id), { 'booking.holdMinutes': 20 }));
  await assertFails(publish(root, id));
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'catalog', id), { booking: { payment: paymentFor(id) } });
    await updateDoc(doc(context.firestore(), 'establishments', id), { 'bookingPolicy.advanceCents': 1400 });
  });
  await assertFails(publish(root, id));
  await env.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'establishments', id), { bookingPolicy: { enabled: false } }));
  await assertSucceeds(publish(root, id));
  assert.equal((await getDoc(doc(root, 'catalog', id))).data().booking.holdMinutes, 15);
  assert.equal((await getDoc(doc(root, 'establishments', id))).data().bookingPolicy.holdMinutes, 15);
  assert.equal((await getDoc(doc(root, 'establishments', id))).data().bookingPolicy.advanceCents, 1500);
  const owner = dbFor('owner');
  const previous = (await getDoc(doc(owner, 'establishments', id, 'settings', 'schedule'))).data();
  const current = { ...previous, openHour: 8, revision: 2, updatedAt: serverTimestamp(), updatedBy: 'owner' };
  const b = writeBatch(owner);
  b.set(doc(owner, 'establishments', id, 'settings', 'schedule'), current);
  b.update(doc(owner, 'catalog', id), { days: current.days, openHour: 8, closeHour: 24, scheduleRevision: 2, scheduleUpdatedAt: serverTimestamp() });
  b.set(doc(owner, 'establishments', id, 'settings', 'schedule', 'history', '2'), { establishmentId: id, kind: 'schedule', revision: 2, actorUid: 'owner', at: serverTimestamp(), before: previous, after: current });
  const logId = randomUUID();
  b.set(doc(owner, 'audit_logs', logId), { action: 'business_setting_changed', establishmentId: id, actorUid: 'owner', at: serverTimestamp(), kind: 'schedule', referenceId: 'schedule', revision: 2 });
  await assertSucceeds(b.commit());
  assert.equal((await getDoc(doc(root, 'audit_logs', logId))).data().kind, 'schedule');
  await assertFails(setDoc(doc(owner, 'audit_logs', randomUUID()), { action: 'business_setting_changed', establishmentId: id, actorUid: 'owner', at: serverTimestamp(), kind: 'schedule', referenceId: 'schedule', revision: 2 }));
});

test('4. Adelanto por negocio y señal de comprobante se validan juntos sin verificar dinero ni abrir datos privados', async () => {
  const id = randomUUID(); await ready(id, { published: true });
  const client = dbFor('client'), root = dbFor('root'), owner = dbFor('owner'), r = reservation(id);
  await assertFails(hold(client, 'wrong-advance', reservation(id, 1000)));
  await assertSucceeds(hold(client, 'real-hold', r));
  await assertFails(updateDoc(doc(client, slotPath(r)), { reviewPending: true }));
  await assertFails(submit(client, 'real-hold', r, { omitSlot: true }));
  await assertFails(submit(client, 'real-hold', r, { verify: true }));
  await assertSucceeds(submit(client, 'real-hold', r));
  assert.equal((await getDoc(doc(root, slotPath(r)))).data().reviewPending, true);
  for (const path of ['direct_proofs/real-hold', 'direct_requests/real-hold']) await assertFails(getDoc(doc(root, path)));
  const review = writeBatch(owner);
  review.update(doc(owner, 'direct_requests/real-hold'), { status: 'confirmed', paymentStatus: 'verified', reviewedAt: serverTimestamp(), reviewedBy: 'owner', verifiedAdvanceCents: 1500 });
  review.update(doc(owner, slotPath(r)), { status: 'confirmed', reviewPending: false });
  review.set(doc(owner, 'establishments', id, 'court_income', 'real-hold'), {
    reservationId: 'real-hold', courtId: r.courtId, courtName: r.courtName,
    date: r.date, hour: r.hour, totalCents: r.totalCents,
    advanceCents: r.advanceCents, advanceAt: serverTimestamp(), advanceBy: 'owner',
    balanceCents: 0, balanceAt: null, balanceBy: null, balanceMethod: null,
  });
  await assertSucceeds(review.commit());
  assert.equal((await getDoc(doc(root, slotPath(r)))).data().reviewPending, false);
  assert.equal((await getDoc(doc(client, 'direct_requests/real-hold'))).data().verifiedAdvanceCents, 1500);
  await assertFails(updateDoc(doc(client, slotPath(r)), { reviewPending: true, phone: '999111222' }));
});
