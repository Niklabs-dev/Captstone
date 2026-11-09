import {
  isoWeekdayOf,
  type IsoWeekday,
  type OperatingCalendar,
  salesDayStatus,
  type SalesDayInput,
} from './sales-day-status.js';

// Lunes a sábado; domingo cerrado. 2026-11-08 es domingo.
const CALENDAR: OperatingCalendar = {
  openWeekdays: new Set<IsoWeekday>([1, 2, 3, 4, 5, 6]),
  trackingStartDate: '2026-11-01',
};

function status(overrides: Partial<SalesDayInput>) {
  return salesDayStatus({
    date: '2026-11-05',
    today: '2026-11-06',
    calendar: CALENDAR,
    hasClosure: false,
    hasActiveImport: false,
    ...overrides,
  });
}

describe('salesDayStatus (SPRINT-4R-T12)', () => {
  it('calcula el día de la semana ISO sin depender de la zona horaria', () => {
    expect(isoWeekdayOf('2026-11-02')).toBe(1); // lunes
    expect(isoWeekdayOf('2026-11-07')).toBe(6); // sábado
    expect(isoWeekdayOf('2026-11-08')).toBe(7); // domingo
  });

  it('un día abierto de hoy sin archivo queda PENDIENTE', () => {
    expect(status({ date: '2026-11-06', today: '2026-11-06' })).toBe(
      'PENDIENTE',
    );
  });

  it('desde el día siguiente pasa a ATRASADO', () => {
    expect(status({ date: '2026-11-05', today: '2026-11-06' })).toBe(
      'ATRASADO',
    );
    expect(status({ date: '2026-11-02', today: '2026-11-06' })).toBe(
      'ATRASADO',
    );
  });

  it('una importación vigente lo resuelve, también si llega tarde', () => {
    expect(status({ hasActiveImport: true })).toBe('IMPORTADO');
    expect(
      status({
        date: '2026-11-06',
        today: '2026-11-06',
        hasActiveImport: true,
      }),
    ).toBe('IMPORTADO');
  });

  it('el cierre semanal nunca es alerta', () => {
    expect(status({ date: '2026-11-08', today: '2026-11-08' })).toBe('CERRADO');
    expect(status({ date: '2026-11-08', today: '2026-11-10' })).toBe('CERRADO');
  });

  it('el cierre por excepción nunca es alerta', () => {
    expect(status({ hasClosure: true })).toBe('CERRADO');
    expect(
      status({ date: '2026-11-06', today: '2026-11-06', hasClosure: true }),
    ).toBe('CERRADO');
  });

  it('con importación, un día cerrado igual se informa como IMPORTADO', () => {
    expect(
      status({
        date: '2026-11-08',
        today: '2026-11-09',
        hasActiveImport: true,
      }),
    ).toBe('IMPORTADO');
    expect(status({ hasClosure: true, hasActiveImport: true })).toBe(
      'IMPORTADO',
    );
  });

  it('no informa días futuros', () => {
    expect(status({ date: '2026-11-07', today: '2026-11-06' })).toBeNull();
    expect(
      status({
        date: '2026-11-07',
        today: '2026-11-06',
        hasActiveImport: true,
      }),
    ).toBeNull();
  });

  it('no informa días anteriores a la fecha de inicio', () => {
    expect(status({ date: '2026-10-31', today: '2026-11-06' })).toBeNull();
    expect(status({ date: '2026-11-01', today: '2026-11-06' })).toBe('CERRADO'); // domingo
    expect(status({ date: '2026-11-02', today: '2026-11-06' })).toBe(
      'ATRASADO',
    );
  });

  it('sin calendario no hay alertas, pero lo importado se ve', () => {
    expect(status({ calendar: null })).toBeNull();
    expect(status({ calendar: null, hasClosure: true })).toBeNull();
    expect(status({ calendar: null, hasActiveImport: true })).toBe('IMPORTADO');
  });

  it('cambia de PENDIENTE a ATRASADO justo al cambiar el día de negocio', () => {
    const date = '2026-11-06';
    expect(status({ date, today: '2026-11-06' })).toBe('PENDIENTE');
    expect(status({ date, today: '2026-11-07' })).toBe('ATRASADO');
  });

  it('cruza fin de mes y de año', () => {
    const calendar: OperatingCalendar = {
      openWeekdays: new Set<IsoWeekday>([1, 2, 3, 4, 5, 6, 7]),
      trackingStartDate: '2026-12-01',
    };
    expect(status({ calendar, date: '2026-12-31', today: '2027-01-01' })).toBe(
      'ATRASADO',
    );
    expect(status({ calendar, date: '2027-01-01', today: '2027-01-01' })).toBe(
      'PENDIENTE',
    );
  });
});
