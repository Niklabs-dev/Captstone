// Escritura del .xlsx de propinas del período (SPRINT-4A-T05).
//
// Dependencia elegida: write-excel-file, versión fijada exacta en
// package.json (4.1.1, publicada hace más de dos semanas). Ya se usaba en los
// tests para generar los fixtures de MrComanda y es la pareja de
// read-excel-file (lectura de importaciones, SPRINT-4R-T09): misma autora y
// mantención activa, una sola dependencia (fflate) y `npm audit` sin
// vulnerabilidades. Escribe celdas numéricas con formato propio (CLP), fechas
// y varias hojas, que es todo lo que hace falta. Se descartó `exceljs` por su
// tamaño (~170 paquetes) y la vulnerabilidad moderada de su dependencia uuid,
// y `xlsx` (SheetJS) porque la versión del registro npm arrastra prototype
// pollution y ReDoS sin corrección.

import writeXlsxFile from 'write-excel-file/node';
import type { WorkbookSheet } from './daily-tips-workbook.js';

export async function writeWorkbook(
  sheets: readonly WorkbookSheet[],
): Promise<Buffer> {
  return writeXlsxFile(
    sheets.map((sheet) => ({
      sheet: sheet.name,
      data: sheet.rows,
      columns: sheet.columnWidths.map((width) => ({ width })),
      stickyRowsCount: sheet.stickyRowsCount,
      stickyColumnsCount: sheet.stickyColumnsCount,
    })),
  ).toBuffer();
}
