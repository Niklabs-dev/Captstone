import { parseCalendarDate } from '../../audit/utils/business-day.util.js';
import { addDays } from '../../documents/utils/document-dates.util.js';
import type { TipPaymentAlert } from '../types/tip-payment-alerts.types.js';
import {
  DEFAULT_TIP_LEGAL_PAYMENT_DAYS,
  isTipPaymentOverdue,
  latestOverdueBusinessDate,
  parseTipAlertHolidays,
  parseTipLegalPaymentDays,
  summarizeTipPaymentAlerts,
  tipPaymentDaysOverdue,
  tipPaymentDeadline,
} from './tip-payment-deadline.js';

function date(value: string) {
  const parsed = parseCalendarDate(value);
  if (!parsed) throw new Error(`Fecha de prueba inválida: ${value}`);
  return parsed;
}

function text(value: { year: number; month: number; day: number }): string {
  return [
    value.year,
    String(value.month).padStart(2, '0'),
    String(value.day).padStart(2, '0'),
  ].join('-');
}

const NO_HOLIDAYS = new Set<string>();

describe('Plazo legal de pago de propinas (SPRINT-3-T14 y SPRINT-4A-T22)', () => {
  it('por defecto son siete días hábiles, sin sábados ni domingos', () => {
    expect(DEFAULT_TIP_LEGAL_PAYMENT_DAYS).toBe(7);
    // Viernes 2: lunes 5 a viernes 9 y lunes 12 a martes 13.
    expect(text(tipPaymentDeadline(date('2026-10-02'), 7, NO_HOLIDAYS))).toBe(
      '2026-10-13',
    );
  });

  it('omite los feriados chilenos configurados', () => {
    const holidays = parseTipAlertHolidays('2026-10-12');
    expect(text(tipPaymentDeadline(date('2026-10-02'), 7, holidays))).toBe(
      '2026-10-14',
    );
  });

  it('cuenta los días que pacte el convenio', () => {
    expect(text(tipPaymentDeadline(date('2026-10-02'), 10, NO_HOLIDAYS))).toBe(
      '2026-10-16',
    );
    expect(text(tipPaymentDeadline(date('2026-10-02'), 1, NO_HOLIDAYS))).toBe(
      '2026-10-05',
    );
  });

  it('borde exacto: el día límite no alerta y el día siguiente sí', () => {
    const businessDate = date('2026-10-02');
    expect(
      isTipPaymentOverdue(businessDate, date('2026-10-12'), 7, NO_HOLIDAYS),
    ).toBe(false);
    expect(
      isTipPaymentOverdue(businessDate, date('2026-10-13'), 7, NO_HOLIDAYS),
    ).toBe(false);
    expect(
      isTipPaymentOverdue(businessDate, date('2026-10-14'), 7, NO_HOLIDAYS),
    ).toBe(true);
    // Con un plazo pactado mayor, el mismo día sigue en plazo.
    expect(
      isTipPaymentOverdue(businessDate, date('2026-10-14'), 10, NO_HOLIDAYS),
    ).toBe(false);
  });

  it('un plazo que vence el viernes alerta desde el sábado', () => {
    const businessDate = date('2026-09-30');
    expect(text(tipPaymentDeadline(businessDate, 7, NO_HOLIDAYS))).toBe(
      '2026-10-09',
    );
    expect(
      isTipPaymentOverdue(businessDate, date('2026-10-09'), 7, NO_HOLIDAYS),
    ).toBe(false);
    expect(
      isTipPaymentOverdue(businessDate, date('2026-10-10'), 7, NO_HOLIDAYS),
    ).toBe(true);
    expect(tipPaymentDaysOverdue(date('2026-10-09'), date('2026-10-10'))).toBe(
      1,
    );
    expect(tipPaymentDaysOverdue(date('2026-10-09'), date('2026-10-12'))).toBe(
      3,
    );
    expect(tipPaymentDaysOverdue(date('2026-10-09'), date('2026-10-09'))).toBe(
      0,
    );
  });

  it('calcula la última fecha de negocio vencida hoy', () => {
    // El 13 vence lo del viernes 2 (y sábado 3 y domingo 4, con el mismo
    // límite): el 13 todavía no hay nada del 2; el 14, hasta el domingo 4.
    expect(
      text(latestOverdueBusinessDate(date('2026-10-13'), 7, NO_HOLIDAYS)),
    ).toBe('2026-10-01');
    expect(
      text(latestOverdueBusinessDate(date('2026-10-14'), 7, NO_HOLIDAYS)),
    ).toBe('2026-10-04');
    // Un feriado corre el plazo un día.
    const holidays = parseTipAlertHolidays('2026-10-12');
    expect(
      text(latestOverdueBusinessDate(date('2026-10-14'), 7, holidays)),
    ).toBe('2026-10-01');
    expect(
      text(latestOverdueBusinessDate(date('2026-10-15'), 7, holidays)),
    ).toBe('2026-10-04');
  });

  it('la última fecha vencida coincide con la regla día a día', () => {
    for (const legalDays of [1, 7, 15]) {
      for (const today of ['2026-10-10', '2026-10-14', '2026-12-28']) {
        const cutoff = latestOverdueBusinessDate(
          date(today),
          legalDays,
          NO_HOLIDAYS,
        );
        expect(
          isTipPaymentOverdue(cutoff, date(today), legalDays, NO_HOLIDAYS),
        ).toBe(true);
        expect(
          isTipPaymentOverdue(
            addDays(cutoff, 1),
            date(today),
            legalDays,
            NO_HOLIDAYS,
          ),
        ).toBe(false);
      }
    }
  });

  it('valida TIP_LEGAL_PAYMENT_DAYS como entero positivo con valor por defecto', () => {
    expect(parseTipLegalPaymentDays(undefined)).toBe(7);
    expect(parseTipLegalPaymentDays('')).toBe(7);
    expect(parseTipLegalPaymentDays(' 10 ')).toBe(10);
    expect(parseTipLegalPaymentDays('1')).toBe(1);
    expect(parseTipLegalPaymentDays('260')).toBe(260);
    for (const invalid of ['0', '-3', '2.5', 'abc', '7d', '261', '1e3']) {
      expect(() => parseTipLegalPaymentDays(invalid)).toThrow(
        /TIP_LEGAL_PAYMENT_DAYS debe ser un entero entre 1 y 260/,
      );
    }
  });

  it('valida, recorta y deduplica el calendario de feriados', () => {
    const holidays = parseTipAlertHolidays(
      ' 2026-10-12,2026-10-12, 2026-11-01 ',
    );
    expect([...holidays]).toEqual(['2026-10-12', '2026-11-01']);
    expect(parseTipAlertHolidays(undefined)).toEqual(new Set());
    expect(() => parseTipAlertHolidays('2026-02-30,12-01-2026')).toThrow(
      'TIP_ALERT_HOLIDAYS contiene fechas inválidas: 2026-02-30, 12-01-2026',
    );
  });

  it('resume monto, días, fechas y mayor atraso de un conjunto de alertas', () => {
    const alert = (overrides: Partial<TipPaymentAlert>): TipPaymentAlert => ({
      store: { id: 's', name: 'Local' },
      worker: { id: 'w', name: 'Ana' },
      allocationCount: 1,
      amount: 1000,
      oldestBusinessDate: '2026-10-01',
      newestBusinessDate: '2026-10-01',
      deadline: '2026-10-12',
      daysOverdue: 2,
      ...overrides,
    });
    expect(summarizeTipPaymentAlerts([])).toEqual({
      alertCount: 0,
      allocationCount: 0,
      amount: 0,
      oldestBusinessDate: null,
      newestBusinessDate: null,
      maxDaysOverdue: 0,
    });
    expect(
      summarizeTipPaymentAlerts([
        alert({ allocationCount: 2, amount: 3000, daysOverdue: 5 }),
        alert({
          oldestBusinessDate: '2026-09-28',
          newestBusinessDate: '2026-10-03',
          amount: 500,
        }),
      ]),
    ).toEqual({
      alertCount: 2,
      allocationCount: 3,
      amount: 3500,
      oldestBusinessDate: '2026-09-28',
      newestBusinessDate: '2026-10-03',
      maxDaysOverdue: 5,
    });
  });
});
