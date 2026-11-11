import { inflateRawSync } from 'node:zlib';

// Lectura mínima de un .xlsx para las pruebas con API real (SPRINT-4A-T13):
// abre el ZIP, toma las hojas en el orden del libro y devuelve sus celdas
// como texto o número. Solo para archivos generados por el propio sistema
// (sin ZIP64 ni cifrado); evita sumar una dependencia al frontend.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

export type XlsxValue = string | number;
export type XlsxSheet = { name: string; rows: XlsxValue[][] };

function readZipEntries(buffer: Buffer): Map<string, string> {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== EOCD_SIGNATURE) eocd -= 1;
  if (eocd < 0) throw new Error('El archivo no es un ZIP.');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE)
      throw new Error('Directorio central del ZIP inválido.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(start, start + compressedSize);
    entries.set(
      name,
      (method === 0 ? raw : inflateRawSync(raw)).toString('utf8'),
    );
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Texto de un nodo <si> o <is>: concatena todos sus <t>.
function textOf(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('');
}

// Índice de columna (base 0) de una referencia como «C12».
function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? 'A';
  return (
    [...letters].reduce(
      (sum, letter) => sum * 26 + letter.charCodeAt(0) - 64,
      0,
    ) - 1
  );
}

export function readXlsx(buffer: Buffer): XlsxSheet[] {
  const entries = readZipEntries(buffer);
  const shared = [
    ...(entries.get('xl/sharedStrings.xml') ?? '').matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
  ].map((match) => textOf(match[1]));
  const names = [
    ...(entries.get('xl/workbook.xml') ?? '').matchAll(
      /<sheet\b[^>]*\bname="([^"]*)"/g,
    ),
  ].map((match) => decodeXml(match[1]));
  return names.map((name, index) => {
    const xml = entries.get(`xl/worksheets/sheet${index + 1}.xml`);
    if (xml === undefined) throw new Error(`Falta la hoja ${name}.`);
    const rows: XlsxValue[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: XlsxValue[] = [];
      for (const cell of row[1].matchAll(
        /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      )) {
        const attributes = cell[1];
        const body = cell[2] ?? '';
        const reference = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? 'A1';
        const type = /\bt="(\w+)"/.exec(attributes)?.[1];
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: XlsxValue = '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'str') value = decodeXml(raw ?? '');
        else if (raw !== undefined) value = Number(raw);
        cells[columnIndex(reference)] = value;
      }
      rows.push(Array.from(cells, (value) => value ?? ''));
    }
    return { name, rows };
  });
}

// Fecha serial de Excel (sistema 1900) → YYYY-MM-DD.
export function excelDate(serial: number): string {
  return new Date(Math.round((serial - 25569) * 86_400_000))
    .toISOString()
    .slice(0, 10);
}
