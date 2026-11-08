// Parser del reporte «Informe de Ventas Diario» de MrComanda (SPRINT-4R-T09).
//
// Trabaja sobre las filas ya leídas de la planilla y no persiste nada. Ubica
// cada dato por su etiqueta y no por posiciones fijas:
// - «Período:» da la fecha de negocio (un solo día). Nunca se usa el nombre
//   del archivo ni la «Fecha» de emisión: el reporte del 05/11 suele llamarse
//   ventas-06-11-2026.xlsx porque se emite al día siguiente.
// - «Horario:» da la hora de inicio y término (puede cruzar la medianoche).
// - «Local: …» en el encabezado de filtros da el identificador externo. Un
//   reporte de «Todos los locales» o de varios locales se rechaza.
// - La sección «Medios de pago» da el total y una línea por medio, hasta la
//   primera fila vacía o la siguiente sección. «Venta por depto.» se ignora.
// Cualquier estructura irreconocible, monto inválido o total que no cuadra
// lanza MrComandaReportError con un mensaje accionable.

import { parseCalendarDate } from '../../audit/utils/business-day.util.js';
import { normalizeExternalLabel } from '../normalization/normalize-external-label.js';
import { MrComandaReportError } from './mrcomanda-report.errors.js';
import type {
  ParsedMrComandaReport,
  ParsedPaymentLine,
  ReportCell,
  ReportRow,
  ReportSheet,
} from './mrcomanda-report.types.js';
import { type ClockTime, zonedWallClockToInstant } from './zoned-time.util.js';

const PAYMENTS_SECTION_LABEL = 'MEDIOS DE PAGO';
const PERCENTAGE_HEADERS = new Set(['PORCENTAJE', '%']);
// Etiquetas que inician otra sección o el pie del reporte.
const OTHER_SECTION_LABELS = new Set([
  'VENTAS',
  'MEDIOS DE PAGO',
  'VENTA POR DEPTO.',
]);
const FOOTER_PREFIX = 'EMITIO';
// Mismo largo que sales_import_lines.original_label y external_store_code.
const MAX_LABEL_LENGTH = 100;

const PERIOD_LABEL = /^PERIODO:?$/;
const SCHEDULE_LABEL = /^HORARIO:?$/;
const DATE_TEXT = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
const SCHEDULE_TEXT =
  /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+a\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/i;
const TITLE_TEXT = /informe de ventas diario/i;
const STORE_MARKER = /\blocal(es)?\s*:/gi;
// Los filtros del encabezado se separan con « - » seguido de texto; el
// identificador del local («208 - 72597») tiene guiones entre números.
const FILTER_SEPARATOR = /\s+-\s+(?=[^\d\s])/;
const CLP_TEXT = /^(-)?\s*\$?\s*(-)?\s*(\d{1,3}(?:\.\d{3})+|\d+)$/;
const PERCENTAGE_TEXT = /^(\d{1,3})(?:[.,](\d+))?\s*%?$/;

interface LocatedCell {
  rowIndex: number;
  columnIndex: number;
  text: string;
}

function textOf(cell: ReportCell | undefined): string | null {
  if (typeof cell !== 'string') return null;
  const trimmed = cell.trim();
  return trimmed === '' ? null : trimmed;
}

function isEmptyRow(row: ReportRow): boolean {
  return row.every(
    (cell) => cell === null || (typeof cell === 'string' && cell.trim() === ''),
  );
}

// Primera celda con texto de la fila (la etiqueta en el reporte).
function rowLabel(row: ReportRow): LocatedCell | null {
  for (const [columnIndex, cell] of row.entries()) {
    const text = textOf(cell);
    if (text !== null) return { rowIndex: -1, columnIndex, text };
  }
  return null;
}

// Celdas de texto cuyo valor normalizado cumple el predicado.
function findCells(
  rows: readonly ReportRow[],
  predicate: (normalized: string) => boolean,
): LocatedCell[] {
  const found: LocatedCell[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, cell] of row.entries()) {
      const text = textOf(cell);
      if (text !== null && predicate(normalizeExternalLabel(text))) {
        found.push({ rowIndex, columnIndex, text });
      }
    }
  }
  return found;
}

// Primer texto a la derecha de una etiqueta («Período:» → «05/11/2026 al …»).
function valueRightOf(rows: readonly ReportRow[], cell: LocatedCell) {
  const row = rows[cell.rowIndex] ?? [];
  for (let index = cell.columnIndex + 1; index < row.length; index++) {
    const text = textOf(row[index]);
    if (text !== null) return text;
  }
  return null;
}

function excelRow(rowIndex: number): number {
  return rowIndex + 1;
}

function hasPaymentsSection(sheet: ReportSheet): boolean {
  return (
    findCells(sheet.rows, (text) => text === PAYMENTS_SECTION_LABEL).length > 0
  );
}

interface ReportDate {
  text: string;
  isoDate: string;
  date: { year: number; month: number; day: number };
}

function parseReportDates(text: string): ReportDate[] | null {
  const dates: ReportDate[] = [];
  for (const match of text.matchAll(DATE_TEXT)) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const isoDate = `${match[3]}-${month}-${day}`;
    const date = parseCalendarDate(isoDate);
    if (!date) return null;
    dates.push({ text: match[0], isoDate, date });
  }
  return dates;
}

function parsePeriod(rows: readonly ReportRow[]): ReportDate {
  const labels = findCells(rows, (text) => PERIOD_LABEL.test(text));
  if (labels.length === 0) {
    throw new MrComandaReportError(
      'PERIOD_MISSING',
      'El reporte no tiene la fila «Período:». Exporta el «Informe de Ventas Diario» de MrComanda sin modificar su encabezado.',
    );
  }
  if (labels.length > 1) {
    throw new MrComandaReportError(
      'PERIOD_AMBIGUOUS',
      `El reporte tiene más de una fila «Período:» (filas ${labels
        .map((label) => excelRow(label.rowIndex))
        .join(', ')}). Sube un solo informe por archivo.`,
    );
  }
  const label = labels[0];
  const row = excelRow(label.rowIndex);
  const value = valueRightOf(rows, label);
  const dates = value === null ? null : parseReportDates(value);
  const onlyDates =
    value !== null &&
    /^\s*\d{1,2}\/\d{1,2}\/\d{4}(\s+al\s+\d{1,2}\/\d{1,2}\/\d{4})?\s*$/i.test(
      value,
    );
  if (!dates || dates.length === 0 || !onlyDates) {
    throw new MrComandaReportError(
      'PERIOD_INVALID',
      `El «Período» de la fila ${row} no es una fecha válida (se esperaba «dd/mm/aaaa al dd/mm/aaaa» y se leyó «${value ?? ''}»).`,
      row,
    );
  }
  const [start, end] = [dates[0], dates[dates.length - 1]];
  if (start.isoDate !== end.isoDate) {
    throw new MrComandaReportError(
      'PERIOD_MULTIPLE_DAYS',
      `El reporte cubre del ${start.text} al ${end.text}. Exporta un informe por día: el período debe empezar y terminar el mismo día.`,
      row,
    );
  }
  return start;
}

// El título «Informe de Ventas Diario dd/mm/aaaa - dd/mm/aaaa», si existe,
// debe coincidir con el período: si no, el encabezado es ambiguo.
function assertTitleMatchesPeriod(
  rows: readonly ReportRow[],
  period: ReportDate,
): void {
  for (const [rowIndex, row] of rows.entries()) {
    for (const cell of row) {
      const text = textOf(cell);
      if (text === null || !TITLE_TEXT.test(text)) continue;
      const dates = parseReportDates(text) ?? [];
      if (dates.some((date) => date.isoDate !== period.isoDate)) {
        throw new MrComandaReportError(
          'PERIOD_INCONSISTENT',
          `El título de la fila ${excelRow(rowIndex)} («${text}») no coincide con el «Período» ${period.text}. Vuelve a exportar el informe.`,
          excelRow(rowIndex),
        );
      }
    }
  }
}

function parseClock(
  hours: string,
  minutes: string,
  seconds: string | undefined,
): ClockTime | null {
  const time = {
    hours: Number(hours),
    minutes: Number(minutes),
    seconds: Number(seconds ?? '0'),
  };
  if (time.hours > 23 || time.minutes > 59 || time.seconds > 59) return null;
  return time;
}

function parseSchedule(
  rows: readonly ReportRow[],
  period: ReportDate,
): { periodStart: Date; periodEnd: Date } {
  const labels = findCells(rows, (text) => SCHEDULE_LABEL.test(text));
  if (labels.length === 0) {
    throw new MrComandaReportError(
      'SCHEDULE_MISSING',
      'El reporte no tiene la fila «Horario:». Exporta el «Informe de Ventas Diario» de MrComanda sin modificar su encabezado.',
    );
  }
  if (labels.length > 1) {
    throw new MrComandaReportError(
      'SCHEDULE_AMBIGUOUS',
      'El reporte tiene más de una fila «Horario:». Sube un solo informe por archivo.',
    );
  }
  const label = labels[0];
  const row = excelRow(label.rowIndex);
  const value = valueRightOf(rows, label) ?? '';
  const match = SCHEDULE_TEXT.exec(value);
  const start = match ? parseClock(match[1], match[2], match[3]) : null;
  const end = match ? parseClock(match[4], match[5], match[6]) : null;
  if (!start || !end) {
    throw new MrComandaReportError(
      'SCHEDULE_INVALID',
      `El «Horario» de la fila ${row} no es válido (se esperaba «hh:mm:ss a hh:mm:ss» y se leyó «${value}»).`,
      row,
    );
  }
  const toSeconds = (time: ClockTime): number =>
    time.hours * 3600 + time.minutes * 60 + time.seconds;
  if (toSeconds(start) === toSeconds(end)) {
    throw new MrComandaReportError(
      'SCHEDULE_INVALID',
      `El «Horario» de la fila ${row} empieza y termina a la misma hora («${value}»).`,
      row,
    );
  }
  // Un horario que termina antes de empezar cruza la medianoche: el término
  // es del día siguiente, pero la fecha de negocio sigue siendo la del inicio.
  const endDate =
    toSeconds(end) > toSeconds(start)
      ? period.date
      : (() => {
          const next = new Date(
            Date.UTC(
              period.date.year,
              period.date.month - 1,
              period.date.day + 1,
            ),
          );
          return {
            year: next.getUTCFullYear(),
            month: next.getUTCMonth() + 1,
            day: next.getUTCDate(),
          };
        })();
  return {
    periodStart: zonedWallClockToInstant(period.date, start),
    periodEnd: zonedWallClockToInstant(endDate, end),
  };
}

function parseStore(rows: readonly ReportRow[]): {
  label: string;
  code: string;
} {
  const markers: {
    rowIndex: number;
    text: string;
    start: number;
    plural: boolean;
  }[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    for (const cell of row) {
      const text = textOf(cell);
      if (text === null) continue;
      for (const match of text.matchAll(STORE_MARKER)) {
        markers.push({
          rowIndex,
          text,
          start: (match.index ?? 0) + match[0].length,
          plural: match[1] !== undefined,
        });
      }
    }
  }
  if (markers.length === 0) {
    throw new MrComandaReportError(
      'STORE_MISSING',
      'El encabezado del reporte no indica el local («Local: …»). Exporta el informe filtrando un solo local.',
    );
  }
  if (markers.length > 1) {
    throw new MrComandaReportError(
      'STORE_AMBIGUOUS',
      'El encabezado del reporte menciona más de un local. Exporta un informe por local.',
    );
  }
  const marker = markers[0];
  const row = excelRow(marker.rowIndex);
  const rest = marker.text.slice(marker.start).trim();
  const label = (rest.split(FILTER_SEPARATOR)[0] ?? '').trim();
  const code = normalizeExternalLabel(label);
  if (code === '') {
    throw new MrComandaReportError(
      'STORE_MISSING',
      `El encabezado de la fila ${row} no indica el identificador del local después de «Local:».`,
      row,
    );
  }
  if (
    marker.plural ||
    /^(TODOS|TODAS)\b/.test(code) ||
    /[,;]|\sY\s/.test(code)
  ) {
    throw new MrComandaReportError(
      'STORE_COMBINED',
      `El reporte combina locales («${label}»). Exporta un informe por cada local.`,
      row,
    );
  }
  if (code.length > MAX_LABEL_LENGTH) {
    throw new MrComandaReportError(
      'STORE_INVALID',
      `El identificador del local de la fila ${row} supera los ${MAX_LABEL_LENGTH} caracteres.`,
      row,
    );
  }
  return { label, code };
}

// Monto CLP entero: número de la planilla o texto como «$ 633.670».
function parseClpAmount(cell: ReportCell | undefined): number | null {
  if (typeof cell === 'number') {
    return Number.isSafeInteger(cell) ? cell : null;
  }
  const text = textOf(cell);
  if (text === null) return null;
  const match = CLP_TEXT.exec(text);
  if (!match || (match[1] && match[2])) return null;
  const value = Number(match[3].replace(/\./g, ''));
  if (!Number.isSafeInteger(value)) return null;
  return match[1] || match[2] ? -value : value;
}

// Porcentaje opcional entre 0 y 100, con dos decimales.
function parsePercentage(
  cell: ReportCell | undefined,
): number | null | undefined {
  if (cell === null || cell === undefined) return null;
  let value: number;
  if (typeof cell === 'number') {
    value = cell;
  } else {
    const text = textOf(cell);
    if (text === null) return null;
    const match = PERCENTAGE_TEXT.exec(text);
    if (!match) return undefined;
    value = Number(`${match[1]}.${match[2] ?? '0'}`);
  }
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return Math.round(value * 100) / 100;
}

function formatClp(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function parsePayments(rows: readonly ReportRow[]): {
  totalAmount: number;
  lines: ParsedPaymentLine[];
} {
  const sections = findCells(rows, (text) => text === PAYMENTS_SECTION_LABEL);
  if (sections.length > 1) {
    throw new MrComandaReportError(
      'PAYMENTS_SECTION_AMBIGUOUS',
      `El reporte tiene más de una sección «Medios de pago» (filas ${sections
        .map((section) => excelRow(section.rowIndex))
        .join(', ')}). Sube un solo informe por archivo.`,
    );
  }
  const section = sections[0];
  const headerRow = rows[section.rowIndex] ?? [];
  const sectionRow = excelRow(section.rowIndex);

  // El total de la sección está en la misma fila que su título; esa columna
  // es la de los importes de cada medio.
  let amountColumn = -1;
  for (let index = section.columnIndex + 1; index < headerRow.length; index++) {
    if (parseClpAmount(headerRow[index]) !== null) {
      amountColumn = index;
      break;
    }
  }
  if (amountColumn < 0) {
    throw new MrComandaReportError(
      'PAYMENTS_TOTAL_INVALID',
      `La fila ${sectionRow} («Medios de pago») no tiene un total en pesos válido.`,
      sectionRow,
    );
  }
  const totalAmount = parseClpAmount(headerRow[amountColumn]) ?? 0;
  const percentageColumn = headerRow.findIndex((cell) => {
    const text = textOf(cell);
    return (
      text !== null && PERCENTAGE_HEADERS.has(normalizeExternalLabel(text))
    );
  });

  const lines: ParsedPaymentLine[] = [];
  const seen = new Map<string, number>();
  for (
    let rowIndex = section.rowIndex + 1;
    rowIndex < rows.length;
    rowIndex++
  ) {
    const row = rows[rowIndex];
    if (isEmptyRow(row)) break;
    const rowNumber = excelRow(rowIndex);
    const label = rowLabel(row);
    if (label !== null) {
      const normalized = normalizeExternalLabel(label.text);
      if (
        OTHER_SECTION_LABELS.has(normalized) ||
        normalized.startsWith(FOOTER_PREFIX)
      ) {
        break;
      }
    }
    if (label === null || label.columnIndex >= amountColumn) {
      throw new MrComandaReportError(
        'LINE_LABEL_INVALID',
        `La fila ${rowNumber} de «Medios de pago» no tiene el nombre del medio de pago.`,
        rowNumber,
      );
    }
    const normalizedLabel = normalizeExternalLabel(label.text);
    if (label.text.length > MAX_LABEL_LENGTH) {
      throw new MrComandaReportError(
        'LINE_LABEL_INVALID',
        `El medio de pago de la fila ${rowNumber} supera los ${MAX_LABEL_LENGTH} caracteres.`,
        rowNumber,
      );
    }
    const amount = parseClpAmount(row[amountColumn]);
    if (amount === null) {
      throw new MrComandaReportError(
        'LINE_AMOUNT_INVALID',
        `El monto de «${label.text}» (fila ${rowNumber}) no es un monto en pesos entero válido.`,
        rowNumber,
      );
    }
    const percentage =
      percentageColumn >= 0 ? parsePercentage(row[percentageColumn]) : null;
    if (percentage === undefined) {
      throw new MrComandaReportError(
        'LINE_PERCENTAGE_INVALID',
        `El porcentaje de «${label.text}» (fila ${rowNumber}) debe ser un número entre 0 y 100.`,
        rowNumber,
      );
    }
    const previous = seen.get(normalizedLabel);
    if (previous !== undefined) {
      throw new MrComandaReportError(
        'LINE_DUPLICATED',
        `El medio de pago «${label.text}» aparece dos veces (filas ${previous} y ${rowNumber}).`,
        rowNumber,
      );
    }
    seen.set(normalizedLabel, rowNumber);
    lines.push({
      lineNumber: lines.length + 1,
      rowNumber,
      originalLabel: label.text,
      normalizedLabel,
      amount,
      percentage,
    });
  }

  if (lines.length === 0) {
    throw new MrComandaReportError(
      'PAYMENT_LINES_MISSING',
      `La sección «Medios de pago» (fila ${sectionRow}) no tiene ningún medio de pago.`,
      sectionRow,
    );
  }
  const sum = lines.reduce((total, line) => total + line.amount, 0);
  if (!Number.isSafeInteger(sum) || sum !== totalAmount) {
    throw new MrComandaReportError(
      'TOTAL_MISMATCH',
      `La suma de los medios de pago (${formatClp(sum)}) no coincide con el total del reporte (${formatClp(totalAmount)}). Revisa que el archivo no haya sido editado.`,
      sectionRow,
    );
  }
  return { totalAmount, lines };
}

// Ubica el único informe del libro (la hoja con «Medios de pago») y lo valida.
export function parseMrComandaReport(
  sheets: readonly ReportSheet[],
): ParsedMrComandaReport {
  const reports = sheets.filter(hasPaymentsSection);
  if (reports.length === 0) {
    throw new MrComandaReportError(
      'REPORT_NOT_FOUND',
      'El archivo no tiene la sección «Medios de pago». Sube el «Informe de Ventas Diario» exportado desde MrComanda.',
    );
  }
  if (reports.length > 1) {
    throw new MrComandaReportError(
      'MULTIPLE_REPORTS',
      `El archivo tiene más de un informe (hojas ${reports
        .map((sheet) => `«${sheet.name}»`)
        .join(', ')}). Sube un informe por archivo.`,
    );
  }
  const sheet = reports[0];
  const period = parsePeriod(sheet.rows);
  assertTitleMatchesPeriod(sheet.rows, period);
  const { periodStart, periodEnd } = parseSchedule(sheet.rows, period);
  const store = parseStore(sheet.rows);
  const { totalAmount, lines } = parsePayments(sheet.rows);
  return {
    sheetName: sheet.name,
    businessDate: period.isoDate,
    periodStart,
    periodEnd,
    externalStoreLabel: store.label,
    externalStoreCode: store.code,
    totalAmount,
    lines,
  };
}
