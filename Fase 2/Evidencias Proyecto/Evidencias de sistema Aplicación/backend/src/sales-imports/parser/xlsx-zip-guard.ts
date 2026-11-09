// Control del ZIP de un .xlsx antes de leerlo (SPRINT-4R-T18).
//
// Un .xlsx es un ZIP, y un ZIP pequeño puede descomprimirse a cientos de MB
// («bomba zip»): un archivo de 302 KB que se expande a 300 MB llevaba el
// proceso a ~400 MB de memoria y ~1 minuto de CPU antes de rechazarlo. La
// librería de lectura descomprime en streaming leyendo los encabezados
// locales de principio a fin, sin tope, así que este control:
// 1. Lee el directorio central y rechaza ZIP64, multidisco, cifrado,
//    métodos distintos de «stored»/«deflate» y más de MAX_ZIP_ENTRIES.
// 2. Exige que las entradas del directorio cubran el archivo de corrido,
//    desde el byte 0 hasta el directorio central: no queda espacio para una
//    entrada escondida que la lectura en streaming sí procesaría.
// 3. Descomprime cada entrada con zlib y un tope real de salida
//    (maxOutputLength), sin confiar en los tamaños declarados: la memoria
//    nunca supera MAX_UNCOMPRESSED_BYTES.
// El reporte diario real pesa ~10 KB y se descomprime a decenas de KB; un
// .xlsx común se expande entre 3 y 12 veces.

import { inflateRawSync } from 'node:zlib';
import { MrComandaReportError } from './mrcomanda-report.errors.js';

export const MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 100;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const EOCD_BYTES = 22;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const MAX_COMMENT_BYTES = 0xffff;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

interface CentralEntry {
  flags: number;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function corrupt(): MrComandaReportError {
  return new MrComandaReportError(
    'FILE_CORRUPT',
    'No se pudo leer la planilla: el archivo está dañado o no es un .xlsx válido. Vuelve a exportarlo desde MrComanda.',
  );
}

function tooLarge(): MrComandaReportError {
  return new MrComandaReportError(
    'FILE_TOO_LARGE',
    `El contenido de la planilla supera los ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MB al descomprimirse: no parece un «Informe de Ventas Diario» de MrComanda.`,
  );
}

function tooManyEntries(): MrComandaReportError {
  return new MrComandaReportError(
    'FILE_TOO_LARGE',
    `La planilla contiene más de ${MAX_ZIP_ENTRIES} archivos internos: no parece un «Informe de Ventas Diario» de MrComanda.`,
  );
}

// Lecturas con control de límites: un campo fuera del archivo es un ZIP
// dañado o cortado.
function u16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) throw corrupt();
  return buffer.readUInt16LE(offset);
}

function u32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) throw corrupt();
  return buffer.readUInt32LE(offset);
}

// Registro de fin del directorio central: se busca desde el final, porque
// puede ir seguido de un comentario de hasta 65.535 bytes.
function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - EOCD_BYTES - MAX_COMMENT_BYTES);
  for (let offset = buffer.length - EOCD_BYTES; offset >= lowest; offset -= 1) {
    if (
      buffer.readUInt32LE(offset) === EOCD_SIGNATURE &&
      offset + EOCD_BYTES + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      return offset;
    }
  }
  throw corrupt();
}

function readCentralDirectory(buffer: Buffer): {
  entries: CentralEntry[];
  centralOffset: number;
} {
  const eocd = findEndOfCentralDirectory(buffer);
  const diskNumber = u16(buffer, eocd + 4);
  const centralDisk = u16(buffer, eocd + 6);
  const entriesOnDisk = u16(buffer, eocd + 8);
  const totalEntries = u16(buffer, eocd + 10);
  const centralSize = u32(buffer, eocd + 12);
  const centralOffset = u32(buffer, eocd + 16);
  if (
    totalEntries === ZIP64_MARKER_16 ||
    centralSize === ZIP64_MARKER_32 ||
    centralOffset === ZIP64_MARKER_32 ||
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    centralOffset + centralSize !== eocd
  ) {
    throw corrupt();
  }
  if (totalEntries > MAX_ZIP_ENTRIES) throw tooManyEntries();

  const entries: CentralEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (u32(buffer, offset) !== CENTRAL_SIGNATURE) throw corrupt();
    const entry: CentralEntry = {
      flags: u16(buffer, offset + 8),
      method: u16(buffer, offset + 10),
      compressedSize: u32(buffer, offset + 20),
      localOffset: u32(buffer, offset + 42),
    };
    if (
      entry.compressedSize === ZIP64_MARKER_32 ||
      entry.localOffset === ZIP64_MARKER_32 ||
      (entry.flags & FLAG_ENCRYPTED) !== 0 ||
      (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE)
    ) {
      throw corrupt();
    }
    entries.push(entry);
    offset +=
      CENTRAL_HEADER_BYTES +
      u16(buffer, offset + 28) +
      u16(buffer, offset + 30) +
      u16(buffer, offset + 32);
  }
  if (offset !== eocd) throw corrupt();
  return { entries, centralOffset };
}

// Descomprime una entrada con el presupuesto que queda; devuelve los bytes
// que produjo. maxOutputLength corta la salida sin reservar más memoria.
function uncompressedBytes(
  entry: CentralEntry,
  data: Buffer,
  remaining: number,
): number {
  if (entry.method === METHOD_STORED) return data.length;
  try {
    return inflateRawSync(data, { maxOutputLength: Math.max(remaining, 1) })
      .length;
  } catch (error) {
    if (error instanceof RangeError) throw tooLarge();
    throw corrupt();
  }
}

export function assertZipWithinLimits(buffer: Buffer): void {
  const { entries, centralOffset } = readCentralDirectory(buffer);
  const ordered = [...entries].sort((a, b) => a.localOffset - b.localOffset);

  let expectedOffset = 0;
  let total = 0;
  for (const entry of ordered) {
    // Sin huecos ni solapes: cada entrada empieza donde termina la anterior.
    if (entry.localOffset !== expectedOffset) throw corrupt();
    if (u32(buffer, entry.localOffset) !== LOCAL_SIGNATURE) throw corrupt();
    const dataStart =
      entry.localOffset +
      LOCAL_HEADER_BYTES +
      u16(buffer, entry.localOffset + 26) +
      u16(buffer, entry.localOffset + 28);
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > centralOffset) throw corrupt();

    total += uncompressedBytes(
      entry,
      buffer.subarray(dataStart, dataEnd),
      MAX_UNCOMPRESSED_BYTES - total,
    );
    if (total > MAX_UNCOMPRESSED_BYTES) throw tooLarge();

    expectedOffset = dataEnd;
    if ((entry.flags & FLAG_DATA_DESCRIPTOR) !== 0) {
      // CRC y tamaños después de los datos, con firma opcional.
      expectedOffset += u32(buffer, dataEnd) === DESCRIPTOR_SIGNATURE ? 16 : 12;
    }
  }
  if (expectedOffset !== centralOffset) throw corrupt();
}
