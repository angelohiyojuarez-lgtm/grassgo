import { Injectable, inject } from '@angular/core';
import { FirebaseService } from '../firebase/firebase.service';
import { AuthService } from './auth.service';
import { EstablishmentMembership } from '../models/domain';

@Injectable({ providedIn: 'root' })
export class AccessService {
  private readonly firebase = inject(FirebaseService);
  private readonly auth = inject(AuthService);
  async isSuperadmin(): Promise<boolean> {
    await this.auth.ready;
    const user = this.auth.user();
    if (!user) return false;
    const { doc, getDoc } = await import('firebase/firestore');
    const result = await getDoc(doc(await this.firebase.getDb(), 'platform_roles', user.uid));
    return result.data()?.['role'] === 'superadmin' && result.data()?.['status'] === 'active';
  }
  async memberships(): Promise<EstablishmentMembership[]> {
    await this.auth.ready;
    const user = this.auth.user();
    if (!user) return [];
    const { collection, doc, getDoc, getDocs } = await import('firebase/firestore');
    const db = await this.firebase.getDb();
    const result = await getDocs(collection(db, 'users', user.uid, 'memberships'));
    const candidates = result.docs
      .map((item) => ({ ...item.data(), establishmentId: item.id }) as EstablishmentMembership)
      .filter((item) => item.status === 'active' && item.role === 'admin');
    // El índice de navegación no sustituye la membresía canónica del establecimiento.
    const checked = await Promise.all(
      candidates.map(async (item) => {
        try {
          const member = await getDoc(
            doc(db, 'establishments', item.establishmentId, 'members', user.uid),
          );
          return member.data()?.['role'] === 'admin' && member.data()?.['status'] === 'active'
            ? item
            : null;
        } catch {
          return null;
        }
      }),
    );
    return checked.filter((item): item is EstablishmentMembership => item !== null);
  }
}
