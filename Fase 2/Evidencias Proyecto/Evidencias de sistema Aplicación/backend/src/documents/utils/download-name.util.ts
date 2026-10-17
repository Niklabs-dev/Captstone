import { EXTENSION_BY_MIME_TYPE } from '../../storage/types/storage.types.js';

// Nombre y cabecera Content-Disposition de una descarga (SPRINT-2-T06).
// Funciones puras, sin NestJS, para testearlas directamente.

const MAX_TITLE_LENGTH = 100;

// Caracteres no válidos en nombres de archivo de Windows/macOS, los de
// control y ";" (separa parámetros en la cabecera).
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f"\\/:*?<>|;]/g;

// Nombre generado sin datos personales: <TIPO>_<título>_v<N>.<ext>. La
// extensión sale del tipo real detectado al cargar, no del nombre original
// (que puede traer el nombre o RUT del trabajador).
export function buildDownloadFileName(
  typeCode: string,
  title: string,
  versionNumber: number,
  mimeType: string,
): string {
  const extensions: Record<string, string | undefined> = EXTENSION_BY_MIME_TYPE;
  const safeTitle =
    Array.from(
      title
        .normalize('NFC')
        .replace(UNSAFE_CHARACTERS, '')
        .trim()
        .replace(/\s+/g, '-'),
    )
      .slice(0, MAX_TITLE_LENGTH)
      .join('') || 'documento';
  return `${typeCode}_${safeTitle}_v${versionNumber}.${extensions[mimeType] ?? 'bin'}`;
}

// Content-Disposition con filename (solo ASCII, para clientes antiguos) y
// filename* (UTF-8, RFC 6266/5987) que conserva tildes y ñ.
export function contentDisposition(fileName: string): string {
  const asciiName = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encodedName = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
