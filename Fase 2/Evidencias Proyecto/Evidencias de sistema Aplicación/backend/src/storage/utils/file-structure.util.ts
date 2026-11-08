// Chequeo estructural liviano de archivos cargados (SPRINT-4R-T18).
//
// La firma ("magic bytes") dice qué tipo de archivo es por sus primeros
// bytes, pero un archivo cortado a la mitad (subida interrumpida, copia
// incompleta, archivo dañado) conserva esa firma. Este chequeo verifica
// además la marca de cierre de cada formato, sin decodificar el contenido ni
// agregar dependencias:
// - PDF: «%%EOF» dentro de los últimos 1.024 bytes (la misma tolerancia que
//   aplican los lectores de PDF a los bytes extra al final).
// - JPEG: el marcador de fin de imagen FF D9 en algún punto después del
//   encabezado. No se exige que esté al final: algunos celulares (fotos «en
//   movimiento») guardan un video pegado después de la imagen y la foto es
//   válida.
// - PNG: el bloque final IEND (con su CRC fijo); un PNG cortado nunca llega
//   a escribirlo.
// - WebP: el tamaño que declara el encabezado RIFF no puede ser mayor que el
//   archivo recibido.
// No es una validación completa (un archivo dañado por dentro con su cierre
// intacto pasa), pero detecta los archivos truncados, el caso más común, y su
// integridad posterior queda protegida por el hash SHA-256.

export type StructuredMimeType =
  'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

const PDF_EOF = Buffer.from('%%EOF', 'latin1');
const PDF_TAIL_WINDOW = 1024;
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
// Bloque IEND: largo 0, tipo «IEND» y su CRC, siempre AE 42 60 82.
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
// Encabezado RIFF: «RIFF» + tamaño (4 bytes, little endian) + «WEBP».
const RIFF_HEADER_BYTES = 8;
const WEBP_MIN_BYTES = 12;

export function hasCompleteStructure(
  content: Buffer,
  mimeType: StructuredMimeType,
): boolean {
  switch (mimeType) {
    case 'application/pdf':
      return content
        .subarray(Math.max(0, content.length - PDF_TAIL_WINDOW))
        .includes(PDF_EOF);
    case 'image/jpeg':
      // Después del marcador de inicio FF D8.
      return content.indexOf(JPEG_EOI, 2) !== -1;
    case 'image/png':
      // Después de la firma de 8 bytes.
      return content.indexOf(PNG_IEND, 8) !== -1;
    case 'image/webp': {
      if (content.length < WEBP_MIN_BYTES) return false;
      const declared = content.readUInt32LE(4);
      return declared >= 4 && content.length >= declared + RIFF_HEADER_BYTES;
    }
  }
}
