import { resolvePaymentDate } from './payment-date.js';

// Tests unitarios de la fecha de pago del reparto (SPRINT-3-T13).

// 27-10-2026 a las 23:30 en Chile (UTC-3) ya es 28-10-2026 en UTC.
const LATE_NIGHT_IN_CHILE = new Date('2026-10-28T02:30:00.000Z');

describe('resolvePaymentDate', () => {
  it('sin fecha usa el día de hoy en hora de Chile, no el día UTC', () => {
    expect(
      resolvePaymentDate(undefined, '2026-10-15', LATE_NIGHT_IN_CHILE),
    ).toEqual({ valid: true, date: '2026-10-27' });
  });

  it('acepta hoy, el último día del período y fechas intermedias', () => {
    for (const date of ['2026-10-27', '2026-10-15', '2026-10-20']) {
      expect(
        resolvePaymentDate(date, '2026-10-15', LATE_NIGHT_IN_CHILE),
      ).toEqual({ valid: true, date });
    }
  });

  it('rechaza una fecha futura en hora de Chile', () => {
    const result = resolvePaymentDate(
      '2026-10-28',
      '2026-10-15',
      LATE_NIGHT_IN_CHILE,
    );
    expect(result).toEqual({
      valid: false,
      message: 'paymentDate no puede ser futura (hoy es 2026-10-27)',
    });
  });

  it('rechaza una fecha anterior al término del período', () => {
    const result = resolvePaymentDate(
      '2026-10-14',
      '2026-10-15',
      LATE_NIGHT_IN_CHILE,
    );
    expect(result).toEqual({
      valid: false,
      message:
        'paymentDate no puede ser anterior al término del período (2026-10-15)',
    });
  });

  it('sin fecha rechaza un período que todavía no termina', () => {
    expect(
      resolvePaymentDate(undefined, '2026-10-31', LATE_NIGHT_IN_CHILE).valid,
    ).toBe(false);
  });

  it('rechaza formatos y fechas inexistentes', () => {
    for (const value of ['2026-02-30', '27-10-2026', '2026-10-27T00:00']) {
      expect(
        resolvePaymentDate(value, '2026-01-01', LATE_NIGHT_IN_CHILE).valid,
      ).toBe(false);
    }
  });
});
