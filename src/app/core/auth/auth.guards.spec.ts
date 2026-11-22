import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { authGuard, adminGuard, superadminGuard } from './auth.guards';
import { AuthService } from './auth.service';
import { AccessService } from './access.service';

describe('Rutas privadas', () => {
  const auth = { ready: Promise.resolve(), user: () => null as unknown };
  const access = { memberships: async () => [] as unknown[], isSuperadmin: async () => false };
  beforeEach(() => {
    auth.user = () => null;
    access.memberships = async () => [];
    access.isSuperadmin = async () => false;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: AccessService, useValue: access },
      ],
    });
  });
  it('visitante debe iniciar sesión y conserva destino interno', async () => {
    const result = await TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/reservas' } as never),
    );
    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe('/ingresar?next=%2Freservas');
  });
  it('cliente autenticado puede acceder a su área', async () => {
    auth.user = () => ({ uid: 'cliente' });
    expect(await TestBed.runInInjectionContext(() => authGuard({} as never, {} as never))).toBe(
      true,
    );
  });
  it('sin membresía ni privilegio global se niegan áreas administrativas', async () => {
    for (const guard of [adminGuard, superadminGuard]) {
      const result = await TestBed.runInInjectionContext(() => guard({} as never, {} as never));
      expect(TestBed.inject(Router).serializeUrl(result as never)).toContain('access=denied');
    }
  });
  it('fallo al comprobar privilegios deja el acceso restringido', async () => {
    access.isSuperadmin = async () => {
      throw new Error('sin red');
    };
    const result = await TestBed.runInInjectionContext(() =>
      superadminGuard({} as never, {} as never),
    );
    expect(TestBed.inject(Router).serializeUrl(result as never)).toContain('access=unavailable');
  });
});
