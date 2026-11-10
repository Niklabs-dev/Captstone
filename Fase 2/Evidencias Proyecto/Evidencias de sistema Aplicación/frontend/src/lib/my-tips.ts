import { isRecord } from './auth';
import { isTipDate } from './tips';
import { isUuid } from './users';

// Portal del trabajador (SPRINT-4A-T10): «Mis propinas» por día con su estado
// de pago, contrato de GET /my-tips (SPRINT-4A-T09). Funciones puras,
// compartidas por la página, la consulta al backend y las pruebas.

export type MyTipStatus = 'UNPAID' | 'PAID';
export interface MyTipDay {
  id: string;
  businessDate: string;
  store: { id: string; name: string };
  amount: number;
  status: MyTipStatus;
  paymentBatchId: string | null;
  paidAt: string | null;
}
export interface MyTips {
  from: string;
  to: string;
  days: MyTipDay[];
  totals: {
    totalAmount: number;
    paidAmount: number;
    unpaidAmount: number;
    dayCount: number;
  };
}
export interface MonthRange {
  // Mes consultado, YYYY-MM.
  month: string;
  from: string;
  to: string;
}

// Meses ofrecidos en el filtro, contando el actual.
export const MONTH_OPTION_COUNT = 24;

const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseDay(value: unknown): MyTipDay | null {
  if (!isRecord(value) || !isRecord(value.store)) return null;
  const { store } = value;
  const paid = value.status === 'PAID';
  // Una propina pagada lleva su lote y su fecha de pago; una pendiente, ninguno.
  const consistent = paid
    ? isUuid(value.paymentBatchId) &&
      typeof value.paidAt === 'string' &&
      Number.isFinite(Date.parse(value.paidAt))
    : value.status === 'UNPAID' &&
      value.paymentBatchId === null &&
      value.paidAt === null;
  return isUuid(value.id) &&
    isTipDate(value.businessDate) &&
    isUuid(store.id) &&
    typeof store.name === 'string' &&
    store.name.trim().length > 0 &&
    amount(value.amount) &&
    consistent
    ? {
        id: value.id,
        businessDate: value.businessDate,
        store: { id: store.id, name: store.name },
        amount: value.amount,
        status: paid ? 'PAID' : 'UNPAID',
        paymentBatchId: paid ? (value.paymentBatchId as string) : null,
        paidAt: paid ? (value.paidAt as string) : null,
      }
    : null;
}

// Valida la respuesta del backend: días dentro del rango, sin repetir, y
// totales que cuadran con los días (pendiente + pagado = total).
export function parseMyTips(value: unknown): MyTips | null {
  if (
    !isRecord(value) ||
    !isTipDate(value.from) ||
    !isTipDate(value.to) ||
    value.from > value.to ||
    !Array.isArray(value.days) ||
    !isRecord(value.totals)
  )
    return null;
  const { from, to, totals } = value;
  const days: MyTipDay[] = [];
  for (const item of value.days) {
    const day = parseDay(item);
    if (!day || day.businessDate < from || day.businessDate > to) return null;
    days.push(day);
  }
  if (new Set(days.map((day) => day.id)).size !== days.length) return null;
  const sum = (status: MyTipStatus): number =>
    days
      .filter((day) => day.status === status)
      .reduce((total, day) => total + day.amount, 0);
  const paidAmount = sum('PAID');
  const unpaidAmount = sum('UNPAID');
  if (
    totals.paidAmount !== paidAmount ||
    totals.unpaidAmount !== unpaidAmount ||
    totals.totalAmount !== paidAmount + unpaidAmount ||
    totals.dayCount !== new Set(days.map((day) => day.businessDate)).size
  )
    return null;
  return {
    from,
    to,
    days,
    totals: {
      totalAmount: paidAmount + unpaidAmount,
      paidAmount,
      unpaidAmount,
      dayCount: totals.dayCount,
    },
  };
}

// --- Filtro por mes ----------------------------------------------------------

function isMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}
// Del día 1 al último día del mes (el backend admite hasta 62 días).
export function monthRange(month: string): MonthRange {
  const [year, number] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return {
    month,
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}
export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export type MonthFilterResult =
  | { ok: true; range: MonthRange }
  | { ok: false; range: MonthRange; message: string };
// Mes de la URL (?month=YYYY-MM); sin él, el mes en curso de hoy (día de
// negocio en Chile). Un mes futuro o mal escrito vuelve al mes actual.
export function parseMonthFilter(
  value: string | string[] | undefined,
  today: string,
): MonthFilterResult {
  const current = monthRange(today.slice(0, 7));
  const raw = (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  if (!raw) return { ok: true, range: current };
  if (!isMonth(raw))
    return {
      ok: false,
      range: current,
      message: 'El mes indicado no es válido. Te mostramos el mes actual.',
    };
  if (raw > current.month)
    return {
      ok: false,
      range: current,
      message: 'Aún no hay propinas para ese mes. Te mostramos el mes actual.',
    };
  return { ok: true, range: monthRange(raw) };
}
// Meses del filtro, del actual hacia atrás; incluye el consultado si es más
// antiguo que el último ofrecido.
export function monthOptions(today: string, selected: string): string[] {
  const current = today.slice(0, 7);
  const options = Array.from({ length: MONTH_OPTION_COUNT }, (_, index) =>
    shiftMonth(current, -index),
  );
  return options.includes(selected) ? options : [...options, selected];
}

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
export function formatMonth(month: string): string {
  const [year, number] = month.split('-').map(Number);
  const name = MONTH_NAMES[number - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`;
}
export function myTipsPageHref(month: string): string {
  return '/portal/propinas?' + new URLSearchParams({ month }).toString();
}
export function myTipsBackendPath(range: MonthRange): string {
  return (
    '/my-tips?' +
    new URLSearchParams({ from: range.from, to: range.to }).toString()
  );
}

// --- Presentación -------------------------------------------------------------

export function myTipStatusLabel(status: MyTipStatus): string {
  return status === 'PAID' ? 'Pagada' : 'No pagada';
}
const WEEKDAYS = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];
// Día de la semana de una fecha calendario (no depende de la zona horaria).
export function weekdayOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function myTipsError(status: number): string {
  if (status === 401) return 'Tu sesión venció. Vuelve a iniciar sesión.';
  if (status === 403)
    return 'Tu cuenta no tiene permiso para consultar estas propinas.';
  if (status === 400)
    return 'El mes consultado no es válido. Elige otro mes e intenta nuevamente.';
  if (status === 429)
    return 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.';
  if (status === 503)
    return 'No se pudo conectar con el servicio de propinas. Intenta nuevamente más tarde.';
  return 'No se pudieron consultar tus propinas. Intenta nuevamente en unos momentos.';
}
