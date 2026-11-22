import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { isDeepStrictEqual } from 'node:util';
const fail = (code, message) => {
  throw new HttpsError(code, message);
};
const key = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)
    ? value
    : fail('invalid-argument', 'Identificador inválido.');
const text = (value, label, max, required = false) => {
  if (
    typeof value !== 'string' ||
    value.trim().length > max ||
    (required && value.trim().length < 2) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    fail('invalid-argument', `${label}: revisa el texto ingresado.`);
  return value.trim();
};
const keys = (value, allowed) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((item) => !allowed.includes(item))
  )
    fail('invalid-argument', 'El formulario contiene campos no permitidos.');
};
const number = (value, min, max, label) => {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < min || value > max)
    fail('invalid-argument', `${label}: valor inválido.`);
  return value;
};
const list = (value, max, label) => {
  if (!Array.isArray(value) || value.length > max)
    fail('invalid-argument', `${label}: cantidad inválida.`);
  return value;
};
export function validateBusinessConfiguration(input, establishmentId) {
  keys(input, [
    'name',
    'district',
    'address',
    'reference',
    'description',
    'phone',
    'images',
    'days',
    'openHour',
    'closeHour',
    'courts',
    'holdMinutes',
    'payment',
    'adminEmail',
  ]);
  const asset = (value) => {
    if (value === '') return '';
    if (
      typeof value !== 'string' ||
      !new RegExp(`^business-media/${establishmentId}/[a-zA-Z0-9-]{1,80}$`).test(value)
    )
      fail('invalid-argument', 'Una imagen no pertenece a este negocio.');
    return value;
  };
  const courts = list(input.courts, 20, 'Canchas').map((court) => {
    keys(court, [
      'id',
      'name',
      'sport',
      'surface',
      'dayPriceCents',
      'nightPriceCents',
      'nightStartsAt',
      'images',
    ]);
    if (
      !['', 'Fútbol', 'Vóley', 'Multiuso'].includes(court.sport) ||
      !['', 'Grass sintético', 'Losa deportiva', 'Arena', 'Otro'].includes(court.surface)
    )
      fail('invalid-argument', 'Selecciona el tipo y la superficie de cada cancha.');
    return {
      id: key(court.id),
      name: text(court.name, 'Nombre de cancha', 80, true),
      sport: court.sport,
      surface: court.surface,
      dayPriceCents: number(court.dayPriceCents, 1000, 1000000, 'Tarifa de día'),
      nightPriceCents: number(court.nightPriceCents, 1000, 1000000, 'Tarifa de noche'),
      nightStartsAt: number(court.nightStartsAt, 0, 23, 'Inicio de noche'),
      images: [...new Set(list(court.images, 3, 'Fotos por cancha').map(asset))].filter(Boolean),
    };
  });
  if (new Set(courts.map((court) => court.id)).size !== courts.length)
    fail('invalid-argument', 'Las canchas deben tener identificadores distintos.');
  const days = [...new Set(list(input.days, 7, 'Días de atención'))];
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
    fail('invalid-argument', 'Días de atención inválidos.');
  keys(input.payment, ['mode', 'methods', 'recipient', 'phone', 'qr']);
  if (!['demo', 'live'].includes(input.payment.mode))
    fail('invalid-argument', 'Modo de pago inválido.');
  const methods = [...new Set(list(input.payment.methods, 2, 'Métodos de pago'))];
  if (methods.some((method) => !['Yape', 'Plin'].includes(method)))
    fail('invalid-argument', 'Método de pago inválido.');
  const phone = text(input.phone, 'Teléfono del negocio', 20);
  const paymentPhone = text(input.payment.phone, 'Teléfono de pago', 20);
  if (![phone, paymentPhone].every((value) => /^[+0-9 ()-]*$/.test(value)))
    fail('invalid-argument', 'Revisa los números telefónicos.');
  const email = text(input.adminEmail, 'Correo del administrador', 254).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail('invalid-argument', 'Correo de administrador inválido.');
  const config = {
    name: text(input.name, 'Nombre del negocio', 100, true),
    district: text(input.district, 'Distrito', 80),
    address: text(input.address, 'Dirección', 200),
    reference: text(input.reference, 'Referencia', 300),
    description: text(input.description, 'Descripción', 1000),
    phone,
    images: [
      ...new Set(list(input.images ?? [], 5, 'Fotos del establecimiento').map(asset)),
    ].filter(Boolean),
    days,
    openHour: number(input.openHour, 0, 23, 'Apertura'),
    closeHour: number(input.closeHour, 1, 24, 'Cierre'),
    courts,
    holdMinutes: number(input.holdMinutes, 1, 1440, 'Plazo de comprobante'),
    payment: {
      mode: input.payment.mode,
      methods,
      recipient: text(input.payment.recipient, 'Titular de pago', 100),
      phone: paymentPhone,
      qr: asset(input.payment.qr),
    },
    adminEmail: email,
  };
  if (config.openHour !== null && config.closeHour !== null && config.openHour >= config.closeHour)
    fail(
      'invalid-argument',
      'El cierre debe ser posterior a la apertura. Para medianoche elige 24:00.',
    );
  return config;
}
export function businessReadiness(config, { allowDemo = false } = {}) {
  const missing = [];
  if (!config.images.length) missing.push('Agrega la foto de portada del establecimiento.');
  if (!config.district || !config.address) missing.push('Completa distrito y dirección.');
  if (!config.days.length || config.openHour === null || config.closeHour === null)
    missing.push('Define días y horario de atención.');
  if (!config.courts.length) missing.push('Agrega al menos una cancha.');
  for (const [index, court] of config.courts.entries()) {
    if (
      !court.sport ||
      !court.surface ||
      court.dayPriceCents === null ||
      court.nightPriceCents === null ||
      court.nightStartsAt === null ||
      !court.images.length
    )
      missing.push(`Completa tipo, superficie, tarifas y foto de la cancha ${index + 1}.`);
  }
  if (config.holdMinutes === null) missing.push('Define el plazo para enviar el comprobante.');
  if (!config.adminEmail) missing.push('Asigna el correo del administrador del local.');
  if (!config.payment.methods.length) missing.push('Selecciona Yape o Plin.');
  if (
    config.payment.mode === 'live' &&
    (!config.payment.recipient ||
      !config.payment.qr ||
      !/^\+?\d[\d ()-]{7,19}$/.test(config.payment.phone))
  )
    missing.push('Completa titular, teléfono y QR de pago.');
  if (config.payment.mode === 'demo' && !allowDemo)
    missing.push('El modo demostración solo se habilita en emuladores.');
  return missing;
}
export function makeBusinessApi(
  db,
  {
    allowDemo = false,
    verifyAsset = async () => {
      throw new Error('Verificación de imágenes no configurada.');
    },
    resolveAdmin = async () => null,
  } = {},
) {
  async function superadmin(uid, tx) {
    if (!uid) fail('unauthenticated', 'Inicia sesión.');
    const ref = db.doc(`platform_roles/${uid}`);
    const data = (await (tx ? tx.get(ref) : ref.get())).data();
    if (data?.role !== 'superadmin' || data?.status !== 'active')
      fail('permission-denied', 'Acceso exclusivo de superadministración.');
  }
  const get = async (uid, input) => {
    await superadmin(uid);
    const establishmentId = key(input.establishmentId);
    const snapshot = await db.doc(`establishments/${establishmentId}`).get();
    if (!snapshot.exists) fail('not-found', 'Negocio no encontrado.');
    const data = snapshot.data();
    const legacyCourts = data.configuration
      ? []
      : (
          await db
            .collection(`establishments/${establishmentId}/courts`)
            .where('status', '==', 'active')
            .get()
        ).docs.map((court) => {
          const value = court.data();
          return {
            id: court.id,
            name: value.name,
            sport: value.sport || '',
            surface: value.surface || '',
            dayPriceCents: value.dayPriceCents ?? null,
            nightPriceCents: value.nightPriceCents ?? null,
            nightStartsAt: value.nightStartsAt ?? null,
            images: (value.images || []).filter(
              (path) =>
                typeof path === 'string' && path.startsWith(`business-media/${establishmentId}/`),
            ),
          };
        });
    return {
      id: snapshot.id,
      name: data.name,
      location: data.location || '',
      status: data.status,
      revision: data.businessRevision || 0,
      configuration: data.configuration || null,
      legacyCourts,
    };
  };
  return {
    getBusinessConfiguration: get,
    async saveBusinessConfiguration(uid, input) {
      await superadmin(uid);
      keys(input, ['establishmentId', 'revision', 'configuration']);
      const establishmentId = key(input.establishmentId);
      const revision = number(input.revision, 0, 1000000, 'Versión');
      if (revision === null) fail('invalid-argument', 'Versión requerida.');
      const config = validateBusinessConfiguration(input.configuration, establishmentId);
      const assets = [
        ...new Set(
          [
            ...config.images,
            ...config.courts.flatMap((court) => court.images),
            config.payment.qr,
          ].filter(Boolean),
        ),
      ];
      // Validación binaria y pertenencia antes de referenciar archivos en la configuración.
      for (const path of assets) await verifyAsset(path);
      await db.runTransaction(async (tx) => {
        await superadmin(uid, tx);
        const ref = db.doc(`establishments/${establishmentId}`),
          snapshot = await tx.get(ref);
        if (!snapshot.exists) fail('not-found', 'Negocio no encontrado.');
        const current = snapshot.data();
        if (current.status === 'published')
          fail(
            'failed-precondition',
            'Suspende la publicación antes de editar la operación del negocio.',
          );
        if ((current.businessRevision || 0) !== revision) {
          if (isDeepStrictEqual(current.configuration, config)) return;
          fail('aborted', 'Otra pestaña cambió este negocio. Recarga antes de guardar.');
        }
        tx.update(ref, {
          name: config.name,
          location:
            [config.address, config.district].filter(Boolean).join(', ') || current.location || '',
          description: config.description,
          configuration: config,
          businessRevision: revision + 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.create(db.collection('audit_logs').doc(), {
          action: 'business_configuration_saved',
          establishmentId,
          actorUid: uid,
          at: FieldValue.serverTimestamp(),
        });
      });
      return get(uid, { establishmentId });
    },
    async publishBusiness(uid, input) {
      await superadmin(uid);
      keys(input, ['establishmentId', 'revision']);
      const establishmentId = key(input.establishmentId);
      const previous = await get(uid, { establishmentId });
      if (!previous.configuration)
        fail('failed-precondition', 'Configura el negocio antes de publicarlo.');
      const config = validateBusinessConfiguration(previous.configuration, establishmentId);
      const missing = businessReadiness(config, { allowDemo });
      if (missing.length) fail('failed-precondition', missing.join(' '));
      const admin = await resolveAdmin(config.adminEmail);
      if (!admin || admin.disabled || !admin.emailVerified)
        fail(
          'failed-precondition',
          'El administrador debe tener una cuenta registrada, activa y con correo verificado.',
        );
      for (const path of [
        ...new Set(
          [
            ...config.images,
            ...config.courts.flatMap((court) => court.images),
            config.payment.qr,
          ].filter(Boolean),
        ),
      ])
        await verifyAsset(path);
      await db.runTransaction(async (tx) => {
        await superadmin(uid, tx);
        const ref = db.doc(`establishments/${establishmentId}`),
          snapshot = await tx.get(ref);
        const current = snapshot.data();
        if (!current) fail('not-found', 'Negocio no encontrado.');
        if (
          current.businessRevision !== input.revision ||
          current.businessRevision !== previous.revision
        )
          fail('aborted', 'La configuración cambió. Recarga antes de publicar.');
        if (current.status === 'published') return;
        if (current.status === 'suspended')
          fail(
            'failed-precondition',
            'Aprueba el negocio suspendido antes de volver a publicarlo.',
          );
        const oldCourts = await tx.get(db.collection(`establishments/${establishmentId}/courts`));
        const reservations = await tx.get(
          db.collection('reservations').where('establishmentId', '==', establishmentId),
        );
        const now = Date.now();
        if (
          oldCourts.docs.some(
            (court) => court.data().runtime && !config.courts.some((item) => item.id === court.id),
          )
        )
          fail('failed-precondition', 'No puedes retirar una cancha con un partido en juego.');
        if (
          reservations.docs.some((item) => {
            const reservation = item.data();
            return (
              !config.courts.some((court) => court.id === reservation.courtId) &&
              reservation.endsAt?.toMillis() > now &&
              (reservation.status === 'confirmed' ||
                (['pending_payment', 'pending_verification'].includes(reservation.status) &&
                  reservation.expiresAt?.toMillis() > now))
            );
          })
        )
          fail(
            'failed-precondition',
            'No puedes retirar una cancha con reservas vigentes. Conserva su ficha para proteger esos horarios.',
          );
        if (current.managedAdminUid && current.managedAdminUid !== admin.uid) {
          tx.delete(db.doc(`establishments/${establishmentId}/members/${current.managedAdminUid}`));
          tx.delete(db.doc(`users/${current.managedAdminUid}/memberships/${establishmentId}`));
        }
        for (const old of oldCourts.docs)
          if (!config.courts.some((court) => court.id === old.id))
            tx.update(old.ref, { status: 'inactive' });
        for (const court of config.courts)
          tx.set(
            db.doc(`establishments/${establishmentId}/courts/${court.id}`),
            {
              ...court,
              status: 'active',
              openHour: config.openHour,
              closeHour: config.closeHour,
              openDays: config.days,
            },
            { merge: true },
          );
        tx.set(db.doc(`establishments/${establishmentId}/members/${admin.uid}`), {
          role: 'admin',
          status: 'active',
        });
        tx.set(db.doc(`users/${admin.uid}/memberships/${establishmentId}`), {
          name: config.name,
          role: 'admin',
          status: 'active',
        });
        tx.update(ref, {
          status: 'published',
          managedAdminUid: admin.uid,
          bookingPolicy: { enabled: true, advanceCents: 1000, holdMinutes: config.holdMinutes },
          payment: {
            ...config.payment,
            qr: config.payment.mode === 'demo' ? '/assets/demo-payment-qr.svg' : config.payment.qr,
          },
          publishedAt: FieldValue.serverTimestamp(),
        });
        tx.create(db.collection('audit_logs').doc(), {
          action: 'business_published',
          establishmentId,
          actorUid: uid,
          at: FieldValue.serverTimestamp(),
        });
      });
      return { success: true };
    },
    async listPublishedBusinesses(uid) {
      if (!uid) fail('unauthenticated', 'Inicia sesión.');
      const venues = await db
        .collection('establishments')
        .where('status', '==', 'published')
        .limit(100)
        .get();
      const result = [];
      for (const snapshot of venues.docs) {
        const data = snapshot.data(),
          config = data.configuration || {};
        const courts = await db
          .collection(`establishments/${snapshot.id}/courts`)
          .where('status', '==', 'active')
          .get();
        result.push({
          id: snapshot.id,
          name: data.name,
          location: data.location || '',
          description: config.description || data.description || '',
          reference: config.reference || data.reference || '',
          district: config.district || '',
          phone: config.phone || data.phone || '',
          images: config.images || [],
          openHour: config.openHour ?? courts.docs[0]?.data().openHour ?? null,
          closeHour: config.closeHour ?? courts.docs[0]?.data().closeHour ?? null,
          days: config.days || [],
          advanceCents: 1000,
          rating: data.ratingSummary?.count ? { average: data.ratingSummary.average, count: data.ratingSummary.count, demo: false } :
            allowDemo && data.demoRatingSummary?.count ? { average: data.demoRatingSummary.average, count: data.demoRatingSummary.count, demo: true } : null,
          courts: courts.docs.map((courtDoc) => {
            const court = courtDoc.data();
            return {
              id: courtDoc.id,
              name: court.name,
              sport: court.sport || 'Fútbol',
              surface: court.surface || '',
              images: court.images || [],
              dayPriceCents: court.dayPriceCents,
              nightPriceCents: court.nightPriceCents,
              nightStartsAt: court.nightStartsAt,
            };
          }),
        });
      }
      return { establishments: result };
    },
  };
}
