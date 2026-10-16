import type { AllowedMimeType } from '../types/storage.types.js';

// Detección del tipo real por "magic bytes" (SPRINT-2-T04): los primeros bytes
// de cada formato son fijos, a diferencia de la extensión o del tipo que
// declara el navegador, que el usuario puede cambiar.

const SIGNATURES: ReadonlyArray<{ mimeType: AllowedMimeType; bytes: Buffer }> =
  [
    // "%PDF-"
    {
      mimeType: 'application/pdf',
      bytes: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
    },
    {
      mimeType: 'image/png',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
    { mimeType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]) },
  ];

// Devuelve el tipo permitido que corresponde al contenido, o null si no es
// ninguno de los permitidos.
export function detectMimeType(content: Buffer): AllowedMimeType | null {
  const match = SIGNATURES.find(
    ({ bytes }) =>
      content.length >= bytes.length &&
      content.subarray(0, bytes.length).equals(bytes),
  );
  return match ? match.mimeType : null;
}
