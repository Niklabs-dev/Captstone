// ID de local asignado por Subway (SPRINT-4A-T15). Es la misma regla del
// CHECK stores_subway_store_id_digits (migración
// 20261110010000_locales_id_subway): solo dígitos, de 1 a 10. Se guarda como
// texto para conservar el valor exacto que informa Subway.
export const SUBWAY_STORE_ID_PATTERN = /^[0-9]{1,10}$/;

export const SUBWAY_STORE_ID_MAX_LENGTH = 10;

// Índice único del ID Subway: distingue su violación (P2002) de la del nombre.
export const SUBWAY_STORE_ID_UNIQUE_INDEX = 'stores_subway_store_id_key';

export function isValidSubwayStoreId(value: string): boolean {
  return SUBWAY_STORE_ID_PATTERN.test(value);
}

// Nombre del índice único que rechazó la escritura, según los metadatos que
// entrega el adaptador de PostgreSQL de Prisma; null si no vienen.
export function violatedUniqueIndex(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) return null;
  const adapterError = (meta as { driverAdapterError?: unknown })
    .driverAdapterError;
  if (typeof adapterError !== 'object' || adapterError === null) return null;
  const cause = (adapterError as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || cause === null) return null;
  const constraint = (cause as { constraint?: unknown }).constraint;
  if (typeof constraint !== 'object' || constraint === null) return null;
  const index = (constraint as { index?: unknown }).index;
  return typeof index === 'string' ? index : null;
}
