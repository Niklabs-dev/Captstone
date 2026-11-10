import type { Cell, Row } from 'write-excel-file/node';
import {
  sumTipAmounts,
  summarizeByWorker,
} from '../calculation/daily-tips-aggregation.js';
import type {
  DailyTipAllocationFact,
  TipAllocationStatusCode,
} from '../types/daily-tips.types.js';

// Contenido del Excel de propinas del período (SPRINT-4A-T05). Funciones
// puras, sin NestJS, base de datos ni la librería de escritura: arman las
// hojas «Resumen» y «Detalle» a partir de las propinas diarias que lee
// DailyTipsService.findAllocations, con la misma agregación que la API
// (summarizeByWorker y sumTipAmounts), así los totales del archivo cuadran
// con GET /daily-tips/summary. Los montos son celdas numéricas con formato
// CLP, nunca texto.

export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/// Formato de moneda CLP (peso chileno, sin decimales; 340A = es-CL).
export const CLP_FORMAT = '[$$-340A]#,##0';

/// Formato de las fechas de la hoja «Detalle».
export const DATE_FORMAT = 'dd-mm-yyyy';

export const SUMMARY_SHEET = 'Resumen';
export const DETAIL_SHEET = 'Detalle';

export const SUMMARY_TOTAL_LABEL = 'Total por día';

export const STATUS_LABEL: Record<TipAllocationStatusCode, string> = {
  UNPAID: 'No pagada',
  PAID: 'Pagada',
};

const MAX_SLUG_LENGTH = 60;

export interface DailyTipsWorkbookInput {
  /** Desde y hasta (YYYY-MM-DD, inclusive). */
  from: string;
  to: string;
  /** Propinas del local en el rango, ordenadas por fecha y nombre. */
  allocations: readonly DailyTipAllocationFact[];
  /** RUT de cada trabajador (null si no lo tiene registrado). */
  rutByWorker: ReadonlyMap<string, string | null>;
}

/// Hoja lista para escribir: filas, ancho de columnas y filas/columnas fijas.
export interface WorkbookSheet {
  name: string;
  rows: Row[];
  columnWidths: number[];
  stickyRowsCount: number;
  stickyColumnsCount: number;
}

// Días corridos del período (YYYY-MM-DD), ambos extremos incluidos.
export function listPeriodDays(from: string, to: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${to}T00:00:00.000Z`);
  for (
    let current = Date.parse(`${from}T00:00:00.000Z`);
    current <= end;
    current += 86_400_000
  ) {
    days.push(new Date(current).toISOString().slice(0, 10));
  }
  return days;
}

// YYYY-MM-DD → DD-MM-YYYY (encabezados de la hoja «Resumen»).
export function displayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}

// Nombre del local en un slug seguro para el nombre del archivo: sin tildes
// (la ñ queda n), en minúsculas, solo letras, números y guiones.
export function storeSlug(storeName: string): string {
  const slug = storeName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'local';
}

// propinas_<local>_<desde>_<hasta>.xlsx, con fechas YYYY-MM-DD.
export function buildExportFileName(
  storeName: string,
  from: string,
  to: string,
): string {
  return `propinas_${storeSlug(storeName)}_${from}_${to}.xlsx`;
}

function header(value: string): Cell {
  return { value, fontWeight: 'bold', backgroundColor: '#E2EFDA' };
}

function amount(value: number, bold = false): Cell {
  return {
    value,
    type: Number,
    format: CLP_FORMAT,
    ...(bold ? { fontWeight: 'bold' as const } : {}),
  };
}

function text(value: string, bold = false): Cell {
  return {
    value,
    type: String,
    ...(bold ? { fontWeight: 'bold' as const } : {}),
  };
}

// Hoja «Resumen»: una fila por trabajador (nombre y RUT), una columna por
// día del período y su total; al final, el total por día y el total general.
export function buildSummarySheet(
  input: DailyTipsWorkbookInput,
): WorkbookSheet {
  const days = listPeriodDays(input.from, input.to);
  const workers = summarizeByWorker(input.allocations);
  const byWorkerAndDay = new Map<string, DailyTipAllocationFact[]>();
  const byDay = new Map<string, DailyTipAllocationFact[]>();
  const push = (
    map: Map<string, DailyTipAllocationFact[]>,
    key: string,
    allocation: DailyTipAllocationFact,
  ): void => {
    const list = map.get(key);
    if (list) list.push(allocation);
    else map.set(key, [allocation]);
  };
  for (const allocation of input.allocations) {
    push(
      byWorkerAndDay,
      `${allocation.worker.id}|${allocation.businessDate}`,
      allocation,
    );
    push(byDay, allocation.businessDate, allocation);
  }

  const rows: Row[] = [
    [
      header('Trabajador'),
      header('RUT'),
      ...days.map((day) => header(displayDate(day))),
      header('Total'),
    ],
  ];
  for (const summary of workers) {
    rows.push([
      text(summary.worker.name),
      text(input.rutByWorker.get(summary.worker.id) ?? ''),
      ...days.map((day) =>
        amount(
          sumTipAmounts(byWorkerAndDay.get(`${summary.worker.id}|${day}`) ?? [])
            .totalAmount,
        ),
      ),
      amount(summary.totalAmount, true),
    ]);
  }
  rows.push([
    text(SUMMARY_TOTAL_LABEL, true),
    text('', true),
    ...days.map((day) =>
      amount(sumTipAmounts(byDay.get(day) ?? []).totalAmount, true),
    ),
    amount(sumTipAmounts(input.allocations).totalAmount, true),
  ]);

  return {
    name: SUMMARY_SHEET,
    rows,
    columnWidths: [28, 13, ...days.map(() => 12), 14],
    stickyRowsCount: 1,
    stickyColumnsCount: 2,
  };
}

// Hoja «Detalle»: una fila por propina diaria con fecha, trabajador, monto,
// estado (No pagada/Pagada) y lote de pago (vacío si está pendiente).
export function buildDetailSheet(input: DailyTipsWorkbookInput): WorkbookSheet {
  const rows: Row[] = [
    [
      header('Fecha'),
      header('Trabajador'),
      header('Monto'),
      header('Estado'),
      header('Lote de pago'),
    ],
  ];
  for (const allocation of input.allocations) {
    rows.push([
      {
        value: new Date(`${allocation.businessDate}T00:00:00.000Z`),
        type: Date,
        format: DATE_FORMAT,
      },
      text(allocation.worker.name),
      amount(allocation.amount),
      text(STATUS_LABEL[allocation.status]),
      text(allocation.paymentBatchId ?? ''),
    ]);
  }
  return {
    name: DETAIL_SHEET,
    rows,
    columnWidths: [12, 28, 14, 12, 38],
    stickyRowsCount: 1,
    stickyColumnsCount: 0,
  };
}

export function buildDailyTipsWorkbook(
  input: DailyTipsWorkbookInput,
): WorkbookSheet[] {
  return [buildSummarySheet(input), buildDetailSheet(input)];
}
