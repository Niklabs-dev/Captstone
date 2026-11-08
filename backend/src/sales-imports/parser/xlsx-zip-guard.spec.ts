import { deflateRawSync } from 'node:zlib';
import { MrComandaReportError } from './mrcomanda-report.errors.js';
import {
  assertZipWithinLimits,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ZIP_ENTRIES,
} from './xlsx-zip-guard.js';

// Tests del control de ZIP del .xlsx (SPRINT-4R-T18). Los ZIP se arman a
// mano para poder construir cada trampa: bomba zip, tamaños declarados
// falsos, entradas escondidas, demasiadas entradas y métodos no admitidos.

interface EntrySpec {
  name: string;
  content: Buffer;
  method?: number;
  flags?: number;
  // Descriptor de datos después del contenido (bit 3), con o sin firma.
  descriptor?: 'with-signature' | 'without-signature';
  // Bytes ya comprimidos (para simular un deflate dañado).
  rawData?: Buffer;
  // Tamaño descomprimido declarado (por defecto el real).
  declaredSize?: number;
}

interface ZipOptions {
  // Bytes extra después de la entrada indicada que el directorio central no
  // registra (una entrada «escondida»).
  hiddenAfter?: { index: number; bytes: Buffer };
  comment?: string;
  // Fuerza el marcador ZIP64 en la cantidad de entradas.
  zip64Marker?: boolean;
}

function compress(entry: EntrySpec): Buffer {
  if (entry.rawData) return entry.rawData;
  return (entry.method ?? 8) === 8
    ? deflateRawSync(entry.content)
    : entry.content;
}

function buildZip(entries: EntrySpec[], options: ZipOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  entries.forEach((entry, index) => {
    const name = Buffer.from(entry.name, 'latin1');
    const data = compress(entry);
    const method = entry.method ?? 8;
    const flags = (entry.flags ?? 0) | (entry.descriptor ? 0x0008 : 0);
    const declared = entry.declaredSize ?? entry.content.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    // Con descriptor, el encabezado local deja los tamaños en cero.
    local.writeUInt32LE(entry.descriptor ? 0 : data.length, 18);
    local.writeUInt32LE(entry.descriptor ? 0 : declared, 22);
    local.writeUInt16LE(name.length, 26);
    const parts = [local, name, data];
    if (entry.descriptor) {
      const descriptor = Buffer.alloc(
        entry.descriptor === 'with-signature' ? 16 : 12,
      );
      let at = 0;
      if (entry.descriptor === 'with-signature') {
        descriptor.writeUInt32LE(0x08074b50, 0);
        at = 4;
      }
      descriptor.writeUInt32LE(data.length, at + 4);
      descriptor.writeUInt32LE(declared, at + 8);
      parts.push(descriptor);
    }
    if (options.hiddenAfter?.index === index) {
      parts.push(options.hiddenAfter.bytes);
    }
    const localBlock = Buffer.concat(parts);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));

    locals.push(localBlock);
    offset += localBlock.length;
  });

  const centralDirectory = Buffer.concat(centrals);
  const comment = Buffer.from(options.comment ?? '', 'latin1');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const count = options.zip64Marker ? 0xffff : entries.length;
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, centralDirectory, eocd, comment]);
}

// Código del error lanzado (o null si el ZIP pasa el control).
function rejection(zip: Buffer): string | null {
  try {
    assertZipWithinLimits(zip);
    return null;
  } catch (error) {
    if (error instanceof MrComandaReportError) return error.code;
    throw error;
  }
}

const XML = Buffer.from('<?xml version="1.0"?><worksheet><sheetData/>');

describe('assertZipWithinLimits (SPRINT-4R-T18)', () => {
  describe('acepta planillas normales', () => {
    it('acepta entradas comprimidas (deflate) y sin comprimir (stored)', () => {
      const zip = buildZip([
        { name: '[Content_Types].xml', content: XML },
        { name: 'xl/worksheets/sheet1.xml', content: XML, method: 0 },
      ]);
      expect(rejection(zip)).toBeNull();
    });

    it('acepta descriptores de datos con y sin firma', () => {
      const zip = buildZip([
        { name: 'a.xml', content: XML, descriptor: 'with-signature' },
        { name: 'b.xml', content: XML, descriptor: 'without-signature' },
      ]);
      expect(rejection(zip)).toBeNull();
    });

    it('acepta un comentario al final del ZIP', () => {
      const zip = buildZip([{ name: 'a.xml', content: XML }], {
        comment: 'exportado por MrComanda',
      });
      expect(rejection(zip)).toBeNull();
    });

    it('acepta contenido descomprimido justo en el límite', () => {
      const zip = buildZip([
        { name: 'a.xml', content: Buffer.alloc(MAX_UNCOMPRESSED_BYTES, 0x20) },
      ]);
      expect(rejection(zip)).toBeNull();
    });
  });

  describe('bomba zip', () => {
    it('rechaza una entrada que se descomprime por sobre el límite', () => {
      const bomb = buildZip([
        {
          name: 'xl/worksheets/sheet1.xml',
          content: Buffer.alloc(MAX_UNCOMPRESSED_BYTES + 1, 0x20),
        },
      ]);
      // Un archivo de decenas de KB que se expandiría a más de 25 MB.
      expect(bomb.length).toBeLessThan(100 * 1024);
      expect(rejection(bomb)).toBe('FILE_TOO_LARGE');
    });

    it('rechaza el total aunque cada entrada quede bajo el límite', () => {
      const third = Buffer.alloc(Math.ceil(MAX_UNCOMPRESSED_BYTES / 3) + 1);
      const zip = buildZip([
        { name: 'a.xml', content: third },
        { name: 'b.xml', content: third },
        { name: 'c.xml', content: third },
      ]);
      expect(rejection(zip)).toBe('FILE_TOO_LARGE');
    });

    it('mide lo que realmente se descomprime aunque el tamaño declarado mienta', () => {
      const lying = buildZip([
        {
          name: 'xl/worksheets/sheet1.xml',
          content: Buffer.alloc(MAX_UNCOMPRESSED_BYTES + 1, 0x20),
          declaredSize: 10,
        },
      ]);
      expect(rejection(lying)).toBe('FILE_TOO_LARGE');
    });

    it('rechaza una entrada stored mayor que el límite', () => {
      // Sin comprimir no ocupa menos que su contenido, pero el total igual
      // se controla (el archivo completo lo limita además la carga).
      const stored = buildZip([
        {
          name: 'a.xml',
          content: Buffer.alloc(MAX_UNCOMPRESSED_BYTES + 1),
          method: 0,
        },
      ]);
      expect(rejection(stored)).toBe('FILE_TOO_LARGE');
    });

    it(`rechaza más de ${MAX_ZIP_ENTRIES} entradas`, () => {
      const many = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, index) => ({
        name: `xl/media/${index}.xml`,
        content: XML,
      }));
      expect(rejection(buildZip(many))).toBe('FILE_TOO_LARGE');
      expect(rejection(buildZip(many.slice(0, MAX_ZIP_ENTRIES)))).toBeNull();
    });
  });

  describe('estructura del ZIP', () => {
    it('rechaza una entrada escondida que el directorio central no registra', () => {
      const hidden = buildZip([{ name: 'escondida.xml', content: XML }]);
      const zip = buildZip(
        [
          { name: 'a.xml', content: XML },
          { name: 'b.xml', content: XML },
        ],
        // Una entrada local completa entre a.xml y b.xml.
        { hiddenAfter: { index: 0, bytes: hidden.subarray(0, 60) } },
      );
      expect(rejection(zip)).toBe('FILE_CORRUPT');
    });

    it('rechaza un método de compresión no admitido', () => {
      const zip = buildZip([{ name: 'a.xml', content: XML, method: 12 }]);
      expect(rejection(zip)).toBe('FILE_CORRUPT');
    });

    it('rechaza una entrada cifrada', () => {
      const zip = buildZip([{ name: 'a.xml', content: XML, flags: 0x0001 }]);
      expect(rejection(zip)).toBe('FILE_CORRUPT');
    });

    it('rechaza el marcador ZIP64', () => {
      const zip = buildZip([{ name: 'a.xml', content: XML }], {
        zip64Marker: true,
      });
      expect(rejection(zip)).toBe('FILE_CORRUPT');
    });

    it('rechaza un ZIP cortado sin directorio central', () => {
      const zip = buildZip([{ name: 'a.xml', content: XML }]);
      expect(rejection(zip.subarray(0, zip.length - 30))).toBe('FILE_CORRUPT');
    });

    it('rechaza datos deflate dañados', () => {
      const zip = buildZip([
        {
          name: 'a.xml',
          content: XML,
          rawData: Buffer.from([0xff, 0xff, 0xff, 0xff]),
        },
      ]);
      expect(rejection(zip)).toBe('FILE_CORRUPT');
    });

    it('rechaza un archivo demasiado corto para ser un ZIP', () => {
      expect(rejection(Buffer.from('PK\x03\x04', 'latin1'))).toBe(
        'FILE_CORRUPT',
      );
    });
  });
});
