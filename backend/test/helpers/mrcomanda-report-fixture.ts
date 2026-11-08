import writeXlsxFile from 'write-excel-file/node';
import type {
  ReportCell,
  ReportSheet,
} from '../../src/sales-imports/parser/mrcomanda-report.types.js';

// Fixtures FICTICIOS del «Informe de Ventas Diario» de MrComanda
// (SPRINT-4R-T09): misma estructura que el reporte real (columnas A..G,
// encabezado con filtros, «Período», «Horario», «Ventas», «Medios de pago»
// con importe en F y porcentaje en G, «Venta por depto.» y pie), pero con
// local, fechas y montos inventados. El archivo real no se versiona; se usa
// solo como prueba de aceptación manual (MRCOMANDA_SAMPLE_XLSX).

export interface FixtureLine {
  label: string;
  amount: ReportCell;
  percentage?: ReportCell;
}

export interface ReportFixtureOptions {
  emitted?: string | null;
  title?: string | null;
  filters?: string | null;
  periodLabel?: string;
  period?: string | null;
  schedule?: string | null;
  salesTotal?: ReportCell;
  paymentsTotal?: ReportCell;
  percentageHeader?: string | null;
  lines?: readonly FixtureLine[];
  // false: sin fila vacía entre «Medios de pago» y «Venta por depto.».
  blankAfterPayments?: boolean;
}

// Etiquetas con el relleno de espacios del reporte real. Suman 650.000.
export const FIXTURE_LINES: readonly FixtureLine[] = [
  { label: 'T. DEBITO           ', amount: 400_000, percentage: 61.54 },
  { label: 'EFECTIVO            ', amount: 150_000, percentage: 23.08 },
  { label: 'T. CREDITO          ', amount: 100_000, percentage: 15.38 },
  { label: 'N.de Créd.          ', amount: 0, percentage: 0 },
];
export const FIXTURE_TOTAL = 650_000;
export const FIXTURE_STORE = '901 - 12345';
export const FIXTURE_FILTERS = ` - Todas las Empresas  - Todos los puntos de venta - Local: ${FIXTURE_STORE} - Todos los Sectores  - Toda la banda horaria  - Todos los comprobantes`;

const WIDTH = 7;

function row(cells: Record<number, ReportCell>): ReportCell[] {
  return Array.from({ length: WIDTH }, (_, index) => cells[index] ?? null);
}

export function buildReportRows(
  options: ReportFixtureOptions = {},
): ReportCell[][] {
  const lines = options.lines ?? FIXTURE_LINES;
  const rows: ReportCell[][] = [];
  rows.push(
    row({
      4:
        options.emitted === undefined
          ? 'Fecha 15/03/2026 - 09:30:00'
          : options.emitted,
    }),
  );
  rows.push(
    row({
      0:
        options.title === undefined
          ? 'Informe de Ventas Diario 14/03/2026 - 14/03/2026'
          : options.title,
    }),
  );
  rows.push(
    row({
      0: options.filters === undefined ? FIXTURE_FILTERS : options.filters,
    }),
  );
  rows.push(row({}));
  rows.push(row({}));
  if (options.period !== null) {
    rows.push(
      row({
        0: options.periodLabel ?? 'Período:',
        1: options.period ?? '14/03/2026 al 14/03/2026',
      }),
    );
  }
  if (options.schedule !== null) {
    rows.push(
      row({ 0: 'Horario:', 1: options.schedule ?? '00:00:00 a 23:59:59' }),
    );
  }
  rows.push(row({ 0: 'Ventas', 5: options.salesTotal ?? FIXTURE_TOTAL }));
  rows.push(
    row({
      0: 'Medios de pago',
      5:
        options.paymentsTotal === undefined
          ? FIXTURE_TOTAL
          : options.paymentsTotal,
      6:
        options.percentageHeader === undefined
          ? 'Porcentaje'
          : options.percentageHeader,
    }),
  );
  for (const line of lines) {
    rows.push(
      row({ 0: line.label, 5: line.amount, 6: line.percentage ?? null }),
    );
  }
  if (options.blankAfterPayments !== false) rows.push(row({}));
  rows.push(
    row({
      0: 'Venta por depto.',
      2: 600_000,
      4: 'Cantidad',
      5: 'Importe',
      6: '%',
    }),
  );
  rows.push(row({ 0: 'UNIDADES        ', 4: 120, 5: 450_000, 6: 75 }));
  rows.push(row({ 0: 'BEBIDAS         ', 4: 60, 5: 150_000, 6: 25 }));
  rows.push(row({ 0: 'Emitió: Gerente de prueba' }));
  return rows;
}

export function buildReportSheet(
  options: ReportFixtureOptions = {},
  name = 'Informe_ventas_diario',
): ReportSheet {
  return { name, rows: buildReportRows(options) };
}

export async function buildReportXlsx(
  sheets: readonly ReportSheet[] = [buildReportSheet()],
): Promise<Buffer> {
  return writeXlsxFile(
    sheets.map((sheet) => ({
      sheet: sheet.name,
      data: sheet.rows.map((cells) =>
        cells.map((cell) => (cell === null ? null : { value: cell })),
      ),
    })),
  ).toBuffer();
}
