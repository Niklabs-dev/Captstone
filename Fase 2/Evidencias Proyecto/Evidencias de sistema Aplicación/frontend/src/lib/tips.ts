import { isRecord } from './auth';
import { isUuid } from './users';

export const TIP_METHODS = [
  'CASH',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'TRANSFER',
] as const;
export type TipMethod = (typeof TIP_METHODS)[number];
export const TIP_LABELS: Record<TipMethod, string> = {
  CASH: 'Efectivo',
  DEBIT_CARD: 'Tarjeta de débito',
  CREDIT_CARD: 'Tarjeta de crédito',
  TRANSFER: 'Transferencia',
};
export const TIP_INACTIVE_STORE_MESSAGE =
  'Tu local está inactivo. Consulta con el administrador para volver a registrar propinas. Puedes seguir consultando el historial.';
export const MAX_TIP_AMOUNT = 9_999_999_999;
export interface TipInput {
  businessDate: string;
  paymentMethod: TipMethod;
  amount: number;
}
export interface TipEntry extends TipInput {
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
export function isTipMethod(value: unknown): value is TipMethod {
  return TIP_METHODS.some((method) => method === value);
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
    ...(!isTipMethod(fields.paymentMethod)
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
    !isTipMethod(value.paymentMethod) ||
    !isTipAmount(value.amount)
  )
    return null;
  return {
    businessDate: value.businessDate,
    paymentMethod: value.paymentMethod,
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
    !isTipMethod(value.paymentMethod) ||
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
    paymentMethod: value.paymentMethod,
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
  if (!Array.isArray(value) || value.length > TIP_METHODS.length) return null;
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
  return entries.sort(
    (a, b) =>
      TIP_METHODS.indexOf(a.paymentMethod) -
      TIP_METHODS.indexOf(b.paymentMethod),
  );
}
export function tipTotals(
  entries: readonly TipEntry[],
): Record<TipMethod, number> {
  const totals: Record<TipMethod, number> = {
    CASH: 0,
    DEBIT_CARD: 0,
    CREDIT_CARD: 0,
    TRANSFER: 0,
  };
  for (const entry of entries) totals[entry.paymentMethod] += entry.amount;
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
