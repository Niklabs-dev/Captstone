import { inflateRawSync } from 'node:zlib';

// Lectura mínima del ZIP de un .xlsx para los tests de la exportación de
// propinas (SPRINT-4A-T05): read-excel-file entrega los valores, pero no el
// formato de las celdas; aquí se leen styles.xml y las hojas para verificar
// que los montos son celdas numéricas con formato CLP. Solo para archivos
// generados por el propio sistema (sin ZIP64 ni cifrado).

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

// Contenido de cada entrada del ZIP por su ruta (ej. 'xl/styles.xml').
export function readZipEntries(buffer: Buffer): Map<string, string> {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== EOCD_SIGNATURE) eocd -= 1;
  if (eocd < 0) throw new Error('El archivo no es un ZIP');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('Directorio central inválido');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    entries.set(
      name,
      (method === 0 ? raw : inflateRawSync(raw)).toString('utf8'),
    );
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export interface XlsxCellFormat {
  // Atributo t de la celda: undefined para números (y fechas).
  type: string | undefined;
  // formatCode del estilo de la celda, o null si usa el formato general.
  formatCode: string | null;
}

// Tipo y formato de cada celda de una hoja (por referencia, ej. 'C2').
// sheetIndex es 1 para la primera hoja del libro.
export function readCellFormats(
  buffer: Buffer,
  sheetIndex: number,
): Map<string, XlsxCellFormat> {
  const entries = readZipEntries(buffer);
  const styles = entries.get('xl/styles.xml') ?? '';
  const sheet = entries.get(`xl/worksheets/sheet${sheetIndex}.xml`);
  if (sheet === undefined) throw new Error(`Falta la hoja ${sheetIndex}`);

  const formatCodes = new Map<string, string>();
  for (const match of styles.matchAll(
    /<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g,
  )) {
    formatCodes.set(match[1], match[2].replace(/&quot;/g, '"'));
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const styleFormats = [...cellXfs.matchAll(/<xf\b([^>]*)/g)].map(
    (match) => /numFmtId="(\d+)"/.exec(match[1])?.[1] ?? '0',
  );

  const cells = new Map<string, XlsxCellFormat>();
  for (const match of sheet.matchAll(/<c\b([^>]*?)\/?>/g)) {
    const attributes = match[1];
    const reference = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1];
    if (reference === undefined) continue;
    const style = /\bs="(\d+)"/.exec(attributes)?.[1] ?? '0';
    const numFmtId = styleFormats[Number(style)] ?? '0';
    cells.set(reference, {
      type: /\bt="(\w+)"/.exec(attributes)?.[1],
      formatCode: formatCodes.get(numFmtId) ?? null,
    });
  }
  return cells;
}

// Referencia de una celda a partir de su fila y columna (base 0).
export function cellReference(rowIndex: number, columnIndex: number): string {
  let column = '';
  let remaining = columnIndex + 1;
  while (remaining > 0) {
    const letter = (remaining - 1) % 26;
    column = String.fromCharCode(65 + letter) + column;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return `${column}${rowIndex + 1}`;
}
