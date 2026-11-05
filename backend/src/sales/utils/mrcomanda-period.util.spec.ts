import { BadRequestException } from '@nestjs/common';
import {
  calendarDateToUtcDate,
  parseMrComandaPeriod,
} from './mrcomanda-period.util.js';

describe('parseMrComandaPeriod', () => {
  it('acepta un período con zona horaria dentro de un mismo día chileno', () => {
    const period = parseMrComandaPeriod(
      '2026-03-10T08:00:00-03:00',
      '2026-03-10T14:00:00-03:00',
    );
    expect(period.start.toISOString()).toBe('2026-03-10T11:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-03-10T17:00:00.000Z');
    expect(period.businessDate).toEqual({ year: 2026, month: 3, day: 10 });
  });

  it('acepta un período expresado en UTC cuando cae en el día chileno', () => {
    const period = parseMrComandaPeriod(
      '2026-03-10T12:00:00Z',
      '2026-03-10T20:00:00Z',
    );
    // 12:00 UTC = 09:00 en Chile (horario de verano, GMT-3).
    expect(period.businessDate).toEqual({ year: 2026, month: 3, day: 10 });
  });

  it('rechaza un período sin zona horaria explícita', () => {
    expect(() =>
      parseMrComandaPeriod('2026-03-10T08:00:00', '2026-03-10T14:00:00'),
    ).toThrow(BadRequestException);
    expect(() =>
      parseMrComandaPeriod('2026-03-10T08:00:00-03:00', '2026-03-10T14:00:00'),
    ).toThrow(BadRequestException);
  });

  it('rechaza una fecha-hora inválida', () => {
    expect(() =>
      parseMrComandaPeriod(
        '2026-03-10T25:00:00-03:00',
        '2026-03-10T14:00:00-03:00',
      ),
    ).toThrow(BadRequestException);
  });

  it('rechaza un fin anterior o igual al inicio', () => {
    expect(() =>
      parseMrComandaPeriod(
        '2026-03-10T14:00:00-03:00',
        '2026-03-10T14:00:00-03:00',
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      parseMrComandaPeriod(
        '2026-03-10T14:00:00-03:00',
        '2026-03-10T08:00:00-03:00',
      ),
    ).toThrow(BadRequestException);
  });

  it('rechaza un período que cruza la medianoche chilena', () => {
    // 23:00 del 10 es el mismo día en Chile, pero 01:00 del 11 ya es otro.
    expect(() =>
      parseMrComandaPeriod(
        '2026-03-10T23:00:00-03:00',
        '2026-03-11T01:00:00-03:00',
      ),
    ).toThrow(BadRequestException);
  });

  it('rechaza un período que cruza la medianoche aunque en UTC caiga el mismo día', () => {
    // 23:30-03:00 = 02:30 UTC del 11 y 00:30-03:00 = 03:30 UTC del 11: en
    // UTC comparten día, pero en Chile ya cambió el día de negocio.
    expect(() =>
      parseMrComandaPeriod(
        '2026-03-10T23:30:00-03:00',
        '2026-03-11T00:30:00-03:00',
      ),
    ).toThrow(BadRequestException);
  });

  it('acepta el fin exclusivo exactamente a medianoche del día siguiente', () => {
    // El fin exclusivo en 00:00 del día siguiente es el corte del día
    // completo: no cruza de día de negocio, lo cierra.
    const period = parseMrComandaPeriod(
      '2026-03-10T08:00:00-03:00',
      '2026-03-11T00:00:00-03:00',
    );
    expect(period.businessDate).toEqual({ year: 2026, month: 3, day: 10 });
    expect(period.end.toISOString()).toBe('2026-03-11T03:00:00.000Z');
  });

  it('acepta el día completo de 00:00 a la medianoche exclusiva siguiente', () => {
    const period = parseMrComandaPeriod(
      '2026-03-10T00:00:00-03:00',
      '2026-03-11T00:00:00-03:00',
    );
    expect(period.businessDate).toEqual({ year: 2026, month: 3, day: 10 });
  });

  it('rechaza el fin un segundo después de la medianoche del día siguiente', () => {
    // 00:00:01 del 11 ya pertenece al día de negocio siguiente: el rango
    // realmente cruza de día y no es un cierre de día completo.
    expect(() =>
      parseMrComandaPeriod(
        '2026-03-10T08:00:00-03:00',
        '2026-03-11T00:00:01-03:00',
      ),
    ).toThrow(BadRequestException);
  });
});

describe('calendarDateToUtcDate', () => {
  it('produce la medianoche UTC con la misma parte de fecha', () => {
    expect(calendarDateToUtcDate({ year: 2026, month: 3, day: 10 })).toEqual(
      new Date('2026-03-10T00:00:00.000Z'),
    );
  });
});
