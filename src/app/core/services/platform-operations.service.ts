import { Injectable, inject } from '@angular/core';
import { FirebaseService } from '../firebase/firebase.service';
import { PlatformVenue } from '../models/platform';

export interface PlatformOperation {
  establishmentId: string;
  name: string;
  confirmed: number;
  pendingProofs: number;
  running: number;
  partial: boolean;
  version: string;
}
/** Indicadores sin identidades ni imágenes: usa las mismas ocupaciones que ve el cliente. */
@Injectable({ providedIn: 'root' })
export class PlatformOperationsService {
  private readonly firebase = inject(FirebaseService);
  async observe(
    venues: PlatformVenue[],
    next: (rows: PlatformOperation[]) => void,
    error: () => void,
  ): Promise<() => void> {
    const { collection, doc, query, limit, onSnapshot } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    let active = true,
      day = '',
      last = '';
    let stops: (() => void)[] = [];
    const slots = new Map<string, { hour: number; data: Record<string, any> }[]>();
    const games = new Map<string, Record<string, any>>();
    const expected = venues.reduce((total, venue) => total + venue.courts.length, 0);
    const today = () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    const report = () => {
      if (!active || slots.size !== expected || games.size !== expected) return;
      const now = Date.now();
      const rows = venues.map((venue) => {
        let confirmed = 0,
          pendingProofs = 0,
          running = 0;
        const versions: string[] = [day];
        for (const court of venue.courts)
          for (const slot of slots.get(venue.id + '/' + court.id) || []) {
            const value = slot.data;
            if (value['status'] === 'confirmed') confirmed++;
            const start = Date.parse(`${day}T${String(slot.hour).padStart(2, '0')}:00:00-05:00`);
            const locked = value['lockedAt']?.toMillis?.() || 0;
            versions.push(
              [
                court.id,
                slot.hour,
                value['reservationId'],
                locked,
                value['status'],
                value['reviewPending'] === true,
              ].join(':'),
            );
            if (
              value['status'] === 'held' &&
              value['reviewPending'] === true &&
              locked + 900000 > now &&
              start > now
            )
              pendingProofs++;
          }
        for (const court of venue.courts) {
          const game = games.get(venue.id + '/' + court.id);
          const actual = game?.['actualStartAt']?.toMillis?.() || 0;
          versions.push([court.id, game?.['activeReservationId'], actual].join(':'));
          if (game?.['activeReservationId'] && actual && actual + 3600000 > now) running++;
        }
        versions.push(`${pendingProofs}:${running}`);
        let first = 2166136261,
          second = 5381;
        for (const character of versions.sort().join('|')) {
          first = Math.imul(first ^ character.charCodeAt(0), 16777619);
          second = Math.imul(second, 33) ^ character.charCodeAt(0);
        }
        return {
          establishmentId: venue.id,
          name: venue.name,
          confirmed,
          pendingProofs,
          running,
          partial: venue.courtLimitReached,
          version: `${day}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`,
        };
      });
      const signature = JSON.stringify(rows);
      if (signature !== last) {
        last = signature;
        next(rows);
      }
    };
    const connect = () => {
      stops.forEach((stop) => stop());
      slots.clear();
      games.clear();
      day = today();
      const observedDay = day;
      stops = venues.flatMap((venue) =>
        venue.courts.flatMap((court) => [
          onSnapshot(
            query(
              collection(db, 'direct_slots', venue.id, 'courts', court.id, 'days', day, 'hours'),
              limit(24),
            ),
            (result) => {
              if (!active || observedDay !== day) return;
              slots.set(
                venue.id + '/' + court.id,
                result.docs.map((item) => ({ hour: Number(item.id), data: item.data() })),
              );
              report();
            },
            () => {
              if (active && observedDay === day) error();
            },
          ),
          onSnapshot(
            doc(db, 'establishments', venue.id, 'courts', court.id, 'operations', 'current'),
            (result) => {
              if (!active || observedDay !== day) return;
              games.set(venue.id + '/' + court.id, result.data() || {});
              report();
            },
            () => {
              if (active && observedDay === day) error();
            },
          ),
        ]),
      );
      report();
    };
    connect();
    const clock = setInterval(() => {
      if (today() !== day) connect();
      else report();
    }, 1000);
    return () => {
      active = false;
      clearInterval(clock);
      stops.forEach((stop) => stop());
    };
  }
}
