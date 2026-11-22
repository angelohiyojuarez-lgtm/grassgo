import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { BusinessCatalogService } from './business-catalog.service';
import { BookingService } from './booking.service';
import { FirebaseService } from '../firebase/firebase.service';
const sdk = vi.hoisted(() => ({
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  where: vi.fn((...args) => args),
  limit: vi.fn((value) => value),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path,
  query: (...args: unknown[]) => args,
  getDocsFromServer: sdk.getDocs,
  onSnapshot: sdk.onSnapshot,
  where: sdk.where,
  limit: sdk.limit,
}));
describe('Catálogo publicado con Firebase gratuito', () => {
  const call = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: BookingService, useValue: { call } },
        { provide: FirebaseService, useValue: { getDb: async () => ({}) } },
      ],
    });
  });
  it('consulta únicamente locales publicados sin invocar Cloud Functions', async () => {
    sdk.getDocs.mockResolvedValue({
      docs: [
        {
          id: 'el-puma',
          data: () => ({
            name: 'Grass El Puma',
            status: 'published',
            scheduleRevision: 4,
            days: [],
            openHour: 8,
            closeHour: 24,
            demo: true,
            courts: [{ id: 'principal', sport: 'Fútbol' }],
          }),
        },
      ],
    });
    const result = await TestBed.inject(BusinessCatalogService).list();
    expect(result[0].id).toBe('el-puma');
    expect(result[0].demo).toBe(true);
    expect(result[0].scheduleRevision).toBe(4);
    expect(result[0].days).toEqual([]);
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(sdk.where).toHaveBeenCalledWith('status', '==', 'published');
    expect(sdk.limit).toHaveBeenCalledWith(100);
    expect(call).not.toHaveBeenCalled();
  });
  it('no inventa locales si falla la consulta de Firebase', async () => {
    sdk.getDocs.mockRejectedValue(new Error('Sin conexión'));
    await expect(TestBed.inject(BusinessCatalogService).list()).rejects.toThrow('Sin conexión');
    expect(call).not.toHaveBeenCalled();
  });
  it('escucha cambios publicados y conserva horarios/precios nuevos sin volver a cargar la página', async () => {
    const stop = vi.fn(),
      items = vi.fn(),
      error = vi.fn();
    sdk.onSnapshot.mockReturnValue(stop);
    const unsubscribe = await TestBed.inject(BusinessCatalogService).observe(items, error);
    const [query, next] = sdk.onSnapshot.mock.calls[0];
    expect(query).toEqual(['catalog', ['status', '==', 'published'], 100]);
    const result = (hour: number, price: number) => ({
      docs: [
        {
          id: 'local',
          data: () => ({ openHour: hour, courts: [{ id: 'principal', dayPriceCents: price }] }),
        },
      ],
    });
    next(result(8, 3000));
    next(result(10, 3550));
    expect(items).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'local',
        openHour: 10,
        courts: [{ id: 'principal', dayPriceCents: 3550 }],
      }),
    ]);
    expect(sdk.getDocs).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    unsubscribe();
    expect(stop).toHaveBeenCalledOnce();
    next(result(12, 4500));
    expect(items).toHaveBeenCalledTimes(2);
  });
  it('propaga fallos del listener y su limpieza bloquea callbacks tardíos', async () => {
    const items = vi.fn(),
      error = vi.fn(),
      stop = vi.fn();
    sdk.onSnapshot.mockReturnValue(stop);
    const unsubscribe = await TestBed.inject(BusinessCatalogService).observe(items, error);
    const callback = sdk.onSnapshot.mock.calls[0][2];
    const failure = Error('Sin conexión');
    callback(failure);
    expect(error).toHaveBeenCalledExactlyOnceWith(failure);
    unsubscribe();
    callback(Error('Evento viejo'));
    expect(error).toHaveBeenCalledOnce();
    expect(items).not.toHaveBeenCalled();
  });
});
