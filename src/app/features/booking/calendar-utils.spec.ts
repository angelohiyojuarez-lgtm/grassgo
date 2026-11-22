import { describe, it, expect } from 'vitest';
import { limaToday, calendarDays, addDays } from './calendar-utils';
import { money, slotLabel, PILOT } from '../../core/models/booking';
describe('Calendario y tarifas del piloto', () => {
  it('usa la fecha de Lima cerca de medianoche UTC', () => {
    expect(limaToday(new Date('2026-10-24T03:00:00Z'))).toBe('2026-10-23');
  });
  it('ordena la semana de lunes a domingo y cruza meses', () => {
    const cells = calendarDays('2026-11');
    expect(cells).toHaveLength(42);
    expect(cells[0].date).toBe('2026-10-26');
    expect(cells[6].date).toBe('2026-11-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('muestra bloques completos y diferencia adelanto de total', () => {
    expect(slotLabel(23)).toBe('23:00 – 00:00');
    expect(PILOT.advanceCents).toBe(1000);
    expect(PILOT.nightStartsAt).toBe(18);
    expect(PILOT.dayPriceCents).toBe(3000);
    expect(PILOT.nightPriceCents).toBe(4000);
    expect(money(1000)).toContain('10');
  });
});
