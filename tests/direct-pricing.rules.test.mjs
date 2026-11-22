import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, Timestamp, serverTimestamp } from 'firebase/firestore';

let env;
const dbFor = (uid) => env.authenticatedContext(uid).firestore();
const payment = { mode: 'demo', qr: '', methods: ['Yape'], recipient: '', phone: '' };
const court = { name: 'Cancha principal', status: 'active', openHour: 0, closeHour: 24,
  openDays: [], maintenance: false, runtime: null, dayPriceCents: 3000, nightPriceCents: 4000, nightStartsAt: 18 };
const pricingPath = (id = 'puma', courtId = 'one') => `establishments/${id}/courts/${courtId}/settings/pricing`;
before(async () => { env = await initializeTestEnvironment({projectId:'demo-grassgo-pricing-tests',firestore:{rules:readFileSync('firestore.rules','utf8')}}); });
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db=c.firestore(), b=writeBatch(db);
    for(const id of ['puma','other']) {
      b.set(doc(db,`establishments/${id}`),{status:'published',bookingEngine:'direct',bookingPolicy:{enabled:true}});
      b.set(doc(db,`catalog/${id}`),{status:'published',name:id==='puma'?'Grass El Puma':'Otro local',advanceCents:1000,
        courts:[{id:'one',...court},{id:'two',...court,name:'Segunda cancha'}],
        booking:{enabled:true,engine:'direct',holdMinutes:15,payment}});
      for(const courtId of ['one','two']) for(const prefix of ['establishments','catalog'])
        b.set(doc(db,`${prefix}/${id}/courts/${courtId}`),{...court,name:courtId==='one'?court.name:'Segunda cancha'});
    }
    b.set(doc(db,'establishments/puma/members/admin'),{role:'admin',status:'active'});
    b.set(doc(db,'establishments/puma/members/admin-two'),{role:'admin',status:'active'});
    b.set(doc(db,'establishments/other/members/other-admin'),{role:'admin',status:'active'});
    b.set(doc(db,'platform_roles/super'),{role:'superadmin',status:'active'});
    await b.commit();
  });
});
async function trusted(path) { let data;await env.withSecurityRulesDisabled(async c=>{data=(await getDoc(doc(c.firestore(),path))).data()||null;});return data; }
async function trustedUpdate(path,value){await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),path),value));}
async function price(db,changes={},options={}) {
  const {id='puma',courtId='one',actor='admin'}=options,path=pricingPath(id,courtId);
  const before=options.before!==undefined?options.before:await trusted(path), parent=await trusted(`catalog/${id}`);
  const data={establishmentId:id,courtId,dayPriceCents:4500,nightPriceCents:5500,nightStartsAt:19,
    revision:(before?.revision||0)+1,updatedAt:serverTimestamp(),updatedBy:actor,...changes};
  const mirror={dayPriceCents:data.dayPriceCents,nightPriceCents:data.nightPriceCents,nightStartsAt:data.nightStartsAt,
    pricingRevision:data.revision,pricingUpdatedAt:data.updatedAt};
  const index=parent.courts.findIndex(c=>c.id===courtId);
  const entries=parent.courts.map((c,i)=>i===index?{...c,dayPriceCents:data.dayPriceCents,nightPriceCents:data.nightPriceCents,nightStartsAt:data.nightStartsAt}:c);
  const b=writeBatch(db);
  if(!options.omitCanonical)b.set(doc(db,path),data);
  if(!options.omitPrivate)b.update(doc(db,`establishments/${id}/courts/${courtId}`),{...mirror,...options.privateExtra});
  if(!options.omitPublic)b.update(doc(db,`catalog/${id}/courts/${courtId}`),{...mirror,...options.publicExtra});
  if(!options.omitParent)b.update(doc(db,`catalog/${id}`),{courts:entries,pricingCourtId:courtId,pricingCourtIndex:index,
    pricingRevision:data.revision,pricingUpdatedAt:data.updatedAt,...options.parentExtra});
  if(!options.omitHistory)b.set(doc(db,`${path}/history/${options.historyId||data.revision}`),{
    establishmentId:id,kind:'pricing',revision:data.revision,actorUid:actor,at:serverTimestamp(),before,after:data,...options.historyExtra});
  options.extraWrite?.(b,db,data);
  return b.commit();
}
test('precios: dueño guarda cinco documentos, preserva tarjeta, otras canchas y datos de pago',async()=>{
  const before=await trusted('catalog/puma');
  await assertSucceeds(price(dbFor('admin')));
  const canonical=await trusted(pricingPath()), parent=await trusted('catalog/puma');
  assert.equal(canonical.dayPriceCents,4500);assert.equal(parent.courts[0].nightPriceCents,5500);
  assert.deepEqual(parent.courts[1],before.courts[1]);assert.deepEqual(parent.booking,before.booking);
  assert.equal(parent.advanceCents,1000);assert.equal(parent.pricingCourtIndex,0);
  assert.deepEqual((await trusted(pricingPath()+'/history/1')).after,canonical);
  assert.equal((await trusted('catalog/puma/courts/one')).pricingRevision,1);
});
test('precios: primer guardado puede conservar importes y registra revisión',async()=>{
  await assertSucceeds(price(dbFor('admin'),{dayPriceCents:3000,nightPriceCents:4000,nightStartsAt:18}));
  await assertSucceeds(price(dbFor('admin'),{dayPriceCents:3600}));
  assert.equal((await trusted(pricingPath())).revision,2);
});
test('precios: el dueño consulta y edita su propio borrador sin publicar ni ampliar acceso a clientes',async()=>{
  await trustedUpdate('catalog/puma',{status:'draft'});
  await assertSucceeds(getDoc(doc(dbFor('admin'),'catalog/puma/courts/one')));
  await assertFails(getDoc(doc(dbFor('alice'),'catalog/puma/courts/one')));
  await assertFails(getDoc(doc(dbFor('other-admin'),'catalog/puma/courts/one')));
  await assertSucceeds(price(dbFor('admin')));
  assert.equal((await trusted('catalog/puma')).status,'draft');
});
test('precios: cliente, anónimo, admin ajeno y superadmin sin membresía no escriben',async()=>{
  for(const uid of ['alice','other-admin','super']) await assertFails(price(dbFor(uid),{},{actor:uid}));
  await assertFails(price(env.unauthenticatedContext().firestore()));
  await assertSucceeds(price(dbFor('other-admin'),{},{id:'other',actor:'other-admin'}));
});
test('precios: suspender miembro/local, motor anterior y cancha inactiva revocan la edición',async()=>{
  for(const [path,change,restore] of [
    ['establishments/puma/members/admin',{status:'suspended'},{status:'active'}],
    ['establishments/puma',{status:'suspended'},{status:'published'}],
    ['establishments/puma',{bookingEngine:'legacy'},{bookingEngine:'direct'}],
    ['establishments/puma/courts/one',{status:'inactive'},{status:'active'}]]){
    await trustedUpdate(path,change);await assertFails(price(dbFor('admin')));await trustedUpdate(path,restore);
  }
});
test('precios: importes, tipos, campos, hora, autor y reloj inválidos se rechazan',async()=>{
  for(const value of [{dayPriceCents:999},{nightPriceCents:1000001},{dayPriceCents:10.5},{nightPriceCents:'4500'},
    {nightStartsAt:24},{nightStartsAt:-1},{nightStartsAt:2.5},{updatedBy:'other-admin'},
    {updatedAt:Timestamp.fromMillis(1)},{revision:5},{extra:'inyección'},{establishmentId:'other'},{courtId:'two'}])
    await assertFails(price(dbFor('admin'),value));
});
test('precios: omitir cualquier espejo/historia/canónico o falsear evento está denegado',async()=>{
  for(const value of [{omitCanonical:true},{omitPrivate:true},{omitPublic:true},{omitParent:true},{omitHistory:true},
    {historyExtra:{before:{}}},{historyExtra:{kind:'payment'}},{historyId:2},{historyExtra:{actorUid:'alice'}}])
    await assertFails(price(dbFor('admin'),{},value));
});
test('precios: no concede roles ni altera horarios, nombres, habilitación, adelanto u otras canchas',async()=>{
  const parent=await trusted('catalog/puma');
  for(const value of [{privateExtra:{status:'published'}},{privateExtra:{maintenance:true}},{publicExtra:{name:'Usurpado'}},
    {parentExtra:{advanceCents:9000}},{parentExtra:{booking:{enabled:false}}},{parentExtra:{status:'draft'}},
    {parentExtra:{pricingCourtIndex:1}},{parentExtra:{pricingCourtId:'two'}},
    {parentExtra:{courts:[{...parent.courts[0],dayPriceCents:4500,nightPriceCents:5500,nightStartsAt:19},{...parent.courts[1],name:'Manipulado'}]}},
    {parentExtra:{courts:[parent.courts[1],{...parent.courts[0],dayPriceCents:4500,nightPriceCents:5500,nightStartsAt:19}]}}])
    await assertFails(price(dbFor('admin'),{},value));
});
test('precios: configuración e historia privadas, eventos inmutables y revisión obsoleta rechazada',async()=>{
  await price(dbFor('admin'));
  for(const path of [pricingPath(),pricingPath()+'/history/1']) {
    await assertSucceeds(getDoc(doc(dbFor('super'),path)));
    for(const uid of ['alice','other-admin'])await assertFails(getDoc(doc(dbFor(uid),path)));
    await assertFails(deleteDoc(doc(dbFor('admin'),path)));
  }
  await assertFails(updateDoc(doc(dbFor('admin'),pricingPath()+'/history/1'),{actorUid:'alice'}));
  await assertFails(price(dbFor('admin-two'),{revision:1},{actor:'admin-two',before:null}));
});
test('precios: operación mixta no puede crear reserva con la tarifa anterior',async()=>{
  const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const startsAt=Timestamp.fromDate(new Date(`${date}T14:00:00-05:00`));
  const extra=(amount)=>(b,db)=>{
    b.set(doc(db,'direct_requests/mixed'),{clientUid:'admin',establishmentId:'puma',establishmentName:'Grass El Puma',
      courtId:'one',courtName:court.name,date,hour:14,startsAt,endsAt:Timestamp.fromMillis(startsAt.toMillis()+3600000),
      totalCents:amount,advanceCents:1000,createdAt:serverTimestamp(),status:'pending_payment',paymentStatus:'unpaid',paymentSnapshot:payment});
    b.set(doc(db,`direct_slots/puma/courts/one/days/${date}/hours/14`),{reservationId:'mixed',lockedAt:serverTimestamp(),status:'held'});
    b.set(doc(db,`direct_limits/admin/days/${date}`),{count:1,lastRequestId:'mixed',updatedAt:serverTimestamp()});
  };
  await assertFails(price(dbFor('admin'),{},{extraWrite:extra(3000)}));
  await assertSucceeds(price(dbFor('admin'),{},{extraWrite:extra(4500)}));
  assert.equal((await trusted('direct_requests/mixed')).totalCents,4500);
});
