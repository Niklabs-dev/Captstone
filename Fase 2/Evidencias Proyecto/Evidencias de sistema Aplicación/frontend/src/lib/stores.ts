import { isObject, isUuid, type StoreOption } from './users';

export interface Store {
  id: string;
  name: string;
  city: string;
  address: string;
  // ID que Subway asigna al local; null mientras no esté configurado.
  subwayStoreId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export type StoreTextField = 'name' | 'city' | 'address';
// subwayStoreId omitido conserva el valor actual al editar; null lo quita.
export type StoreInput = Pick<Store, StoreTextField> & {
  subwayStoreId?: string | null;
};
export type StoreField = keyof StoreInput;
export type StoreOperation = 'load' | 'save' | 'deactivate';
// Código seguro que el BFF entrega para distinguir el conflicto del ID Subway.
export type StoreErrorCode = 'SUBWAY_STORE_ID_TAKEN';
export const STORE_FIELDS = ['name', 'city', 'address'] as const;
const STORE_INPUT_KEYS: readonly string[] = [...STORE_FIELDS, 'subwayStoreId'];
export const STORE_LABELS: Record<StoreField, string> = {
  name: 'Nombre del local',
  city: 'Ciudad',
  address: 'Dirección',
  subwayStoreId: 'ID Subway',
};
// Misma regla del backend (SUBWAY_STORE_ID_PATTERN): solo dígitos, de 1 a 10.
export const SUBWAY_STORE_ID_PATTERN = /^[0-9]{1,10}$/;
export const SUBWAY_STORE_ID_MAX_LENGTH = 10;
export const SUBWAY_STORE_ID_HELP =
  'Es el número que identifica al local en el informe de ventas de MrComanda: el que aparece después del guion en el encabezado (ej. en «208 - 72597» el ID Subway es 72597). Déjalo vacío si aún no lo conoces.';
// Como el backend, solo recorta los extremos; vacío equivale a sin ID Subway.
export function normalizeSubwayStoreId(value: string): string | null {
  const text = value.trim();
  return text ? text : null;
}
export function subwayStoreIdError(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    return 'Usa solo dígitos, sin espacios, puntos ni guiones (ej. 72597).';
  const text = normalizeSubwayStoreId(value);
  if (text === null || SUBWAY_STORE_ID_PATTERN.test(text)) return null;
  // Encabezado completo del informe («208 - 72597»): se sugiere el número correcto.
  const suffix = /^[0-9]+\s*-\s*([0-9]{1,10})$/.exec(text)?.[1];
  if (suffix) return `Usa solo el número después del guion: ${suffix}.`;
  if (/^[0-9]+$/.test(text))
    return `Admite hasta ${SUBWAY_STORE_ID_MAX_LENGTH} dígitos.`;
  return 'Usa solo dígitos, sin espacios, puntos ni guiones (ej. 72597).';
}
export function parseStoreErrorCode(
  value: unknown,
): StoreErrorCode | undefined {
  return value === 'SUBWAY_STORE_ID_TAKEN' ? value : undefined;
}
export function normalizeStoreText(value: string): string {
  return value
    .replace(/\p{Cf}/gu, '')
    .trim()
    .replace(/\s+/gu, ' ');
}
export function storeFieldError(
  field: StoreField,
  value: unknown,
): string | null {
  if (typeof value !== 'string') return 'Completa este campo.';
  const text = normalizeStoreText(value);
  const limit = field === 'address' ? 200 : 100;
  if (!text) return 'Completa este campo.';
  if (text.length > limit) return `Admite hasta ${limit} caracteres.`;
  if (/[\u0000-\u001f\u007f]/.test(text))
    return 'Quita los caracteres de control.';
  if (!(field === 'address' ? /[\p{L}\p{N}]/u : /\p{L}/u).test(text))
    return field === 'address'
      ? 'Incluye una letra o número.'
      : 'Incluye al menos una letra.';
  return null;
}
export function parseStoreInput(value: unknown): StoreInput | null {
  if (
    !isObject(value) ||
    Object.keys(value).some((key) => !STORE_INPUT_KEYS.includes(key))
  )
    return null;
  if (
    STORE_FIELDS.some((field) => storeFieldError(field, value[field])) ||
    subwayStoreIdError(value.subwayStoreId)
  )
    return null;
  if (
    typeof value.name !== 'string' ||
    typeof value.city !== 'string' ||
    typeof value.address !== 'string'
  )
    return null;
  const input: StoreInput = {
    name: normalizeStoreText(value.name),
    city: normalizeStoreText(value.city),
    address: normalizeStoreText(value.address),
  };
  if (value.subwayStoreId !== undefined)
    input.subwayStoreId =
      typeof value.subwayStoreId === 'string'
        ? normalizeSubwayStoreId(value.subwayStoreId)
        : null;
  return input;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
export function parseStore(value: unknown): Store | null {
  if (
    !isObject(value) ||
    !isUuid(value.id) ||
    typeof value.isActive !== 'boolean' ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt)
  )
    return null;
  // Un catálogo sin el campo se lee como «sin configurar» para no bloquear
  // las vistas que solo usan el nombre; un valor con otro formato se rechaza.
  const subwayStoreId = value.subwayStoreId ?? null;
  if (
    subwayStoreId !== null &&
    (typeof subwayStoreId !== 'string' ||
      !SUBWAY_STORE_ID_PATTERN.test(subwayStoreId))
  )
    return null;
  const input = parseStoreInput({
    name: value.name,
    city: value.city,
    address: value.address,
  });
  if (!input) return null;
  return {
    ...input,
    subwayStoreId,
    id: value.id,
    isActive: value.isActive,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
export function parseStores(value: unknown): Store[] | null {
  if (!Array.isArray(value)) return null;
  const items: Store[] = [];
  for (const candidate of value) {
    const store = parseStore(candidate);
    if (!store || items.some((item) => item.id === store.id)) return null;
    items.push(store);
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
export function storeOptions(
  stores: Store[],
  activeOnly = false,
): StoreOption[] {
  return stores
    .filter((store) => !activeOnly || store.isActive)
    .map(({ id, name, isActive }) => ({ id, name, isActive }));
}
export function storeErrorMessage(
  status: number,
  operation: StoreOperation = 'save',
  code?: StoreErrorCode,
): string {
  if (status === 409 && operation === 'deactivate')
    return 'No se puede desactivar el local porque tiene usuarios activos asignados. Desactiva esas cuentas desde Usuarios antes de volver a intentarlo.';
  if (status === 409 && code === 'SUBWAY_STORE_ID_TAKEN')
    return 'Ya existe un local con ese ID Subway. Revisa el número en el informe de ventas de MrComanda: cada local tiene un ID Subway distinto.';
  const messages: Record<number, string> = {
    400: 'Revisa el nombre, la ciudad, la dirección y el ID Subway del local.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'No tienes permiso para administrar locales.',
    404: 'El local ya no está disponible. Actualiza el catálogo.',
    409: 'Ya existe un local con ese nombre. Usa otro nombre, incluso si el existente está inactivo.',
    502: 'La respuesta del catálogo no pudo verificarse. Actualiza antes de repetir la operación.',
    503: 'No se pudo conectar con el catálogo de locales. Intenta nuevamente.',
  };
  return (
    messages[status] ??
    (operation === 'load'
      ? 'No se pudo cargar el catálogo de locales. Vuelve a cargar la vista o actualiza el catálogo.'
      : 'No se pudo guardar el local. Intenta nuevamente.')
  );
}
