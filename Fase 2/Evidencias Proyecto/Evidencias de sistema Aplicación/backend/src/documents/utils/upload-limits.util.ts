import {
  BYTES_PER_MB,
  DEFAULT_MAX_SIZE_MB,
  MAX_ALLOWED_SIZE_MB,
} from '../../storage/types/storage.types.js';

// Tamaño máximo de carga en bytes según DOCUMENTS_MAX_SIZE_MB (SPRINT-2-T05):
// límite de Multer y valor que informa el listado (SPRINT-2-T06). Un valor
// inválido ya lo rechaza StorageService al iniciar la aplicación.
export function maxUploadBytes(value: string | undefined): number {
  const sizeMb = Number(value);
  const valid =
    Number.isSafeInteger(sizeMb) &&
    sizeMb >= 1 &&
    sizeMb <= MAX_ALLOWED_SIZE_MB;
  return (valid ? sizeMb : DEFAULT_MAX_SIZE_MB) * BYTES_PER_MB;
}
