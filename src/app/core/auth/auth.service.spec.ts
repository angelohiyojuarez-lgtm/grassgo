import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { FirebaseService } from '../firebase/firebase.service';

const sdk = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  reset: vi.fn(),
  verify: vi.fn(),
  update: vi.fn(),
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, listener: (user: null) => void) => {
    listener(null);
    return () => {};
  },
  signInWithEmailAndPassword: sdk.login,
  createUserWithEmailAndPassword: sdk.register,
  signOut: sdk.logout,
  sendPasswordResetEmail: sdk.reset,
  sendEmailVerification: sdk.verify,
  updateProfile: sdk.update,
  getAuth: vi.fn(),
  connectAuthEmulator: vi.fn(),
}));

describe('Identidad de acceso', () => {
  let service: AuthService;
  beforeEach(() => {
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [{ provide: FirebaseService, useValue: { auth: {} } }],
    });
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(
      'grassgo_users_db',
      JSON.stringify([{ email: 'demo@example.invalid', password: 'vieja' }]),
    );
    sessionStorage.setItem('grassgo_active_user', JSON.stringify({ uid: 'inventado' }));
    localStorage.setItem('grassgo_reservas_demo', '[]');
    service = TestBed.inject(AuthService);
  });
  it('elimina las credenciales antiguas sin usar la sesión local ni borrar reservas', async () => {
    await service.ready;
    expect(service.user()).toBeNull();
    expect(localStorage.getItem('grassgo_users_db')).toBeNull();
    expect(sessionStorage.getItem('grassgo_active_user')).toBeNull();
    expect(localStorage.getItem('grassgo_reservas_demo')).toBe('[]');
  });
  it('credenciales rechazadas no crean usuario ni sesión de respaldo', async () => {
    sdk.login.mockRejectedValue({ code: 'auth/invalid-credential' });
    await expect(service.login('demo@example.invalid', 'incorrecta')).rejects.toMatchObject({
      code: 'auth/invalid-credential',
    });
    expect(service.user()).toBeNull();
    expect(sdk.register).not.toHaveBeenCalled();
    expect(localStorage.getItem('grassgo_active_user')).toBeNull();
  });
  it('un fallo de red se propaga sin fingir autenticación', async () => {
    sdk.login.mockRejectedValue({ code: 'auth/network-request-failed' });
    await expect(service.login('nuevo@example.invalid', 'clave')).rejects.toBeDefined();
    expect(service.user()).toBeNull();
  });
  it('un acceso válido usa el UID del proveedor sin almacenar la contraseña', async () => {
    sdk.login.mockResolvedValue({ user: { uid: 'real-uid' } });
    await service.login(' cliente@example.invalid ', 'no-guardar');
    expect(service.user()?.uid).toBe('real-uid');
    expect(sdk.login).toHaveBeenCalledWith({}, 'cliente@example.invalid', 'no-guardar');
    expect(JSON.stringify(localStorage)).not.toContain('no-guardar');
  });
  it('recuperación y cierre propagan errores sin comunicar éxito falso', async () => {
    sdk.reset.mockRejectedValue(new Error('red'));
    sdk.logout.mockRejectedValue(new Error('red'));
    await expect(service.resetPassword('cliente@example.invalid')).rejects.toThrow('red');
    service.user.set({ uid: 'real-uid' } as never);
    await expect(service.logout()).rejects.toThrow('red');
    expect(service.user()?.uid).toBe('real-uid');
  });
});
