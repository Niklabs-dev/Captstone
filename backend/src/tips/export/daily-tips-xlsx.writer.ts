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

// Feature de write-excel-file para Node, tomada de las opciones de la firma
// con varias hojas (la última de writeXlsxFile).
type WriteOptions = NonNullable<Parameters<typeof writeXlsxFile>[1]>;
type NodeFeature = NonNullable<WriteOptions['features']>[number];

// Configuración de impresión vertical ajustada a una hoja de ancho
// (SPRINT-5-T08). write-excel-file solo permite elegir la orientación
// horizontal, así que se agrega al XML de la hoja: <sheetPr> va primero
// dentro de <worksheet> y <pageMargins>/<pageSetup> después de los datos
// (antes de <drawing>, si lo hubiera), en el orden que exige el estándar.
export const FIT_TO_WIDTH_SHEET_PR =
  '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
export const FIT_TO_WIDTH_PAGE_SETUP =
  '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
  '<pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0"/>';

export function addFitToWidthPageSetup(xml: string): string {
  const worksheetEnd = xml.indexOf('>', xml.indexOf('<worksheet'));
  const drawing = xml.indexOf('<drawing');
  const pageSetupAt =
    drawing === -1 ? xml.lastIndexOf('</worksheet>') : drawing;
  if (worksheetEnd === -1 || pageSetupAt === -1 || xml.includes('<pageSetup')) {
    throw new Error('No se pudo configurar la impresión de la hoja');
  }
  return (
    xml.slice(0, worksheetEnd + 1) +
    FIT_TO_WIDTH_SHEET_PR +
    xml.slice(worksheetEnd + 1, pageSetupAt) +
    FIT_TO_WIDTH_PAGE_SETUP +
    xml.slice(pageSetupAt)
  );
}

function fitToWidthFeature(sheetNames: ReadonlySet<string>): NodeFeature {
  return {
    files: {
      transform: {
        'xl/worksheets/sheet{id}.xml': {
          transform: (content, options) =>
            options.sheet !== undefined && sheetNames.has(options.sheet)
              ? addFitToWidthPageSetup(content)
              : content,
        },
      },
    },
  };
}

export async function writeWorkbook(
  sheets: readonly WorkbookSheet[],
): Promise<Buffer> {
  const fitToWidth = new Set(
    sheets.filter((sheet) => sheet.fitToPageWidth).map((sheet) => sheet.name),
  );
  return writeXlsxFile(
    sheets.map((sheet) => ({
      sheet: sheet.name,
      data: sheet.rows,
      columns: sheet.columnWidths.map((width) => ({ width })),
      stickyRowsCount: sheet.stickyRowsCount,
      stickyColumnsCount: sheet.stickyColumnsCount,
    })),
    fitToWidth.size > 0 ? { features: [fitToWidthFeature(fitToWidth)] } : {},
  ).toBuffer();
}
