import { describe, expect, it } from 'vitest';
import {
  DirectCourtOperation,
  DirectScheduleSlot,
  directDayStart,
  operationAffectsDate,
  operationEndedAt,
  projectDirectSchedule,
} from './direct-court-schedule';
const date = '2026-11-20',
  HOUR = 3600000;
const time = (hour: number, minute = 0) => directDayStart(date) + hour * HOUR + minute * 60000;
const slots = (...hours: number[]): DirectScheduleSlot[] =>
  hours.map((hour) => ({
    hour,
    reservationId: 'reserva-' + hour,
    status: 'confirmed',
  }));
const running = (hour = 20, minute = 20): DirectCourtOperation => ({
  activeReservationId: 'reserva-' + hour,
  activeDate: date,
  actualStartAt: time(hour, minute),
  lastEndedAt: null,
});
describe('Estimaciones del partido directo', () => {
  it('encadena el retraso de 20 minutos conservando las horas reservadas', () => {
    const result = projectDirectSchedule(date, slots(20, 21, 22), running(), time(20, 30));
    expect(result.map((item) => item.scheduledHour)).toEqual([20, 21, 22]);
    expect(result.map((item) => item.estimatedStartAt)).toEqual([
      time(20, 20),
      time(21, 20),
      time(22, 20),
    ]);
    expect(result.map((item) => item.estimatedEndAt)).toEqual([
      time(21, 20),
      time(22, 20),
      time(23, 20),
    ]);
    expect(result.map((item) => item.running)).toEqual([true, false, false]);
  });
  it('al cerrar el navegador termina en su límite; el siguiente espera inicio manual desde ahora', () => {
    const result = projectDirectSchedule(date, slots(20, 21), running(), time(22, 5));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      scheduledHour: 21,
      running: false,
      awaitingFinish: false,
      estimatedStartAt: time(22, 5),
      estimatedEndAt: time(23, 5),
    });
    expect(operationAffectsDate(running(), date, time(22, 5))).toBe(false);
    expect(operationEndedAt(running(), time(22, 5))).toBe(time(21, 20));
  });
  it('al finalizar usa la hora real de fin y excluye el turno completado', () => {
    const entries = slots(20, 21, 22);
    entries[0] = { ...entries[0], serviceStatus: 'completed', actualEndAt: time(21, 30) };
    const state: DirectCourtOperation = {
      activeReservationId: null,
      activeDate: null,
      actualStartAt: null,
      lastEndedAt: time(21, 30),
    };
    const result = projectDirectSchedule(date, entries, state, time(21, 35));
    expect(result.map((item) => item.scheduledHour)).toEqual([21, 22]);
    expect(result.map((item) => item.estimatedStartAt)).toEqual([time(21, 35), time(22, 35)]);
  });
  it('un juego que cruza medianoche afecta el siguiente día, no fechas futuras independientes', () => {
    const operation = running(23, 40),
      nextDate = '2026-11-21';
    expect(operationAffectsDate(operation, date, time(23, 50))).toBe(true);
    expect(operationAffectsDate(operation, nextDate, time(23, 50))).toBe(true);
    expect(operationAffectsDate(operation, '2026-11-22', time(23, 50))).toBe(false);
    const result = projectDirectSchedule(nextDate, slots(0, 1), operation, time(23, 50));
    expect(result[0].estimatedStartAt).toBe(time(24, 40));
    expect(result[1].estimatedStartAt).toBe(time(25, 40));
  });
  it('sin juego activo o retraso respeta las horas y los huecos del horario', () => {
    const result = projectDirectSchedule(date, slots(8, 10), null, time(7));
    expect(result.map((item) => item.estimatedStartAt)).toEqual([time(8), time(10)]);
    expect(operationAffectsDate(null, date, time(7))).toBe(false);
  });
  it('el límite es exacto: H menos un milisegundo ocupa; en H termina sin registro adicional', () => {
    const operation = running(),
      end = time(21, 20);
    expect(operationAffectsDate(operation, date, end - 1)).toBe(true);
    expect(operationAffectsDate(operation, date, end)).toBe(false);
    const entries = slots(20, 21);
    entries[0] = { ...entries[0], serviceStatus: 'running', actualStartAt: time(20, 20) };
    expect(projectDirectSchedule(date, entries, operation, end - 1)[0].running).toBe(true);
    expect(
      projectDirectSchedule(date, entries, operation, end).map((item) => item.scheduledHour),
    ).toEqual([21]);
    expect(projectDirectSchedule(date, entries, null, end)[0].estimatedStartAt).toBe(end);
  });
});
