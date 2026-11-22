import { Injectable, inject, signal } from '@angular/core';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly firebase = inject(FirebaseService);
  readonly user = signal<User | null>(null);
  readonly loading = signal(true);
  readonly ready: Promise<void>;

  constructor() {
    // Borrar credenciales y sesiones inseguras del prototipo, conservando las reservas de referencia.
    for (const storageName of ['localStorage', 'sessionStorage'] as const) {
      try {
        const storage = window[storageName];
        storage.removeItem('grassgo_users_db');
        storage.removeItem('grassgo_active_user');
      } catch {
        /* El navegador puede bloquear el almacenamiento. */
      }
    }
    this.ready = new Promise((resolve) => {
      onAuthStateChanged(
        this.firebase.auth,
        (user) => {
          this.user.set(user);
          this.loading.set(false);
          resolve();
        },
        () => {
          this.user.set(null);
          this.loading.set(false);
          resolve();
        },
      );
    });
  }
  async login(email: string, password: string): Promise<void> {
    const credential = await signInWithEmailAndPassword(this.firebase.auth, email.trim(), password);
    this.user.set(credential.user);
  }
  async register(name: string, email: string, password: string): Promise<void> {
    const credential = await createUserWithEmailAndPassword(
      this.firebase.auth,
      email.trim(),
      password,
    );
    this.user.set(credential.user);
    await updateProfile(credential.user, { displayName: name.trim() });
  }
  resetPassword(email: string): Promise<void> {
    return sendPasswordResetEmail(this.firebase.auth, email.trim());
  }
  verifyEmail(): Promise<void> {
    const user = this.firebase.auth.currentUser;
    if (!user) return Promise.reject(new Error('Sesión requerida'));
    return sendEmailVerification(user);
  }
  async logout(): Promise<void> {
    await signOut(this.firebase.auth);
    this.user.set(null);
  }
}
