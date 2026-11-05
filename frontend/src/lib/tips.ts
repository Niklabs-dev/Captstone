import { isRecord } from './auth';
import { isUuid } from './users';

// Los medios de pago viven en el catálogo administrable (SPRINT-4-T32): el formulario
// consume los activos elegibles y el histórico conserva código y nombre aunque el
// medio se desactive. Ya no hay una lista fija de medios en el cliente.
export const TIP_INACTIVE_STORE_MESSAGE =
  'Tu local está inactivo. Consulta con el administrador para volver a registrar propinas. Puedes seguir consultando el historial.';
export const MAX_TIP_AMOUNT = 9_999_999_999;
export const MAX_TIP_ENTRIES_PER_DAY = 1000;
export interface TipInput {
  businessDate: string;
  paymentMethod: string;
  amount: number;
}
export interface TipEntry extends TipInput {
  paymentMethodName: string;
  id: string;
  store: { id: string; name: string };
  responsible: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}
export type TipField = keyof TipInput;
export type TipFields = Record<TipField, string>;
export type TipErrors = Partial<Record<TipField, string>>;

export function isTipDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
export function tipBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map((key) => parts.find((part) => part.type === key)?.value)
    .join('-');
}
// El código llega del catálogo; se valida forma básica y el backend es la autoridad.
export function isTipMethodCode(value: unknown): value is string {
  const code = typeof value === 'string' ? value.trim() : '';
  return (
    code.length > 0 && code.length <= 60 && !/[\u0000-\u001f\u007f]/.test(code)
  );
}
function isTipAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TIP_AMOUNT
  );
}
export function parseTipAmount(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const amount = Number(text);
  return isTipAmount(amount) ? amount : null;
}
export function tipFieldErrors(fields: TipFields): TipErrors {
  return {
    ...(!isTipDate(fields.businessDate)
      ? { businessDate: 'Selecciona una fecha válida.' }
      : {}),
    ...(!isTipMethodCode(fields.paymentMethod)
      ? { paymentMethod: 'Selecciona un medio de pago.' }
      : {}),
    ...(parseTipAmount(fields.amount) === null
      ? {
          amount: fields.amount.trim()
            ? 'Ingresa pesos completos entre 0 y 9.999.999.999, sin puntos, decimales ni negativos.'
            : 'Ingresa el monto de las propinas.',
        }
      : {}),
  };
}
export function parseTipInput(value: unknown): TipInput | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    Object.keys(value).some(
      (key) => !['businessDate', 'paymentMethod', 'amount'].includes(key),
    ) ||
    !isTipDate(value.businessDate) ||
    !isTipMethodCode(value.paymentMethod) ||
    !isTipAmount(value.amount)
  )
    return null;
  return {
    businessDate: value.businessDate,
    paymentMethod: value.paymentMethod.trim(),
    amount: value.amount,
  };
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function identity(value: unknown): value is { id: string; name: string } {
  return (
    isRecord(value) &&
    isUuid(value.id) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= 201
  );
}
export function parseTipEntry(
  value: unknown,
  storeId: string,
  date: string,
): TipEntry | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isTipDate(value.businessDate) ||
    value.businessDate !== date ||
    !isTipMethodCode(value.paymentMethod) ||
    typeof value.paymentMethodName !== 'string' ||
    !value.paymentMethodName.trim() ||
    value.paymentMethodName.length > 201 ||
    !isTipAmount(value.amount) ||
    !identity(value.store) ||
    value.store.id !== storeId ||
    !identity(value.responsible) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt)
  )
    return null;
  return {
    id: value.id,
    businessDate: value.businessDate,
    paymentMethod: value.paymentMethod.trim(),
    paymentMethodName: value.paymentMethodName.trim(),
    amount: value.amount,
    store: { id: value.store.id, name: value.store.name },
    responsible: { id: value.responsible.id, name: value.responsible.name },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
export function parseTipEntries(
  value: unknown,
  storeId: string,
  date: string,
): TipEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_TIP_ENTRIES_PER_DAY)
    return null;
  const entries: TipEntry[] = [];
  for (const item of value) {
    const entry = parseTipEntry(item, storeId, date);
    if (
      !entry ||
      entries.some(
        (previous) =>
          previous.id === entry.id ||
          previous.paymentMethod === entry.paymentMethod,
      )
    )
      return null;
    entries.push(entry);
  }
  return entries;
}
// Ordena por el catálogo administrado; los códigos históricos sin medio activo
// quedan al final ordenados por código, sin perderse.
export interface TipMethodOrder {
  code: string;
  sortOrder: number;
}
export function sortTipEntriesByCatalog(
  entries: readonly TipEntry[],
  catalog: readonly TipMethodOrder[],
): TipEntry[] {
  const order = new Map(
    catalog.map((method) => [method.code, method.sortOrder]),
  );
  return [...entries].sort((a, b) => {
    const first = order.get(a.paymentMethod);
    const second = order.get(b.paymentMethod);
    if (first !== undefined && second !== undefined)
      return first - second || a.paymentMethod.localeCompare(b.paymentMethod);
    if (first !== undefined) return -1;
    if (second !== undefined) return 1;
    return a.paymentMethod.localeCompare(b.paymentMethod);
  });
}
export function tipTotals(
  entries: readonly TipEntry[],
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries)
    totals.set(
      entry.paymentMethod,
      (totals.get(entry.paymentMethod) ?? 0) + entry.amount,
    );
  return totals;
}
export function formatClp(amount: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(amount);
}
export function tipErrorMessage(status: number): string {
  const messages: Record<number, string> = {
    400: 'Revisa la fecha, el medio de pago y el monto antes de continuar.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'No tienes permiso para esta operación. Revisa el estado de tu cuenta y local con el administrador.',
    404: 'El registro o local ya no está disponible. Actualiza la página.',
    409: 'Ya existe un registro para esta fecha y medio de pago con otro monto o responsable. Actualiza el listado para revisarlo.',
    429: 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.',
    502: 'No se pudo verificar la respuesta del servicio. Actualiza el listado antes de volver a guardar.',
    503: 'No se pudo conectar con el servicio. Conservamos los campos para que puedas reintentar.',
  };
  return messages[status] ?? messages[502];
}
