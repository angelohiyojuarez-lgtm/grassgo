import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BookingService } from '../../core/services/booking.service';
import { Reservation } from '../../core/models/booking';
import { MyReservations } from './my-reservations';

describe('Historial de reservas del cliente', () => {
  it('conserva el historial cuando falla una actualización y quita el aviso al recuperarse', async () => {
    const item = { id: 'propia', status: 'pending_verification' } as Reservation;
    const mine = vi
      .fn()
      .mockResolvedValueOnce([item])
      .mockRejectedValueOnce(Object.assign(Error('offline'), { code: 'functions/unavailable' }))
      .mockResolvedValueOnce([{ ...item, status: 'confirmed' }]);
    TestBed.configureTestingModule({
      providers: [{ provide: BookingService, useValue: { mine } }],
    });
    const page = TestBed.runInInjectionContext(() => new MyReservations());
    await page.load();
    await page.load(true);
    expect(page.items()).toEqual([item]);
    expect(page.loading()).toBe(false);
    expect(page.error()).toContain('no está disponible');
    await page.load(true);
    expect(page.error()).toBe('');
    expect(page.items()[0].status).toBe('confirmed');
    page.ngOnDestroy();
  });
});
