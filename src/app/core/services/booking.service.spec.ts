import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingService } from './booking.service';
import { BackendTransport } from './backend-transport.service';
import { DirectBookingService } from './direct-booking.service';
import { DirectPlatformService } from './direct-platform.service';
import { FirebaseService } from '../firebase/firebase.service';

describe('Conexión del superadmin con el backend operativo', () => {
  const base = vi.fn(),
    request = vi.fn(),
    getFunctions = vi.fn();
  const platform = { overview: vi.fn(), activity: vi.fn(), setStatus: vi.fn() };
  const mine = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    base.mockResolvedValue(null);
    TestBed.configureTestingModule({
      providers: [
        { provide: BackendTransport, useValue: { base, request } },
        { provide: FirebaseService, useValue: { getFunctions } },
        { provide: DirectBookingService, useValue: { mine } },
        { provide: DirectPlatformService, useValue: platform },
      ],
    });
  });
  it('el resumen consulta Firestore en lugar de Functions cuando no hay servidor alternativo', async () => {
    const result = { establishments: [{ id: 'el-puma' }], totalBusinessCount: 1 };
    platform.overview.mockResolvedValue(result);
    expect(await TestBed.inject(BookingService).call('platformOverview')).toBe(result);
    expect(platform.overview).toHaveBeenCalledOnce();
    expect(getFunctions).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it('actividad y cambios de estado usan el mismo servicio protegido', async () => {
    const result = { events: [] },
      change = { establishmentId: 'el-puma', status: 'suspended' };
    platform.activity.mockResolvedValue(result);
    platform.setStatus.mockResolvedValue({ success: true });
    const service = TestBed.inject(BookingService);
    expect(await service.call('platformActivity')).toBe(result);
    expect(await service.call('setEstablishmentStatus', change)).toEqual({ success: true });
    expect(platform.setStatus).toHaveBeenCalledExactlyOnceWith(change);
    expect(getFunctions).not.toHaveBeenCalled();
  });
  it('conserva el transporte HTTP cuando está configurado explícitamente', async () => {
    base.mockResolvedValue('https://servidor.example.test');
    request.mockResolvedValue({ json: async () => ({ result: { establishments: [] } }) });
    expect(await TestBed.inject(BookingService).call('platformOverview')).toEqual({
      establishments: [],
    });
    expect(request).toHaveBeenCalledWith(
      '/api/platformOverview',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(platform.overview).not.toHaveBeenCalled();
    expect(await TestBed.inject(BookingService).usesDirectBackend()).toBe(false);
  });
  it('las rutas del editor aún pendientes no intentan llamar a un servicio inexistente', async () => {
    for (const name of [
      'createEstablishment',
      'getBusinessConfiguration',
      'saveBusinessConfiguration',
      'publishBusiness',
    ])
      await expect(TestBed.inject(BookingService).call(name)).rejects.toMatchObject({
        code: 'functions/failed-precondition',
      });
    expect(getFunctions).not.toHaveBeenCalled();
  });
  it('conserva el recorrido directo de las reservas del cliente', async () => {
    mine.mockResolvedValue([{ id: 'reserva-existente' }]);
    expect(await TestBed.inject(BookingService).mine()).toEqual([{ id: 'reserva-existente' }]);
    expect(platform.overview).not.toHaveBeenCalled();
    expect(await TestBed.inject(BookingService).usesDirectBackend()).toBe(true);
  });
});
