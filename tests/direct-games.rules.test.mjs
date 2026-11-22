import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';

let env;
const payment={mode:'demo',qr:'',methods:['Yape'],recipient:'',phone:''};
const court={name:'Cancha principal',status:'active',openHour:0,closeHour:24,openDays:[],dayPriceCents:3000,nightPriceCents:4000,nightStartsAt:18,maintenance:false,runtime:null};
const today=()=>new Date(Date.now()-5*3600000).toISOString().slice(0,10);
const tomorrow=()=>new Date(Date.now()-5*3600000+86400000).toISOString().slice(0,10);
const stamp=ms=>Timestamp.fromMillis(ms);
const deadline=value=>new Timestamp(value.seconds+3600,value.nanoseconds);
const dbFor=uid=>env.authenticatedContext(uid).firestore();
const operationsPath=(id='puma',courtId='one')=>`establishments/${id}/courts/${courtId}/operations/current`;
const publicPath=(id='puma',courtId='one')=>`catalog/${id}/courts/${courtId}/operations/current`;
const lockPath=r=>`direct_slots/${r.establishmentId}/courts/${r.courtId}/days/${r.date}/hours/${r.hour}`;
function reservation(hour=0,date=today(),changes={}) {
  const startsAt=stamp(Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00-05:00`));
  return {clientUid:'alice',establishmentId:'puma',establishmentName:'Grass El Puma',courtId:'one',courtName:court.name,
    date,hour,startsAt,endsAt:stamp(startsAt.toMillis()+3600000),totalCents:hour>=18?4000:3000,advanceCents:1000,
    createdAt:stamp(startsAt.toMillis()-3600000),status:'confirmed',paymentStatus:'verified',paymentSnapshot:payment,
    proofSubmittedAt:stamp(startsAt.toMillis()-3599000),reviewedAt:stamp(startsAt.toMillis()-3598000),reviewedBy:'admin',verifiedAdvanceCents:1000,...changes};
}
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-grassgo-game-tests',firestore:{rules:readFileSync('firestore.rules','utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore(), b=writeBatch(db);
    for(const id of ['puma','other']){
      b.set(doc(db,`establishments/${id}`),{status:'published',bookingEngine:'direct',bookingPolicy:{enabled:true}});
      b.set(doc(db,`catalog/${id}`),{name:id==='puma'?'Grass El Puma':'Otro local',status:'published',booking:{enabled:true,engine:'direct',holdMinutes:15,payment}});
      for(const cid of ['one','two'])for(const prefix of ['establishments','catalog'])b.set(doc(db,`${prefix}/${id}/courts/${cid}`),court);
    }
    b.set(doc(db,'establishments/puma/members/admin'),{role:'admin',status:'active'});
    b.set(doc(db,'establishments/puma/members/admin-two'),{role:'admin',status:'active'});
    b.set(doc(db,'establishments/other/members/other-admin'),{role:'admin',status:'active'});
    b.set(doc(db,'platform_roles/super'),{role:'superadmin',status:'active'});
    const r=reservation();b.set(doc(db,'direct_requests/first'),r);b.set(doc(db,lockPath(r)),{reservationId:'first',status:'confirmed',lockedAt:r.createdAt});
    await b.commit();
  });
});
async function trusted(path){let data;await env.withSecurityRulesDisabled(async c=>{data=(await getDoc(doc(c.firestore(),path))).data()||null;});return data;}
async function seed(path,data){return env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),data));}
async function trustedUpdate(path,data){return env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),path),data));}
// Simula un documento escrito hace una hora, sin dormir ni confiar en el reloj cliente
// para autorizar. Las reglas seguirán comparando con request.time del emulador.
async function expireRunning(reservationId='first'){
  const r=await trusted('direct_requests/'+reservationId),ops=await trusted(operationsPath(r.establishmentId,r.courtId));
  const actualStartAt=new Timestamp(Math.floor((Date.now()-3610000)/1000),123456000);
  const local=new Date(actualStartAt.toMillis()-5*3600000),date=local.toISOString().slice(0,10),hour=local.getUTCHours();
  const startsAt=stamp(Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00-05:00`));
  const value={...r,date,hour,startsAt,endsAt:stamp(startsAt.toMillis()+3600000),actualStartAt};
  await seed('direct_requests/'+reservationId,value);
  await seed(lockPath(value),{reservationId,status:'confirmed',lockedAt:r.createdAt,serviceStatus:'running',actualStartAt});
  const current={...ops,activeDate:date,actualStartAt};
  await seed(operationsPath(r.establishmentId,r.courtId),current);
  const {updatedBy,...projection}=current;await seed(publicPath(r.establishmentId,r.courtId),projection);
  return value;
}
async function game(db,action='start',options={}){
  const {reservationId='first',actor='admin'}=options, r=await trusted('direct_requests/'+reservationId);
  const path=operationsPath(r.establishmentId,r.courtId),before=options.before!==undefined?options.before:await trusted(path);
  const after={establishmentId:r.establishmentId,courtId:r.courtId,
    activeReservationId:action==='start'?reservationId:null,activeDate:action==='start'?r.date:null,
    actualStartAt:action==='start'?serverTimestamp():null,lastEndedAt:action==='finish'?deadline(r.actualStartAt||stamp(1)):
      (before?.activeReservationId?deadline(before.actualStartAt):(before?.lastEndedAt||null)),
    revision:(before?.revision||0)+1,updatedAt:serverTimestamp(),updatedBy:actor,...options.opsExtra};
  const {updatedBy,...projection}=after;
  const change=action==='start'?{serviceStatus:'running',actualStartAt:serverTimestamp()}:{serviceStatus:'completed',actualStartAt:r.actualStartAt||stamp(1),actualEndAt:deadline(r.actualStartAt||stamp(1))};
  const b=writeBatch(db);
  if(!options.omitRequest)b.update(doc(db,'direct_requests/'+reservationId),{...change,...options.requestExtra});
  if(!options.omitSlot)b.update(doc(db,lockPath(r)),{...change,...options.slotExtra});
  if(!options.omitCanonical)b.set(doc(db,path),after);
  if(!options.omitPublic)b.set(doc(db,publicPath(r.establishmentId,r.courtId)),{...projection,...options.publicExtra});
  if(!options.omitHistory)b.set(doc(db,`${path}/history/${options.historyId||after.revision}`),{
    establishmentId:r.establishmentId,courtId:r.courtId,kind:'session',revision:after.revision,actorUid:actor,
    at:serverTimestamp(),action,reservationId,before,after,...options.historyExtra});
  options.extraWrite?.(b,db,after);
  return b.commit();
}
test('partido: iniciar registra reloj real, espejo sin PII, bloqueo único e historia sin cambiar pago/hora',async()=>{
  const before=await trusted('direct_requests/first');
  await assertSucceeds(game(dbFor('admin')));
  const r=await trusted('direct_requests/first'),ops=await trusted(operationsPath()),publicOps=await trusted(publicPath());
  assert.equal(r.serviceStatus,'running');assert.equal(ops.activeReservationId,'first');
  assert.ok(r.actualStartAt.toMillis()>=before.startsAt.toMillis());assert.deepEqual(r.actualStartAt,ops.actualStartAt);
  for(const field of ['startsAt','endsAt','hour','date','totalCents','advanceCents','paymentSnapshot','paymentStatus','reviewedAt','reviewedBy'])assert.deepEqual(r[field],before[field]);
  assert.equal(publicOps.updatedBy,undefined);assert.equal(publicOps.clientUid,undefined);
  assert.deepEqual((await trusted(operationsPath()+'/history/1')).after,ops);
  assert.equal((await trusted(lockPath(r))).serviceStatus,'running');
});
test('partido: cierre vencido registra exactamente inicio más una hora y conserva importes',async()=>{
  await game(dbFor('admin'));
  await expireRunning();
  const running=await trusted('direct_requests/first');
  await assertSucceeds(game(dbFor('admin'),'finish'));
  const finished=await trusted('direct_requests/first'),ops=await trusted(operationsPath());
  assert.equal(finished.serviceStatus,'completed');assert.deepEqual(finished.actualStartAt,running.actualStartAt);
  assert.deepEqual(finished.actualEndAt,deadline(finished.actualStartAt));assert.equal(ops.activeReservationId,null);
  assert.deepEqual(ops.lastEndedAt,finished.actualEndAt);assert.equal(ops.actualStartAt,null);assert.equal(ops.revision,2);
  assert.equal((await trusted(lockPath(finished))).serviceStatus,'completed');assert.equal(finished.paymentStatus,'verified');
});
test('partido automático: antes de completar una hora nadie puede acortar el partido',async()=>{
  await game(dbFor('admin'));
  await assertFails(game(dbFor('admin'),'finish'));
  const data=await trusted('direct_requests/first');
  assert.equal(data.serviceStatus,'running');assert.equal(data.actualEndAt,undefined);
  assert.equal((await trusted(operationsPath())).revision,1);
});
test('partido automático: rechaza H-1ms y H+1ms aunque todos los espejos intenten ese mismo fin',async()=>{
  await game(dbFor('admin'));const running=await expireRunning(),end=deadline(running.actualStartAt);
  for(const offset of [-1,1]){
    const fake=new Timestamp(end.seconds,end.nanoseconds+offset*1000000);
    await assertFails(game(dbFor('admin'),'finish',{requestExtra:{actualEndAt:fake},slotExtra:{actualEndAt:fake},opsExtra:{lastEndedAt:fake}}));
  }
  await assertFails(game(dbFor('admin'),'finish',{requestExtra:{actualEndAt:serverTimestamp()},slotExtra:{actualEndAt:serverTimestamp()},opsExtra:{lastEndedAt:serverTimestamp()}}));
  await assertSucceeds(game(dbFor('admin'),'finish'));
  assert.deepEqual((await trusted('direct_requests/first')).actualEndAt,end);
});
test('partido: cancha inactiva no inicia pero permite finalizar un partido ya iniciado',async()=>{
  await trustedUpdate('establishments/puma/courts/one',{status:'inactive'});
  await assertFails(game(dbFor('admin')));
  await trustedUpdate('establishments/puma/courts/one',{status:'active'});
  await game(dbFor('admin'));
  await expireRunning();
  await trustedUpdate('establishments/puma/courts/one',{status:'inactive'});
  await assertSucceeds(game(dbFor('admin'),'finish'));
  assert.equal((await trusted('direct_requests/first')).serviceStatus,'completed');
});
test('partido: cliente, visitante, otro admin y superadmin sin membresía no inician',async()=>{
  for(const uid of ['alice','other-admin','super'])await assertFails(game(dbFor(uid),'start',{actor:uid}));
  await assertFails(game(env.unauthenticatedContext().firestore()));
});
test('partido: solo fecha de hoy y hora ya llegada; no inicia solicitud sin pago verificado',async()=>{
  for(const r of [reservation(0,tomorrow()),reservation(0,'2020-01-01'),
    reservation(0,today(),{status:'pending_payment',paymentStatus:'unpaid'})]){
    await seed('direct_requests/invalid',r);await seed(lockPath(r),{reservationId:'invalid',status:'confirmed',lockedAt:r.createdAt});
    await assertFails(game(dbFor('admin'),'start',{reservationId:'invalid'}));
  }
});
test('partido: falta cualquiera de las cinco escrituras o historia/proyección falsa se deniega',async()=>{
  for(const options of [{omitRequest:true},{omitSlot:true},{omitCanonical:true},{omitPublic:true},{omitHistory:true},
    {historyExtra:{before:{}}},{historyExtra:{actorUid:'alice'}},{historyExtra:{action:'finish'}},
    {publicExtra:{clientUid:'alice'}},{historyId:2}])await assertFails(game(dbFor('admin'),'start',options));
});
test('partido: no permite reloj inventado, precio cambiado, suplantación ni horario original modificado',async()=>{
  for(const options of [{opsExtra:{actualStartAt:stamp(1)}},{requestExtra:{actualStartAt:stamp(1)}},
    {opsExtra:{updatedAt:stamp(1)}},{opsExtra:{updatedBy:'alice'}},{opsExtra:{revision:9}},
    {opsExtra:{extra:true}},{opsExtra:{activeDate:'2020-01-01'}},{requestExtra:{totalCents:9000}},
    {requestExtra:{hour:4}},{requestExtra:{clientUid:'admin'}},{requestExtra:{paymentStatus:'unpaid'}},
    {slotExtra:{reservationId:'different'}}])await assertFails(game(dbFor('admin'),'start',options));
});
test('partido: finalización ajena, reinicio, finalizar dos veces y pérdida de membresía se rechazan',async()=>{
  await assertFails(game(dbFor('admin'),'finish'));
  await game(dbFor('admin'));
  await assertFails(game(dbFor('admin')));
  await assertFails(game(dbFor('admin'),'finish'));
  await expireRunning();
  await trustedUpdate('establishments/puma/members/admin',{status:'suspended'});
  await assertFails(game(dbFor('admin'),'finish'));
  await trustedUpdate('establishments/puma/members/admin',{status:'active'});
  await game(dbFor('admin'),'finish');
  await assertFails(game(dbFor('admin'),'finish'));
});
test('partido: historia privada/inmutable y proyección pública publicada no revela autor',async()=>{
  await game(dbFor('admin'));
  await assertSucceeds(getDoc(doc(dbFor('alice'),publicPath())));
  for(const path of [operationsPath(),operationsPath()+'/history/1']){
    await assertSucceeds(getDoc(doc(dbFor('super'),path)));
    for(const uid of ['alice','other-admin'])await assertFails(getDoc(doc(dbFor(uid),path)));
    await assertFails(deleteDoc(doc(dbFor('admin'),path)));
  }
  await assertFails(updateDoc(doc(dbFor('admin'),operationsPath()+'/history/1'),{action:'finish'}));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),publicPath())));
  await trustedUpdate('catalog/puma',{status:'draft'});
  await assertFails(getDoc(doc(dbFor('alice'),publicPath())));
  await assertSucceeds(getDoc(doc(dbFor('admin'),publicPath())));
});
test('partido: horarios reales solo de local publicado o administrador propio, sin consultar huérfanos',async()=>{
  await game(dbFor('admin'));
  const r=await trusted('direct_requests/first'),path=lockPath(r),directory=path.substring(0,path.lastIndexOf('/'));
  await assertSucceeds(getDoc(doc(dbFor('bob'),path)));
  await assertSucceeds(getDocs(collection(dbFor('bob'),directory)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),path)));
  await trustedUpdate('catalog/puma',{status:'draft'});
  for(const uid of ['bob','other-admin']){
    await assertFails(getDoc(doc(dbFor(uid),path)));
    await assertFails(getDocs(collection(dbFor(uid),directory)));
  }
  await assertSucceeds(getDoc(doc(dbFor('admin'),path)));
  await assertSucceeds(getDocs(collection(dbFor('admin'),directory)));
  await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),'catalog/puma')));
  await assertFails(getDoc(doc(dbFor('bob'),path)));
  await assertFails(getDocs(collection(dbFor('bob'),directory)));
});
test('partido: no hay dos activos en la misma cancha; otra cancha puede operar independientemente',async()=>{
  await game(dbFor('admin'));
  const r=reservation(0,today());
  await seed('direct_requests/second',r);await seed(lockPath(r),{reservationId:'second',status:'confirmed',lockedAt:r.createdAt});
  await assertFails(game(dbFor('admin-two'),'start',{reservationId:'second',actor:'admin-two'}));
  const otherCourt=reservation(0,today(),{courtId:'two'});
  await seed('direct_requests/another-court',otherCourt);await seed(lockPath(otherCourt),{reservationId:'another-court',status:'confirmed',lockedAt:otherCourt.createdAt});
  await assertSucceeds(game(dbFor('admin'),'start',{reservationId:'another-court'}));
});
test('partido automático: iniciar tras vencimiento no exige que alguien hubiera abierto el panel para cerrar',async()=>{
  await game(dbFor('admin'));const expired=await expireRunning();
  const next=reservation(0,today());
  await seed('direct_requests/next',next);await seed(lockPath(next),{reservationId:'next',status:'confirmed',lockedAt:next.createdAt});
  await assertSucceeds(game(dbFor('admin'),'start',{reservationId:'next'}));
  const ops=await trusted(operationsPath());assert.equal(ops.activeReservationId,'next');
  assert.deepEqual(ops.lastEndedAt,deadline(expired.actualStartAt));assert.equal(ops.revision,2);
  assert.equal((await trusted('direct_requests/first')).paymentStatus,'verified');
  assert.equal((await trusted('direct_requests/first')).totalCents,expired.totalCents);
});
test('partido: uno iniciado ayer se cierra hoy con el límite exacto de una hora',async()=>{
  const yesterday=new Date(Date.parse(today()+'T12:00:00-05:00')-86400000).toISOString().slice(0,10);
  const r=reservation(23,yesterday,{serviceStatus:'running',actualStartAt:stamp(Date.parse(`${yesterday}T23:50:00-05:00`))});
  const ops={establishmentId:'puma',courtId:'one',activeReservationId:'yesterday',activeDate:yesterday,
    actualStartAt:r.actualStartAt,lastEndedAt:null,revision:1,updatedAt:r.actualStartAt,updatedBy:'admin'};
  await seed('direct_requests/yesterday',r);await seed(lockPath(r),{reservationId:'yesterday',status:'confirmed',lockedAt:r.createdAt,serviceStatus:'running',actualStartAt:r.actualStartAt});
  await seed(operationsPath(),ops);const {updatedBy,...projection}=ops;await seed(publicPath(),projection);
  await assertSucceeds(game(dbFor('admin'),'finish',{reservationId:'yesterday'}));
  assert.deepEqual((await trusted('direct_requests/yesterday')).actualEndAt,deadline(r.actualStartAt));
});
async function hold(db,reservationId,date,hour=14){
  const startsAt=stamp(Date.parse(`${date}T${hour}:00:00-05:00`));
  const b=writeBatch(db),r={clientUid:'bob',establishmentId:'puma',establishmentName:'Grass El Puma',courtId:'one',courtName:court.name,
    date,hour,startsAt,endsAt:stamp(startsAt.toMillis()+3600000),totalCents:hour>=18?4000:3000,advanceCents:1000,
    createdAt:serverTimestamp(),status:'pending_payment',paymentStatus:'unpaid',paymentSnapshot:payment};
  b.set(doc(db,'direct_requests/'+reservationId),r);b.set(doc(db,lockPath(r)),{reservationId,status:'held',lockedAt:serverTimestamp()});
  b.set(doc(db,`direct_limits/bob/days/${date}`),{count:1,lastRequestId:reservationId,updatedAt:serverTimestamp()});return b.commit();
}
test('partido: bloqueo de solicitudes del día afectado y permiso en futuras fechas independientes',async()=>{
  await game(dbFor('admin'));
  const hour=new Date(Date.now()-5*3600000).getUTCHours();
  if(hour<23)await assertFails(hold(dbFor('bob'),'blocked-today',today(),hour+1));
  await assertSucceeds(hold(dbFor('bob'),'future-independent',tomorrow(),14));
});
test('partido: reabrir tras terminar mantiene guardia sobre fin real y permite fechas posteriores',async()=>{
  await game(dbFor('admin'));await expireRunning();await game(dbFor('admin'),'finish');
  await assertSucceeds(hold(dbFor('bob'),'after-finish',tomorrow(),14));
});
test('partido automático: el bloqueo vence a la hora aun con runtime raw running y sin panel abierto',async()=>{
  await game(dbFor('admin'));await expireRunning();
  const currentHour=new Date(Date.now()-5*3600000).getUTCHours();
  const date=currentHour===23?tomorrow():today(),hour=currentHour===23?0:currentHour+1;
  await assertSucceeds(hold(dbFor('bob'),'after-autonomous-expiry',date,hour));
  assert.equal((await trusted(operationsPath())).activeReservationId,'first');
  assert.equal((await trusted('direct_requests/after-autonomous-expiry')).status,'pending_payment');
});
test('partido: dos inicios concurrentes conservan una sola hora real y un evento',async()=>{
  const results=await Promise.allSettled([game(dbFor('admin')),game(dbFor('admin-two'),'start',{actor:'admin-two'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const events=await getDocs(collection(dbFor('admin'),operationsPath()+'/history'));
  assert.equal(events.size,1);assert.equal((await trusted(operationsPath())).revision,1);
});
test('partido: camino máximo con horario, reapertura y retención vencida admite nueva solicitud futura',async()=>{
  await game(dbFor('admin'));await expireRunning();await game(dbFor('admin'),'finish');
  const date=tomorrow(),old=reservation(14,date,{status:'pending_payment',paymentStatus:'unpaid',createdAt:stamp(Date.now()-20*60000)});
  delete old.proofSubmittedAt;delete old.reviewedAt;delete old.reviewedBy;delete old.verifiedAdvanceCents;
  await seed('direct_requests/expired',old);await seed(lockPath(old),{reservationId:'expired',status:'held',lockedAt:old.createdAt});
  await seed('establishments/puma/settings/schedule',{establishmentId:'puma',days:[0,1,2,3,4,5,6],openHour:0,closeHour:24,
    revision:1,updatedAt:stamp(Date.now()),updatedBy:'admin'});
  await seed('establishments/puma/closures/'+date,{establishmentId:'puma',date,dateStart:stamp(Date.parse(date+'T00:00:00-05:00')),
    closed:false,reason:'Reapertura',revision:2,updatedAt:stamp(Date.now()),updatedBy:'admin'});
  await assertSucceeds(hold(dbFor('bob'),'after-expired',date,14));
  assert.equal((await trusted('direct_requests/expired')).clientUid,'alice');
  assert.equal((await trusted(lockPath(old))).reservationId,'after-expired');
});
