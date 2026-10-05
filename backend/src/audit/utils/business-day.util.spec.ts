import {
  BUSINESS_TIME_ZONE,
  businessDayRange,
  parseCalendarDate,
  startOfDay,
} from './business-day.util.js';

// Tests unitarios de la conversión de fechas de negocio (SPRINT-1-T14).
// Fechas de referencia de Chile continental (America/Santiago):
// - Horario de invierno UTC-4 y de verano UTC-3.
// - 2026-04-05: fin del horario de verano (24:00 del 04-04 vuelve a 23:00).
// - 2026-09-06: inicio del horario de verano (24:00 del 05-09 salta a 01:00).

describe('parseCalendarDate', () => {
  it('interpreta una fecha YYYY-MM-DD válida', () => {
    expect(parseCalendarDate('2026-10-05')).toEqual({
      year: 2026,
      month: 10,
      day: 5,
    });
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29'])(
    'rechaza la fecha inexistente %s',
    (value) => {
      expect(parseCalendarDate(value)).toBeNull();
    },
  );

  it.each(['05-10-2026', '2026-10-5', '2026-10-05T00:00:00Z', ''])(
    'rechaza el formato inválido "%s"',
    (value) => {
      expect(parseCalendarDate(value)).toBeNull();
    },
  );

  it('acepta el 29 de febrero de un año bisiesto', () => {
    expect(parseCalendarDate('2028-02-29')).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });
});

describe('startOfDay', () => {
  it('usa la zona de Chile por defecto', () => {
    expect(BUSINESS_TIME_ZONE).toBe('America/Santiago');
  });

  it('en horario de verano el día empieza a las 03:00 UTC', () => {
    expect(startOfDay({ year: 2026, month: 10, day: 5 }).toISOString()).toBe(
      '2026-10-05T03:00:00.000Z',
    );
  });

  it('en horario de invierno el día empieza a las 04:00 UTC', () => {
    expect(startOfDay({ year: 2026, month: 7, day: 15 }).toISOString()).toBe(
      '2026-07-15T04:00:00.000Z',
    );
  });

  it('el día en que empieza el horario de verano comienza a la 01:00 local (no existe la medianoche)', () => {
    expect(startOfDay({ year: 2026, month: 9, day: 6 }).toISOString()).toBe(
      '2026-09-06T04:00:00.000Z',
    );
  });

  it('el día siguiente al fin del horario de verano comienza a la medianoche en UTC-4', () => {
    expect(startOfDay({ year: 2026, month: 4, day: 5 }).toISOString()).toBe(
      '2026-04-05T04:00:00.000Z',
    );
  });

  it('respeta la zona horaria indicada', () => {
    expect(
      startOfDay({ year: 2026, month: 10, day: 5 }, 'UTC').toISOString(),
    ).toBe('2026-10-05T00:00:00.000Z');
  });
});

describe('businessDayRange', () => {
  it('cubre el día completo en Chile: desde su inicio hasta el inicio del día siguiente', () => {
    const day = { year: 2026, month: 10, day: 5 };
    const range = businessDayRange(day, day);
    expect(range.start?.toISOString()).toBe('2026-10-05T03:00:00.000Z');
    expect(range.end?.toISOString()).toBe('2026-10-06T03:00:00.000Z');
  });

  it('el día del fin del horario de verano dura 25 horas', () => {
    const day = { year: 2026, month: 4, day: 4 };
    const { start, end } = businessDayRange(day, day);
    expect(start?.toISOString()).toBe('2026-04-04T03:00:00.000Z');
    expect(end?.toISOString()).toBe('2026-04-05T04:00:00.000Z');
  });

  it('el día del inicio del horario de verano dura 23 horas', () => {
    const day = { year: 2026, month: 9, day: 6 };
    const { start, end } = businessDayRange(day, day);
    expect(start?.toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect(end?.toISOString()).toBe('2026-09-07T03:00:00.000Z');
  });

  it('cruza fin de mes y de año', () => {
    const range = businessDayRange(
      { year: 2026, month: 12, day: 31 },
      { year: 2026, month: 12, day: 31 },
    );
    expect(range.end?.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('deja abierto el extremo que no se indica', () => {
    const day = { year: 2026, month: 10, day: 5 };
    expect(businessDayRange(day, null)).toEqual({
      start: new Date('2026-10-05T03:00:00.000Z'),
      end: undefined,
    });
    expect(businessDayRange(null, day)).toEqual({
      start: undefined,
      end: new Date('2026-10-06T03:00:00.000Z'),
    });
    expect(businessDayRange(null, null)).toEqual({
      start: undefined,
      end: undefined,
    });
  });
});
