import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import writeXlsxFile from 'write-excel-file/node';

// SPRINT-4A-T12: lectura del Informe de Ventas Diario real (que nunca se
// versiona) y variantes en memoria a partir de él. La lectura usa la misma
// librería del backend (read-excel-file, como scripts/prepare-real-api.mjs
// usa sus dependencias), así la variante conserva la estructura exacta del
// archivo real y solo cambia lo indicado.

export type ReportCell = string | number | null;

const backendRequire = createRequire(
  resolve(process.cwd(), '../backend/package.json'),
);

function isCell(value: unknown): value is ReportCell {
  return (
    value === null || typeof value === 'string' || typeof value === 'number'
  );
}

export async function readReportRows(path: string): Promise<ReportCell[][]> {
  const reader: unknown = backendRequire('read-excel-file/node');
  if (typeof reader !== 'function')
    throw Error('No se pudo cargar read-excel-file desde el backend.');
  const sheets: unknown = await reader(path);
  const first: unknown = Array.isArray(sheets) ? sheets[0] : undefined;
  const data: unknown =
    typeof first === 'object' && first !== null && 'data' in first
      ? first.data
      : undefined;
  if (!Array.isArray(data)) throw Error('El informe no tiene hojas legibles.');
  return data.map((row: unknown) => {
    if (!Array.isArray(row) || !row.every(isCell))
      throw Error('El informe tiene celdas de un tipo no esperado.');
    return row;
  });
}

function slash(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
function nextDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

export interface VariantOptions {
  // Fecha de negocio del informe real (YYYY-MM-DD) y la nueva.
  sourceDate: string;
  targetDate: string;
  // Etiqueta del informe que se reemplaza (en el real, «N.de Créd.» en 0).
  replacedLabel: string;
  label: string;
  amount: number;
}

// Copia del informe real con otra fecha y una línea de medio de pago
// reemplazada por otra etiqueta con monto; «Ventas» y «Medios de pago»
// suben en el mismo monto para que el total cuadre.
export async function reportVariant(
  path: string,
  options: VariantOptions,
): Promise<Buffer> {
  const rows = await readReportRows(path);
  // Reemplazo simultáneo: la emisión (día siguiente) y el período cambian
  // juntos aunque la nueva fecha coincida con una de las originales.
  const dates = new Map([
    [slash(nextDay(options.sourceDate)), slash(nextDay(options.targetDate))],
    [slash(options.sourceDate), slash(options.targetDate)],
  ]);
  const pattern = /\d{2}\/\d{2}\/\d{4}/g;
  let replaced = false;
  const changed = rows.map((cells) => {
    const label = typeof cells[0] === 'string' ? cells[0].trim() : '';
    if (label === options.replacedLabel) {
      replaced = true;
      return cells.map((cell, index) =>
        index === 0 ? options.label : index === 5 ? options.amount : cell,
      );
    }
    return cells.map((cell, index) => {
      if (typeof cell === 'string')
        return cell.replace(pattern, (date) => dates.get(date) ?? date);
      if (
        index === 5 &&
        typeof cell === 'number' &&
        (label === 'Ventas' || label === 'Medios de pago')
      )
        return cell + options.amount;
      return cell;
    });
  });
  if (!replaced)
    throw Error(`El informe no tiene la línea «${options.replacedLabel}».`);
  return writeXlsxFile(
    changed.map((cells) =>
      cells.map((cell) => (cell === null ? null : { value: cell })),
    ),
    { sheet: 'Informe_ventas_diario' },
  ).toBuffer();
}
