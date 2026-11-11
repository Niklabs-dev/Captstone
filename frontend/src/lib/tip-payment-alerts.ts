import { isRecord } from './auth';
import {
  addDays,
  daysInRange,
  MAX_DAILY_TIPS_RANGE_DAYS,
  plural,
  tipsPageHref,
} from './daily-tips';
import { formatClp, isTipDate } from './tips';
import { isUuid } from './users';

// Alerta legal de pago de propinas (SPRINT-4A-T22): contrato de
// GET /tip-payment-alerts y del resumen por local del panel de ventas
// (GET /sales-dashboard, alerts.tipPayment y totals.tipPaymentAlerts). Una
// alerta agrupa las propinas diarias No pagadas de un trabajador en un local
// que superaron TIP_LEGAL_PAYMENT_DAYS días hábiles. Funciones puras,
// compartidas por las páginas y las pruebas.

export interface TipAlertRef {
  id: string;
  name: string;
}
export interface TipPaymentAlert {
  store: TipAlertRef;
  worker: TipAlertRef;
  allocationCount: number;
  amount: number;
  oldestBusinessDate: string;
  newestBusinessDate: string;
  deadline: string;
  daysOverdue: number;
}
export interface TipPaymentAlertSummary {
  alertCount: number;
  allocationCount: number;
  amount: number;
  oldestBusinessDate: string | null;
  newestBusinessDate: string | null;
  maxDaysOverdue: number;
}
export interface TipPaymentAlerts {
  legalPaymentDays: number;
  asOf: string;
  overdueThrough: string;
  items: TipPaymentAlert[];
  totals: TipPaymentAlertSummary;
  calculatedAt: string;
}
// Alertas de un local: lo que se paga junto en un lote del período.
export interface StoreTipAlerts {
  store: TipAlertRef;
  summary: TipPaymentAlertSummary;
  items: TipPaymentAlert[];
}

// --- Validación del contrato -------------------------------------------------

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => count(value) && value > 0;
const instant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

function parseRef(value: unknown): TipAlertRef | null {
  return isRecord(value) && isUuid(value.id) && typeof value.name === 'string'
    ? { id: value.id, name: value.name }
    : null;
}
function parseAlert(value: unknown): TipPaymentAlert | null {
  if (!isRecord(value)) return null;
  const store = parseRef(value.store);
  const worker = parseRef(value.worker);
  return store &&
    worker &&
    positive(value.allocationCount) &&
    count(value.amount) &&
    isTipDate(value.oldestBusinessDate) &&
    isTipDate(value.newestBusinessDate) &&
    value.oldestBusinessDate <= value.newestBusinessDate &&
    isTipDate(value.deadline) &&
    positive(value.daysOverdue)
    ? {
        store,
        worker,
        allocationCount: value.allocationCount,
        amount: value.amount,
        oldestBusinessDate: value.oldestBusinessDate,
        newestBusinessDate: value.newestBusinessDate,
        deadline: value.deadline,
        daysOverdue: value.daysOverdue,
      }
    : null;
}
// Sin alertas las fechas llegan null y los conteos en 0; con alertas, ambas
// fechas y el atraso están presentes.
export function parseTipPaymentAlertSummary(
  value: unknown,
): TipPaymentAlertSummary | null {
  if (
    !isRecord(value) ||
    !count(value.alertCount) ||
    !count(value.allocationCount) ||
    !count(value.amount) ||
    !count(value.maxDaysOverdue)
  )
    return null;
  const { oldestBusinessDate: oldest, newestBusinessDate: newest } = value;
  const empty = value.alertCount === 0;
  if (
    empty
      ? oldest !== null || newest !== null || value.allocationCount !== 0
      : !isTipDate(oldest) ||
        !isTipDate(newest) ||
        oldest > newest ||
        value.maxDaysOverdue === 0
  )
    return null;
  return {
    alertCount: value.alertCount,
    allocationCount: value.allocationCount,
    amount: value.amount,
    oldestBusinessDate: empty ? null : (oldest as string),
    newestBusinessDate: empty ? null : (newest as string),
    maxDaysOverdue: value.maxDaysOverdue,
  };
}
export function parseTipPaymentAlerts(value: unknown): TipPaymentAlerts | null {
  if (
    !isRecord(value) ||
    !positive(value.legalPaymentDays) ||
    !isTipDate(value.asOf) ||
    !isTipDate(value.overdueThrough) ||
    !instant(value.calculatedAt) ||
    !Array.isArray(value.items)
  )
    return null;
  const items: TipPaymentAlert[] = [];
  for (const item of value.items) {
    const parsed = parseAlert(item);
    if (!parsed) return null;
    items.push(parsed);
  }
  const totals = parseTipPaymentAlertSummary(value.totals);
  if (!totals || totals.alertCount !== items.length) return null;
  return {
    legalPaymentDays: value.legalPaymentDays,
    asOf: value.asOf,
    overdueThrough: value.overdueThrough,
    items,
    totals,
    calculatedAt: value.calculatedAt,
  };
}

// --- Agrupación y enlaces -----------------------------------------------------

function summarize(items: readonly TipPaymentAlert[]): TipPaymentAlertSummary {
  return {
    alertCount: items.length,
    allocationCount: items.reduce((sum, item) => sum + item.allocationCount, 0),
    amount: items.reduce((sum, item) => sum + item.amount, 0),
    oldestBusinessDate: items.reduce<string | null>(
      (oldest, item) =>
        oldest === null || item.oldestBusinessDate < oldest
          ? item.oldestBusinessDate
          : oldest,
      null,
    ),
    newestBusinessDate: items.reduce<string | null>(
      (newest, item) =>
        newest === null || item.newestBusinessDate > newest
          ? item.newestBusinessDate
          : newest,
      null,
    ),
    maxDaysOverdue: items.reduce(
      (max, item) => Math.max(max, item.daysOverdue),
      0,
    ),
  };
}
// Por local, en el orden de la respuesta (primero el de mayor atraso).
export function groupAlertsByStore(
  items: readonly TipPaymentAlert[],
): StoreTipAlerts[] {
  const groups = new Map<string, TipPaymentAlert[]>();
  const stores = new Map<string, TipAlertRef>();
  for (const item of items) {
    stores.set(item.store.id, item.store);
    groups.set(item.store.id, [...(groups.get(item.store.id) ?? []), item]);
  }
  return [...groups.entries()].map(([storeId, storeItems]) => ({
    store: stores.get(storeId) as TipAlertRef,
    summary: summarize(storeItems),
    items: storeItems,
  }));
}

// Período de /propinas que muestra lo vencido: desde la fecha más antigua
// hasta la más reciente, recortado al máximo de la vista (se ve primero lo
// más atrasado; al pagarlo, la alerta avanza a lo siguiente).
export function alertPeriod(
  oldest: string,
  newest: string,
): { from: string; to: string } {
  const to =
    daysInRange(oldest, newest) > MAX_DAILY_TIPS_RANGE_DAYS
      ? addDays(oldest, MAX_DAILY_TIPS_RANGE_DAYS - 1)
      : newest;
  return { from: oldest, to };
}
export function alertPeriodIsClipped(oldest: string, newest: string): boolean {
  return alertPeriod(oldest, newest).to !== newest;
}
export function tipAlertHref(
  storeId: string,
  summary: Pick<
    TipPaymentAlertSummary,
    'oldestBusinessDate' | 'newestBusinessDate'
  >,
): string {
  const { oldestBusinessDate: oldest, newestBusinessDate: newest } = summary;
  if (!oldest || !newest) return '/propinas';
  return tipsPageHref({ storeId, ...alertPeriod(oldest, newest) });
}

// --- Textos -------------------------------------------------------------------

export function overdueText(days: number): string {
  return `${plural(days, 'día', 'días')} de atraso`;
}
export function legalTermText(days: number): string {
  return `${plural(days, 'día hábil', 'días hábiles')}`;
}
// Resumen breve para el panel de ventas: monto, días y mayor atraso.
export function tipAlertSummaryText(summary: TipPaymentAlertSummary): string {
  if (summary.alertCount === 0) return 'Sin propinas vencidas';
  return (
    `${formatClp(summary.amount)} sin pagar · ` +
    `${plural(summary.allocationCount, 'propina', 'propinas')} · ` +
    `hasta ${overdueText(summary.maxDaysOverdue)}`
  );
}
export function tipAlertsError(status: number): string {
  if (status === 401) return 'Tu sesión venció. Vuelve a iniciar sesión.';
  if (status === 403)
    return 'Tu cuenta no tiene permiso para consultar las alertas de propinas.';
  if (status === 429)
    return 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.';
  if (status === 503)
    return 'No se pudo conectar con el servicio de propinas para revisar las alertas. Intenta nuevamente más tarde.';
  return 'No se pudieron verificar las alertas de propinas sin pagar. Intenta nuevamente.';
}
