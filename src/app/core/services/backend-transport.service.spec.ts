import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { BackendTransport } from './backend-transport.service';
import { FirebaseService } from '../firebase/firebase.service';
describe('Transporte del backend alternativo', () => {
  const request = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', request);
    request.mockReset();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FirebaseService,
          useValue: { auth: { currentUser: { getIdToken: async () => 'token-prueba' } } },
        },
      ],
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('conserva el backend existente si no hay URL alternativa configurada', async () => {
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ apiBaseUrl: null }) });
    const transport = TestBed.inject(BackendTransport);
    expect(await transport.base()).toBeNull();
    expect(await transport.base()).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('envía el token Firebase solo al servidor configurado y propaga sus errores', async () => {
    request.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ apiBaseUrl: 'https://grassgo-api.example.test' }),
    });
    request.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { code: 'functions/permission-denied', message: 'Sin acceso' } }),
    });
    const transport = TestBed.inject(BackendTransport);
    await expect(transport.request('/api/example')).rejects.toMatchObject({
      code: 'functions/permission-denied',
    });
    const [url, options] = request.mock.calls[1];
    expect(url).toBe('https://grassgo-api.example.test/api/example');
    expect(options.headers.get('Authorization')).toBe('Bearer token-prueba');
    expect(options.credentials).toBe('omit');
  });
  it('no envía credenciales por HTTP en producción', async () => {
    request.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ apiBaseUrl: 'http://other.example.test' }),
    });
    await expect(TestBed.inject(BackendTransport).base()).rejects.toThrow('HTTPS');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
