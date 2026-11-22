import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { FirebaseStorage } from 'firebase/storage';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private readonly app = initializeApp(environment.firebase);
  readonly auth = getAuth(this.app);
  private database?: Promise<Firestore>;
  private functions?: Promise<Functions>;
  private storage?: Promise<FirebaseStorage>;
  constructor() {
    if (environment.useEmulators) {
      connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
  }
  getDb(): Promise<Firestore> {
    this.database ??= import('firebase/firestore').then(
      ({ getFirestore, connectFirestoreEmulator }) => {
        const db = getFirestore(this.app);
        if (environment.useEmulators) connectFirestoreEmulator(db, '127.0.0.1', 8080);
        return db;
      },
    );
    return this.database;
  }
  getFunctions(): Promise<Functions> {
    return (this.functions ??= import('firebase/functions').then(
      ({ getFunctions, connectFunctionsEmulator }) => {
        const functions = getFunctions(this.app, 'us-central1');
        if (environment.useEmulators) connectFunctionsEmulator(functions, '127.0.0.1', 5001);
        return functions;
      },
    ));
  }
  getStorage(): Promise<FirebaseStorage> {
    return (this.storage ??= import('firebase/storage').then(
      ({ getStorage, connectStorageEmulator }) => {
        const storage = getStorage(this.app);
        storage.maxOperationRetryTime = 15000;
        storage.maxUploadRetryTime = 30000;
        if (environment.useEmulators) connectStorageEmulator(storage, '127.0.0.1', 9199);
        return storage;
      },
    ));
  }
}
