import { Injectable, inject } from '@angular/core';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { CatalogEstablishment } from '../models/domain';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly firebase = inject(FirebaseService);
  async published(): Promise<CatalogEstablishment[]> {
    const result = await getDocs(
      query(
        collection(await this.firebase.getDb(), 'catalog'),
        where('status', '==', 'published'),
        limit(30),
      ),
    );
    return result.docs.map((item) => ({ ...item.data(), id: item.id }) as CatalogEstablishment);
  }
}
