import { Injectable, inject } from '@angular/core';
import { BookingService } from './booking.service';
import { FirebaseService } from '../firebase/firebase.service';
import { environment } from '../../environments/environment';
import type { Unsubscribe } from 'firebase/firestore';
export interface PublicCourt {
  id: string;
  name: string;
  sport: string;
  surface: string;
  images: string[];
  dayPriceCents: number;
  nightPriceCents: number;
  nightStartsAt: number;
}
export interface PublicBusiness {
  scheduleRevision?: number;
  demo?: boolean;
  rating?: { average: number; count: number; demo: boolean } | null;
  id: string;
  name: string;
  location: string;
  description: string;
  reference: string;
  district: string;
  phone: string;
  images: string[];
  openHour: number | null;
  closeHour: number | null;
  days: number[];
  advanceCents: number;
  courts: PublicCourt[];
}
@Injectable({ providedIn: 'root' })
export class BusinessCatalogService {
  private readonly backend = inject(BookingService);
  private readonly firebase = inject(FirebaseService);
  async list(): Promise<PublicBusiness[]> {
    if (!environment.useEmulators || environment.directBooking) {
      const { collection, getDocsFromServer, query, where, limit } =
        await import('firebase/firestore');
      const result = await getDocsFromServer(
        query(
          collection(await this.firebase.getDb(), 'catalog'),
          where('status', '==', 'published'),
          limit(100),
        ),
      );
      return result.docs.map((item) => ({ ...item.data(), id: item.id }) as PublicBusiness);
    }
    return (
      await this.backend.call<{ establishments: PublicBusiness[] }>('listPublishedBusinesses')
    ).establishments;
  }
  /** Mantiene los horarios y tarifas del catálogo abiertos en el cliente. */
  async observe(
    onItems: (items: PublicBusiness[]) => void,
    onError: (error: unknown) => void,
  ): Promise<Unsubscribe> {
    let active = true;
    if (!environment.useEmulators || environment.directBooking) {
      const { collection, query, where, limit, onSnapshot } = await import('firebase/firestore');
      const published = query(
        collection(await this.firebase.getDb(), 'catalog'),
        where('status', '==', 'published'),
        limit(100),
      );
      const stop = onSnapshot(
        published,
        (result) => {
          if (active)
            onItems(result.docs.map((item) => ({ ...item.data(), id: item.id }) as PublicBusiness));
        },
        (error) => {
          if (active) onError(error);
        },
      );
      return () => {
        active = false;
        stop();
      };
    }
    // El backend anterior no ofrece listeners. Se conserva su consulta con limpieza.
    let querying = false;
    const refresh = async () => {
      if (!active || querying) return;
      querying = true;
      try {
        const items = await this.list();
        if (active) onItems(items);
      } catch (error) {
        if (active) onError(error);
      } finally {
        querying = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }
}
