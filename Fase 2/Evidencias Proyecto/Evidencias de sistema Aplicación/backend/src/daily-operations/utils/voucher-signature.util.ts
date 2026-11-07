import type { VoucherMimeType } from '../types/daily-operations.types.js';

// Detección del tipo real del voucher por "magic bytes" (SPRINT-4R-T01):
// los primeros bytes de cada formato son fijos, a diferencia de la extensión
// o del tipo que declara el navegador, que el usuario puede cambiar.
// WebP: "RIFF" (0-3) ... "WEBP" (8-11), con el tamaño del chunk en 4-7.

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
const WEBP = Buffer.from([0x57, 0x45, 0x42, 0x50]); // "WEBP"

// Extensión del nombre físico según el tipo REAL detectado del contenido.
export const VOUCHER_EXTENSION_BY_MIME_TYPE: Record<VoucherMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Devuelve el tipo permitido que corresponde al contenido, o null si no es
// ninguno de los aceptados (JPEG, PNG o WebP).
export function detectVoucherMimeType(content: Buffer): VoucherMimeType | null {
  if (content.length >= JPEG.length && content.subarray(0, 3).equals(JPEG)) {
    return 'image/jpeg';
  }
  if (content.length >= PNG.length && content.subarray(0, 8).equals(PNG)) {
    return 'image/png';
  }
  if (
    content.length >= 12 &&
    content.subarray(0, 4).equals(RIFF) &&
    content.subarray(8, 12).equals(WEBP)
  ) {
    return 'image/webp';
  }
  return null;
}
