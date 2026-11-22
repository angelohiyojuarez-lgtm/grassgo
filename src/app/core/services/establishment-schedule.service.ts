import { Injectable, inject } from '@angular/core';
import { recordBusinessAudit } from './business-audit';
import type { DocumentData } from 'firebase/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import {
  AdminScheduleData,
  DateClosure,
  WeeklySchedule,
  scheduleDateStart,
  scheduleError,
} from '../models/establishment-schedule';

const allDays = () => [0, 1, 2, 3, 4, 5, 6];
const identifier = (value: string): string => {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(value))
    scheduleError('invalid-argument', 'Identificador de local inválido.');
  return value;
};
const revision = (value: number): void => {
  if (!Number.isInteger(value) || value < 0 || value >= 1000000000)
    scheduleError('invalid-argument', 'Recarga la configuración antes de guardar.');
};
function validWeekly(value: WeeklySchedule): void {
  revision(value.revision);
  if (
    !Array.isArray(value.days) ||
    value.days.length > 7 ||
    new Set(value.days).size !== value.days.length ||
    value.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    !Number.isInteger(value.openHour) ||
    !Number.isInteger(value.closeHour) ||
    value.openHour! < 0 ||
    value.closeHour! > 24 ||
    value.openHour! >= value.closeHour!
  )
    scheduleError(
      'invalid-argument',
      'Elige los días y una hora de cierre posterior a la apertura.',
    );
}
const weeklyView = (data: DocumentData): WeeklySchedule => ({
  days: [...data['days']],
  openHour: data['openHour'],
  closeHour: data['closeHour'],
  revision: data['revision'],
});
const closureView = (data: DocumentData): DateClosure => ({
  date: data['date'],
  dateStart: data['dateStart'].toMillis(),
  closed: data['closed'],
  reason: data['reason'] || '',
  revision: data['revision'],
});

/** Configuración del local asignado. Las reglas autorizan la copia pública y el historial atómicos. */
@Injectable({ providedIn: 'root' })
export class EstablishmentScheduleService {
  private readonly firebase = inject(FirebaseService);
  private uid(): string {
    return (
      this.firebase.auth.currentUser?.uid ||
      scheduleError('unauthenticated', 'Inicia sesión para continuar.')
    );
  }
  private assertLocal(data: DocumentData | undefined): void {
    if (!data || data['bookingEngine'] !== 'direct')
      scheduleError(
        'failed-precondition',
        'La configuración de horarios de este local todavía no está habilitada.',
      );
  }
  async load(establishmentId: string): Promise<AdminScheduleData> {
    this.uid();
    identifier(establishmentId);
    const {
      doc,
      collection,
      query,
      where,
      orderBy,
      limit,
      Timestamp,
      getDocFromServer,
      getDocsFromServer,
    } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    const local = (await getDocFromServer(doc(db, 'establishments', establishmentId))).data();
    this.assertLocal(local);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const [saved, closures] = await Promise.all([
      getDocFromServer(doc(db, 'establishments', establishmentId, 'settings', 'schedule')),
      getDocsFromServer(
        query(
          collection(db, 'establishments', establishmentId, 'closures'),
          where('closed', '==', true),
          where('dateStart', '>=', Timestamp.fromMillis(scheduleDateStart(today))),
          orderBy('dateStart', 'asc'),
          limit(100),
        ),
      ),
    ]);
    let schedule: WeeklySchedule;
    if (saved.exists()) schedule = weeklyView(saved.data()!);
    else {
      const courts = await getDocsFromServer(
        query(collection(db, 'establishments', establishmentId, 'courts'), limit(20)),
      );
      const active = courts.docs
        .map((item) => item.data())
        .filter((item) => item['status'] === 'active');
      const first = active[0];
      const days = (value: DocumentData) =>
        value['openDays']?.length ? [...value['openDays']].sort() : allDays();
      const common =
        first &&
        Number.isInteger(first['openHour']) &&
        Number.isInteger(first['closeHour']) &&
        first['openHour'] >= 0 &&
        first['closeHour'] <= 24 &&
        first['openHour'] < first['closeHour'] &&
        active.every(
          (item) =>
            item['openHour'] === first['openHour'] &&
            item['closeHour'] === first['closeHour'] &&
            JSON.stringify(days(item)) === JSON.stringify(days(first)),
        );
      // El borrador no publica días ni horas hasta que el propietario guarde.
      schedule = {
        days: common ? days(first) : allDays(),
        openHour: common ? first['openHour'] : null,
        closeHour: common ? first['closeHour'] : null,
        revision: 0,
      };
    }
    return {
      name: local!['name'],
      schedule,
      closures: closures.docs.map((item) => closureView(item.data())),
      closureLimitReached: closures.docs.length === 100,
    };
  }
  async saveWeekly(establishmentId: string, value: WeeklySchedule): Promise<WeeklySchedule> {
    const uid = this.uid();
    identifier(establishmentId);
    validWeekly(value);
    const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    return runTransaction(db, async (tx) => {
      const local = (await tx.get(doc(db, 'establishments', establishmentId))).data();
      this.assertLocal(local);
      const ref = doc(db, 'establishments', establishmentId, 'settings', 'schedule');
      const snapshot = await tx.get(ref),
        before = snapshot.data() || null;
      const days = [...value.days].sort((a, b) => a - b);
      if ((before?.['revision'] || 0) !== value.revision)
        scheduleError(
          'aborted',
          'Otra persona actualizó el horario. Recarga los datos y vuelve a revisar tus cambios.',
        );
      if (
        before &&
        before['openHour'] === value.openHour &&
        before['closeHour'] === value.closeHour &&
        JSON.stringify(before['days']) === JSON.stringify(days)
      )
        return weeklyView(before);
      const next = value.revision + 1;
      const after = {
        establishmentId,
        days,
        openHour: value.openHour,
        closeHour: value.closeHour,
        revision: next,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      };
      tx.set(ref, after);
      tx.update(doc(db, 'catalog', establishmentId), {
        days,
        openHour: value.openHour,
        closeHour: value.closeHour,
        scheduleRevision: next,
        scheduleUpdatedAt: serverTimestamp(),
      });
      tx.set(
        doc(db, 'establishments', establishmentId, 'settings', 'schedule', 'history', String(next)),
        {
          establishmentId,
          kind: 'schedule',
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
        kind: 'schedule',
        referenceId: 'schedule',
        revision: next,
      });
      return { days, openHour: value.openHour, closeHour: value.closeHour, revision: next };
    });
  }
  async getClosure(establishmentId: string, date: string): Promise<DateClosure | null> {
    this.uid();
    identifier(establishmentId);
    scheduleDateStart(date);
    const { doc, getDocFromServer } = await import('firebase/firestore');
    const snapshot = await getDocFromServer(
      doc(await this.firebase.getDb(), 'establishments', establishmentId, 'closures', date),
    );
    return snapshot.exists() ? closureView(snapshot.data()!) : null;
  }
  async saveClosure(establishmentId: string, value: DateClosure): Promise<DateClosure> {
    const uid = this.uid();
    identifier(establishmentId);
    revision(value.revision);
    const dateStart = scheduleDateStart(value.date);
    if (
      value.dateStart !== dateStart ||
      typeof value.closed !== 'boolean' ||
      typeof value.reason !== 'string' ||
      value.reason.length > 160
    )
      scheduleError(
        'invalid-argument',
        'Revisa la fecha y escribe un motivo de hasta 160 caracteres.',
      );
    const reason = value.reason.trim();
    const { doc, runTransaction, serverTimestamp, Timestamp } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    return runTransaction(db, async (tx) => {
      const local = (await tx.get(doc(db, 'establishments', establishmentId))).data();
      this.assertLocal(local);
      const ref = doc(db, 'establishments', establishmentId, 'closures', value.date);
      const snapshot = await tx.get(ref),
        before = snapshot.data() || null;
      if ((before?.['revision'] || 0) !== value.revision)
        scheduleError('aborted', 'Esta fecha cambió en otra pantalla. Recárgala antes de guardar.');
      if (before && before['closed'] === value.closed && before['reason'] === reason)
        return closureView(before);
      const next = value.revision + 1;
      const publicData = {
        establishmentId,
        date: value.date,
        dateStart: Timestamp.fromMillis(dateStart),
        closed: value.closed,
        revision: next,
        updatedAt: serverTimestamp(),
      };
      const after = { ...publicData, reason, updatedBy: uid };
      tx.set(ref, after);
      tx.set(doc(db, 'catalog', establishmentId, 'closures', value.date), publicData);
      tx.set(
        doc(db, 'establishments', establishmentId, 'closures', value.date, 'history', String(next)),
        {
          establishmentId,
          kind: 'closure',
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
        kind: 'closure',
        referenceId: value.date,
        revision: next,
      });
      return { date: value.date, dateStart, closed: value.closed, reason, revision: next };
    });
  }
}
