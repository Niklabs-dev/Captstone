import { zonedWallClockToInstant } from './zoned-time.util.js';

describe('zonedWallClockToInstant (SPRINT-4R-T09)', () => {
  it('convierte la hora de Chile en verano (UTC-3)', () => {
    expect(
      zonedWallClockToInstant(
        { year: 2026, month: 11, day: 5 },
        { hours: 23, minutes: 59, seconds: 59 },
      ).toISOString(),
    ).toBe('2026-11-06T02:59:59.000Z');
  });

  it('convierte la hora de Chile en invierno (UTC-4)', () => {
    expect(
      zonedWallClockToInstant(
        { year: 2026, month: 7, day: 5 },
        { hours: 0, minutes: 0, seconds: 0 },
      ).toISOString(),
    ).toBe('2026-07-05T04:00:00.000Z');
  });

  it('el día en que empieza el horario de verano la medianoche pasa a la 01:00', () => {
    // 2026-09-06: en Chile el reloj salta de 24:00 a 01:00, así que las
    // 00:00 no existen y el día empieza a las 01:00 (UTC-3).
    expect(
      zonedWallClockToInstant(
        { year: 2026, month: 9, day: 6 },
        { hours: 0, minutes: 0, seconds: 0 },
      ).toISOString(),
    ).toBe('2026-09-06T04:00:00.000Z');
  });

  it('respeta una zona horaria explícita', () => {
    expect(
      zonedWallClockToInstant(
        { year: 2026, month: 1, day: 1 },
        { hours: 12, minutes: 0, seconds: 0 },
        'UTC',
      ).toISOString(),
    ).toBe('2026-01-01T12:00:00.000Z');
  });
});
