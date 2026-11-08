// Errores de lectura y validación del reporte diario de MrComanda
// (SPRINT-4R-T09). Cada código tiene un mensaje en español que le dice al
// administrador qué revisar; la API (SPRINT-4R-T10) los traduce a 400/422 sin
// persistir nada.

export type MrComandaReportErrorCode =
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'FILE_XLS_NOT_SUPPORTED'
  | 'FILE_NOT_XLSX'
  | 'FILE_CORRUPT'
  | 'REPORT_NOT_FOUND'
  | 'MULTIPLE_REPORTS'
  | 'PAYMENTS_SECTION_AMBIGUOUS'
  | 'PERIOD_MISSING'
  | 'PERIOD_AMBIGUOUS'
  | 'PERIOD_INVALID'
  | 'PERIOD_MULTIPLE_DAYS'
  | 'PERIOD_INCONSISTENT'
  | 'SCHEDULE_MISSING'
  | 'SCHEDULE_AMBIGUOUS'
  | 'SCHEDULE_INVALID'
  | 'STORE_MISSING'
  | 'STORE_AMBIGUOUS'
  | 'STORE_COMBINED'
  | 'STORE_INVALID'
  | 'PAYMENTS_TOTAL_INVALID'
  | 'PAYMENT_LINES_MISSING'
  | 'LINE_LABEL_INVALID'
  | 'LINE_AMOUNT_INVALID'
  | 'LINE_PERCENTAGE_INVALID'
  | 'LINE_DUPLICATED'
  | 'TOTAL_MISMATCH';

export class MrComandaReportError extends Error {
  readonly code: MrComandaReportErrorCode;
  // Fila de la planilla (1..n) cuando el problema es de una fila puntual.
  readonly row: number | null;

  constructor(
    code: MrComandaReportErrorCode,
    message: string,
    row: number | null = null,
  ) {
    super(message);
    this.name = 'MrComandaReportError';
    this.code = code;
    this.row = row;
  }
}
