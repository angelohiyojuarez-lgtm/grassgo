import { Injectable, inject } from '@angular/core';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { UserProfile } from '../models/domain';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly firebase = inject(FirebaseService);
  async get(uid: string): Promise<UserProfile | null> {
    const result = await getDoc(doc(await this.firebase.getDb(), 'profiles', uid));
    if (!result.exists()) return null;
    const data = result.data();
    return { uid, displayName: data['displayName'], phone: data['phone'] };
  }
  async save(uid: string, displayName: string, phone: string): Promise<void> {
    if (this.firebase.auth.currentUser?.uid !== uid) throw new Error('Sesión requerida');
    const reference = doc(await this.firebase.getDb(), 'profiles', uid);
    const existing = await getDoc(reference);
    const fields = {
      displayName: displayName.trim(),
      phone: phone.trim(),
      updatedAt: serverTimestamp(),
    };
    if (existing.exists()) await updateDoc(reference, fields);
    else await setDoc(reference, { ...fields, uid, createdAt: serverTimestamp() });
  }
}
