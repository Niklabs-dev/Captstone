// Tipos del reporte diario de ventas de MrComanda ya leído y validado
// (SPRINT-4R-T09). El parser no persiste nada: entrega este resultado para que
// la previsualización (SPRINT-4R-T10) lo resuelva contra las equivalencias de
// SPRINT-4R-T08 y lo guarde solo al confirmar.

// Valor de una celda tal como lo entrega el lector XLSX.
export type ReportCell = string | number | boolean | Date | null;

export type ReportRow = readonly ReportCell[];

export interface ReportSheet {
  name: string;
  rows: readonly ReportRow[];
}

// Total de un medio de pago dentro de la sección «Medios de pago».
export interface ParsedPaymentLine {
  // Posición 1..n dentro de la sección (orden del reporte).
  lineNumber: number;
  // Fila de la planilla (1..n), para mensajes accionables.
  rowNumber: number;
  // Etiqueta tal como viene en el reporte, sin los espacios de relleno.
  originalLabel: string;
  // Etiqueta normalizada con la regla de normalize_external_label.
  normalizedLabel: string;
  // Monto CLP entero (con signo: una nota de crédito puede restar).
  amount: number;
  // Porcentaje del total con dos decimales; null si el reporte no lo trae.
  percentage: number | null;
}

export interface ParsedMrComandaReport {
  sheetName: string;
  // Fecha de negocio YYYY-MM-DD tomada del «Período» del contenido (nunca del
  // nombre del archivo ni de la fecha de emisión).
  businessDate: string;
  // Inicio y fin del horario del reporte como instantes (hora de Chile).
  periodStart: Date;
  periodEnd: Date;
  // Identificador del local tal como aparece en el encabezado y normalizado.
  externalStoreLabel: string;
  externalStoreCode: string;
  // Total de la sección «Medios de pago» (coincide con la suma de líneas).
  totalAmount: number;
  lines: ParsedPaymentLine[];
}
