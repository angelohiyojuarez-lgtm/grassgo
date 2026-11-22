import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLocalPricing } from './admin-local-pricing';
import { EstablishmentPricingService } from '../../core/services/establishment-pricing.service';
import { AdminPricingData, CourtPricing } from '../../core/models/establishment-pricing';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
describe('Edición sencilla de precios del local', () => {
  let data: AdminPricingData;
  let service: { load: ReturnType<typeof vi.fn>; savePricing: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    data = {
      name: 'Local deportivo',
      advanceCents: 1000,
      courts: [
        {
          id: 'principal',
          name: 'Cancha principal',
          dayPriceCents: 3000,
          nightPriceCents: 4000,
          nightStartsAt: 18,
          revision: 0,
        },
        {
          id: 'segunda',
          name: 'Cancha de vóley',
          dayPriceCents: 2000,
          nightPriceCents: 2500,
          nightStartsAt: 18,
          revision: 2,
        },
      ],
    };
    service = {
      load: vi.fn(async () => structuredClone(data)),
      savePricing: vi.fn(async (_id: string, value: CourtPricing) => ({
        ...value,
        revision: value.revision + 1,
      })),
    };
    TestBed.configureTestingModule({
      imports: [AdminLocalPricing],
      providers: [{ provide: EstablishmentPricingService, useValue: service }],
    });
  });
  async function setup(): Promise<ComponentFixture<AdminLocalPricing>> {
    const fixture = TestBed.createComponent(AdminLocalPricing);
    fixture.componentRef.setInput('establishmentId', 'local');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  it('carga precios reales y explica que no altera reservas ni adelanto', async () => {
    const fixture = await setup(),
      panel = fixture.componentInstance;
    expect(panel.courts()[0].daySoles).toBe('30.00');
    expect(panel.hasUnsavedChanges()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('El adelanto no cambia');
    expect(fixture.nativeElement.textContent).toContain('S/');
    expect(service.savePricing).not.toHaveBeenCalled();
  });
  it('muestra claramente que faltan canchas y no ofrece precios inventados', async () => {
    data.courts = [];
    const fixture = await setup();
    expect(fixture.nativeElement.textContent).toContain(
      'Todavía no hay canchas operativas configuradas',
    );
    expect(fixture.nativeElement.querySelectorAll('form').length).toBe(0);
  });
  it('un valor desconocido se presenta vacío hasta que el dueño lo ingresa', async () => {
    data.courts[0].dayPriceCents = null;
    data.courts[0].nightStartsAt = null;
    const fixture = await setup(),
      panel = fixture.componentInstance;
    expect(panel.courts()[0].daySoles).toBe('');
    expect(panel.summary(panel.courts()[0])).toContain('Completa');
  });
  it('guarda con decimales en soles y conserva los borradores de otras canchas', async () => {
    const fixture = await setup(),
      panel = fixture.componentInstance;
    const [first, second] = panel.courts();
    first.daySoles = '35,50';
    second.daySoles = '22.75';
    await panel.save(first);
    expect(service.savePricing).toHaveBeenCalledExactlyOnceWith(
      'local',
      expect.objectContaining({
        id: 'principal',
        dayPriceCents: 3550,
        nightPriceCents: 4000,
        nightStartsAt: 18,
        revision: 0,
      }),
    );
    expect(first.daySoles).toBe('35.50');
    expect(first.revision).toBe(1);
    expect(first.message).toContain('Precios guardados');
    expect(second.daySoles).toBe('22.75');
    expect(panel.hasUnsavedChanges()).toBe(true);
  });
  it('rechaza fracciones de céntimo, precios fuera de rango y horario vacío', async () => {
    const panel = (await setup()).componentInstance,
      first = panel.courts()[0];
    first.daySoles = '35.555';
    await panel.save(first);
    expect(first.error).toContain('dos decimales');
    first.daySoles = '9.99';
    await panel.save(first);
    first.daySoles = '10000.01';
    await panel.save(first);
    first.daySoles = '35';
    first.nightStartsAt = null;
    await panel.save(first);
    expect(service.savePricing).not.toHaveBeenCalled();
  });
  it('un doble clic no duplica el guardado y bloquea salir mientras guarda', async () => {
    const panel = (await setup()).componentInstance,
      first = panel.courts()[0];
    const pending = deferred<CourtPricing>();
    service.savePricing.mockReturnValueOnce(pending.promise);
    first.daySoles = '35';
    const saving = panel.save(first);
    await panel.save(first);
    expect(panel.isSaving()).toBe(true);
    expect(service.savePricing).toHaveBeenCalledOnce();
    const event = new Event('beforeunload', { cancelable: true });
    panel.beforeUnload(event);
    expect(event.defaultPrevented).toBe(true);
    pending.resolve({ ...data.courts[0], dayPriceCents: 3500, revision: 1 });
    await saving;
    expect(panel.isSaving()).toBe(false);
    expect(panel.hasUnsavedChanges()).toBe(false);
  });
  it('una revisión obsoleta conserva el precio editado y muestra el motivo', async () => {
    const panel = (await setup()).componentInstance,
      first = panel.courts()[0];
    first.daySoles = '36';
    service.savePricing.mockRejectedValueOnce({
      code: 'functions/aborted',
      message: 'Otra persona cambió estos precios.',
    });
    await panel.save(first);
    expect(first.daySoles).toBe('36');
    expect(first.error).toBe('Otra persona cambió estos precios.');
    expect(panel.hasUnsavedChanges()).toBe(true);
  });
  it('recargar una cancha requiere confirmar y conserva el otro borrador', async () => {
    const panel = (await setup()).componentInstance,
      [first, second] = panel.courts();
    first.daySoles = '39';
    second.nightSoles = '28';
    panel.requestReload(first);
    expect(panel.pendingReload()).toBe(first);
    expect(service.load).toHaveBeenCalledOnce();
    panel.confirmReload();
    await vi.waitFor(() => expect(panel.busy()).toBe(false));
    expect(first.daySoles).toBe('30.00');
    expect(second.nightSoles).toBe('28');
    expect(panel.pendingReload()).toBeNull();
  });
  it('un guardado anterior no contamina los precios de otro establecimiento', async () => {
    const fixture = await setup(),
      panel = fixture.componentInstance,
      first = panel.courts()[0];
    const pending = deferred<CourtPricing>();
    service.savePricing.mockReturnValueOnce(pending.promise);
    first.daySoles = '39';
    const saving = panel.save(first);
    data = {
      name: 'Segundo local',
      advanceCents: 1500,
      courts: [
        {
          id: 'otra',
          name: 'Otra cancha',
          dayPriceCents: 5000,
          nightPriceCents: 5500,
          nightStartsAt: 19,
          revision: 0,
        },
      ],
    };
    fixture.componentRef.setInput('establishmentId', 'segundo');
    fixture.detectChanges();
    await fixture.whenStable();
    pending.resolve({ ...first, dayPriceCents: 3900, revision: 1 });
    await saving;
    expect(panel.name()).toBe('Segundo local');
    expect(panel.courts()[0].id).toBe('otra');
    expect(panel.courts()[0].daySoles).toBe('50.00');
    expect(panel.isSaving()).toBe(false);
  });
  it('respuestas de carga anteriores no sustituyen la última configuración', async () => {
    const old = deferred<AdminPricingData>();
    service.load.mockReturnValueOnce(old.promise);
    const fixture = TestBed.createComponent(AdminLocalPricing);
    fixture.componentRef.setInput('establishmentId', 'primero');
    fixture.detectChanges();
    fixture.componentRef.setInput('establishmentId', 'segundo');
    fixture.detectChanges();
    await fixture.whenStable();
    old.resolve({ name: 'Nombre viejo', advanceCents: 1000, courts: [] });
    await old.promise;
    await fixture.whenStable();
    expect(fixture.componentInstance.name()).toBe('Local deportivo');
  });
});
