// Fixture desechable de partidos, comprobantes y precios: solo emuladores loopback.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const action = process.argv[2];
if (!['setup', 'setup-expired', 'verify', 'cleanup'].includes(action) || process.argv.length !== 3)
  throw Error('Usa setup, setup-expired, verify o cleanup.');
for (const [key, host] of Object.entries({
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
})) {
  if (process.env[key] && process.env[key] !== host)
    throw Error('Este fixture solo admite Auth9099/Firestore8080 en loopback.');
  process.env[key] = host;
}
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: 'demo-grassgo' }, 'qa-live-operations');
const db = getFirestore(app),
  auth = getAuth(app);
const tenant = 'qa-live-operations',
  adminUid = 'qa-ops-admin',
  clientUid = 'qa-ops-client';
const name = 'PARTIDOS Y PRECIOS · DEMO NO PAGAR';
const accounts = [
  {
    uid: adminUid,
    email: 'operaciones.admin@grassgo.test',
    displayName: 'Administrador Operaciones DEMO',
  },
  {
    uid: clientUid,
    email: 'operaciones.cliente@grassgo.test',
    displayName: 'Cliente Operaciones DEMO',
  },
];
const requestIds = ['qa-ops-first', 'qa-ops-next', 'qa-ops-proof'];
const privateRef = db.doc('establishments/' + tenant),
  publicRef = db.doc('catalog/' + tenant);
const owns = (data) => data?.qaLiveOperations === true;
const millis = (value) => value?.toMillis?.() ?? null;
const limaDate = (instant) => new Date(instant - 5 * 3600000).toISOString().slice(0, 10);
const hourAt = (instant) => new Date(instant - 5 * 3600000).getUTCHours();
const at = (date, hour) => Date.parse(date + 'T' + String(hour).padStart(2, '0') + ':00:00-05:00');
const missingUser = (error) => {
  if (error.code === 'auth/user-not-found') return null;
  throw error;
};
const ownRequest = (data) => data?.establishmentId === tenant && data?.clientUid === clientUid;
const slotPath = (data) =>
  `direct_slots/${tenant}/courts/principal/days/${data.date}/hours/${data.hour}`;

async function validateOwnership() {
  const [local, catalog] = await db.getAll(privateRef, publicRef);
  if ([local, catalog].some((snapshot) => snapshot.exists && !owns(snapshot.data())))
    throw Error('La ruta contiene un establecimiento ajeno al fixture. No se modificó.');
  const users = await Promise.all(
    accounts.map((account) => auth.getUser(account.uid).catch(missingUser)),
  );
  users.forEach((user, index) => {
    if (user && user.email !== accounts[index].email)
      throw Error('Uno de los UID pertenece a una cuenta ajena al fixture.');
  });
  const requests = await db
    .collection('direct_requests')
    .where('establishmentId', '==', tenant)
    .get();
  const proofs = await db.collection('direct_proofs').where('establishmentId', '==', tenant).get();
  if (
    requests.docs.some((item) => !ownRequest(item.data())) ||
    proofs.docs.some((item) => !ownRequest(item.data()))
  )
    throw Error('Hay solicitudes o comprobantes de otro cliente dentro del fixture.');
  return { local, catalog, users, requests, proofs };
}

try {
  const state = await validateOwnership();
  if (action === 'setup' || action === 'setup-expired') {
    const refs = [
      ...accounts.map((account) => db.doc('profiles/' + account.uid)),
      db.doc('users/' + adminUid + '/memberships/' + tenant),
      ...requestIds.map((id) => db.doc('direct_requests/' + id)),
      ...requestIds.map((id) => db.doc('direct_proofs/' + id)),
    ];
    const existing = await db.getAll(...refs);
    const existingChildren = await Promise.all([
      privateRef.listCollections(),
      publicRef.listCollections(),
      db.doc('direct_slots/' + tenant).listCollections(),
      db.doc('direct_limits/' + clientUid).listCollections(),
    ]);
    if (
      state.local.exists ||
      state.catalog.exists ||
      state.users.some(Boolean) ||
      state.requests.size ||
      state.proofs.size ||
      existing.some((item) => item.exists) ||
      existingChildren.some((items) => items.length)
    )
      throw Error('Ya existen datos de esta prueba. Usa verify o cleanup; setup no sobrescribe.');
    const source = (await db.doc('catalog/direct-demo').get()).data();
    const sourceCourt = (await db.doc('establishments/direct-demo/courts/principal').get()).data();
    if (!source?.demo || source.booking?.payment?.mode !== 'demo' || !sourceCourt)
      throw Error('Prepara primero seed:direct-emulators. No se copian datos de un negocio real.');
    const bytes = readFileSync(new URL('../docs/screenshots/logo-movil.jpg', import.meta.url));
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw Error('La imagen de prueba debe ser JPEG.');
    const imageData = 'data:image/jpeg;base64,' + bytes.toString('base64');
    if (imageData.length > 700000) throw Error('La imagen de prueba supera el límite permitido.');
    const sha256 = createHash('sha256').update(imageData).digest('hex');
    const now = Date.now(),
      today = limaDate(now),
      hour = hourAt(now);
    // El segundo modo prepara una hora ya vencida para probar el cierre automático
    // al volver al panel, incluso si el inicio real fue ayer antes de medianoche.
    const expired = action === 'setup-expired';
    const firstActualStart = expired ? Timestamp.fromMillis(now - 3600000 - 2000) : null;
    const firstStart = expired
        ? at(limaDate(firstActualStart.toMillis()), hourAt(firstActualStart.toMillis()))
        : at(today, hour),
      nextStart = expired ? at(today, hour) : firstStart + 3600000;
    const tomorrow = limaDate(at(today, 0) + 86400000),
      pendingHour = (hour + 2) % 24;
    const days = [0, 1, 2, 3, 4, 5, 6];
    const payment = {
      mode: 'demo',
      methods: ['Yape', 'Plin'],
      recipient: 'DEMO — NO PAGAR',
      phone: '000000000',
      qr: '/assets/demo-payment-qr.svg',
    };
    const court = {
      ...sourceCourt,
      name: 'Cancha principal DEMO',
      status: 'active',
      images: [],
      openHour: 0,
      closeHour: 24,
      openDays: days,
      dayPriceCents: 3000,
      nightPriceCents: 4000,
      nightStartsAt: 18,
      maintenance: false,
      runtime: null,
    };
    const requests = [firstStart, nextStart, at(tomorrow, pendingHour)].map((start, index) => {
      const date = limaDate(start),
        slotHour = hourAt(start),
        confirmed = index < 2;
      const reviewedAt = Math.min(now - 5 * 60000, start - 8 * 60000);
      const createdAt = confirmed ? reviewedAt - 2 * 60000 : now - 60000;
      return {
        clientUid,
        establishmentId: tenant,
        establishmentName: name,
        courtId: 'principal',
        courtName: court.name,
        date,
        hour: slotHour,
        startsAt: Timestamp.fromMillis(start),
        endsAt: Timestamp.fromMillis(start + 3600000),
        totalCents: slotHour >= 18 ? 4000 : 3000,
        advanceCents: 1000,
        createdAt: Timestamp.fromMillis(createdAt),
        proofSubmittedAt: Timestamp.fromMillis(confirmed ? reviewedAt - 60000 : now - 30000),
        status: confirmed ? 'confirmed' : 'pending_verification',
        paymentStatus: confirmed ? 'verified' : 'submitted',
        paymentSnapshot: payment,
        ...(confirmed
          ? {
              reviewedAt: Timestamp.fromMillis(reviewedAt),
              reviewedBy: adminUid,
              verifiedAdvanceCents: 1000,
            }
          : {}),
        ...(expired && index === 0
          ? { serviceStatus: 'running', actualStartAt: firstActualStart }
          : {}),
      };
    });
    const existingSlots = await db.getAll(...requests.map((request) => db.doc(slotPath(request))));
    if (existingSlots.some((item) => item.exists))
      throw Error('Ya hay bloqueos en las rutas de prueba.');
    // Autorización de los usuarios de prueba: membresía solo de este local.
    const createdUsers = [];
    try {
      for (const account of accounts) {
        await auth.createUser({ ...account, password: 'GrassGoOpsDemo2026!', emailVerified: true });
        createdUsers.push(account.uid);
      }
      const batch = db.batch();
      batch.create(privateRef, {
        qaLiveOperations: true,
        name,
        location: 'Solo emuladores locales',
        status: 'published',
        bookingEngine: 'direct',
        bookingPolicy: { enabled: true, advanceCents: 1000, holdMinutes: 15 },
        payment,
        qaCreatedAt: Timestamp.fromMillis(now),
      });
      batch.create(publicRef, {
        qaLiveOperations: true,
        status: 'published',
        demo: true,
        name,
        location: 'Solo emuladores locales',
        description: 'Prueba desechable de partidos y precios. NO PAGAR.',
        reference: 'No visitar: establecimiento ficticio',
        district: 'Demostración',
        phone: '',
        images: [],
        openHour: 0,
        closeHour: 24,
        days,
        advanceCents: 1000,
        rating: null,
        courts: [{ id: 'principal', ...court }],
        booking: { engine: 'direct', enabled: true, holdMinutes: 15, payment },
      });
      batch.create(db.doc('establishments/' + tenant + '/courts/principal'), court);
      batch.create(db.doc('catalog/' + tenant + '/courts/principal'), court);
      batch.create(db.doc('establishments/' + tenant + '/members/' + adminUid), {
        role: 'admin',
        status: 'active',
      });
      batch.create(db.doc('users/' + adminUid + '/memberships/' + tenant), {
        name,
        role: 'admin',
        status: 'active',
      });
      for (const account of accounts)
        batch.create(db.doc('profiles/' + account.uid), {
          uid: account.uid,
          displayName: account.displayName,
          phone: '',
          createdAt: Timestamp.fromMillis(now),
          updatedAt: Timestamp.fromMillis(now),
        });
      requests.forEach((request, index) => {
        batch.create(db.doc('direct_requests/' + requestIds[index]), request);
        batch.create(db.doc(slotPath(request)), {
          reservationId: requestIds[index],
          lockedAt: request.createdAt,
          status: index < 2 ? 'confirmed' : 'held',
          ...(expired && index === 0
            ? { serviceStatus: 'running', actualStartAt: firstActualStart }
            : {}),
        });
        batch.create(db.doc('direct_proofs/' + requestIds[index]), {
          reservationId: requestIds[index],
          establishmentId: tenant,
          clientUid,
          contentType: 'image/jpeg',
          imageData,
          sha256,
          createdAt: request.proofSubmittedAt,
        });
      });
      if (expired) {
        const operation = {
          establishmentId: tenant,
          courtId: 'principal',
          activeReservationId: requestIds[0],
          activeDate: requests[0].date,
          actualStartAt: firstActualStart,
          lastEndedAt: null,
          revision: 1,
          updatedAt: firstActualStart,
          updatedBy: adminUid,
        };
        const { updatedBy, ...projection } = operation;
        const operationPath = 'establishments/' + tenant + '/courts/principal/operations/current';
        batch.create(db.doc(operationPath), operation);
        batch.create(
          db.doc('catalog/' + tenant + '/courts/principal/operations/current'),
          projection,
        );
        batch.create(db.doc(operationPath + '/history/1'), {
          establishmentId: tenant,
          courtId: 'principal',
          kind: 'session',
          revision: 1,
          actorUid: adminUid,
          at: firstActualStart,
          action: 'start',
          reservationId: requestIds[0],
          before: null,
          after: operation,
        });
      }
      await batch.commit();
    } catch (error) {
      for (const uid of createdUsers) await auth.deleteUser(uid);
      throw error;
    }
    console.log(
      JSON.stringify({
        fixture: tenant,
        timezone: 'America/Lima',
        mode: action,
        automaticEndAt: firstActualStart ? firstActualStart.toMillis() + 3600000 : null,
        confirmed: requests.slice(0, 2).map((request, index) => ({
          id: requestIds[index],
          date: request.date,
          hour: request.hour,
        })),
        pending: { id: requestIds[2], date: tomorrow, hour: pendingHour },
        noRealPayments: true,
      }),
    );
  } else if (action === 'verify') {
    const [privateCourt, publicCourt, runtime, history, pricingHistory] = await Promise.all([
      db.doc('establishments/' + tenant + '/courts/principal').get(),
      db.doc('catalog/' + tenant + '/courts/principal').get(),
      db.doc('establishments/' + tenant + '/courts/principal/operations/current').get(),
      db
        .collection('establishments/' + tenant + '/courts/principal/operations/current/history')
        .get(),
      db
        .collection('establishments/' + tenant + '/courts/principal/settings/pricing/history')
        .get(),
    ]);
    const prices = (snapshot) =>
      snapshot.exists
        ? {
            dayPriceCents: snapshot.data().dayPriceCents,
            nightPriceCents: snapshot.data().nightPriceCents,
            nightStartsAt: snapshot.data().nightStartsAt,
          }
        : null;
    const operation = runtime.data();
    console.log(
      JSON.stringify({
        exists: state.local.exists,
        privatePrices: prices(privateCourt),
        publicPrices: prices(publicCourt),
        runtime: operation
          ? {
              activeReservationId: operation.activeReservationId,
              activeDate: operation.activeDate,
              actualStartAt: millis(operation.actualStartAt),
              lastEndedAt: millis(operation.lastEndedAt),
              revision: operation.revision,
            }
          : null,
        historyCounts: { sessions: history.size, pricing: pricingHistory.size },
        requests: state.requests.docs.map((item) => {
          const request = item.data();
          return {
            id: item.id,
            date: request.date,
            hour: request.hour,
            status: request.status,
            paymentStatus: request.paymentStatus,
            totalCents: request.totalCents,
            advanceCents: request.advanceCents,
            verifiedAdvanceCents: request.verifiedAdvanceCents,
            serviceStatus: request.serviceStatus || null,
            actualStartAt: millis(request.actualStartAt),
            actualEndAt: millis(request.actualEndAt),
            proofExists: state.proofs.docs.some((proof) => proof.id === item.id),
          };
        }),
      }),
    );
  } else {
    // Toda comprobación ocurre antes de borrar: nunca borrar datos de otros UID/locales.
    const [clientRequests, memberships, profiles, globalRoles, members] = await Promise.all([
      db.collection('direct_requests').where('clientUid', '==', clientUid).get(),
      Promise.all(
        accounts.map((account) => db.collection('users/' + account.uid + '/memberships').get()),
      ),
      db.getAll(...accounts.map((account) => db.doc('profiles/' + account.uid))),
      db.getAll(...accounts.map((account) => db.doc('platform_roles/' + account.uid))),
      privateRef.collection('members').get(),
    ]);
    if (
      clientRequests.docs.some((request) => !ownRequest(request.data())) ||
      memberships.some((items) => items.docs.some((item) => item.id !== tenant)) ||
      profiles.some(
        (profile, index) => profile.exists && profile.data().uid !== accounts[index].uid,
      ) ||
      globalRoles.some((role) => role.exists) ||
      members.docs.some((member) => member.id !== adminUid)
    )
      throw Error('Las cuentas contienen datos o permisos ajenos al fixture. No se borró nada.');
    const ownedIds = new Set(state.requests.docs.map((request) => request.id));
    const courts = await db.collection('direct_slots/' + tenant + '/courts').listDocuments();
    for (const court of courts)
      for (const day of await court.collection('days').listDocuments()) {
        const hours = await day.collection('hours').get();
        if (hours.docs.some((hour) => !ownedIds.has(hour.data().reservationId)))
          throw Error('Hay un bloqueo ajeno al conjunto de solicitudes del fixture.');
      }
    if (state.local.exists) await db.recursiveDelete(privateRef);
    if (state.catalog.exists) await db.recursiveDelete(publicRef);
    for (const request of state.requests.docs) await db.recursiveDelete(request.ref);
    for (const proof of state.proofs.docs) await proof.ref.delete();
    await db.recursiveDelete(db.doc('direct_slots/' + tenant));
    await db.recursiveDelete(db.doc('direct_limits/' + clientUid));
    for (const account of accounts) {
      await db.recursiveDelete(db.doc('users/' + account.uid));
      await db.doc('profiles/' + account.uid).delete();
      if (state.users.some((user) => user?.uid === account.uid)) await auth.deleteUser(account.uid);
    }
    console.log(
      'Fixture qa-live-operations retirado. Los otros locales y sus reservas se conservaron.',
    );
  }
} finally {
  await deleteApp(app);
}
