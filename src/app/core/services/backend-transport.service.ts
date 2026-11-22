import { Injectable, inject } from '@angular/core';
import { FirebaseService } from '../firebase/firebase.service';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class BackendTransport {
  private readonly firebase = inject(FirebaseService);
  private configuration?: Promise<string | null>;
  base(): Promise<string | null> {
    return (this.configuration ??= fetch('/assets/backend.json', { cache: 'no-cache' }).then(
      async (response) => {
        if (!response.ok) throw new Error('No se pudo leer la configuración del servidor.');
        const value = (await response.json()).apiBaseUrl;
        if (value === null) return null;
        const url = new URL(value);
        if (
          url.protocol !== 'https:' &&
          !(environment.useEmulators && ['localhost', '127.0.0.1'].includes(url.hostname))
        )
          throw new Error('El servidor requiere HTTPS.');
        if (url.username || url.password || url.search || url.hash)
          throw new Error('Dirección de servidor inválida.');
        return url.origin;
      },
    ));
  }
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const base = await this.base();
    if (!base) throw new Error('El servidor alternativo aún no está configurado.');
    const user = this.firebase.auth.currentUser;
    if (!user)
      throw Object.assign(new Error('Inicia sesión.'), { code: 'functions/unauthenticated' });
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
    const response = await fetch(base + path, {
      ...init,
      headers,
      signal: AbortSignal.timeout(120000),
      credentials: 'omit',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw Object.assign(
        new Error(body?.error?.message || 'El servidor no pudo completar la operación.'),
        { code: body?.error?.code || 'functions/unavailable' },
      );
    }
    return response;
  }
  async readMedia(path: string): Promise<Blob> {
    return (await this.request(`/media?path=${encodeURIComponent(path)}`)).blob();
  }
  async uploadMedia(path: string, file: File): Promise<void> {
    await this.request(`/media?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
  }
}
