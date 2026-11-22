import { Injectable, Injector, inject } from '@angular/core';
import { FirebaseService } from '../firebase/firebase.service';
import { Availability, Reservation } from '../models/booking';
import { BackendTransport } from './backend-transport.service';
import { DirectBookingService } from './direct-booking.service';
import { DirectPlatformService } from './direct-platform.service';
import { environment } from '../../environments/environment';
@Injectable({ providedIn: 'root' })
export class BookingService {
  private readonly transport = inject(BackendTransport);
  private readonly firebase = inject(FirebaseService);
  private readonly direct = inject(DirectBookingService);
  private readonly injector = inject(Injector);
  async usesDirectBackend(): Promise<boolean> {
    return environment.directBooking && !(await this.transport.base());
  }
  async call<T>(name: string, data: unknown = {}): Promise<T> {
    const alternative = await this.transport.base();
    if (environment.directBooking && !alternative) {
      const input = data as Record<string, any>;
      if (name === 'platformOverview')
        return (await this.injector.get(DirectPlatformService).overview()) as T;
      if (name === 'platformActivity')
        return (await this.injector.get(DirectPlatformService).activity()) as T;
      if (name === 'setEstablishmentStatus')
        return (await this.injector
          .get(DirectPlatformService)
          .setStatus(input as Parameters<DirectPlatformService['setStatus']>[0])) as T;
      if (
        [
          'createEstablishment',
          'getBusinessConfiguration',
          'saveBusinessConfiguration',
          'publishBusiness',
        ].includes(name)
      )
        throw Object.assign(
          new Error(
            'El alta y la publicación de nuevos negocios están pendientes de conexión. Los datos del local existente se editan desde su panel de administración.',
          ),
          { code: 'functions/failed-precondition' },
        );
      if (name === 'myReservations') return (await this.direct.mine()) as T;
      if (name === 'getAvailability')
        return (await this.direct.availability(
          input['establishmentId'],
          input['courtId'],
          input['date'],
        )) as T;
      if (name === 'createReservation')
        return (await this.direct.create(
          input['establishmentId'],
          input['courtId'],
          input['date'],
          input['hour'],
          input['requestId'],
        )) as T;
      if (name === 'adminOverview')
        return (await this.direct.adminOverview(input['establishmentId'], input['date'])) as T;
      if (name === 'adminPendingProofs')
        return (await this.direct.adminPendingProofs(input['establishmentId'])) as T;
      if (name === 'reviewPayment')
        return (await this.direct.reviewPayment(
          input as Parameters<DirectBookingService['reviewPayment']>[0],
        )) as T;
      if (name === 'recordSession')
        return (await this.direct.recordSession(
          input as Parameters<DirectBookingService['recordSession']>[0],
        )) as T;
    }
    if (alternative) {
      const response = await this.transport.request(`/api/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      return (await response.json()).result as T;
    }
    const { httpsCallable } = await import('firebase/functions');
    const functions = await this.firebase.getFunctions();
    return (
      await httpsCallable<unknown, T>(functions, name, {
        timeout: ['saveBusinessConfiguration', 'publishBusiness'].includes(name) ? 120000 : 12000,
      })(data)
    ).data;
  }
  mine(): Promise<Reservation[]> {
    return this.call('myReservations');
  }
  async readProof(path: string): Promise<Blob> {
    if (path.startsWith('direct-proofs/')) return this.direct.readProof(path);
    if (await this.transport.base()) return this.transport.readMedia(path);
    const { getBlob, ref } = await import('firebase/storage');
    return getBlob(ref(await this.firebase.getStorage(), path), 5 * 1024 * 1024);
  }
  availability(establishmentId: string, courtId: string, date: string): Promise<Availability> {
    return this.call('getAvailability', { establishmentId, courtId, date });
  }
  create(
    establishmentId: string,
    courtId: string,
    date: string,
    hour: number,
    requestId: string,
  ): Promise<Reservation> {
    return this.call('createReservation', { establishmentId, courtId, date, hour, requestId });
  }
  async submitProof(reservation: Reservation, file: File): Promise<void> {
    if (
      reservation.engine === 'direct' ||
      (environment.directBooking && !(await this.transport.base()))
    ) {
      await this.direct.submitProof(reservation, file);
      return;
    }
    if (await this.transport.base()) {
      await this.transport.uploadMedia(
        `proofs/${reservation.clientUid}/${reservation.id}/receipt`,
        file,
      );
      await this.call('submitPaymentProof', { reservationId: reservation.id });
      return;
    }
    const { ref, uploadBytes, getMetadata } = await import('firebase/storage');
    const storage = await this.firebase.getStorage();
    const path = `proofs/${reservation.clientUid}/${reservation.id}/receipt`;
    const fileRef = ref(storage, path);
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    let existing;
    try {
      existing = await getMetadata(fileRef);
    } catch (error) {
      if ((error as { code?: string }).code !== 'storage/object-not-found') throw error;
    }
    if (existing) {
      if (existing.customMetadata?.['sha256'] !== hash)
        throw new Error(
          'Ya subiste un comprobante distinto para esta solicitud. Reintenta el envío del archivo original.',
        );
    } else
      await uploadBytes(fileRef, file, {
        contentType: file.type,
        customMetadata: { sha256: hash },
      });
    await this.call('submitPaymentProof', { reservationId: reservation.id });
  }
}
export function bookingError(error: unknown): string {
  const message = (error as { message?: string })?.message;
  const originalCode = (error as { code?: string })?.code || '';
  const code = originalCode.includes('/') ? originalCode : 'functions/' + originalCode;
  if (code === 'functions/already-exists')
    return 'Ese horario acaba de ocuparse. Elige otro para continuar.';
  if (
    code === 'functions/failed-precondition' ||
    code === 'functions/invalid-argument' ||
    code === 'functions/aborted'
  )
    return message || 'La agenda todavía no está habilitada.';
  if (code === 'functions/permission-denied')
    return 'No tienes permisos para realizar esta operación.';
  if (code === 'functions/resource-exhausted')
    return message || 'Alcanzaste el límite temporal de solicitudes. Inténtalo más tarde.';
  if (code === 'functions/unauthenticated') return 'Tu sesión venció. Vuelve a ingresar.';
  if (['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded'].includes(code))
    return 'El servicio de reservas no está disponible en este momento. Inténtalo nuevamente más tarde.';
  return 'No pudimos conectar con la agenda. Puedes volver a intentarlo.';
}
