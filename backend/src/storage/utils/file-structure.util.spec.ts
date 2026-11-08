import { hasCompleteStructure } from './file-structure.util.js';

// Archivos mínimos completos de cada formato (encabezado + cierre) y sus
// versiones truncadas (SPRINT-4R-T18).
const PDF = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
);
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9,
]);
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
      expect(hasCompleteStructure(JPEG.subarray(0, 10), 'image/jpeg')).toBe(
        false,
      );
    });

    it('no confunde el FF D8 inicial con el cierre', () => {
      expect(
        hasCompleteStructure(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'),
      ).toBe(false);
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
