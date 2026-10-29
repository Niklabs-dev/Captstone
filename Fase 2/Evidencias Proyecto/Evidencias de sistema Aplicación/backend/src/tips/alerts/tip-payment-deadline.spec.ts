import { parseCalendarDate } from '../../audit/utils/business-day.util.js';
import {
  calculateTipPaymentDeadline,
  parseTipAlertHolidays,
} from './tip-payment-deadline.js';

function date(value: string) {
  const parsed = parseCalendarDate(value);
  if (!parsed) throw new Error(`Fecha de prueba inválida: ${value}`);
  return parsed;
}

describe('Plazo de siete días hábiles para propinas (SPRINT-3-T14)', () => {
  it('omite sábados y domingos desde la fecha de recepción', () => {
    const result = calculateTipPaymentDeadline(
      date('2026-10-02'),
      new Date('2026-10-02T15:00:00Z'),
      new Set(),
    );
    expect(result).toEqual({
      deadline: '2026-10-13',
      daysRemaining: 7,
      status: 'UPCOMING',
    });
  });

  it('omite los feriados chilenos configurados', () => {
    const holidays = parseTipAlertHolidays('2026-10-12');
    const result = calculateTipPaymentDeadline(
      date('2026-10-02'),
      new Date('2026-10-02T15:00:00Z'),
      holidays,
    );
    expect(result.deadline).toBe('2026-10-14');
  });

  it('descuenta días hábiles restantes y marca cero en el día límite', () => {
    const holidays = new Set<string>();
    expect(
      calculateTipPaymentDeadline(
        date('2026-10-02'),
        new Date('2026-10-05T15:00:00Z'),
        holidays,
      ).daysRemaining,
    ).toBe(6);
    expect(
      calculateTipPaymentDeadline(
        date('2026-10-02'),
        new Date('2026-10-13T15:00:00Z'),
        holidays,
      ),
    ).toMatchObject({ daysRemaining: 0, status: 'UPCOMING' });
  });

  it('queda vencida al día siguiente y solo descuenta días hábiles transcurridos', () => {
    const businessDate = date('2026-09-30');
    expect(
      calculateTipPaymentDeadline(
        businessDate,
        new Date('2026-10-09T15:00:00Z'),
        new Set(),
      ),
    ).toMatchObject({
      deadline: '2026-10-09',
      daysRemaining: 0,
      status: 'UPCOMING',
    });
    for (const instant of ['2026-10-10T15:00:00Z', '2026-10-11T15:00:00Z']) {
      expect(
        calculateTipPaymentDeadline(businessDate, new Date(instant), new Set()),
      ).toMatchObject({ daysRemaining: 0, status: 'OVERDUE' });
    }
    expect(
      calculateTipPaymentDeadline(
        businessDate,
        new Date('2026-10-12T15:00:00Z'),
        new Set(),
      ),
    ).toMatchObject({ daysRemaining: -1, status: 'OVERDUE' });
  });

  it('usa el día en hora de Chile y no el día UTC', () => {
    const businessDate = date('2026-10-02');
    expect(
      calculateTipPaymentDeadline(
        businessDate,
        new Date('2026-10-14T02:30:00Z'),
        new Set(),
      ),
    ).toMatchObject({ daysRemaining: 0, status: 'UPCOMING' });
    expect(
      calculateTipPaymentDeadline(
        businessDate,
        new Date('2026-10-14T03:30:00Z'),
        new Set(),
      ),
    ).toMatchObject({ daysRemaining: -1, status: 'OVERDUE' });
  });

  it('mantiene la cuenta durante el cambio de horario chileno', () => {
    const result = calculateTipPaymentDeadline(
      date('2026-09-04'),
      new Date('2026-09-06T15:00:00Z'),
      new Set(),
    );
    expect(result).toEqual({
      deadline: '2026-09-15',
      daysRemaining: 7,
      status: 'UPCOMING',
    });
  });

  it('valida, recorta y deduplica el calendario configurable', () => {
    const holidays = parseTipAlertHolidays(
      ' 2026-10-12,2026-10-12, 2026-11-01 ',
    );
    expect([...holidays]).toEqual(['2026-10-12', '2026-11-01']);
    expect(parseTipAlertHolidays(undefined)).toEqual(new Set());
    expect(() => parseTipAlertHolidays('2026-02-30,12-01-2026')).toThrow(
      'TIP_ALERT_HOLIDAYS contiene fechas inválidas: 2026-02-30, 12-01-2026',
    );
  });
});
