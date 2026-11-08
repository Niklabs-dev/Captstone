import { MrComandaReportError } from '../src/sales-imports/parser/mrcomanda-report.errors.js';
import { parseMrComandaReport } from '../src/sales-imports/parser/mrcomanda-report.parser.js';
import type { ReportSheet } from '../src/sales-imports/parser/mrcomanda-report.types.js';
import {
  buildReportSheet,
  FIXTURE_FILTERS,
  FIXTURE_STORE,
  FIXTURE_TOTAL,
  type ReportFixtureOptions,
} from './helpers/mrcomanda-report-fixture.js';

// Pruebas del parser del «Informe de Ventas Diario» de MrComanda
// (SPRINT-4R-T09) sobre filas ficticias con la estructura del reporte real.

function parse(options: ReportFixtureOptions = {}) {
  return parseMrComandaReport([buildReportSheet(options)]);
}

function expectError(fn: () => unknown, code: string): MrComandaReportError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MrComandaReportError);
    const reportError = error as MrComandaReportError;
    expect(reportError.code).toBe(code);
    expect(reportError.message.length).toBeGreaterThan(20);
    return reportError;
  }
  throw new Error(`Se esperaba el error ${code} y el parser no falló`);
}

describe('parseMrComandaReport (SPRINT-4R-T09)', () => {
  describe('reporte válido', () => {
    it('lee período, horario, local, total y las cuatro líneas de medios de pago', () => {
      const report = parse();

      expect(report.sheetName).toBe('Informe_ventas_diario');
      expect(report.businessDate).toBe('2026-03-14');
      // 00:00:00 y 23:59:59 en Chile (UTC-3 en marzo).
      expect(report.periodStart.toISOString()).toBe('2026-03-14T03:00:00.000Z');
      expect(report.periodEnd.toISOString()).toBe('2026-03-15T02:59:59.000Z');
      expect(report.externalStoreLabel).toBe(FIXTURE_STORE);
      expect(report.externalStoreCode).toBe('901 - 12345');
      expect(report.totalAmount).toBe(FIXTURE_TOTAL);
      expect(report.lines).toEqual([
        {
          lineNumber: 1,
          rowNumber: 10,
          originalLabel: 'T. DEBITO',
          normalizedLabel: 'T. DEBITO',
          amount: 400_000,
          percentage: 61.54,
        },
        {
          lineNumber: 2,
          rowNumber: 11,
          originalLabel: 'EFECTIVO',
          normalizedLabel: 'EFECTIVO',
          amount: 150_000,
          percentage: 23.08,
        },
        {
          lineNumber: 3,
          rowNumber: 12,
          originalLabel: 'T. CREDITO',
          normalizedLabel: 'T. CREDITO',
          amount: 100_000,
          percentage: 15.38,
        },
        {
          lineNumber: 4,
          rowNumber: 13,
          originalLabel: 'N.de Créd.',
          normalizedLabel: 'N.DE CRED.',
          amount: 0,
          percentage: 0,
        },
      ]);
    });

    it('toma la fecha del «Período» y no de la fecha de emisión', () => {
      const report = parse({ emitted: 'Fecha 20/03/2026 - 11:14:55' });
      expect(report.businessDate).toBe('2026-03-14');
      // La emisión se conserva solo como dato informativo (SPRINT-4R-T10).
      expect(report.issuedAt?.toISOString()).toBe('2026-03-20T14:14:55.000Z');
    });

    it('la fecha de emisión es opcional', () => {
      expect(parse({ emitted: null }).issuedAt).toBeNull();
    });

    it('rechaza una fecha de emisión ilegible', () => {
      expectError(
        () => parse({ emitted: 'Fecha 32/13/2026 - 11:14:55' }),
        'ISSUED_AT_INVALID',
      );
    });

    it('acepta un período de una sola fecha y reportes sin título ni emisión', () => {
      const report = parse({
        period: '14/03/2026',
        title: null,
        emitted: null,
      });
      expect(report.businessDate).toBe('2026-03-14');
    });

    it('admite nuevos medios sin limitarse a cuatro', () => {
      const report = parse({
        paymentsTotal: 700_000,
        lines: [
          { label: 'T. DEBITO', amount: 400_000 },
          { label: 'EFECTIVO', amount: 150_000 },
          { label: 'T. CREDITO', amount: 100_000 },
          { label: 'JUNAEB', amount: 30_000 },
          { label: 'TRANSFERENCIA', amount: 20_000 },
        ],
      });
      expect(report.lines.map((line) => line.normalizedLabel)).toEqual([
        'T. DEBITO',
        'EFECTIVO',
        'T. CREDITO',
        'JUNAEB',
        'TRANSFERENCIA',
      ]);
      // Sin porcentajes en el reporte, quedan en null.
      expect(report.lines.every((line) => line.percentage === null)).toBe(true);
    });

    it('lee montos en texto con formato CLP y notas de crédito negativas', () => {
      const report = parse({
        paymentsTotal: '$ 645.000',
        lines: [
          { label: 'T. DEBITO', amount: '$ 400.000' },
          { label: 'EFECTIVO', amount: 150_000 },
          { label: 'T. CREDITO', amount: '100000' },
          { label: 'N.de Créd.', amount: '-$ 5.000' },
        ],
      });
      expect(report.totalAmount).toBe(645_000);
      expect(report.lines.map((line) => line.amount)).toEqual([
        400_000, 150_000, 100_000, -5_000,
      ]);
    });

    it('termina la sección en la siguiente sección aunque no haya fila vacía', () => {
      const report = parse({ blankAfterPayments: false });
      expect(report.lines).toHaveLength(4);
    });

    it('ignora «Venta por depto.» aunque su total sea distinto', () => {
      // El fixture trae «Venta por depto.» con 600.000 frente a 650.000.
      expect(parse().totalAmount).toBe(FIXTURE_TOTAL);
    });

    it('un horario que cruza la medianoche termina al día siguiente', () => {
      const report = parse({ schedule: '10:00:00 a 02:00:00' });
      expect(report.businessDate).toBe('2026-03-14');
      expect(report.periodStart.toISOString()).toBe('2026-03-14T13:00:00.000Z');
      expect(report.periodEnd.toISOString()).toBe('2026-03-15T05:00:00.000Z');
    });

    it('usa el desfase de invierno de Chile (UTC-4) cuando corresponde', () => {
      const report = parse({
        period: '05/07/2026 al 05/07/2026',
        title: null,
      });
      expect(report.businessDate).toBe('2026-07-05');
      expect(report.periodStart.toISOString()).toBe('2026-07-05T04:00:00.000Z');
    });

    it('busca el informe en la hoja que tiene «Medios de pago»', () => {
      const other: ReportSheet = {
        name: 'Notas',
        rows: [['Hoja auxiliar sin datos de ventas']],
      };
      const report = parseMrComandaReport([other, buildReportSheet()]);
      expect(report.sheetName).toBe('Informe_ventas_diario');
    });
  });

  describe('estructura irreconocible', () => {
    it('rechaza un archivo sin la sección «Medios de pago»', () => {
      expectError(
        () =>
          parseMrComandaReport([
            {
              name: 'Hoja1',
              rows: [
                ['Nombre', 'Monto'],
                ['Juan', 100],
              ],
            },
          ]),
        'REPORT_NOT_FOUND',
      );
    });

    it('rechaza dos informes en hojas distintas', () => {
      expectError(
        () =>
          parseMrComandaReport([
            buildReportSheet({}, 'Dia 1'),
            buildReportSheet({}, 'Dia 2'),
          ]),
        'MULTIPLE_REPORTS',
      );
    });

    it('rechaza el reporte sin «Período»', () => {
      expectError(() => parse({ period: null }), 'PERIOD_MISSING');
    });

    it('rechaza un período ilegible o con fecha inexistente', () => {
      expectError(() => parse({ period: 'ayer' }), 'PERIOD_INVALID');
      expectError(
        () => parse({ period: '31/02/2026 al 31/02/2026', title: null }),
        'PERIOD_INVALID',
      );
    });

    it('rechaza períodos de más de un día con un mensaje accionable', () => {
      const error = expectError(
        () => parse({ period: '14/03/2026 al 15/03/2026', title: null }),
        'PERIOD_MULTIPLE_DAYS',
      );
      expect(error.message).toContain('un informe por día');
      expect(error.row).toBe(6);
    });

    it('rechaza un título que contradice el período', () => {
      expectError(
        () =>
          parse({ title: 'Informe de Ventas Diario 13/03/2026 - 13/03/2026' }),
        'PERIOD_INCONSISTENT',
      );
    });

    it('rechaza el reporte sin «Horario» o con un horario inválido', () => {
      expectError(() => parse({ schedule: null }), 'SCHEDULE_MISSING');
      expectError(
        () => parse({ schedule: '25:00:00 a 23:59:59' }),
        'SCHEDULE_INVALID',
      );
      expectError(
        () => parse({ schedule: '08:00:00 a 08:00:00' }),
        'SCHEDULE_INVALID',
      );
    });

    it('rechaza el reporte sin local', () => {
      expectError(
        () => parse({ filters: ' - Todas las Empresas - Todos los Sectores' }),
        'STORE_MISSING',
      );
    });

    it('rechaza reportes de todos los locales o de locales combinados', () => {
      expectError(
        () =>
          parse({
            filters: FIXTURE_FILTERS.replace(
              `Local: ${FIXTURE_STORE}`,
              'Local: Todos los locales',
            ),
          }),
        'STORE_COMBINED',
      );
      expectError(
        () =>
          parse({
            filters: FIXTURE_FILTERS.replace(
              `Local: ${FIXTURE_STORE}`,
              'Locales: 901 - 12345, 902 - 67890',
            ),
          }),
        'STORE_COMBINED',
      );
    });

    it('rechaza un encabezado con dos locales', () => {
      expectError(
        () =>
          parse({
            filters: `${FIXTURE_FILTERS} - Local: 902 - 67890`,
          }),
        'STORE_AMBIGUOUS',
      );
    });
  });

  describe('montos y totales', () => {
    it('rechaza un total de sección ausente', () => {
      expectError(
        () => parse({ paymentsTotal: null }),
        'PAYMENTS_TOTAL_INVALID',
      );
    });

    it('rechaza una sección sin medios de pago', () => {
      expectError(
        () => parse({ lines: [], paymentsTotal: 0 }),
        'PAYMENT_LINES_MISSING',
      );
    });

    it('rechaza montos no enteros o ilegibles indicando la fila', () => {
      const error = expectError(
        () =>
          parse({
            lines: [
              { label: 'T. DEBITO', amount: 400_000.5 },
              { label: 'EFECTIVO', amount: 249_999.5 },
            ],
          }),
        'LINE_AMOUNT_INVALID',
      );
      expect(error.row).toBe(10);
      expectError(
        () =>
          parse({
            lines: [
              { label: 'T. DEBITO', amount: 'cuatrocientos mil' },
              { label: 'EFECTIVO', amount: 250_000 },
            ],
          }),
        'LINE_AMOUNT_INVALID',
      );
      expectError(
        () =>
          parse({
            lines: [
              { label: 'T. DEBITO', amount: null },
              { label: 'EFECTIVO', amount: 650_000 },
            ],
          }),
        'LINE_AMOUNT_INVALID',
      );
    });

    it('rechaza porcentajes fuera de rango', () => {
      expectError(
        () =>
          parse({
            paymentsTotal: 650_000,
            lines: [{ label: 'EFECTIVO', amount: 650_000, percentage: 150 }],
          }),
        'LINE_PERCENTAGE_INVALID',
      );
    });

    it('rechaza un medio de pago repetido', () => {
      expectError(
        () =>
          parse({
            lines: [
              { label: 'EFECTIVO', amount: 325_000 },
              { label: 'Efectivo  ', amount: 325_000 },
            ],
          }),
        'LINE_DUPLICATED',
      );
    });

    it('rechaza una línea sin nombre de medio de pago', () => {
      expectError(
        () =>
          parse({
            lines: [
              { label: 'EFECTIVO', amount: 650_000 },
              { label: '   ', amount: 1 },
            ],
          }),
        'LINE_LABEL_INVALID',
      );
    });

    it('rechaza totales inconsistentes mostrando ambos montos', () => {
      const error = expectError(
        () => parse({ paymentsTotal: 650_001 }),
        'TOTAL_MISMATCH',
      );
      expect(error.message).toContain('$650.000');
      expect(error.message).toContain('$650.001');
    });
  });
});
