// Chequeo estructural liviano de archivos cargados (SPRINT-4R-T18).
//
// La firma ("magic bytes") dice qué tipo de archivo es por sus primeros
// bytes, pero un archivo cortado a la mitad (subida interrumpida, copia
// incompleta, archivo dañado) conserva esa firma. Este chequeo verifica
// además la marca de cierre de cada formato, sin decodificar el contenido ni
// agregar dependencias:
// - PDF: «%%EOF» dentro de los últimos 1.024 bytes (la misma tolerancia que
//   aplican los lectores de PDF a los bytes extra al final).
// - JPEG: se recorren los segmentos por su largo declarado hasta el SOS
//   (FF DA) de la imagen principal, y después de él debe aparecer el fin de
//   imagen FF D9. Recorrer por largo salta la miniatura EXIF (un JPEG
//   completo dentro del segmento APP1, con su propio FF DA y FF D9), que de
//   otro modo hacía pasar una foto cortada a la mitad. No se exige que FF D9
//   esté al final: algunos celulares (fotos «en movimiento») guardan un video
//   pegado después de la imagen y la foto es válida.
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
const JPEG_MARKER_PREFIX = 0xff;
const JPEG_SOI = 0xd8;
const JPEG_SOS = 0xda;
const JPEG_TEM = 0x01;
const JPEG_RST_FIRST = 0xd0;
const JPEG_RST_LAST = 0xd7;
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
      return hasJpegEndAfterMainScan(content);
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

// Marcadores JPEG sin largo ni contenido: SOI, TEM y RST0–RST7.
function isStandaloneJpegMarker(marker: number): boolean {
  return (
    marker === JPEG_SOI ||
    marker === JPEG_TEM ||
    (marker >= JPEG_RST_FIRST && marker <= JPEG_RST_LAST)
  );
}

// Recorre los segmentos desde el inicio (después de FF D8) saltando cada uno
// por su largo, sin mirar su contenido, hasta el SOS de la imagen principal.
// Un segmento que declara más bytes de los recibidos es un archivo cortado.
// Desde el SOS, los datos de imagen nunca contienen FF D9 por azar (todo FF
// de datos va seguido de 00 o de un marcador RST), así que basta con buscar
// el fin de imagen después de él.
function hasJpegEndAfterMainScan(content: Buffer): boolean {
  let offset = 2;
  while (offset < content.length) {
    if (content[offset] !== JPEG_MARKER_PREFIX) return false;
    // Bytes de relleno FF antes del marcador.
    while (offset < content.length && content[offset] === JPEG_MARKER_PREFIX) {
      offset += 1;
    }
    if (offset >= content.length) return false;
    const marker = content[offset];
    offset += 1;
    if (isStandaloneJpegMarker(marker)) continue;
    // Fin de imagen antes de cualquier dato de imagen: no hay foto.
    if (marker === JPEG_EOI[1]) return false;
    if (offset + 2 > content.length) return false;
    const length = content.readUInt16BE(offset);
    // El largo incluye sus propios 2 bytes.
    if (length < 2 || offset + length > content.length) return false;
    offset += length;
    if (marker === JPEG_SOS) {
      return content.indexOf(JPEG_EOI, offset) !== -1;
    }
  }
  return false;
}
