import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReservationTiming } from './reservation-timing';
import { Reservation } from '../core/models/booking';

describe('Fin automático visible para el cliente', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });
  it('cambia a finalizado al cumplirse una hora sin otra descarga', () => {
    vi.useFakeTimers();
    const start = Date.parse('2026-11-20T15:20:00Z');
    vi.setSystemTime(start + 3600000 - 1000);
    const fixture = TestBed.createComponent(ReservationTiming);
    fixture.componentRef.setInput('reservation', {
      engine: 'direct',
      serviceStatus: 'running',
      actualStartAt: start,
      estimatedStartAt: start,
      estimatedEndAt: start + 3600000,
      startsAt: start - 20 * 60000,
    } as Reservation);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Tu partido está en juego');
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Partido finalizado');
    expect(fixture.componentInstance.endAt()).toBe(start + 3600000);
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('conserva la hora registrada de partidos históricos completados', () => {
    const fixture = TestBed.createComponent(ReservationTiming);
    fixture.componentRef.setInput('reservation', {
      engine: 'direct',
      serviceStatus: 'completed',
      actualStartAt: 100000,
      actualEndAt: 200000,
    } as Reservation);
    fixture.detectChanges();
    expect(fixture.componentInstance.completed()).toBe(true);
    expect(fixture.componentInstance.endAt()).toBe(200000);
    fixture.destroy();
  });
});
