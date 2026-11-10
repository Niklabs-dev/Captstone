import type { CellObject, Row } from 'write-excel-file/node';
import type { DailyTipAllocationFact } from '../types/daily-tips.types.js';
import {
  buildDailyTipsWorkbook,
  buildExportFileName,
  CLP_FORMAT,
  DETAIL_SHEET,
  displayDate,
  listPeriodDays,
  storeSlug,
  SUMMARY_SHEET,
  SUMMARY_TOTAL_LABEL,
} from './daily-tips-workbook.js';

// Contenido del Excel de propinas del período (SPRINT-4A-T05) con datos
// ficticios: estructura de las hojas, montos numéricos con formato CLP y
// totales que cuadran por trabajador, por día y en general.

function tip(
  id: string,
  businessDate: string,
  workerId: string,
  name: string,
  amount: number,
  paymentBatchId: string | null = null,
): DailyTipAllocationFact {
  return {
    id,
    operationId: `op-${businessDate}`,
    businessDate,
    worker: { id: workerId, name },
    amount,
    status: paymentBatchId ? 'PAID' : 'UNPAID',
    paymentBatchId,
  };
}

const ALLOCATIONS: DailyTipAllocationFact[] = [
  tip('t1', '2026-11-03', 'w-ana', 'Ana Ficticia', 10_000, 'lote-1'),
  tip('t2', '2026-11-03', 'w-beto', 'Beto Ficticio', 10_000, 'lote-1'),
  tip('t3', '2026-11-05', 'w-ana', 'Ana Ficticia', 3_334),
  tip('t4', '2026-11-05', 'w-beto', 'Beto Ficticio', 3_333),
  tip('t5', '2026-11-05', 'w-carla', 'Carla Ficticia', 3_333),
];

function cell(row: Row, index: number): CellObject {
  const value = row[index];
  if (typeof value !== 'object' || value === null || value instanceof Date) {
    throw new Error(`La celda ${index} no es un objeto`);
  }
  return value as CellObject;
}

function values(row: Row): unknown[] {
  return row.map((_, index) => cell(row, index).value);
}

describe('Excel de propinas del período (SPRINT-4A-T05)', () => {
  it('lista los días corridos del período, ambos extremos incluidos', () => {
    expect(listPeriodDays('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(listPeriodDays('2026-11-03', '2026-11-03')).toEqual(['2026-11-03']);
    expect(displayDate('2026-11-03')).toBe('03-11-2026');
  });

  it('nombra el archivo con el local en slug seguro y las fechas', () => {
    expect(storeSlug('Subway Melipilla Centro')).toBe(
      'subway-melipilla-centro',
    );
    expect(storeSlug('  Peñaflor / Café «Ñuñoa»  ')).toBe(
      'penaflor-cafe-nunoa',
    );
    expect(storeSlug('¿¡!?')).toBe('local');
    expect(storeSlug('a'.repeat(80))).toHaveLength(60);
    expect(
      buildExportFileName('Subway Calera', '2026-11-01', '2026-11-15'),
    ).toBe('propinas_subway-calera_2026-11-01_2026-11-15.xlsx');
  });

  it('Resumen: trabajador y RUT, una columna por día, totales por trabajador, por día y general', () => {
    const [summary] = buildDailyTipsWorkbook({
      from: '2026-11-03',
      to: '2026-11-05',
      allocations: ALLOCATIONS,
      rutByWorker: new Map([
        ['w-ana', '11111111-1'],
        ['w-beto', '22222222-2'],
        ['w-carla', null],
      ]),
    });
    expect(summary.name).toBe(SUMMARY_SHEET);
    expect(summary.rows.map(values)).toEqual([
      ['Trabajador', 'RUT', '03-11-2026', '04-11-2026', '05-11-2026', 'Total'],
      ['Ana Ficticia', '11111111-1', 10_000, 0, 3_334, 13_334],
      ['Beto Ficticio', '22222222-2', 10_000, 0, 3_333, 13_333],
      ['Carla Ficticia', '', 0, 0, 3_333, 3_333],
      [SUMMARY_TOTAL_LABEL, '', 20_000, 0, 10_000, 30_000],
    ]);
    // Todos los montos son números con formato CLP, nunca texto.
    for (const row of summary.rows.slice(1)) {
      for (let index = 2; index < row.length; index += 1) {
        expect(cell(row, index).type).toBe(Number);
        expect(cell(row, index).format).toBe(CLP_FORMAT);
      }
    }
    expect(summary.stickyRowsCount).toBe(1);
    expect(summary.stickyColumnsCount).toBe(2);
    expect(summary.columnWidths).toHaveLength(6);
  });

  it('Detalle: fecha, trabajador, monto, estado y lote de pago', () => {
    const [, detail] = buildDailyTipsWorkbook({
      from: '2026-11-03',
      to: '2026-11-05',
      allocations: ALLOCATIONS,
      rutByWorker: new Map(),
    });
    expect(detail.name).toBe(DETAIL_SHEET);
    const rows = detail.rows.map(values);
    expect(rows[0]).toEqual([
      'Fecha',
      'Trabajador',
      'Monto',
      'Estado',
      'Lote de pago',
    ]);
    expect(rows.slice(1)).toEqual([
      [
        new Date('2026-11-03T00:00:00.000Z'),
        'Ana Ficticia',
        10_000,
        'Pagada',
        'lote-1',
      ],
      [
        new Date('2026-11-03T00:00:00.000Z'),
        'Beto Ficticio',
        10_000,
        'Pagada',
        'lote-1',
      ],
      [
        new Date('2026-11-05T00:00:00.000Z'),
        'Ana Ficticia',
        3_334,
        'No pagada',
        '',
      ],
      [
        new Date('2026-11-05T00:00:00.000Z'),
        'Beto Ficticio',
        3_333,
        'No pagada',
        '',
      ],
      [
        new Date('2026-11-05T00:00:00.000Z'),
        'Carla Ficticia',
        3_333,
        'No pagada',
        '',
      ],
    ]);
    expect(cell(detail.rows[1], 2)).toMatchObject({
      type: Number,
      format: CLP_FORMAT,
    });
  });

  it('un período sin propinas deja solo encabezado y totales en 0', () => {
    const [summary, detail] = buildDailyTipsWorkbook({
      from: '2026-11-01',
      to: '2026-11-02',
      allocations: [],
      rutByWorker: new Map(),
    });
    expect(summary.rows.map(values)).toEqual([
      ['Trabajador', 'RUT', '01-11-2026', '02-11-2026', 'Total'],
      [SUMMARY_TOTAL_LABEL, '', 0, 0, 0],
    ]);
    expect(detail.rows).toHaveLength(1);
  });
});
