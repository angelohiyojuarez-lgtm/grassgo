import { Injectable, inject } from '@angular/core';
import { recordBusinessAudit } from './business-audit';
import type { DocumentData } from 'firebase/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import {
  AdminBusinessData,
  BusinessContact,
  BusinessPayment,
  PreparedPaymentQr,
  businessSettingsError,
  paymentQrParts,
  validPaymentQr,
} from '../models/establishment-business';

function identifier(id: string): void {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id))
    businessSettingsError('invalid-argument', 'Identificador de local inválido.');
}
function revision(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= 1000000000)
    businessSettingsError('invalid-argument', 'Recarga los datos antes de guardar.');
}
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const contactView = (data: DocumentData | undefined): BusinessContact => ({
  phone: text(data?.['phone']),
  description: text(data?.['description']),
  reference: text(data?.['reference']),
  revision: data?.['revision'] || 0,
});
const paymentView = (data: DocumentData | undefined): BusinessPayment => ({
  methods: Array.isArray(data?.['methods'])
    ? [
        ...new Set<string>(
          data!['methods'].filter((method: unknown) => method === 'Yape' || method === 'Plin'),
        ),
      ]
    : [],
  recipient: text(data?.['recipient']),
  phone: text(data?.['phone']),
  qr: text(data?.['qr']),
  revision: data?.['revision'] || 0,
});
function contactValues(value: BusinessContact): BusinessContact {
  revision(value.revision);
  if (
    typeof value.phone !== 'string' ||
    !/^[+0-9 ()-]{0,20}$/.test(value.phone) ||
    typeof value.description !== 'string' ||
    value.description.length > 1000 ||
    typeof value.reference !== 'string' ||
    value.reference.length > 300
  )
    businessSettingsError(
      'invalid-argument',
      'Revisa el celular, la descripción y la referencia del local.',
    );
  return {
    phone: value.phone.trim(),
    description: value.description.trim(),
    reference: value.reference.trim(),
    revision: value.revision,
  };
}
function paymentValues(value: BusinessPayment): BusinessPayment {
  revision(value.revision);
  if (
    !Array.isArray(value.methods) ||
    value.methods.length < 1 ||
    value.methods.length > 2 ||
    new Set(value.methods).size !== value.methods.length ||
    value.methods.some((method) => !['Yape', 'Plin'].includes(method)) ||
    typeof value.recipient !== 'string' ||
    value.recipient.trim().length < 2 ||
    value.recipient.length > 100 ||
    typeof value.phone !== 'string' ||
    !/^\+?[0-9][0-9 ()-]{7,19}$/.test(value.phone.trim()) ||
    typeof value.qr !== 'string'
  )
    businessSettingsError(
      'invalid-argument',
      'Elige Yape o Plin y completa el titular, el celular de pago y el QR.',
    );
  return {
    methods: ['Yape', 'Plin'].filter((method) => value.methods.includes(method)),
    recipient: value.recipient.trim(),
    phone: value.phone.trim(),
    qr: value.qr,
    revision: value.revision,
  };
}

/** Datos públicos y pago del local asignado, con revisiones e historial atómicos. */
@Injectable({ providedIn: 'root' })
export class EstablishmentBusinessService {
  private readonly firebase = inject(FirebaseService);
  private uid(): string {
    return (
      this.firebase.auth.currentUser?.uid ||
      businessSettingsError('unauthenticated', 'Inicia sesión para continuar.')
    );
  }
  private assertLocal(data: DocumentData | undefined): void {
    if (!data || data['bookingEngine'] !== 'direct')
      businessSettingsError(
        'failed-precondition',
        'La edición de datos de este local todavía no está habilitada.',
      );
  }
  async load(establishmentId: string): Promise<AdminBusinessData> {
    this.uid();
    identifier(establishmentId);
    const { doc, getDocFromServer } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    const local = (await getDocFromServer(doc(db, 'establishments', establishmentId))).data();
    this.assertLocal(local);
    const [parent, contact, payment] = await Promise.all([
      getDocFromServer(doc(db, 'catalog', establishmentId)),
      getDocFromServer(doc(db, 'establishments', establishmentId, 'settings', 'contact')),
      getDocFromServer(doc(db, 'establishments', establishmentId, 'settings', 'payment')),
    ]);
    if (!parent.exists())
      businessSettingsError(
        'failed-precondition',
        'Primero debe estar preparada la ficha del establecimiento.',
      );
    return {
      name: text(local!['name']),
      contact: contactView(contact.exists() ? contact.data() : { ...parent.data(), revision: 0 }),
      payment: paymentView(
        payment.exists() ? payment.data() : { ...parent.data()?.['booking']?.payment, revision: 0 },
      ),
    };
  }
  async saveContact(establishmentId: string, input: BusinessContact): Promise<BusinessContact> {
    const uid = this.uid();
    identifier(establishmentId);
    const value = contactValues(input);
    const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    return runTransaction(db, async (tx) => {
      this.assertLocal((await tx.get(doc(db, 'establishments', establishmentId))).data());
      const ref = doc(db, 'establishments', establishmentId, 'settings', 'contact');
      const before = (await tx.get(ref)).data() || null;
      if ((before?.['revision'] || 0) !== value.revision)
        businessSettingsError(
          'aborted',
          'Otra persona cambió los datos del negocio. Recarga antes de guardar.',
        );
      if (
        before &&
        before['phone'] === value.phone &&
        before['description'] === value.description &&
        before['reference'] === value.reference
      )
        return contactView(before);
      const next = value.revision + 1;
      const after = {
        establishmentId,
        phone: value.phone,
        description: value.description,
        reference: value.reference,
        revision: next,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      };
      tx.set(ref, after);
      tx.update(doc(db, 'catalog', establishmentId), {
        phone: value.phone,
        description: value.description,
        reference: value.reference,
        contactRevision: next,
        contactUpdatedAt: serverTimestamp(),
      });
      tx.set(
        doc(db, 'establishments', establishmentId, 'settings', 'contact', 'history', String(next)),
        {
          establishmentId,
          kind: 'contact',
          revision: next,
          actorUid: uid,
          at: serverTimestamp(),
          before,
          after,
        },
      );
      await recordBusinessAudit(tx, db, {
        establishmentId,
        actorUid: uid,
        kind: 'contact',
        referenceId: 'contact',
        revision: next,
      });
      return { ...value, revision: next };
    });
  }
  async savePayment(
    establishmentId: string,
    input: BusinessPayment,
    newQr?: PreparedPaymentQr,
  ): Promise<BusinessPayment> {
    const uid = this.uid();
    identifier(establishmentId);
    const value = paymentValues(input);
    const parts = paymentQrParts(value.qr);
    if (
      !parts ||
      parts.establishmentId !== establishmentId ||
      (newQr && (!validPaymentQr(newQr) || newQr.id !== parts.id))
    )
      businessSettingsError(
        'invalid-argument',
        'Sube y revisa una foto del QR de este establecimiento antes de guardar.',
      );
    const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    return runTransaction(db, async (tx) => {
      this.assertLocal((await tx.get(doc(db, 'establishments', establishmentId))).data());
      const ref = doc(db, 'establishments', establishmentId, 'settings', 'payment');
      const before = (await tx.get(ref)).data() || null;
      if ((before?.['revision'] || 0) !== value.revision)
        businessSettingsError(
          'aborted',
          'Otra persona cambió los datos de pago. Recarga y vuelve a revisarlos.',
        );
      const qrRef = doc(db, 'catalog', establishmentId, 'paymentQrs', parts.id);
      const savedQr = (await tx.get(qrRef)).data();
      if (savedQr) {
        if (
          savedQr['establishmentId'] !== establishmentId ||
          savedQr['id'] !== parts.id ||
          !validPaymentQr(savedQr as PreparedPaymentQr) ||
          (newQr &&
            (savedQr['sha256'] !== newQr.sha256 || savedQr['imageData'] !== newQr.imageData))
        )
          businessSettingsError(
            'invalid-argument',
            'Esta imagen no corresponde al QR elegido. Vuelve a subirla.',
          );
      } else if (!newQr)
        businessSettingsError(
          'failed-precondition',
          'Falta subir la foto del QR. Elige la imagen antes de guardar.',
        );
      if (
        before &&
        before['mode'] === 'live' &&
        before['qr'] === value.qr &&
        before['phone'] === value.phone &&
        before['recipient'] === value.recipient &&
        JSON.stringify(before['methods']) === JSON.stringify(value.methods)
      )
        return paymentView(before);
      const next = value.revision + 1;
      const publicPayment = {
        mode: 'live',
        qr: value.qr,
        methods: value.methods,
        recipient: value.recipient,
        phone: value.phone,
      };
      const after = {
        establishmentId,
        ...publicPayment,
        revision: next,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      };
      if (!savedQr)
        tx.set(qrRef, {
          establishmentId,
          id: newQr!.id,
          imageData: newQr!.imageData,
          contentType: newQr!.contentType,
          width: newQr!.width,
          height: newQr!.height,
          sha256: newQr!.sha256,
          createdAt: serverTimestamp(),
        });
      tx.set(ref, after);
      tx.update(doc(db, 'catalog', establishmentId), {
        'booking.payment': publicPayment,
        paymentRevision: next,
        paymentUpdatedAt: serverTimestamp(),
      });
      tx.set(
        doc(db, 'establishments', establishmentId, 'settings', 'payment', 'history', String(next)),
        {
          establishmentId,
          kind: 'payment',
          revision: next,
          actorUid: uid,
          at: serverTimestamp(),
          before,
          after,
        },
      );
      await recordBusinessAudit(tx, db, {
        establishmentId,
        actorUid: uid,
        kind: 'payment',
        referenceId: 'payment',
        revision: next,
      });
      return { ...value, revision: next };
    });
  }
}
