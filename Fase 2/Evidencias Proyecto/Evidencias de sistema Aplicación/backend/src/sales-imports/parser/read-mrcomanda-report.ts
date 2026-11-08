// Punto de entrada del parser (SPRINT-4R-T09): archivo XLSX → reporte
// validado. No persiste nada; si algo falla lanza MrComandaReportError.

import { parseMrComandaReport } from './mrcomanda-report.parser.js';
import type { ParsedMrComandaReport } from './mrcomanda-report.types.js';
import { readReportWorkbook } from './xlsx-workbook.reader.js';

export async function readMrComandaReport(
  buffer: Buffer,
): Promise<ParsedMrComandaReport> {
  const sheets = await readReportWorkbook(buffer);
  return parseMrComandaReport(sheets);
}
