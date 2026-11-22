import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BusinessCatalogService,
  PublicBusiness,
} from '../../core/services/business-catalog.service';
import { BookingService } from '../../core/services/booking.service';
import { Availability, Reservation } from '../../core/models/booking';
import { BookingFlow } from './booking-flow';

const local = (price = 3000): PublicBusiness => ({
  id: 'local',
  name: 'Mi local',
  location: 'Salinas',
  district: 'Andahuaylas',
  reference: '',
  description: '',
  phone: '',
  images: [],
  days: [1, 2, 3, 4, 5, 6, 0],
  openHour: 8,
  closeHour: 24,
  advanceCents: 1000,
  courts: [
    {
      id: 'principal',
      name: 'Cancha principal',
      sport: 'Fútbol',
      surface: 'Grass',
      images: [],
      dayPriceCents: price,
      nightPriceCents: 4000,
      nightStartsAt: 18,
    },
  ],
});
const availability = (price = 3000): Availability => ({
  slots: [{ hour: 16, available: true, priceCents: price }],
  demo: false,
  paymentQr: 'payment-qrs/local/original',
  paymentMode: 'live',
  holdMinutes: 15,
});
const reservation = (): Reservation => ({
  id: 'solicitud',
  engine: 'direct',
  establishmentId: 'local',
  establishmentName: 'Nombre histórico',
  courtId: 'principal',
  courtName: 'Cancha histórica',
  clientUid: 'cliente',
  date: '2030-01-20',
  hour: 16,
  totalCents: 3000,
  advanceCents: 1000,
  status: 'pending_payment',
  paymentStatus: 'unpaid',
  demo: false,
  paymentSnapshot: {
    mode: 'live',
    qr: 'payment-qrs/local/qr-historico',
    methods: ['Yape'],
    recipient: 'Titular original',
    phone: '999111222',
  },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};
describe('Reserva que mantiene actualizada la ficha publicada', () => {
  let panel: BookingFlow;
  const observe = vi.fn(),
    getAvailability = vi.fn(),
    mine = vi.fn(),
    stop = vi.fn();
  let query: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    observe.mockReset().mockResolvedValue(stop);
    stop.mockReset();
    getAvailability.mockReset().mockResolvedValue(availability());
    mine.mockReset().mockResolvedValue([]);
    query = new Map();
    TestBed.configureTestingModule({
      providers: [
        { provide: BusinessCatalogService, useValue: { observe } },
        { provide: BookingService, useValue: { availability: getAvailability, mine } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: new Map([
                ['establishmentId', 'local'],
                ['courtId', 'principal'],
              ]),
              queryParamMap: query,
            },
          },
        },
      ],
    });
    panel = TestBed.runInInjectionContext(() => new BookingFlow());
  });
  afterEach(() => {
    panel.ngOnDestroy();
    vi.useRealTimers();
  });
  it('refleja tarifas del dueño sin avanzar pasos ni modificar una selección', async () => {
    await panel.ngOnInit();
    const next = observe.mock.calls[0][0];
    next([local()]);
    expect(panel.valid).toBe(true);
    expect(panel.metadataLoading()).toBe(false);
    next([local(3550)]);
    expect(panel.venue.dayPriceCents).toBe(3550);
    expect(panel.step()).toBe(1);
    expect(getAvailability).not.toHaveBeenCalled();
  });
  it('el calendario respeta días reales y distingue cerrado de horario aún no definido', async () => {
    await panel.ngOnInit();
    const next = observe.mock.calls[0][0];
    next([{ ...local(), days: [], scheduleRevision: 0 }]);
    expect(panel.isWeeklyClosed('2030-01-20')).toBe(false);
    next([{ ...local(), days: [], scheduleRevision: 1 }]);
    expect(panel.isWeeklyClosed('2030-01-20')).toBe(true);
    next([{ ...local(), days: [1], scheduleRevision: 2 }]);
    expect(panel.isWeeklyClosed('2030-01-20')).toBe(true);
    expect(panel.isWeeklyClosed('2030-01-21')).toBe(false);
    expect(panel.isWeeklyClosed('2030-02-31')).toBe(false);
  });
  it('no elige fechas cerradas ni consulta disponibilidad al confirmar una de ellas', async () => {
    await panel.ngOnInit();
    const next = observe.mock.calls[0][0];
    panel.date.set('2030-01-20');
    next([{ ...local(), days: [1], scheduleRevision: 1 }]);
    expect(panel.date()).toBe('2030-01-20');
    expect(panel.error()).toContain('El local no atiende este día');
    await panel.confirmDate();
    expect(getAvailability).not.toHaveBeenCalled();
    panel.chooseDate('2030-01-21');
    expect(panel.date()).toBe('2030-01-21');
    panel.chooseDate('2030-01-20');
    expect(panel.date()).toBe('2030-01-21');
  });
  it('refresca disponibilidad y precio al cambiar el catálogo en Resumen', async () => {
    await panel.ngOnInit();
    const next = observe.mock.calls[0][0];
    next([local()]);
    panel.step.set(3);
    panel.hour.set(16);
    panel.availability.set(availability());
    getAvailability.mockResolvedValueOnce(availability(3550));
    next([local(3550)]);
    expect(panel.scheduleStale()).toBe(true);
    await vi.waitFor(() => expect(panel.scheduleStale()).toBe(false));
    expect(panel.price()).toBe(3550);
    expect(panel.hour()).toBe(16);
    expect(panel.step()).toBe(3);
  });
  it('descarta una agenda anterior y repite la consulta si los precios cambiaron durante su carga', async () => {
    await panel.ngOnInit();
    const next = observe.mock.calls[0][0];
    next([local()]);
    panel.step.set(3);
    panel.hour.set(16);
    const old = deferred<Availability>();
    getAvailability.mockReturnValueOnce(old.promise).mockResolvedValueOnce(availability(3550));
    const first = panel.refreshSchedule();
    next([local(3550)]);
    old.resolve(availability(3000));
    await first;
    await vi.waitFor(() => expect(getAvailability).toHaveBeenCalledTimes(2));
    expect(panel.price()).toBe(3550);
    expect(panel.scheduleStale()).toBe(false);
  });
  it('retirar un local invalida nuevas solicitudes y cierra la metadata de carga', async () => {
    await panel.ngOnInit();
    const next = observe.mock.calls[0][0];
    next([local()]);
    panel.availability.set(availability());
    next([]);
    expect(panel.valid).toBe(false);
    expect(panel.availability()).toBeNull();
    expect(panel.scheduleStale()).toBe(true);
    expect(panel.metadataLoading()).toBe(false);
  });
  it('una solicitud histórica conserva total y datos de pago aunque cambie o desaparezca la ficha', async () => {
    query.set('solicitud', 'solicitud');
    mine.mockResolvedValueOnce([reservation()]);
    await panel.ngOnInit();
    const next = observe.mock.calls[0][0];
    next([local(5500)]);
    expect(panel.step()).toBe(4);
    expect(panel.total()).toBe(3000);
    expect(panel.qr()).toBe('payment-qrs/local/qr-historico');
    expect(panel.paymentRecipient()).toBe('Titular original');
    next([]);
    expect(panel.valid).toBe(true);
    expect(panel.venue.name).toBe('Nombre histórico');
    expect(panel.court?.name).toBe('Cancha histórica');
    expect(panel.reservation()?.totalCents).toBe(3000);
  });
  it('un error o callback posterior a salir no modifica la metadata y cancela la escucha', async () => {
    await panel.ngOnInit();
    const [next, error] = observe.mock.calls[0];
    next([local()]);
    error(Error('Sin conexión'));
    expect(panel.valid).toBe(false);
    expect(panel.metadataLoading()).toBe(false);
    panel.ngOnDestroy();
    next([local(5550)]);
    expect(panel.valid).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
  });
});
