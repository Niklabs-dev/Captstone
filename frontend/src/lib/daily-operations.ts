import { isRecord } from './auth';
import { isUuid } from './users';
import { formatClp, isTipDate } from './tips';

// Contrato SPRINT-4R-T01/T03: una operación diaria por local y fecha con
// propina tarjeta, voucher privado, propina efectivo, diferencia de efectivo
// declarada y trabajadores participantes del reparto (solo id y nombre).
export const MAX_DAILY_AMOUNT = 9_999_999_999;
export const MAX_DIFFERENCE_REASON_LENGTH = 500;
export const MAX_VOUCHER_BYTES = 5 * 1024 * 1024;
export const VOUCHER_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type VoucherMimeType = (typeof VOUCHER_MIME_TYPES)[number];
export const DAILY_STORE_INACTIVE_MESSAGE =
  'Tu local está inactivo. Consulta con el administrador para volver a registrar la operación diaria. Puedes seguir consultando el historial.';

export interface DailyOperationParticipant {
  id: string;
  name: string;
}
export interface DailyOperationVoucher {
  id: string;
  fileName: string;
  mimeType: VoucherMimeType;
  sizeBytes: number;
  sha256Hash: string;
  createdAt: string;
}
export interface DailyOperation {
  id: string;
  store: { id: string; name: string };
  businessDate: string;
  cardTipAmount: number;
  cashTipAmount: number;
  tipFundAmount: number;
  cashDifference: number;
  differenceReason: string | null;
  voucher: DailyOperationVoucher | null;
  participants: DailyOperationParticipant[];
  responsible: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}
export interface DailyOperationFormFields {
  businessDate: string;
  cardTipAmount: string;
  cashTipAmount: string;
  cashDifference: string;
  differenceReason: string;
}
export type DailyOperationField =
  keyof DailyOperationFormFields | 'voucher' | 'participants';
export type DailyOperationFieldErrors = Partial<
  Record<DailyOperationField, string>
>;

export function isDailyAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DAILY_AMOUNT
  );
}
export function parseDailyAmount(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const amount = Number(text);
  return isDailyAmount(amount) ? amount : null;
}
export function isCashDifference(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_DAILY_AMOUNT
  );
}
// La diferencia se declara con signo: sobrante positivo, faltante negativo.
export function parseCashDifference(value: string): number | null {
  const text = value.trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const difference = Number(text);
  if (!isCashDifference(difference)) return null;
  return difference === 0 ? 0 : difference;
}
export function isVoucherMimeType(value: unknown): value is VoucherMimeType {
  return (
    typeof value === 'string' &&
    (VOUCHER_MIME_TYPES as readonly string[]).includes(value)
  );
}
// Validación compartida entre la interfaz y el proxy del voucher adjunto.
export function voucherFileError(file: {
  size: number;
  type: string;
}): string | null {
  if (!isVoucherMimeType(file.type))
    return 'La foto del voucher debe estar en formato JPEG, PNG o WebP.';
  if (file.size > MAX_VOUCHER_BYTES)
    return 'La foto del voucher supera el máximo de 5 MiB.';
  if (file.size === 0)
    return 'La foto del voucher está vacía. Vuelve a tomarla.';
  return null;
}
export function dailyOperationFieldErrors(
  fields: DailyOperationFormFields,
  voucherSelected: boolean,
): DailyOperationFieldErrors {
  const errors: DailyOperationFieldErrors = {};
  const cardTip = parseDailyAmount(fields.cardTipAmount);
  const cashTip = parseDailyAmount(fields.cashTipAmount);
  const difference = parseCashDifference(fields.cashDifference);
  const reason = fields.differenceReason.trim();
  if (!isTipDate(fields.businessDate))
    errors.businessDate = 'Selecciona una fecha válida.';
  if (cardTip === null)
    errors.cardTipAmount = fields.cardTipAmount.trim()
      ? 'Ingresa pesos completos entre 0 y 9.999.999.999, sin puntos, decimales ni negativos.'
      : 'Ingresa la propina recibida con tarjeta.';
  if (cashTip === null)
    errors.cashTipAmount = fields.cashTipAmount.trim()
      ? 'Ingresa pesos completos entre 0 y 9.999.999.999, sin puntos, decimales ni negativos.'
      : 'Ingresa la propina recibida en efectivo.';
  if (difference === null)
    errors.cashDifference = fields.cashDifference.trim()
      ? 'Ingresa pesos completos con signo (por ejemplo -1500 o 2000), sin puntos ni decimales.'
      : 'Ingresa la diferencia de efectivo con signo (0 si no hay diferencia).';
  if (reason.length > MAX_DIFFERENCE_REASON_LENGTH)
    errors.differenceReason =
      'El motivo debe tener como máximo 500 caracteres.';
  else if (difference !== null && difference !== 0 && !reason)
    errors.differenceReason =
      'Indica el motivo de la diferencia cuando no es cero.';
  if (cardTip !== null && cardTip > 0 && !voucherSelected)
    errors.voucher = 'Adjunta la foto del voucher de las propinas con tarjeta.';
  if (cardTip !== null && cardTip === 0 && voucherSelected)
    errors.voucher =
      'La foto del voucher solo se acepta cuando hay propina con tarjeta. Quítala o ingresa ese monto.';
  return errors;
}
// SPRINT-4R-T03: con fondo de propinas (tarjeta + efectivo) mayor que 0 se
// exige al menos un trabajador participante; con fondo 0 la selección es
// opcional. Montos nulos (aún inválidos) no agregan error aquí: lo reporta el
// campo correspondiente.
export function dailyParticipantSelectionError(
  cardTipAmount: number | null,
  cashTipAmount: number | null,
  participantCount: number,
): string | null {
  if (cardTipAmount === null || cashTipAmount === null) return null;
  if (cardTipAmount + cashTipAmount > 0 && participantCount < 1)
    return 'Selecciona al menos un trabajador participante: hay propinas por repartir.';
  return null;
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
// Catálogo de trabajadores elegibles del local (SPRINT-4R-T03): solo id y
// nombre, sin datos personales; el servicio los ordena por nombre y el
// cliente conserva ese orden. Se exige unicidad de IDs.
export function parseEligibleWorkers(
  value: unknown,
): DailyOperationParticipant[] | null {
  if (!Array.isArray(value)) return null;
  const workers: DailyOperationParticipant[] = [];
  for (const item of value) {
    if (!identity(item)) return null;
    if (workers.some((other) => other.id === item.id)) return null;
    workers.push({ id: item.id, name: item.name });
  }
  return workers;
}
function parseParticipants(value: unknown): DailyOperationParticipant[] | null {
  if (!Array.isArray(value)) return null;
  const participants: DailyOperationParticipant[] = [];
  for (const item of value) {
    if (!identity(item)) return null;
    if (participants.some((other) => other.id === item.id)) return null;
    participants.push({ id: item.id, name: item.name });
  }
  return participants;
}
function parseVoucher(value: unknown): DailyOperationVoucher | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.fileName !== 'string' ||
    !value.fileName.trim() ||
    value.fileName.length > 255 ||
    !isVoucherMimeType(value.mimeType) ||
    typeof value.sizeBytes !== 'number' ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes <= 0 ||
    value.sizeBytes > MAX_VOUCHER_BYTES ||
    typeof value.sha256Hash !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(value.sha256Hash) ||
    !timestamp(value.createdAt)
  )
    return null;
  return {
    id: value.id,
    fileName: value.fileName.trim(),
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    sha256Hash: value.sha256Hash,
    createdAt: value.createdAt,
  };
}
// Proyección estricta de la respuesta pública; con `date` se exige además la
// fecha consultada y con `storeId` el propio local de la sesión.
export function parseDailyOperation(
  value: unknown,
  storeId?: string,
  date?: string,
): DailyOperation | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isTipDate(value.businessDate) ||
    (date !== undefined && value.businessDate !== date) ||
    !isDailyAmount(value.cardTipAmount) ||
    !isDailyAmount(value.cashTipAmount) ||
    !isDailyAmount(value.tipFundAmount) ||
    value.tipFundAmount !== value.cardTipAmount + value.cashTipAmount ||
    !isCashDifference(value.cashDifference) ||
    (typeof value.differenceReason !== 'string' &&
      value.differenceReason !== null) ||
    (typeof value.differenceReason === 'string' &&
      (value.differenceReason.trim().length === 0 ||
        value.differenceReason.length > MAX_DIFFERENCE_REASON_LENGTH)) ||
    (value.cashDifference !== 0 &&
      typeof value.differenceReason !== 'string') ||
    !identity(value.store) ||
    (storeId !== undefined && value.store.id !== storeId) ||
    !identity(value.responsible) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt)
  )
    return null;
  const voucher = parseVoucher(value.voucher);
  if (value.voucher !== null && voucher === null) return null;
  const participants = parseParticipants(value.participants);
  if (participants === null) return null;
  return {
    id: value.id,
    store: { id: value.store.id, name: value.store.name },
    businessDate: value.businessDate,
    cardTipAmount: value.cardTipAmount,
    cashTipAmount: value.cashTipAmount,
    tipFundAmount: value.tipFundAmount,
    cashDifference: value.cashDifference,
    differenceReason:
      typeof value.differenceReason === 'string'
        ? value.differenceReason
        : null,
    voucher,
    participants,
    responsible: { id: value.responsible.id, name: value.responsible.name },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
// El contrato devuelve un arreglo de 0 o 1 operaciones por local y fecha.
export function parseDailyOperations(
  value: unknown,
  storeId: string,
  date: string,
): DailyOperation[] | null {
  if (!Array.isArray(value) || value.length > 1) return null;
  const operations: DailyOperation[] = [];
  for (const item of value) {
    const operation = parseDailyOperation(item, storeId, date);
    if (!operation || operations.some((other) => other.id === operation.id))
      return null;
    operations.push(operation);
  }
  return operations;
}
export function formatSignedClp(amount: number): string {
  if (amount > 0) return '+' + formatClp(amount);
  if (amount < 0) return '-' + formatClp(Math.abs(amount));
  return formatClp(0);
}
export function dailyOperationErrorMessage(status: number): string {
  const messages: Record<number, string> = {
    400: 'Revisa la fecha, los montos, la diferencia y el voucher antes de continuar.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'No tienes permiso para esta operación. Revisa el estado de tu cuenta y local con el administrador.',
    404: 'La operación ya no está disponible. Actualiza la página.',
    409: 'Ya existe una operación registrada para esta fecha con otros valores. Consúltala antes de continuar.',
    413: 'La foto del voucher supera el máximo de 5 MiB.',
    415: 'La foto del voucher debe estar en formato JPEG, PNG o WebP.',
    429: 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.',
    502: 'No se pudo verificar la respuesta del servicio. Actualiza la consulta antes de volver a guardar.',
    503: 'No se pudo conectar con el servicio. Conservamos los campos para que puedas reintentar.',
  };
  return messages[status] ?? messages[502];
}
