import { Injectable, inject } from '@angular/core';
import type { DocumentData, Firestore, Transaction } from 'firebase/firestore';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import {
  paymentQrParts,
  validPaymentQr,
  PreparedPaymentQr,
} from '../models/establishment-business';
import { platformError } from '../models/platform';

export interface NewPlatformBusiness {
  requestId: string;
  name: string;
  location: string;
  ownerEmail: string;
  advanceCents: number;
  courts: NewPlatformCourt[];
}
export interface NewPlatformCourt {
  id: string;
  name: string;
  sport: string;
  surface: string;
  dayPriceCents: number;
  nightPriceCents: number;
  nightStartsAt: number;
}
export interface BusinessInvitation {
  id: string;
  establishmentId: string;
  establishmentName: string;
  targetEmail: string;
  status: 'pending' | 'accepted';
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const identifier = (value: string) => {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(value)) platformError('invalid-argument', 'Negocio inválido.');
};
const emailValue = (value: string) => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    platformError('invalid-argument', 'Escribe el correo del dueño correctamente.');
  return email;
};
const requiredText = (value: string, label: string, maximum: number) => {
  if (
    typeof value !== 'string' ||
    value.trim().length < 2 ||
    value.trim().length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    platformError('invalid-argument', `Revisa ${label}.`);
  return value.trim();
};
const courtInput = (input: NewPlatformCourt, advance?: number): NewPlatformCourt => {
  if (!input || (input.id !== 'principal' && !UUID.test(input.id)))
    platformError('invalid-argument', 'Vuelve a agregar esta cancha al formulario.');
  const value = {
    id: input.id,
    name: requiredText(input.name, 'el nombre de la cancha', 100),
    sport: requiredText(input.sport, 'el deporte', 50),
    surface: requiredText(input.surface, 'la superficie', 80),
    dayPriceCents: input.dayPriceCents,
    nightPriceCents: input.nightPriceCents,
    nightStartsAt: input.nightStartsAt,
  };
  if (
    ![value.dayPriceCents, value.nightPriceCents].every(
      (price) =>
        Number.isInteger(price) &&
        price >= 1000 &&
        price <= 1000000 &&
        (advance === undefined || price >= advance),
    ) ||
    !Number.isInteger(value.nightStartsAt) ||
    value.nightStartsAt < 0 ||
    value.nightStartsAt > 23
  )
    platformError(
      'invalid-argument',
      'Completa los precios reales y la hora de tarifa nocturna. El precio no puede ser menor al adelanto.',
    );
  return value;
};

/** Convierte el adelanto indicado por el negocio sin inventar ni redondear importes. */
export function advanceInputCents(value: string): number | null {
  if (!/^[0-9]{1,5}([.,][0-9]{1,2})?$/.test(value.trim())) return null;
  const [whole, decimal = ''] = value.trim().replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return cents > 0 && cents <= 1000000 ? cents : null;
}
export function onboardingError(error: unknown): string {
  const value = error as { code?: string; message?: string };
  if (
    /functions\/(invalid-argument|failed-precondition|already-exists|aborted|not-found)$/.test(
      value?.code || '',
    )
  )
    return value.message || 'Actualiza los datos antes de continuar.';
  if (value?.code?.endsWith('permission-denied'))
    return 'No tienes permiso para realizar esta acción.';
  if (value?.code?.endsWith('unauthenticated')) return 'Inicia sesión para continuar.';
  return 'No pudimos guardar los cambios. Comprueba tu conexión y vuelve a intentarlo.';
}

/** Alta, aceptación voluntaria del dueño y publicación mediante operaciones atómicas. */
@Injectable({ providedIn: 'root' })
export class PlatformOnboardingService {
  private readonly firebase = inject(FirebaseService);
  private readonly auth = inject(AuthService);
  private sdk?: Promise<typeof import('firebase/firestore')>;
  private firestore() {
    return (this.sdk ??= import('firebase/firestore'));
  }
  private async session() {
    await this.auth.ready;
    const user = this.auth.user();
    if (!user) platformError('unauthenticated', 'Inicia sesión para continuar.');
    return { user, uid: user.uid, db: await this.firebase.getDb() };
  }
  private async superadmin(db: Firestore, uid: string, tx?: Transaction) {
    const { doc, getDocFromServer } = await this.firestore();
    const ref = doc(db, 'platform_roles', uid);
    const role = (tx ? await tx.get(ref) : await getDocFromServer(ref)).data();
    if (role?.['role'] !== 'superadmin' || role?.['status'] !== 'active')
      platformError('permission-denied', 'Acceso exclusivo de superadministración.');
  }

  async create(input: NewPlatformBusiness): Promise<{ id: string }> {
    if (!UUID.test(input.requestId))
      platformError('invalid-argument', 'Vuelve a abrir el formulario.');
    const name = requiredText(input.name, 'el nombre del negocio', 100);
    const location = requiredText(input.location, 'la ubicación', 200);
    const ownerEmail = emailValue(input.ownerEmail);
    if (
      !Number.isInteger(input.advanceCents) ||
      input.advanceCents <= 0 ||
      input.advanceCents > 1000000
    )
      platformError('invalid-argument', 'Indica el adelanto real del negocio.');
    if (!Array.isArray(input.courts) || input.courts.length < 1 || input.courts.length > 20)
      platformError(
        'invalid-argument',
        'Agrega entre una y veinte canchas con sus precios reales.',
      );
    const courts = input.courts.map((item) => courtInput(item, input.advanceCents));
    if (
      courts[0].id !== 'principal' ||
      new Set(courts.map((court) => court.id)).size !== courts.length
    )
      platformError(
        'invalid-argument',
        'Revisa las canchas del formulario: sus identificadores deben ser distintos.',
      );
    const { db, uid } = await this.session();
    const { doc, runTransaction, serverTimestamp } = await this.firestore();
    const id = input.requestId;
    const refs = {
      venue: doc(db, 'establishments', id),
      catalog: doc(db, 'catalog', id),
      invitation: doc(db, 'establishment_invitations', id),
      audit: doc(db, 'audit_logs', id),
    };
    await runTransaction(db, async (tx) => {
      await this.superadmin(db, uid, tx);
      const [venue, parent, invitation, audit] = await Promise.all(
        [refs.venue, refs.catalog, refs.invitation, refs.audit].map((ref) => tx.get(ref)),
      );
      if (venue.exists()) {
        const old = venue.data()!;
        if (
          old['createdBy'] !== uid ||
          old['name'] !== name ||
          old['location'] !== location ||
          old['bookingPolicy']?.advanceCents !== input.advanceCents ||
          invitation.data()?.['targetEmail'] !== ownerEmail
        )
          platformError(
            'already-exists',
            'Este intento ya corresponde a otro negocio. Abre un formulario nuevo.',
          );
        if (!parent.exists() || audit.data()?.['action'] !== 'establishment_created')
          platformError(
            'failed-precondition',
            'Este negocio requiere revisar su alta antes de continuar.',
          );
        return;
      }
      if ([parent, invitation, audit].some((item) => item.exists()))
        platformError(
          'already-exists',
          'Este identificador ya está en uso. Abre un formulario nuevo.',
        );
      const lifecycle = {
        lifecycleChangeId: id,
        lifecycleUpdatedAt: serverTimestamp(),
        lifecycleUpdatedBy: uid,
      };
      tx.set(refs.venue, {
        name,
        location,
        status: 'approved',
        bookingEngine: 'direct',
        bookingPolicy: { enabled: false, advanceCents: input.advanceCents, holdMinutes: 15 },
        ownerInvitationId: id,
        createdBy: uid,
        createdAt: serverTimestamp(),
        ...lifecycle,
      });
      tx.set(refs.catalog, {
        name,
        location,
        status: 'draft',
        description: '',
        reference: '',
        district: '',
        phone: '',
        images: [],
        courts: [],
        advanceCents: input.advanceCents,
        booking: { engine: 'direct', enabled: false, holdMinutes: 15 },
        ...lifecycle,
      });
      tx.set(refs.invitation, {
        establishmentId: id,
        establishmentName: name,
        targetEmail: ownerEmail,
        status: 'pending',
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
      tx.set(refs.audit, {
        action: 'establishment_created',
        establishmentId: id,
        actorUid: uid,
        at: serverTimestamp(),
        status: 'approved',
        publicationStatus: 'draft',
      });
    });
    try {
      for (const court of courts) await this.addCourt(id, court);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code?.endsWith('permission-denied') || code?.endsWith('unauthenticated')) throw error;
      platformError(
        'failed-precondition',
        `El negocio quedó en preparación. Conserva este formulario y pulsa Guardar otra vez para completar sus canchas. ${onboardingError(error)}`,
      );
    }
    return { id };
  }

  async addCourt(establishmentId: string, input: NewPlatformCourt): Promise<{ id: string }> {
    identifier(establishmentId);
    const value = courtInput(input);
    const { db, uid } = await this.session();
    const { doc, runTransaction, serverTimestamp } = await this.firestore();
    const parentRef = doc(db, 'catalog', establishmentId);
    const privateRef = doc(db, 'establishments', establishmentId, 'courts', value.id);
    const publicRef = doc(db, 'catalog', establishmentId, 'courts', value.id);
    const canonicalRef = doc(
      db,
      'establishments',
      establishmentId,
      'courts',
      value.id,
      'settings',
      'pricing',
    );
    const eventRef = doc(db, 'audit_logs', crypto.randomUUID());
    await runTransaction(db, async (tx) => {
      await this.superadmin(db, uid, tx);
      const [venue, parent, existing, published, savedPricing] = await Promise.all([
        tx.get(doc(db, 'establishments', establishmentId)),
        tx.get(parentRef),
        tx.get(privateRef),
        tx.get(publicRef),
        tx.get(canonicalRef),
      ]);
      const local = venue.data(),
        catalog = parent.data();
      if (
        !local ||
        local['bookingEngine'] !== 'direct' ||
        !['approved', 'published'].includes(local['status']) ||
        !catalog ||
        !Array.isArray(catalog['courts'])
      )
        platformError(
          'failed-precondition',
          'El negocio necesita una ficha aprobada antes de agregar canchas.',
        );
      const advance = local['bookingPolicy']?.advanceCents ?? catalog['advanceCents'];
      if (!Number.isInteger(advance) || advance < 1 || advance !== catalog['advanceCents'])
        platformError(
          'failed-precondition',
          'Primero revisa el adelanto real configurado para este negocio.',
        );
      courtInput(value, advance);
      const list = catalog['courts'] as DocumentData[];
      const entries = list.filter((entry) => entry['id'] === value.id);
      if (existing.exists()) {
        const privateCourt = existing.data()!,
          publicCourt = published.data(),
          pricing = savedPricing.data();
        const same = (data: DocumentData | undefined) =>
          !!data &&
          ['name', 'sport', 'surface', 'dayPriceCents', 'nightPriceCents', 'nightStartsAt'].every(
            (key) => data[key] === value[key as keyof NewPlatformCourt],
          );
        if (
          !same(privateCourt) ||
          !same(publicCourt) ||
          entries.length !== 1 ||
          !same(entries[0]) ||
          !pricing ||
          !['dayPriceCents', 'nightPriceCents', 'nightStartsAt'].every(
            (key) => pricing[key] === value[key as keyof NewPlatformCourt],
          ) ||
          privateCourt['status'] !== 'active' ||
          publicCourt!['status'] !== 'active' ||
          !Number.isInteger(pricing['revision']) ||
          pricing['revision'] < 1 ||
          privateCourt['pricingRevision'] !== pricing['revision'] ||
          publicCourt!['pricingRevision'] !== pricing['revision'] ||
          entries[0]['pricingRevision'] !== pricing['revision'] ||
          entries[0]['pricingConfirmed'] !== true ||
          !pricing['updatedAt'] ||
          [privateCourt['pricingUpdatedAt'], publicCourt!['pricingUpdatedAt']].some(
            (value) => JSON.stringify(value) !== JSON.stringify(pricing['updatedAt']),
          )
        )
          platformError(
            'already-exists',
            'Esta cancha ya tiene otros datos guardados. Revisa su ficha antes de volver a agregarla.',
          );
        return;
      }
      if (published.exists() || savedPricing.exists() || entries.length)
        platformError(
          'already-exists',
          'La cancha ya tiene datos parciales. Actualiza el negocio para revisarlos.',
        );
      if (list.length >= 20)
        platformError('failed-precondition', 'Este negocio ya tiene veinte canchas.');
      if (
        (list.length === 0 && value.id !== 'principal') ||
        (list.length > 0 && value.id === 'principal')
      )
        platformError(
          'invalid-argument',
          'La primera cancha debe ser la principal. Vuelve a abrir el formulario de la nueva cancha.',
        );
      const fields = {
        dayPriceCents: value.dayPriceCents,
        nightPriceCents: value.nightPriceCents,
        nightStartsAt: value.nightStartsAt,
      };
      const pricing = {
        establishmentId,
        courtId: value.id,
        ...fields,
        revision: 1,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      };
      const certificate = { pricingRevision: 1, pricingConfirmed: true };
      const court = {
        name: value.name,
        sport: value.sport,
        surface: value.surface,
        images: [],
        ...fields,
        status: 'active',
        maintenance: false,
        runtime: null,
        pricingRevision: 1,
        pricingUpdatedAt: serverTimestamp(),
      };
      tx.set(privateRef, court);
      tx.set(publicRef, court);
      tx.set(canonicalRef, pricing);
      tx.update(parentRef, {
        courts: [
          ...list,
          {
            id: value.id,
            name: value.name,
            sport: value.sport,
            surface: value.surface,
            images: [],
            ...fields,
            ...certificate,
          },
        ],
        pricingCourtId: value.id,
        pricingCourtIndex: list.length,
        pricingRevision: 1,
        pricingUpdatedAt: serverTimestamp(),
        courtAdditionId: eventRef.id,
        courtAdditionAt: serverTimestamp(),
        courtAdditionBy: uid,
      });
      tx.set(
        doc(
          db,
          'establishments',
          establishmentId,
          'courts',
          value.id,
          'settings',
          'pricing',
          'history',
          '1',
        ),
        {
          establishmentId,
          kind: 'pricing',
          revision: 1,
          actorUid: uid,
          at: serverTimestamp(),
          before: null,
          after: pricing,
        },
      );
      tx.set(eventRef, {
        establishmentId,
        actorUid: uid,
        kind: 'pricing',
        referenceId: value.id,
        revision: 1,
        action: 'business_setting_changed',
        at: serverTimestamp(),
      });
    });
    return { id: value.id };
  }

  async invitations(): Promise<BusinessInvitation[]> {
    const { db, user } = await this.session();
    const email = emailValue(user.email || '');
    const { collection, query, where, limit, getDocsFromServer } = await this.firestore();
    const result = await getDocsFromServer(
      query(
        collection(db, 'establishment_invitations'),
        where('targetEmail', '==', email),
        limit(50),
      ),
    );
    return result.docs.map((item) => {
      const value = item.data();
      return {
        id: item.id,
        establishmentId: value['establishmentId'],
        establishmentName: value['establishmentName'],
        targetEmail: value['targetEmail'],
        status: value['status'],
      } as BusinessInvitation;
    });
  }

  async accept(invitationId: string): Promise<{ establishmentId: string }> {
    if (!UUID.test(invitationId)) platformError('invalid-argument', 'La invitación no es válida.');
    const { db, uid, user } = await this.session();
    const token = await user.getIdTokenResult(true);
    const email = emailValue(user.email || '');
    if (
      token.claims['email_verified'] !== true ||
      emailValue(String(token.claims['email'] || '')) !== email
    )
      platformError('failed-precondition', 'Verifica tu correo antes de aceptar la invitación.');
    const { doc, runTransaction, serverTimestamp } = await this.firestore();
    const invitationRef = doc(db, 'establishment_invitations', invitationId);
    const venueRef = doc(db, 'establishments', invitationId);
    const auditRef = doc(db, 'audit_logs', crypto.randomUUID());
    await runTransaction(db, async (tx) => {
      const invitation = await tx.get(invitationRef);
      const value = invitation.data();
      if (!value || value['establishmentId'] !== invitationId || value['targetEmail'] !== email)
        platformError('permission-denied', 'La invitación no corresponde a tu cuenta.');
      if (value['status'] === 'accepted') {
        if (value['acceptedBy'] === uid) return;
        platformError('failed-precondition', 'Esta invitación ya fue aceptada por otra cuenta.');
      }
      if (value['status'] !== 'pending')
        platformError('failed-precondition', 'La invitación ya no está disponible.');
      // La invitación contiene el nombre necesario para navegar. Antes de aceptar
      // no se leen datos privados del negocio. Las reglas validan ausencia de
      // dueño, borrador y creación de ambas membresías en el mismo commit.
      tx.update(invitationRef, {
        status: 'accepted',
        acceptedAt: serverTimestamp(),
        acceptedBy: uid,
      });
      tx.update(venueRef, {
        managedAdminUid: uid,
        lifecycleChangeId: auditRef.id,
        lifecycleUpdatedAt: serverTimestamp(),
        lifecycleUpdatedBy: uid,
      });
      tx.set(doc(db, 'establishments', invitationId, 'members', uid), {
        role: 'admin',
        status: 'active',
      });
      tx.set(doc(db, 'users', uid, 'memberships', invitationId), {
        name: value['establishmentName'],
        role: 'admin',
        status: 'active',
      });
      tx.set(auditRef, {
        action: 'owner_invitation_accepted',
        establishmentId: invitationId,
        actorUid: uid,
        at: serverTimestamp(),
        status: 'approved',
        publicationStatus: 'draft',
      });
    });
    return { establishmentId: invitationId };
  }

  async publish(establishmentId: string): Promise<{ success: true }> {
    identifier(establishmentId);
    const { db, uid } = await this.session();
    const { doc, runTransaction, serverTimestamp } = await this.firestore();
    const venueRef = doc(db, 'establishments', establishmentId),
      parentRef = doc(db, 'catalog', establishmentId);
    const eventRef = doc(db, 'audit_logs', crypto.randomUUID());
    await runTransaction(db, async (tx) => {
      await this.superadmin(db, uid, tx);
      const [venue, parent, weekly, payment] = await Promise.all([
        tx.get(venueRef),
        tx.get(parentRef),
        tx.get(doc(db, 'establishments', establishmentId, 'settings', 'schedule')),
        tx.get(doc(db, 'establishments', establishmentId, 'settings', 'payment')),
      ]);
      const local = venue.data(),
        catalog = parent.data(),
        schedule = weekly.data(),
        pay = payment.data();
      if (
        !local ||
        !catalog ||
        !['approved', 'published'].includes(local['status']) ||
        local['bookingEngine'] !== 'direct'
      )
        platformError('failed-precondition', 'Primero aprueba el negocio y prepara su ficha.');
      const ownerUid = local['managedAdminUid'];
      const qrParts = paymentQrParts(String(pay?.['qr'] || ''));
      if (
        typeof ownerUid !== 'string' ||
        !ownerUid ||
        !qrParts ||
        qrParts.establishmentId !== establishmentId
      )
        platformError(
          'failed-precondition',
          'Falta que el dueño acepte su invitación o configure el QR de pago.',
        );
      const [member, qr] = await Promise.all([
        tx.get(doc(db, 'establishments', establishmentId, 'members', ownerUid)),
        tx.get(doc(db, 'catalog', establishmentId, 'paymentQrs', qrParts.id)),
      ]);
      const parentCourts = catalog['courts'];
      // El piloto anterior ya mostraba el adelanto en su ficha pública.
      // Solo se completa el dato canónico ausente; los importes distintos requieren revisión.
      const advance = local['bookingPolicy']?.advanceCents ?? catalog['advanceCents'];
      // Cada entrada recibe su certificado al agregar la cancha o guardar precios
      // junto al canónico y las dos proyecciones. Así publicar veinte canchas
      // mantiene la validación del servidor dentro del límite de lecturas.
      const validCourts =
        Array.isArray(parentCourts) &&
        parentCourts.length >= 1 &&
        parentCourts.length <= 20 &&
        new Set(parentCourts.map((court: DocumentData) => court['id'])).size ===
          parentCourts.length &&
        parentCourts.every(
          (court: DocumentData) =>
            typeof court['id'] === 'string' &&
            /^[A-Za-z0-9-]{1,80}$/.test(court['id']) &&
            typeof court['name'] === 'string' &&
            court['name'].trim().length >= 2 &&
            typeof court['sport'] === 'string' &&
            court['sport'].trim().length >= 2 &&
            Number.isInteger(court['pricingRevision']) &&
            court['pricingRevision'] >= 1 &&
            court['pricingConfirmed'] === true &&
            [court['dayPriceCents'], court['nightPriceCents']].every(
              (price) =>
                Number.isInteger(price) && price >= 1000 && price <= 1000000 && price >= advance,
            ) &&
            Number.isInteger(court['nightStartsAt']) &&
            court['nightStartsAt'] >= 0 &&
            court['nightStartsAt'] <= 23,
        );
      const validSchedule =
        !!schedule &&
        schedule['establishmentId'] === establishmentId &&
        Number.isInteger(schedule['revision']) &&
        schedule['revision'] >= 1 &&
        Array.isArray(schedule['days']) &&
        schedule['days'].length > 0 &&
        schedule['days'].length <= 7 &&
        new Set(schedule['days']).size === schedule['days'].length &&
        schedule['days'].every((day: number) => Number.isInteger(day) && day >= 0 && day <= 6) &&
        Number.isInteger(schedule['openHour']) &&
        Number.isInteger(schedule['closeHour']) &&
        schedule['openHour'] >= 0 &&
        schedule['closeHour'] <= 24 &&
        schedule['openHour'] < schedule['closeHour'] &&
        ['days', 'openHour', 'closeHour'].every(
          (key) => JSON.stringify(schedule[key]) === JSON.stringify(catalog[key]),
        ) &&
        schedule['revision'] === catalog['scheduleRevision'];
      const publicPayment = catalog['booking']?.payment;
      const validPayment =
        pay?.['mode'] === 'live' &&
        pay['establishmentId'] === establishmentId &&
        Number.isInteger(pay['revision']) &&
        pay['revision'] >= 1 &&
        Array.isArray(pay['methods']) &&
        pay['methods'].length >= 1 &&
        pay['methods'].length <= 2 &&
        new Set(pay['methods']).size === pay['methods'].length &&
        pay['methods'].every((method: string) => ['Yape', 'Plin'].includes(method)) &&
        typeof pay['recipient'] === 'string' &&
        pay['recipient'].trim().length >= 2 &&
        pay['recipient'].length <= 100 &&
        String(pay['phone'] || '').length <= 20 &&
        /^\+?[0-9][0-9 ()-]{7,19}$/.test(String(pay['phone'] || '')) &&
        ['mode', 'qr', 'methods', 'recipient', 'phone'].every(
          (key) => JSON.stringify(pay[key]) === JSON.stringify(publicPayment?.[key]),
        ) &&
        pay['revision'] === catalog['paymentRevision'] &&
        validPaymentQr(qr.data() as PreparedPaymentQr) &&
        qr.data()?.['establishmentId'] === establishmentId &&
        qr.data()?.['id'] === qrParts.id;
      if (
        member.data()?.['role'] !== 'admin' ||
        member.data()?.['status'] !== 'active' ||
        !validCourts ||
        !validSchedule ||
        !validPayment ||
        !Number.isInteger(advance) ||
        advance <= 0 ||
        advance > 1000000 ||
        advance !== catalog['advanceCents'] ||
        (local['bookingPolicy']?.holdMinutes ?? 15) !== 15 ||
        (catalog['booking']?.holdMinutes ?? 15) !== 15
      )
        platformError(
          'failed-precondition',
          'Completa horarios, QR y precios guardados de todas las canchas antes de publicar. Revisa también que el adelanto no supere sus precios.',
        );
      if (
        local['status'] === 'published' &&
        local['bookingPolicy']?.enabled === true &&
        catalog['status'] === 'published' &&
        catalog['booking']?.enabled === true
      )
        return;
      const lifecycle = {
        lifecycleChangeId: eventRef.id,
        lifecycleUpdatedAt: serverTimestamp(),
        lifecycleUpdatedBy: uid,
      };
      tx.update(venueRef, {
        status: 'published',
        'bookingPolicy.enabled': true,
        'bookingPolicy.holdMinutes': 15,
        'bookingPolicy.advanceCents': advance,
        ...lifecycle,
      });
      tx.update(parentRef, {
        status: 'published',
        'booking.enabled': true,
        'booking.engine': 'direct',
        'booking.holdMinutes': 15,
        ...lifecycle,
      });
      tx.set(eventRef, {
        action: 'business_published',
        establishmentId,
        actorUid: uid,
        at: serverTimestamp(),
        status: 'published',
        publicationStatus: 'published',
      });
    });
    return { success: true };
  }
}
