import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLocalSchedule } from './admin-local-schedule';
import { EstablishmentScheduleService } from '../../core/services/establishment-schedule.service';
import {
  AdminScheduleData,
  DateClosure,
  WeeklySchedule,
} from '../../core/models/establishment-schedule';

const date = '2099-06-15';
const otherDate = '2099-06-16';
const closure = (values: Partial<DateClosure> = {}): DateClosure => ({
  date,
  dateStart: Date.parse(date + 'T00:00:00-05:00'),
  closed: true,
  reason: '',
  revision: 1,
  ...values,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('Horarios del administrador del local', () => {
  let data: AdminScheduleData;
  let service: {
    load: ReturnType<typeof vi.fn>;
    saveWeekly: ReturnType<typeof vi.fn>;
    getClosure: ReturnType<typeof vi.fn>;
    saveClosure: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    data = {
      name: 'Local de prueba',
      schedule: { days: [1, 2, 3, 4, 5], openHour: 8, closeHour: 22, revision: 2 },
      closures: [],
    };
    service = {
      load: vi.fn(async () => structuredClone(data)),
      saveWeekly: vi.fn(async (_id: string, value: WeeklySchedule) => {
        data.schedule = { ...value, days: [...value.days], revision: value.revision + 1 };
        return structuredClone(data.schedule);
      }),
      getClosure: vi.fn(async () => null),
      saveClosure: vi.fn(async (_id: string, value: DateClosure) => {
        const saved = { ...value, revision: value.revision + 1 };
        data.closures = [...data.closures.filter((item) => item.date !== saved.date), saved].filter(
          (item) => item.closed,
        );
        return saved;
      }),
    };
    TestBed.configureTestingModule({
      imports: [AdminLocalSchedule],
      providers: [{ provide: EstablishmentScheduleService, useValue: service }],
    });
  });
  async function setup(): Promise<ComponentFixture<AdminLocalSchedule>> {
    const fixture = TestBed.createComponent(AdminLocalSchedule);
    fixture.componentRef.setInput('establishmentId', 'local-prueba');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  const button = (fixture: ComponentFixture<AdminLocalSchedule>, text: string): HTMLButtonElement =>
    [...fixture.nativeElement.querySelectorAll('button')].find(
      (element: HTMLButtonElement) => element.textContent?.trim() === text,
    )!;

  it('mantiene horas pendientes y no publica un horario al entrar', async () => {
    data.schedule = { days: [0, 1, 2, 3, 4, 5, 6], openHour: null, closeHour: null, revision: 0 };
    const fixture = await setup(),
      component = fixture.componentInstance;
    expect(component.weekly.openHour).toBeNull();
    expect(component.weekly.closeHour).toBeNull();
    expect(component.weeklySummary()).toContain('Elige la apertura');
    expect(component.hasUnsavedChanges()).toBe(false);
    expect(service.saveWeekly).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Las solicitudes y reservas existentes se mantienen y deben atenderse',
    );
  });
  it('permite elegir los días con su estado accesible y guardar horas reales', async () => {
    const fixture = await setup(),
      component = fixture.componentInstance;
    const monday = fixture.nativeElement.querySelector('.weekday') as HTMLButtonElement;
    expect(monday.getAttribute('aria-pressed')).toBe('true');
    monday.click();
    fixture.detectChanges();
    expect(monday.getAttribute('aria-pressed')).toBe('false');
    expect(monday.textContent).toContain('Cerrado');
    component.weekly.closeHour = 24;
    expect(component.hasUnsavedChanges()).toBe(true);
    await component.saveWeekly();
    expect(service.saveWeekly).toHaveBeenCalledExactlyOnceWith('local-prueba', {
      days: [2, 3, 4, 5],
      openHour: 8,
      closeHour: 24,
      revision: 2,
    });
    expect(component.weekly.revision).toBe(3);
    expect(component.hasUnsavedChanges()).toBe(false);
    expect(component.weeklyMessage()).toContain('nuevas solicitudes');
  });
  it('avisa cuando todos los días estarán cerrados y guarda la selección vacía', async () => {
    const component = (await setup()).componentInstance;
    component.selectAllDays(false);
    expect(component.weeklySummary()).toBe(
      'Todos los días estarán cerrados para nuevas solicitudes.',
    );
    await component.saveWeekly();
    expect(service.saveWeekly).toHaveBeenCalledWith(
      'local-prueba',
      expect.objectContaining({ days: [] }),
    );
  });
  it.each([
    { openHour: null, closeHour: null },
    { openHour: 22, closeHour: 8 },
    { openHour: 8, closeHour: 8 },
  ])('rechaza un horario incompleto o un cierre anterior a la apertura: %o', async (hours) => {
    const component = (await setup()).componentInstance;
    Object.assign(component.weekly, hours);
    await component.saveWeekly();
    expect(service.saveWeekly).not.toHaveBeenCalled();
    expect(component.weeklyError()).toContain('un cierre posterior');
  });
  it('conserva los cambios si otra persona actualizó el horario', async () => {
    service.saveWeekly.mockRejectedValue({
      code: 'functions/aborted',
      message: 'Otra persona actualizó el horario.',
    });
    const component = (await setup()).componentInstance;
    component.weekly.openHour = 9;
    await component.saveWeekly();
    expect(component.weeklyError()).toBe('Otra persona actualizó el horario.');
    expect(component.weekly.openHour).toBe(9);
    expect(component.hasUnsavedChanges()).toBe(true);
    expect(component.isSaving()).toBe(false);
  });
  it('guarda un cierre solo después de revisar y confirmar la fecha', async () => {
    const fixture = await setup(),
      component = fixture.componentInstance;
    await component.chooseClosureDate(date);
    component.closureReason = '  Mantenimiento de prueba  ';
    fixture.detectChanges();
    button(fixture, 'Revisar cierre').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.saveClosure).not.toHaveBeenCalled();
    expect(component.pendingClosure()?.date).toBe(date);
    expect(fixture.nativeElement.querySelector('#close-confirm-title')).toBeTruthy();
    button(fixture, 'Confirmar cierre para nuevas reservas').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.saveClosure).toHaveBeenCalledExactlyOnceWith('local-prueba', {
      date,
      dateStart: Date.parse(date + 'T00:00:00-05:00'),
      closed: true,
      reason: 'Mantenimiento de prueba',
      revision: 0,
    });
    expect(component.hasUnsavedChanges()).toBe(false);
    expect(component.closures()).toHaveLength(1);
    expect(component.closureMessage()).toContain('Las reservas existentes se mantienen');
  });
  it('volver de la confirmación conserva la entrada sin escribir', async () => {
    const fixture = await setup(),
      component = fixture.componentInstance;
    await component.chooseClosureDate(date);
    component.closureReason = 'Motivo pendiente';
    component.reviewClosure();
    fixture.detectChanges();
    button(fixture, 'Volver').click();
    fixture.detectChanges();
    expect(component.pendingClosure()).toBeNull();
    expect(component.closureDate).toBe(date);
    expect(component.closureReason).toBe('Motivo pendiente');
    expect(component.hasUnsavedChanges()).toBe(true);
    expect(service.saveClosure).not.toHaveBeenCalled();
  });
  it('reutiliza la revisión de una fecha reabierta y evita duplicar un cierre vigente', async () => {
    service.getClosure.mockResolvedValue(closure({ closed: false, revision: 4 }));
    const component = (await setup()).componentInstance;
    await component.chooseClosureDate(date);
    component.reviewClosure();
    await component.confirmClosure();
    expect(service.saveClosure).toHaveBeenCalledWith(
      'local-prueba',
      expect.objectContaining({ revision: 4, closed: true }),
    );
    service.getClosure.mockResolvedValue(closure({ revision: 5 }));
    await component.chooseClosureDate(date);
    component.reviewClosure();
    expect(component.pendingClosure()).toBeNull();
    expect(component.closureError()).toContain('ya está cerrada');
  });
  it('quitar un cierre requiere confirmar y devuelve la fecha al horario habitual', async () => {
    data.closures = [closure({ reason: 'Nota interna', revision: 3 })];
    const fixture = await setup(),
      component = fixture.componentInstance;
    button(fixture, 'Quitar cierre').click();
    fixture.detectChanges();
    expect(service.saveClosure).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Si ese día no atiendes normalmente, seguirá cerrado',
    );
    button(fixture, 'Sí, quitar cierre').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.saveClosure).toHaveBeenCalledExactlyOnceWith(
      'local-prueba',
      expect.objectContaining({ date, closed: false, revision: 3, reason: 'Nota interna' }),
    );
    expect(component.closures()).toEqual([]);
    expect(component.closureMessage()).toContain('horario habitual');
    expect(component.hasUnsavedChanges()).toBe(false);
  });
  it('rechaza fechas pasadas o inválidas y motivos demasiado largos antes de confirmar', async () => {
    const component = (await setup()).componentInstance;
    await component.chooseClosureDate('2000-01-01');
    component.reviewClosure();
    expect(component.pendingClosure()).toBeNull();
    expect(service.getClosure).not.toHaveBeenCalled();
    await component.chooseClosureDate('2099-02-31');
    expect(service.getClosure).not.toHaveBeenCalled();
    await component.chooseClosureDate(date);
    component.closureReason = 'a'.repeat(161);
    component.reviewClosure();
    expect(component.closureError()).toContain('160');
    expect(service.saveClosure).not.toHaveBeenCalled();
  });
  it('ignora consultas de fecha anteriores cuando se elige otro día', async () => {
    const old = deferred<DateClosure | null>(),
      latest = deferred<DateClosure | null>();
    service.getClosure.mockImplementation((_id: string, day: string) =>
      day === date ? old.promise : latest.promise,
    );
    const component = (await setup()).componentInstance;
    const oldRequest = component.chooseClosureDate(date);
    const latestRequest = component.chooseClosureDate(otherDate);
    latest.resolve(closure({ date: otherDate, reason: 'Fecha elegida', revision: 6 }));
    await latestRequest;
    old.resolve(closure({ reason: 'Respuesta anterior', revision: 2 }));
    await oldRequest;
    expect(component.closureDate).toBe(otherDate);
    expect(component.closureReason).toBe('Fecha elegida');
    expect(component.checkingDate()).toBe(false);
  });
  it('ignora la carga del establecimiento anterior al cambiar de local', async () => {
    const old = deferred<AdminScheduleData>(),
      latest = deferred<AdminScheduleData>();
    service.load.mockImplementation((id: string) =>
      id === 'local-anterior' ? old.promise : latest.promise,
    );
    const fixture = TestBed.createComponent(AdminLocalSchedule);
    fixture.componentRef.setInput('establishmentId', 'local-anterior');
    fixture.detectChanges();
    fixture.componentRef.setInput('establishmentId', 'local-actual');
    fixture.detectChanges();
    latest.resolve({ ...structuredClone(data), name: 'Local actual' });
    await latest.promise;
    await Promise.resolve();
    old.resolve({ ...structuredClone(data), name: 'Local anterior' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.name()).toBe('Local actual');
    expect(fixture.componentInstance.loading()).toBe(false);
  });
  it('actualiza las fechas sin borrar los cambios del horario habitual', async () => {
    const component = (await setup()).componentInstance;
    component.weekly.openHour = 10;
    data.closures = [closure()];
    data.closureLimitReached = true;
    await component.refreshClosures();
    expect(component.closures()).toHaveLength(1);
    expect(component.closureLimitReached()).toBe(true);
    expect(component.weekly.openHour).toBe(10);
    expect(component.hasUnsavedChanges()).toBe(true);
  });
  it('protege un motivo pendiente incluso antes de elegir la fecha', async () => {
    const component = (await setup()).componentInstance;
    component.closureReason = 'Mantenimiento pendiente';
    expect(component.closureDate).toBe('');
    expect(component.hasUnsavedChanges()).toBe(true);
    const event = new Event('beforeunload', { cancelable: true });
    component.beforeUnload(event);
    expect(event.defaultPrevented).toBe(true);
    expect(service.saveClosure).not.toHaveBeenCalled();
  });
  it('protege los cambios pendientes al recargar y permite salir después de guardar', async () => {
    const component = (await setup()).componentInstance;
    await component.chooseClosureDate(date);
    expect(component.hasUnsavedChanges()).toBe(false);
    component.closureReason = 'Pendiente';
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    component.beforeUnload(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    component.reviewClosure();
    await component.confirmClosure();
    const savedEvent = new Event('beforeunload', { cancelable: true });
    component.beforeUnload(savedEvent);
    expect(savedEvent.defaultPrevented).toBe(false);
  });
});
