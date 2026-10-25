import { isObject, isUuid, type StoreOption } from './users';

export interface Store {
  id: string;
  name: string;
  city: string;
  address: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export type StoreInput = Pick<Store, 'name' | 'city' | 'address'>;
export type StoreField = keyof StoreInput;
export type StoreOperation = 'load' | 'save' | 'deactivate';
export const STORE_FIELDS = ['name', 'city', 'address'] as const;
export const STORE_LABELS: Record<StoreField, string> = {
  name: 'Nombre del local',
  city: 'Ciudad',
  address: 'Dirección',
};
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
    Object.keys(value).some(
      (key) => !STORE_FIELDS.some((field) => field === key),
    )
  )
    return null;
  if (STORE_FIELDS.some((field) => storeFieldError(field, value[field])))
    return null;
  if (
    typeof value.name !== 'string' ||
    typeof value.city !== 'string' ||
    typeof value.address !== 'string'
  )
    return null;
  return {
    name: normalizeStoreText(value.name),
    city: normalizeStoreText(value.city),
    address: normalizeStoreText(value.address),
  };
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
  const input = parseStoreInput({
    name: value.name,
    city: value.city,
    address: value.address,
  });
  if (!input) return null;
  return {
    ...input,
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
): string {
  if (status === 409 && operation === 'deactivate')
    return 'No se puede desactivar el local porque tiene usuarios activos asignados. Desactiva esas cuentas desde Usuarios antes de volver a intentarlo.';
  const messages: Record<number, string> = {
    400: 'Revisa el nombre, la ciudad y la dirección del local.',
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
