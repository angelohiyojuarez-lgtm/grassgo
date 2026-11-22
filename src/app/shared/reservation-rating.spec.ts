import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReservationRating } from './reservation-rating';
import { BookingService } from '../core/services/booking.service';
import { Reservation } from '../core/models/booking';
const r = { id: 'played', status: 'confirmed', serviceStatus: 'completed', demo: true } as Reservation;
describe('Calificar después de jugar', () => {
  const call = vi.fn();
  beforeEach(() => {
    call.mockReset();
    TestBed.configureTestingModule({ imports: [ReservationRating], providers: [{ provide: BookingService, useValue: { call } }] });
  });
  it('solo muestra el formulario al finalizar y envía las estrellas elegidas', async () => {
    const fixture = TestBed.createComponent(ReservationRating);
    fixture.componentRef.setInput('reservation', { ...r, serviceStatus: 'running' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.rating-stars')).toBeNull();
    fixture.componentRef.setInput('reservation', r);
    fixture.detectChanges();
    const stars = fixture.nativeElement.querySelectorAll('.rating-stars button');
    stars[3].click();
    call.mockResolvedValue({ stars: 4 });
    await fixture.componentInstance.send(); fixture.detectChanges();
    expect(call).toHaveBeenCalledWith('rateEstablishment', { reservationId: 'played', stars: 4 });
    expect(fixture.nativeElement.textContent).toContain('4 de 5');
    expect(fixture.nativeElement.querySelector('.rating-stars')).toBeNull();
  });
  it('conserva la selección y permite reintentar si falla la conexión', async () => {
    const fixture = TestBed.createComponent(ReservationRating);
    fixture.componentRef.setInput('reservation', r);
    fixture.componentInstance.selected.set(5);
    call.mockRejectedValue(Error('offline'));
    await fixture.componentInstance.send(); fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBeTruthy();
    expect(fixture.componentInstance.busy()).toBe(false);
    expect(fixture.componentInstance.selected()).toBe(5);
  });
});
