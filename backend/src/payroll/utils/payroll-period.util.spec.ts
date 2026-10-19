import {
  formatPayrollPeriod,
  isFuturePeriod,
  parsePayrollPeriod,
  payslipRevision,
} from './payroll-period.util.js';

describe('Período de liquidaciones (SPRINT-2-T13)', () => {
  it('interpreta YYYY-MM como el primer día del mes', () => {
    expect(parsePayrollPeriod('2026-09')).toEqual({
      year: 2026,
      month: 9,
      day: 1,
    });
    expect(parsePayrollPeriod('2026-12')).toEqual({
      year: 2026,
      month: 12,
      day: 1,
    });
  });

  it('rechaza formatos y meses inválidos', () => {
    for (const value of ['2026-13', '2026-00', '2026-9', '2026-09-01', '']) {
      expect(parsePayrollPeriod(value)).toBeNull();
    }
  });

  it('formatea la columna date como YYYY-MM', () => {
    expect(formatPayrollPeriod(new Date('2026-09-01T00:00:00.000Z'))).toBe(
      '2026-09',
    );
  });

  it('admite el mes en curso y los anteriores, en hora de Chile', () => {
    const now = new Date('2026-10-19T15:00:00.000Z');
    expect(isFuturePeriod({ year: 2026, month: 10, day: 1 }, now)).toBe(false);
    expect(isFuturePeriod({ year: 2026, month: 9, day: 1 }, now)).toBe(false);
    expect(isFuturePeriod({ year: 2025, month: 12, day: 1 }, now)).toBe(false);
    expect(isFuturePeriod({ year: 2026, month: 11, day: 1 }, now)).toBe(true);
    expect(isFuturePeriod({ year: 2027, month: 1, day: 1 }, now)).toBe(true);
  });

  it('usa el mes de Chile en el cambio de mes UTC', () => {
    // 01:00 UTC del 01-11 son las 22:00 del 31-10 en Chile (UTC-3): noviembre
    // aún no empieza.
    const now = new Date('2026-11-01T01:00:00.000Z');
    expect(isFuturePeriod({ year: 2026, month: 11, day: 1 }, now)).toBe(true);
  });

  it('deriva la revisión de updated_at', () => {
    expect(payslipRevision(new Date('2026-10-19T15:00:00.000Z'))).toBe(
      '2026-10-19T15:00:00.000Z',
    );
  });
});
