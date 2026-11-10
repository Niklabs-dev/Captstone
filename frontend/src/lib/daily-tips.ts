import { isRecord } from './auth';
import { formatCalendarDate } from './display-date';
import { formatClp, isTipDate } from './tips';
import { isUuid } from './users';

// Vista de propinas del administrador y el contador (SPRINT-4A-T07):
// contratos de GET /daily-tips/days, /day y /summary (SPRINT-4A-T04), la
// exportación Excel (SPRINT-4A-T05) y los lotes de pago (SPRINT-4A-T06).
// Funciones puras, compartidas por la página, el BFF, el cliente y las pruebas.

export const MAX_DAILY_TIPS_RANGE_DAYS = 62;
export const DAY_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];
export const ALLOCATION_STATUSES = ['UNPAID', 'PAID'] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface TipRef {
  id: string;
  name: string;
}
export interface TipAmounts {
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
}
export interface TipDay extends TipAmounts {
  operationId: string;
  businessDate: string;
  tipFundAmount: number;
  participantCount: number;
  status: DayStatus;
}
export interface TipDays {
  store: TipRef;
  from: string;
  to: string;
  days: TipDay[];
  totals: TipAmounts & { dayCount: number };
}
export interface TipAllocation {
  id: string;
  worker: TipRef;
  amount: number;
  status: AllocationStatus;
  paymentBatchId: string | null;
  paidAt: string | null;
}
export interface TipDayDetail extends TipDay {
  store: TipRef;
  allocations: TipAllocation[];
}
export interface TipWorkerSummary extends TipAmounts {
  worker: TipRef;
  dayCount: number;
}
export interface TipSummary {
  store: TipRef;
  from: string;
  to: string;
  status: AllocationStatus | null;
  workers: TipWorkerSummary[];
  totals: TipAmounts & { workerCount: number; dayCount: number };
}
export interface PaymentBatch {
  id: string;
  store: TipRef;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  allocationCount: number;
  workerCount: number;
  paidBy: TipRef;
  paidAt: string;
}
export interface TipsRange {
  storeId: string;
  from: string;
  to: string;
}

// --- Validación del contrato -------------------------------------------------

const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const instant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

function list<T>(
  value: unknown,
  parse: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}
function parseRef(value: unknown): TipRef | null {
  return isRecord(value) && isUuid(value.id) && text(value.name)
    ? { id: value.id, name: value.name }
    : null;
}
// Los montos deben cuadrar: total = pagado + pendiente.
function parseAmounts(value: unknown): TipAmounts | null {
  return isRecord(value) &&
    amount(value.totalAmount) &&
    amount(value.paidAmount) &&
    amount(value.unpaidAmount) &&
    value.totalAmount === value.paidAmount + value.unpaidAmount
    ? {
        totalAmount: value.totalAmount,
        paidAmount: value.paidAmount,
        unpaidAmount: value.unpaidAmount,
      }
    : null;
}
const isDayStatus = (value: unknown): value is DayStatus =>
  DAY_STATUSES.some((status) => status === value);
const isAllocationStatus = (value: unknown): value is AllocationStatus =>
  ALLOCATION_STATUSES.some((status) => status === value);

function parseDay(value: unknown): TipDay | null {
  const amounts = parseAmounts(value);
  return amounts &&
    isRecord(value) &&
    isUuid(value.operationId) &&
    isTipDate(value.businessDate) &&
    amount(value.tipFundAmount) &&
    amount(value.participantCount) &&
    isDayStatus(value.status)
    ? {
        ...amounts,
        operationId: value.operationId,
        businessDate: value.businessDate,
        tipFundAmount: value.tipFundAmount,
        participantCount: value.participantCount,
        status: value.status,
      }
    : null;
}
function parseRangeHeader(
  value: unknown,
): { store: TipRef; from: string; to: string } | null {
  if (!isRecord(value)) return null;
  const store = parseRef(value.store);
  return store &&
    isTipDate(value.from) &&
    isTipDate(value.to) &&
    value.from <= value.to
    ? { store, from: value.from, to: value.to }
    : null;
}

export function parseTipDays(value: unknown): TipDays | null {
  const header = parseRangeHeader(value);
  if (!header || !isRecord(value) || !isRecord(value.totals)) return null;
  const days = list(value.days, parseDay);
  const totals = parseAmounts(value.totals);
  if (!days || !totals || !amount(value.totals.dayCount)) return null;
  return {
    ...header,
    days,
    totals: { ...totals, dayCount: value.totals.dayCount },
  };
}
function parseAllocation(value: unknown): TipAllocation | null {
  if (!isRecord(value)) return null;
  const worker = parseRef(value.worker);
  const paid = value.status === 'PAID';
  // Una propina pagada lleva su lote y su fecha; una pendiente, ninguno.
  return worker &&
    isUuid(value.id) &&
    amount(value.amount) &&
    isAllocationStatus(value.status) &&
    (paid
      ? isUuid(value.paymentBatchId) && instant(value.paidAt)
      : value.paymentBatchId === null && value.paidAt === null)
    ? {
        id: value.id,
        worker,
        amount: value.amount,
        status: value.status,
        paymentBatchId: paid ? (value.paymentBatchId as string) : null,
        paidAt: paid ? (value.paidAt as string) : null,
      }
    : null;
}
export function parseTipDayDetail(value: unknown): TipDayDetail | null {
  const day = parseDay(value);
  if (!day || !isRecord(value)) return null;
  const store = parseRef(value.store);
  const allocations = list(value.allocations, parseAllocation);
  return store && allocations ? { ...day, store, allocations } : null;
}
function parseWorkerSummary(value: unknown): TipWorkerSummary | null {
  const amounts = parseAmounts(value);
  if (!amounts || !isRecord(value)) return null;
  const worker = parseRef(value.worker);
  return worker && amount(value.dayCount)
    ? { ...amounts, worker, dayCount: value.dayCount }
    : null;
}
export function parseTipSummary(value: unknown): TipSummary | null {
  const header = parseRangeHeader(value);
  if (!header || !isRecord(value) || !isRecord(value.totals)) return null;
  const workers = list(value.workers, parseWorkerSummary);
  const totals = parseAmounts(value.totals);
  if (
    !workers ||
    !totals ||
    !(value.status === null || isAllocationStatus(value.status)) ||
    !amount(value.totals.workerCount) ||
    !amount(value.totals.dayCount)
  )
    return null;
  return {
    ...header,
    status: value.status,
    workers,
    totals: {
      ...totals,
      workerCount: value.totals.workerCount,
      dayCount: value.totals.dayCount,
    },
  };
}
export function parsePaymentBatch(value: unknown): PaymentBatch | null {
  if (!isRecord(value)) return null;
  const store = parseRef(value.store);
  const paidBy = parseRef(value.paidBy);
  return store &&
    paidBy &&
    isUuid(value.id) &&
    isTipDate(value.periodStart) &&
    isTipDate(value.periodEnd) &&
    value.periodStart <= value.periodEnd &&
    amount(value.totalAmount) &&
    amount(value.allocationCount) &&
    amount(value.workerCount) &&
    instant(value.paidAt)
    ? {
        id: value.id,
        store,
        periodStart: value.periodStart,
        periodEnd: value.periodEnd,
        totalAmount: value.totalAmount,
        allocationCount: value.allocationCount,
        workerCount: value.workerCount,
        paidBy,
        paidAt: value.paidAt,
      }
    : null;
}
export function parsePaymentBatches(value: unknown): PaymentBatch[] | null {
  return isRecord(value) ? list(value.batches, parsePaymentBatch) : null;
}

// --- Consultas del BFF -------------------------------------------------------

// Acepta exactamente las claves indicadas (sin repetir) y devuelve sus valores.
function exactQuery(
  query: URLSearchParams,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, string> | null {
  const keys = [...query.keys()];
  if (keys.length !== new Set(keys).size) return null;
  if (keys.some((key) => !required.includes(key) && !optional.includes(key)))
    return null;
  if (required.some((key) => !query.has(key))) return null;
  return Object.fromEntries(query.entries());
}
export function parseRange(value: unknown): TipsRange | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    !isUuid(value.storeId) ||
    !isTipDate(value.from) ||
    !isTipDate(value.to) ||
    value.from > value.to ||
    daysInRange(value.from, value.to) > MAX_DAILY_TIPS_RANGE_DAYS
  )
    return null;
  return { storeId: value.storeId, from: value.from, to: value.to };
}
export function parseRangeQuery(query: URLSearchParams): TipsRange | null {
  const values = exactQuery(query, ['storeId', 'from', 'to']);
  return values ? parseRange(values) : null;
}
export function parseSummaryQuery(
  query: URLSearchParams,
): (TipsRange & { status: AllocationStatus | null }) | null {
  const values = exactQuery(query, ['storeId', 'from', 'to'], ['status']);
  if (!values) return null;
  const { status = null, ...range } = values;
  const parsed = parseRange(range);
  if (!parsed || !(status === null || isAllocationStatus(status))) return null;
  return { ...parsed, status };
}
export function parseDayQuery(
  query: URLSearchParams,
): { storeId: string; businessDate: string } | null {
  const values = exactQuery(query, ['storeId', 'businessDate']);
  return values && isUuid(values.storeId) && isTipDate(values.businessDate)
    ? { storeId: values.storeId, businessDate: values.businessDate }
    : null;
}
export function rangeQuery(range: TipsRange): string {
  return new URLSearchParams({
    storeId: range.storeId,
    from: range.from,
    to: range.to,
  }).toString();
}

// --- Fechas y filtros de la página -------------------------------------------

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}
export function daysInRange(from: string, to: string): number {
  return (
    (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) /
      86_400_000 +
    1
  );
}
// Semana de lunes a domingo que contiene el día de negocio (ya en hora de
// Chile, ver tipBusinessDate): la fecha calendario no depende de la zona.
export function weekOf(date: string): { from: string; to: string } {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const from = addDays(date, -((weekday + 6) % 7));
  return { from, to: addDays(from, 6) };
}

export type SearchValue = string | string[] | undefined;
export interface TipsStoreOption {
  id: string;
  name: string;
  isActive: boolean;
}
export type TipsFiltersResult =
  | { ok: true; filters: TipsRange }
  | { ok: false; filters: TipsRange; message: string };
function single(value: SearchValue): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}
// Filtros de la URL: por defecto el primer local activo y la semana actual.
export function parseTipsFilters(
  params: { storeId?: SearchValue; from?: SearchValue; to?: SearchValue },
  today: string,
  stores: readonly TipsStoreOption[],
): TipsFiltersResult {
  const rawFrom = single(params.from);
  const rawTo = single(params.to);
  const week = weekOf(today);
  const filters: TipsRange = {
    storeId:
      single(params.storeId) ||
      (stores.find((store) => store.isActive) ?? stores[0])?.id ||
      '',
    from: rawFrom || (rawTo ? '' : week.from),
    to: rawTo || (rawFrom ? '' : week.to),
  };
  const fail = (message: string): TipsFiltersResult => ({
    ok: false,
    filters,
    message,
  });
  if (!filters.storeId)
    return fail('No hay locales registrados para consultar propinas.');
  if (!isUuid(filters.storeId)) return fail('Selecciona un local válido.');
  if (!filters.from || !filters.to)
    return fail('Indica la fecha de inicio y la de término del período.');
  if (!isTipDate(filters.from) || !isTipDate(filters.to))
    return fail('Alguna fecha no es válida. Usa el formato día, mes y año.');
  if (filters.from > filters.to)
    return fail('La fecha de inicio no puede ser posterior a la de término.');
  if (daysInRange(filters.from, filters.to) > MAX_DAILY_TIPS_RANGE_DAYS)
    return fail(
      `El período no puede superar ${MAX_DAILY_TIPS_RANGE_DAYS} días.`,
    );
  return { ok: true, filters };
}
export function tipsPageHref(range: TipsRange): string {
  return '/propinas?' + rangeQuery(range);
}

// --- Presentación -------------------------------------------------------------

export type StatusTone = 'ok' | 'info' | 'warn' | 'neutral';
// Un día con fondo 0 llega UNPAID con total 0: no hay nada que pagar.
export function dayStatusPresentation(day: {
  status: DayStatus;
  totalAmount: number;
}): { label: string; tone: StatusTone } {
  if (day.totalAmount === 0) return { label: 'Sin propinas', tone: 'neutral' };
  if (day.status === 'PAID') return { label: 'Pagado', tone: 'ok' };
  if (day.status === 'PARTIAL') return { label: 'Parcial', tone: 'info' };
  return { label: 'No pagado', tone: 'warn' };
}
export function allocationStatusPresentation(status: AllocationStatus): {
  label: string;
  tone: StatusTone;
} {
  return status === 'PAID'
    ? { label: 'Pagada', tone: 'ok' }
    : { label: 'No pagada', tone: 'warn' };
}
export function periodLabel(from: string, to: string): string {
  return from === to
    ? formatCalendarDate(from)
    : `${formatCalendarDate(from)} al ${formatCalendarDate(to)}`;
}
export function plural(count: number, one: string, many: string): string {
  return `${new Intl.NumberFormat('es-CL').format(count)} ${count === 1 ? one : many}`;
}

// Datos del diálogo de pago: lo pendiente del período y quiénes lo reciben.
export interface PaymentPreview {
  from: string;
  to: string;
  unpaidAmount: number;
  workerCount: number;
}
export function paymentPreview(summary: TipSummary): PaymentPreview | null {
  const workerCount = summary.workers.filter(
    (worker) => worker.unpaidAmount > 0,
  ).length;
  return summary.totals.unpaidAmount > 0 && workerCount > 0
    ? {
        from: summary.from,
        to: summary.to,
        unpaidAmount: summary.totals.unpaidAmount,
        workerCount,
      }
    : null;
}
export function paymentSuccessMessage(batch: PaymentBatch): string {
  return (
    `Se registró el pago de ${formatClp(batch.totalAmount)} a ` +
    `${plural(batch.workerCount, 'trabajador', 'trabajadores')} del período ` +
    `${periodLabel(batch.periodStart, batch.periodEnd)}.`
  );
}

// Nombre de la descarga: el de Content-Disposition si es seguro; si no, uno
// construido con el período. Nunca contiene rutas ni caracteres de control.
export function exportFileName(
  disposition: string | null,
  range: { from: string; to: string },
): string {
  const fallback = `propinas_${range.from}_${range.to}.xlsx`;
  if (!disposition) return fallback;
  let name = '';
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      name = decodeURIComponent(encoded[1].trim());
    } catch {
      name = '';
    }
  }
  if (!name) {
    const quoted = /filename\s*=\s*"([^"]*)"/i.exec(disposition);
    const bare = /filename\s*=\s*([^;"\s]+)/i.exec(disposition);
    name = (quoted?.[1] ?? bare?.[1] ?? '').trim();
  }
  return name.length > 0 &&
    name.length <= 200 &&
    /\.xlsx$/i.test(name) &&
    !/[\\/\u0000-\u001f\u007f]/.test(name) &&
    !name.startsWith('.')
    ? name
    : fallback;
}

// --- Mensajes -----------------------------------------------------------------

export type TipsOperation = 'load' | 'day' | 'export' | 'pay' | 'batches';
export function dailyTipsError(
  status: number,
  operation: TipsOperation = 'load',
): string {
  if (status === 401) return 'Tu sesión venció. Vuelve a iniciar sesión.';
  if (status === 403)
    return 'Tu cuenta no tiene permiso para esta operación de propinas.';
  if (status === 400)
    return `Revisa el local y el período: deben ser válidos y de hasta ${MAX_DAILY_TIPS_RANGE_DAYS} días.`;
  if (status === 404)
    return operation === 'day'
      ? 'Ese día ya no tiene operación registrada. Actualiza la vista.'
      : operation === 'export' || operation === 'pay' || operation === 'batches'
        ? 'Esta función aún no está disponible en el servicio. Intenta más tarde.'
        : 'El local seleccionado no existe. Elige otro local.';
  if (status === 409)
    return operation === 'pay'
      ? 'No hay propinas pendientes de pago en el período. Actualizamos la vista con el estado vigente.'
      : 'Los datos cambiaron. Actualiza la vista antes de continuar.';
  if (status === 429)
    return 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.';
  if (status === 503)
    return 'No se pudo conectar con el servicio de propinas. Intenta nuevamente más tarde.';
  return 'No se pudo verificar la respuesta del servicio de propinas. Intenta nuevamente.';
}
