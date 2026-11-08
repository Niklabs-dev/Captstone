import { hasCompleteStructure } from './file-structure.util.js';

// Archivos mínimos completos de cada formato (encabezado + cierre) y sus
// versiones truncadas (SPRINT-4R-T18).
const PDF = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
);
// JPEG armado por segmentos, cada uno con su largo real (incluye los 2
// bytes del largo), como lo escribe una cámara.
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0x00, 0x00]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

const APP0_JFIF = segment(
  0xe0,
  Buffer.from('4a46494600010100000100010000', 'hex'),
);
// Encabezado del SOS: 1 componente, tablas 0/0, Ss, Se y Ah/Al.
const SOS_HEADER = Buffer.from('0101003f00', 'hex');

function jpeg(scanData: Buffer, ...extraSegments: Buffer[]): Buffer {
  return Buffer.concat([
    SOI,
    APP0_JFIF,
    ...extraSegments,
    segment(0xda, SOS_HEADER),
    scanData,
    EOI,
  ]);
}

const JPEG = jpeg(Buffer.from('datos de imagen'));

// Foto de celular: el segmento APP1 «Exif» lleva una miniatura que es un
// JPEG completo, con su propio FF DA y su propio FF D9.
const THUMBNAIL = jpeg(Buffer.from('miniatura'));
const EXIF_PHOTO = jpeg(
  Buffer.alloc(4096, 0x11),
  segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), THUMBNAIL])),
);

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

// WebP con el tamaño RIFF declarado (resto del archivo después de los 8
// bytes del encabezado).
function webp(declaredSize: number, totalBytes: number): Buffer {
  const content = Buffer.alloc(totalBytes);
  content.write('RIFF', 0, 'latin1');
  content.writeUInt32LE(declaredSize, 4);
  content.write('WEBPVP8 ', 8, 'latin1');
  return content;
}

describe('hasCompleteStructure (SPRINT-4R-T18)', () => {
  describe('PDF', () => {
    it('acepta un PDF con %%EOF al final', () => {
      expect(hasCompleteStructure(PDF, 'application/pdf')).toBe(true);
    });

    it('tolera bytes extra después de %%EOF dentro de los últimos 1.024', () => {
      const trailing = Buffer.concat([PDF, Buffer.alloc(500, 0x20)]);
      expect(hasCompleteStructure(trailing, 'application/pdf')).toBe(true);
    });

    it('rechaza un PDF truncado sin %%EOF', () => {
      const truncated = PDF.subarray(0, PDF.length - 10);
      expect(hasCompleteStructure(truncated, 'application/pdf')).toBe(false);
    });

    it('rechaza un PDF cuyo %%EOF quedó lejos del final', () => {
      const appended = Buffer.concat([PDF, Buffer.alloc(2000, 0x41)]);
      expect(hasCompleteStructure(appended, 'application/pdf')).toBe(false);
    });
  });

  describe('JPEG', () => {
    it('acepta un JPEG con su marcador de fin', () => {
      expect(hasCompleteStructure(JPEG, 'image/jpeg')).toBe(true);
    });

    it('acepta datos extra después del fin (fotos «en movimiento»)', () => {
      const motion = Buffer.concat([JPEG, Buffer.from('ftypmp42video')]);
      expect(hasCompleteStructure(motion, 'image/jpeg')).toBe(true);
    });

    it('rechaza un JPEG truncado sin FF D9', () => {
      expect(
        hasCompleteStructure(JPEG.subarray(0, JPEG.length - 2), 'image/jpeg'),
      ).toBe(false);
    });

    it('no confunde el FF D8 inicial con el cierre', () => {
      expect(
        hasCompleteStructure(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'),
      ).toBe(false);
    });

    it('acepta una foto completa con miniatura EXIF', () => {
      expect(hasCompleteStructure(EXIF_PHOTO, 'image/jpeg')).toBe(true);
    });

    it('rechaza una foto con miniatura EXIF cortada a la mitad', () => {
      const half = EXIF_PHOTO.subarray(0, EXIF_PHOTO.length / 2);
      // El FF D9 de la miniatura sigue presente: es el caso que antes pasaba.
      expect(half.includes(EOI)).toBe(true);
      expect(hasCompleteStructure(half, 'image/jpeg')).toBe(false);
    });

    it('rechaza una foto cortada justo después de la miniatura EXIF', () => {
      const exifEnd = EXIF_PHOTO.lastIndexOf(EOI, -3) + EOI.length;
      expect(
        hasCompleteStructure(EXIF_PHOTO.subarray(0, exifEnd), 'image/jpeg'),
      ).toBe(false);
    });

    it('rechaza un segmento que declara más bytes de los recibidos', () => {
      const cutInsideExif = EXIF_PHOTO.subarray(0, 40);
      expect(hasCompleteStructure(cutInsideExif, 'image/jpeg')).toBe(false);
    });

    it('acepta datos con bytes de relleno FF 00 y marcadores RST', () => {
      const scan = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
      expect(hasCompleteStructure(jpeg(scan), 'image/jpeg')).toBe(true);
    });

    it('acepta bytes de relleno FF antes de un marcador', () => {
      const padded = Buffer.concat([
        SOI,
        Buffer.from([0xff, 0xff]),
        APP0_JFIF,
        segment(0xda, SOS_HEADER),
        Buffer.from('datos'),
        EOI,
      ]);
      expect(hasCompleteStructure(padded, 'image/jpeg')).toBe(true);
    });

    it('rechaza un fin de imagen antes de los datos (sin SOS)', () => {
      const noScan = Buffer.concat([SOI, APP0_JFIF, EOI]);
      expect(hasCompleteStructure(noScan, 'image/jpeg')).toBe(false);
    });

    it('rechaza bytes que no son un marcador entre segmentos', () => {
      const garbage = Buffer.concat([SOI, Buffer.from('basura'), EOI]);
      expect(hasCompleteStructure(garbage, 'image/jpeg')).toBe(false);
    });
  });

  describe('PNG', () => {
    it('acepta un PNG con el bloque IEND', () => {
      expect(hasCompleteStructure(PNG, 'image/png')).toBe(true);
    });

    it('rechaza un PNG truncado antes de IEND', () => {
      expect(hasCompleteStructure(PNG.subarray(0, 14), 'image/png')).toBe(
        false,
      );
    });

    it('rechaza «IEND» sin su CRC (bloque cortado)', () => {
      expect(hasCompleteStructure(PNG.subarray(0, 18), 'image/png')).toBe(
        false,
      );
    });
  });

  describe('WebP', () => {
    it('acepta un WebP del tamaño que declara', () => {
      expect(hasCompleteStructure(webp(24, 32), 'image/webp')).toBe(true);
    });

    it('rechaza un WebP más corto que lo declarado', () => {
      expect(hasCompleteStructure(webp(1000, 32), 'image/webp')).toBe(false);
    });

    it('rechaza un encabezado WebP incompleto o con tamaño inválido', () => {
      expect(
        hasCompleteStructure(webp(24, 32).subarray(0, 10), 'image/webp'),
      ).toBe(false);
      expect(hasCompleteStructure(webp(2, 32), 'image/webp')).toBe(false);
    });
  });
});
