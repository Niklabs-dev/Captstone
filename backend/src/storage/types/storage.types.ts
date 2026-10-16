// Tipos y constantes del almacenamiento de archivos (SPRINT-2-T04).
// Deben coincidir con el frontend de S2-T10 (PR #21, `frontend/src/lib/documents.ts`).

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// Extensión del nombre físico según el tipo REAL detectado del contenido.
export const EXTENSION_BY_MIME_TYPE: Record<AllowedMimeType, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

// Tamaño máximo por archivo si no se define DOCUMENTS_MAX_SIZE_MB.
export const DEFAULT_MAX_SIZE_MB = 25;

// Tope de DOCUMENTS_MAX_SIZE_MB: el archivo se procesa completo en memoria.
export const MAX_ALLOWED_SIZE_MB = 100;

// Un MB = 1024 * 1024 bytes, igual que MAX_DOCUMENT_BYTES del frontend.
export const BYTES_PER_MB = 1024 * 1024;

// Resultado de guardar un archivo; se corresponde con los campos de
// DocumentVersion (filePath, mimeType, sizeBytes, sha256Hash).
export interface StoredFile {
  // Ruta relativa a DOCUMENTS_STORAGE_PATH, siempre con "/" (ej. 2026/10/<uuid>.pdf).
  relativePath: string;
  mimeType: AllowedMimeType;
  sizeBytes: number;
  // Hash SHA-256 en hexadecimal (64 caracteres).
  sha256Hash: string;
}
