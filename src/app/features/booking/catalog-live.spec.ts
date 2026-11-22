import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BusinessCatalogService,
  PublicBusiness,
} from '../../core/services/business-catalog.service';
import { Courts } from './courts';
import { Venues } from './venues';

const venue = (openHour = 8, price = 3000): PublicBusiness => ({
  id: 'local',
  name: 'Grass del barrio',
  location: 'Salinas',
  district: 'Andahuaylas',
  reference: '',
  description: '',
  phone: '',
  images: [],
  days: [1, 2, 3, 4, 5, 6, 0],
  openHour,
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
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};
describe('Catálogo abierto que refleja cambios del dueño', () => {
  const observe = vi.fn();
  beforeEach(() => {
    observe.mockReset().mockResolvedValue(vi.fn());
    TestBed.configureTestingModule({
      providers: [
        { provide: BusinessCatalogService, useValue: { observe } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['establishmentId', 'local']]) } },
        },
      ],
    });
  });
  it('la ficha cambia horarios y precios mientras permanece abierta', async () => {
    const panel = TestBed.runInInjectionContext(() => new Courts());
    await panel.load();
    const [next] = observe.mock.calls[0];
    next([venue()]);
    expect(panel.venue()?.openHour).toBe(8);
    next([venue(10, 3550)]);
    expect(panel.venue()?.openHour).toBe(10);
    expect(panel.venue()?.courts[0].dayPriceCents).toBe(3550);
    expect(panel.loading()).toBe(false);
    next([]);
    expect(panel.venue()).toBeNull();
    panel.ngOnDestroy();
  });
  it('al reintentar limpia la escucha anterior e ignora sus respuestas y errores', async () => {
    const firstStop = vi.fn(),
      secondStop = vi.fn();
    observe.mockResolvedValueOnce(firstStop).mockResolvedValueOnce(secondStop);
    const panel = TestBed.runInInjectionContext(() => new Courts());
    await panel.load();
    const [oldNext, oldError] = observe.mock.calls[0];
    await panel.load();
    expect(firstStop).toHaveBeenCalledOnce();
    observe.mock.calls[1][0]([venue(10)]);
    oldNext([venue(6)]);
    oldError(Error('Viejo'));
    expect(panel.venue()?.openHour).toBe(10);
    expect(panel.error()).toBe('');
    panel.ngOnDestroy();
    expect(secondStop).toHaveBeenCalledOnce();
  });
  it('una escucha que termina de crearse después de salir se cierra inmediatamente', async () => {
    const pending = deferred<() => void>(),
      stop = vi.fn();
    observe.mockReturnValueOnce(pending.promise);
    const panel = TestBed.runInInjectionContext(() => new Courts());
    const load = panel.load();
    panel.ngOnDestroy();
    pending.resolve(stop);
    await load;
    expect(stop).toHaveBeenCalledOnce();
    observe.mock.calls[0][0]([venue()]);
    expect(panel.venue()).toBeNull();
  });
  it('actualizar el listado conserva el buscador y sus filtros', async () => {
    const panel = TestBed.runInInjectionContext(() => new Venues());
    panel.search.set('salinas');
    await panel.load();
    const [next, error] = observe.mock.calls[0];
    next([venue()]);
    expect(panel.visible()).toHaveLength(1);
    next([{ ...venue(10), location: 'Otro distrito' }]);
    expect(panel.search()).toBe('salinas');
    expect(panel.visible()).toHaveLength(0);
    error(Error('Falla'));
    expect(panel.error()).toContain('actualizar');
    expect(panel.loading()).toBe(false);
    panel.ngOnDestroy();
  });
});
