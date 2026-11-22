import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformDashboard } from './platform-dashboard';
import { AuthService } from '../../core/auth/auth.service';
import { AccessService } from '../../core/auth/access.service';
import { BookingService } from '../../core/services/booking.service';
import { DirectPlatformService } from '../../core/services/direct-platform.service';
import { PlatformOverview } from '../../core/models/platform';
import { NotificationService } from '../../core/services/notification.service';
import { PlatformOperationsService } from '../../core/services/platform-operations.service';
import { PlatformOnboardingService } from '../../core/services/platform-onboarding.service';

const overview: PlatformOverview = {
  totalBusinessCount: 1,
  limitReached: false,
  totals: { businesses: 1, published: 1, enabled: 0, suspended: 0, courts: 1 },
  establishments: [
    {
      id: 'el-puma',
      name: 'Grass El Puma',
      location: 'Andahuaylas',
      description: '',
      status: 'approved',
      publicationStatus: 'published',
      bookingEnabled: false,
      courtCount: 1,
      courts: [],
      courtLimitReached: false,
      ownerAssigned: true,
      scheduleConfigured: true,
      paymentConfigured: false,
      ready: false,
      missing: ['QR y datos reales de pago'],
    },
  ],
};
describe('Resumen de plataforma conectado', () => {
  const call = vi.fn(),
    observeChanges = vi.fn(),
    stop = vi.fn();
  let dashboard: PlatformDashboard;
  beforeEach(() => {
    vi.clearAllMocks();
    observeChanges.mockResolvedValue(stop);
    call.mockImplementation(async (name: string) =>
      name === 'platformOverview' ? structuredClone(overview) : { events: [] },
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({ section: 'resumen' }),
            snapshot: {
              data: { section: 'resumen' },
              paramMap: convertToParamMap({}),
              queryParamMap: convertToParamMap({}),
            },
          },
        },
        {
          provide: AuthService,
          useValue: { user: signal({ uid: 'owner', email: 'cuenta@example.test' }) },
        },
        {
          provide: AccessService,
          useValue: { memberships: async () => [{ establishmentId: 'el-puma' }] },
        },
        { provide: BookingService, useValue: { call, usesDirectBackend: async () => true } },
        { provide: DirectPlatformService, useValue: { observeChanges } },
        { provide: NotificationService, useValue: { updateOperations: vi.fn() } },
        {
          provide: PlatformOperationsService,
          useValue: { observe: vi.fn().mockResolvedValue(vi.fn()) },
        },
        { provide: PlatformOnboardingService, useValue: { publish: vi.fn() } },
      ],
    });
    dashboard = TestBed.runInInjectionContext(() => new PlatformDashboard());
  });
  afterEach(() => {
    dashboard.ngOnDestroy();
    vi.useRealTimers();
  });
  it('cuenta El Puma como publicado aunque su estado privado sea aprobado y mantiene reservas deshabilitadas', async () => {
    await dashboard.refresh();
    expect(dashboard.venues()[0].name).toBe('Grass El Puma');
    expect(dashboard.overview()?.totalBusinessCount).toBe(1);
    expect(dashboard.published()).toBe(1);
    expect(dashboard.enabled()).toBe(0);
    expect(dashboard.attention()[0].missing).toEqual(['QR y datos reales de pago']);
    dashboard.filter.set('published');
    expect(dashboard.filtered()).toHaveLength(1);
  });
  it('un fallo de actividad no oculta los negocios ni inventa una lista vacía', async () => {
    call.mockImplementation(async (name: string) => {
      if (name === 'platformActivity') throw Error('Sin conexión');
      return structuredClone(overview);
    });
    await dashboard.refresh();
    expect(dashboard.error()).toBe('');
    expect(dashboard.auditError()).not.toBe('');
    expect(dashboard.published()).toBe(1);
  });
  it('un fallo de negocios retira indicadores anteriores y permite reintentar', async () => {
    await dashboard.refresh();
    call.mockRejectedValueOnce(Error('Sin permisos'));
    await dashboard.refresh();
    expect(dashboard.error()).not.toBe('');
    expect(dashboard.venues()).toEqual([]);
    expect(dashboard.canViewMetrics()).toBe(false);
    await dashboard.refresh();
    expect(dashboard.overview()?.totalBusinessCount).toBe(1);
  });
  it('ofrece el alta de negocios conectada también en el modo directo', () => {
    expect(dashboard.directMode()).toBe(true);
    expect(dashboard.navigation().some((item) => item.path.includes('/nuevo'))).toBe(true);
  });
  it('retira las escuchas al abandonar la pantalla y descarta respuestas que llegan después', async () => {
    dashboard.ngOnInit();
    await vi.waitFor(() => expect(observeChanges).toHaveBeenCalledOnce());
    expect(dashboard.ownedLocalIds()).toEqual(['el-puma']);
    let resolveOverview!: (value: PlatformOverview) => void;
    call.mockImplementation((name: string) =>
      name === 'platformOverview'
        ? new Promise<PlatformOverview>((resolve) => (resolveOverview = resolve))
        : Promise.resolve({ events: [] }),
    );
    const pending = dashboard.refresh();
    dashboard.ngOnDestroy();
    resolveOverview({ ...overview, totalBusinessCount: 999 });
    await pending;
    expect(stop).toHaveBeenCalledOnce();
    expect(dashboard.overview()?.totalBusinessCount).toBe(1);
  });
});
