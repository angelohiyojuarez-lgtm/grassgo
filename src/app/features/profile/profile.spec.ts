import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Profile } from './profile';
import { AuthService } from '../../core/auth/auth.service';
import { AccessService } from '../../core/auth/access.service';
import { ProfileService } from '../../core/services/profile.service';

describe('Opciones de la cuenta', () => {
  const getProfile = vi.fn();
  beforeEach(() => {
    getProfile.mockReset().mockResolvedValue({ displayName: 'Mi nombre', phone: '999999999' });
    TestBed.configureTestingModule({
      imports: [Profile],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal({
              uid: 'cliente',
              displayName: 'Cliente',
              email: 'cliente@example.test',
              emailVerified: true,
            }),
          },
        },
        {
          provide: AccessService,
          useValue: { memberships: async () => [], isSuperadmin: async () => false },
        },
        { provide: ProfileService, useValue: { get: getProfile } },
      ],
    });
  });
  it('abre la cuenta con las opciones cerradas sin consultar el formulario', async () => {
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    await fixture.whenStable();
    const options = fixture.nativeElement.querySelectorAll('details');
    expect(options.length).toBe(2);
    expect([...options].every((option: HTMLDetailsElement) => !option.open)).toBe(true);
    expect(getProfile).not.toHaveBeenCalled();
  });
  it('carga los datos al seleccionar Tu información y conserva la edición al cerrar y abrir', async () => {
    const fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
    await fixture.whenStable();
    const option = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
    option.querySelector('summary')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(option.open).toBe(true);
    expect(getProfile).toHaveBeenCalledExactlyOnceWith('cliente');
    expect(fixture.componentInstance.name).toBe('Mi nombre');
    fixture.componentInstance.name = 'Edición pendiente';
    option.querySelector('summary')!.click();
    await fixture.whenStable();
    option.querySelector('summary')!.click();
    await fixture.whenStable();
    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.name).toBe('Edición pendiente');
  });
});
