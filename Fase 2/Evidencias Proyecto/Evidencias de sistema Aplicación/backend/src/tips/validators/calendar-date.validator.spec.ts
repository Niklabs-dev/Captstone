import { isCalendarDate } from './calendar-date.validator.js';

describe('isCalendarDate', () => {
  it('acepta fechas reales, incluido un bisiesto', () => {
    expect(isCalendarDate('2026-10-26')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
  });

  it('rechaza formato, fechas inexistentes y valores no textuales', () => {
    for (const value of [
      '2026-02-30',
      '2027-02-29',
      '26-10-2026',
      '2026-10-26T12:00:00Z',
      '',
      null,
      undefined,
      20261026,
    ]) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });
});
