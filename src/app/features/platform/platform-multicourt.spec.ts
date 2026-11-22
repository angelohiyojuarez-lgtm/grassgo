import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformOnboarding } from './platform-onboarding';
import { CourtDraft, readCourtDraft } from './platform-court-editor';
import { PlatformOnboardingService } from '../../core/services/platform-onboarding.service';

describe('Registro guiado de varias canchas', () => {
  const create = vi.fn(),
    navigate = vi.fn();
  let page: PlatformOnboarding;
  const complete = (
    court: CourtDraft,
    sport: string,
    dayPrice: string,
    nightPrice: string,
  ): void => {
    Object.assign(court, {
      name: `Cancha de ${sport}`,
      sport,
      surface: 'Piso sintético',
      dayPrice,
      nightPrice,
      nightStartsAt: 18,
    });
  };
  beforeEach(() => {
    vi.resetAllMocks();
    navigate.mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: PlatformOnboardingService, useValue: { create, addCourt: vi.fn() } },
      ],
    });
    page = TestBed.runInInjectionContext(() => new PlatformOnboarding());
    page.name = 'Negocio de prueba';
    page.location = 'Ubicación elegida';
    page.ownerEmail = 'responsable@ejemplo.test';
    page.advance = '10';
  });

  it('añade y quita borradores conservando identidades y valores; mantiene la primera cancha y el límite técnico', () => {
    const first = page.courts()[0];
    expect(first).toMatchObject({
      id: 'principal',
      name: '',
      sport: '',
      surface: '',
      dayPrice: '',
      nightPrice: '',
      nightStartsAt: null,
    });
    complete(first, 'Fútbol', '35', '45');
    page.addCourt();
    const second = page.courts()[1];
    expect(second.id).toMatch(/^[a-f0-9-]{36}$/);
    complete(second, 'Vóley', '20', '25');
    page.addCourt();
    page.removeCourt(page.courts()[2].id);
    page.removeCourt('principal');
    expect(page.courts()).toEqual([first, second]);
    expect(page.courts()[1].nightPrice).toBe('25');
    for (let index = 0; index < 30; index++) page.addCourt();
    expect(page.courts()).toHaveLength(20);
    expect(new Set(page.courts().map((court) => court.id)).size).toBe(20);
    expect(create).not.toHaveBeenCalled();
  });

  it('exige deporte y precios propios de cada cancha, sin inventar tarifas ni redondear fracciones de céntimo', async () => {
    complete(page.courts()[0], 'Fútbol', '35,50', '45');
    page.addCourt();
    const volley = page.courts()[1];
    complete(volley, 'Vóley', '20', '25');
    expect(readCourtDraft(page.courts()[0], 1000)).toMatchObject({
      dayPriceCents: 3550,
      nightPriceCents: 4500,
    });
    expect(readCourtDraft(volley, 1000)).toMatchObject({
      dayPriceCents: 2000,
      nightPriceCents: 2500,
    });
    volley.sport = '';
    await page.save();
    expect(create).not.toHaveBeenCalled();
    expect(page.error()).toContain('cancha 2');
    volley.sport = 'Vóley';
    volley.dayPrice = '20.555';
    expect(readCourtDraft(volley, 1000)).toBeNull();
    volley.dayPrice = '20';
    volley.nightStartsAt = null;
    expect(readCourtDraft(volley, 1000)).toBeNull();
    volley.nightStartsAt = 18;
    expect(readCourtDraft(volley, 2500)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('envía fútbol y vóley con importes independientes y reintenta el mismo registro tras un fallo parcial', async () => {
    complete(page.courts()[0], 'Fútbol', '35', '45');
    page.addCourt();
    complete(page.courts()[1], 'Vóley', '20', '25');
    const ids = page.courts().map((court) => court.id);
    create.mockRejectedValueOnce(
      Object.assign(
        new Error('El negocio quedó en preparación. Vuelve a guardar para continuar.'),
        { code: 'functions/failed-precondition' },
      ),
    );
    await page.save();
    expect(page.busy()).toBe(false);
    expect(page.error()).toContain('preparación');
    expect(page.courts().map((court) => court.id)).toEqual(ids);
    page.removeCourt(ids[1]);
    page.addCourt();
    expect(page.courts().map((court) => court.id)).toEqual(ids);
    expect(navigate).not.toHaveBeenCalled();
    create.mockResolvedValueOnce({ id: 'negocio-creado' });
    await page.save();
    const first = create.mock.calls[0][0],
      retry = create.mock.calls[1][0];
    expect(retry.requestId).toBe(first.requestId);
    expect(retry.courts).toEqual(first.courts);
    expect(retry.courts).toEqual([
      expect.objectContaining({
        id: ids[0],
        sport: 'Fútbol',
        dayPriceCents: 3500,
        nightPriceCents: 4500,
      }),
      expect.objectContaining({
        id: ids[1],
        sport: 'Vóley',
        dayPriceCents: 2000,
        nightPriceCents: 2500,
      }),
    ]);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(['/superadmin/negocios'], {
      queryParams: { creado: 'negocio-creado' },
    });
  });
});
