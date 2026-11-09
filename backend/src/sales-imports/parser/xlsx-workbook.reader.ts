// Lectura del archivo XLSX del reporte de MrComanda (SPRINT-4R-T09).
//
// Dependencia elegida: read-excel-file, versión fijada exacta en package.json.
// - Solo lee .xlsx (no ejecuta macros ni fórmulas) y depende de pocos
//   paquetes (fflate, unzipper-esm, saxen, worker-f): `npm audit` sin
//   vulnerabilidades al elegirla.
// - Se descartó `xlsx` (SheetJS) porque la versión publicada en npm (0.18.5)
//   arrastra prototype pollution y ReDoS sin corrección en el registro, y
//   `exceljs` por su tamaño (~170 paquetes) y la vulnerabilidad moderada de su
//   dependencia uuid; ninguna de sus capacidades de escritura hace falta aquí.
// - Se fija una versión con más de dos semanas publicada (9.3.12).
// Antes de entregarle el archivo se valida tamaño y firma: el archivo vacío,
// el .xls antiguo y cualquier contenido que no sea un ZIP se rechazan con un
// mensaje claro sin intentar leerlos. Luego xlsx-zip-guard limita el
// contenido descomprimido (SPRINT-4R-T18).

import readXlsxFile from 'read-excel-file/node';
import { MrComandaReportError } from './mrcomanda-report.errors.js';
import type { ReportCell, ReportSheet } from './mrcomanda-report.types.js';
import { assertZipWithinLimits } from './xlsx-zip-guard.js';

// El reporte diario pesa unos 10 KB; 5 MB deja margen sin aceptar archivos
// que no son un informe (la API de T10 aplica además su propio límite).
export const MAX_REPORT_FILE_BYTES = 5 * 1024 * 1024;

// Firma de un ZIP (todo .xlsx es un ZIP) y de un documento OLE (.xls antiguo).
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => buffer[index] === byte);
}

function toReportCell(value: unknown): ReportCell {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    return value;
  }
  return null;
}

export async function readReportWorkbook(
  buffer: Buffer,
): Promise<ReportSheet[]> {
  if (buffer.length === 0) {
    throw new MrComandaReportError('FILE_EMPTY', 'El archivo está vacío.');
  }
  if (buffer.length > MAX_REPORT_FILE_BYTES) {
    throw new MrComandaReportError(
      'FILE_TOO_LARGE',
      'El archivo supera los 5 MB: no parece un «Informe de Ventas Diario» de MrComanda.',
    );
  }
  if (startsWith(buffer, OLE_SIGNATURE)) {
    throw new MrComandaReportError(
      'FILE_XLS_NOT_SUPPORTED',
      'El archivo está en el formato antiguo .xls. Expórtalo desde MrComanda como .xlsx (o ábrelo en Excel y guárdalo como «Libro de Excel»).',
    );
  }
  if (!startsWith(buffer, ZIP_SIGNATURE)) {
    throw new MrComandaReportError(
      'FILE_NOT_XLSX',
      'El archivo no es una planilla .xlsx. Sube el «Informe de Ventas Diario» exportado desde MrComanda.',
    );
  }
  // Tope de contenido descomprimido y estructura del ZIP antes de leerlo
  // (SPRINT-4R-T18): una «bomba zip» se rechaza sin agotar la memoria.
  assertZipWithinLimits(buffer);
  try {
    const sheets = await readXlsxFile(buffer, { trim: false });
    return sheets.map((sheet) => ({
      name: sheet.sheet,
      rows: sheet.data.map((row) => row.map(toReportCell)),
    }));
  } catch {
    throw new MrComandaReportError(
      'FILE_CORRUPT',
      'No se pudo leer la planilla: el archivo está dañado o no es un .xlsx válido. Vuelve a exportarlo desde MrComanda.',
    );
  }
}
