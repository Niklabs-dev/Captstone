import {
  isAmount,
  isCalendarDate,
  isMethodCode,
  isRecord,
  isText,
  isTimestamp,
  isUuidValue,
} from './cash-closings';

// Contrato de GET /sales-dashboard (SPRINT-4-T13), documentado en Swagger
// (/api/docs). Montos CLP enteros. Ventas NETAS (sin propina), propina con
// tarjeta y descuadres de vouchers son conceptos separados: el panel nunca los
// suma entre sí para no contar dos veces la misma plata.

export interface DashboardStore {
  id: string;
  name: string;
  city: string;
  isActive: boolean;
}
export interface PaymentMethodSales {
  paymentMethod: string;
  salesCount: number;
  netAmount: number;
}
export interface StoreSales {
  salesCount: number;
  netAmount: number;
  closedSalesCount: number;
  closedNetAmount: number;
  unclosedSalesCount: number;
  unclosedNetAmount: number;
  byPaymentMethod: PaymentMethodSales[];
}
export interface StoreCardTips {
  registeredAmount: number;
  closingsAmount: number;
}
export interface StoreClosings {
  count: number;
  shifts: number[];
  netSalesAmount: number;
  countedAmount: number;
  cashDifference: number;
  voucherDifference: number;
  mrcomandaNetSales: number;
  mercadoPagoNetSales: number;
}
export interface PendingDifference {
  closingId: string;
  shift: number;
  status: 'OPEN' | 'CLOSED';
  cashDifference: number;
  voucherDifference: number;
  differenceReason: string | null;
  closedAt: string | null;
}
export interface AlertCounts {
  overdue: number;
  upcoming: number;
}
export interface StoreAlerts {
  dtRegistration: AlertCounts;
  tipPayment: AlertCounts;
}
export interface StoreDashboard {
  store: DashboardStore;
  sales: StoreSales;
  cardTips: StoreCardTips;
  closings: StoreClosings;
  pendingDifferences: PendingDifference[];
  alerts: StoreAlerts;
}
export interface DashboardTotals {
  salesCount: number;
  netAmount: number;
  closedNetAmount: number;
  unclosedNetAmount: number;
  cardTipsRegisteredAmount: number;
  cardTipsClosingsAmount: number;
  closingsCount: number;
  cashDifference: number;
  voucherDifference: number;
  pendingDifferencesCount: number;
  dtRegistrationAlerts: AlertCounts;
  tipPaymentAlerts: AlertCounts;
}
export interface SalesDashboard {
  businessDate: string;
  timeZone: string;
  periodStart: string;
  periodEnd: string;
  calculatedAt: string;
  stores: StoreDashboard[];
  totals: DashboardTotals;
}

// Estado del local en el día: sin cierres, cuadrado o «No cuadrado» (alguna
// línea o voucher descuadrado aunque el total compensado sea 0).
export type StoreBalance = 'NO_CLOSINGS' | 'BALANCED' | 'UNBALANCED';

function counts(value: unknown): AlertCounts | null {
  if (!isRecord(value) || !isAmount(value.overdue) || !isAmount(value.upcoming))
    return null;
  return { overdue: value.overdue, upcoming: value.upcoming };
}

function amounts<K extends string>(
  value: Record<string, unknown>,
  keys: readonly K[],
  signed: readonly K[] = [],
): Record<K, number> | null {
  const result = {} as Record<K, number>;
  for (const key of keys) {
    const amount = value[key];
    if (!isAmount(amount, signed.includes(key))) return null;
    result[key] = amount;
  }
  return result;
}

function parseStore(value: unknown): StoreDashboard | null {
  if (
    !isRecord(value) ||
    !isRecord(value.store) ||
    !isUuidValue(value.store.id) ||
    !isText(value.store.name) ||
    !isText(value.store.city) ||
    typeof value.store.isActive !== 'boolean' ||
    !isRecord(value.sales) ||
    !Array.isArray(value.sales.byPaymentMethod) ||
    !isRecord(value.cardTips) ||
    !isRecord(value.closings) ||
    !Array.isArray(value.closings.shifts) ||
    !Array.isArray(value.pendingDifferences) ||
    !isRecord(value.alerts)
  )
    return null;
  const sales = amounts(value.sales, [
    'salesCount',
    'netAmount',
    'closedSalesCount',
    'closedNetAmount',
    'unclosedSalesCount',
    'unclosedNetAmount',
  ] as const);
  const cardTips = amounts(value.cardTips, [
    'registeredAmount',
    'closingsAmount',
  ] as const);
  const closings = amounts(
    value.closings,
    [
      'count',
      'netSalesAmount',
      'countedAmount',
      'cashDifference',
      'voucherDifference',
      'mrcomandaNetSales',
      'mercadoPagoNetSales',
    ] as const,
    ['cashDifference', 'voucherDifference', 'mercadoPagoNetSales'] as const,
  );
  const dtRegistration = counts(value.alerts.dtRegistration);
  const tipPayment = counts(value.alerts.tipPayment);
  if (!sales || !cardTips || !closings || !dtRegistration || !tipPayment)
    return null;

  const byPaymentMethod: PaymentMethodSales[] = [];
  for (const item of value.sales.byPaymentMethod) {
    if (
      !isRecord(item) ||
      !isMethodCode(item.paymentMethod) ||
      !isAmount(item.salesCount) ||
      !isAmount(item.netAmount) ||
      byPaymentMethod.some(
        (other) => other.paymentMethod === item.paymentMethod,
      )
    )
      return null;
    byPaymentMethod.push({
      paymentMethod: item.paymentMethod,
      salesCount: item.salesCount,
      netAmount: item.netAmount,
    });
  }
  const shifts: number[] = [];
  for (const shift of value.closings.shifts) {
    if (!isAmount(shift) || shift < 1 || shifts.includes(shift)) return null;
    shifts.push(shift);
  }
  const pendingDifferences: PendingDifference[] = [];
  for (const item of value.pendingDifferences) {
    if (
      !isRecord(item) ||
      !isUuidValue(item.closingId) ||
      !isAmount(item.shift) ||
      item.shift < 1 ||
      (item.status !== 'OPEN' && item.status !== 'CLOSED') ||
      !isAmount(item.cashDifference, true) ||
      !isAmount(item.voucherDifference, true) ||
      !(item.differenceReason === null || isText(item.differenceReason, 500)) ||
      !(item.closedAt === null || isTimestamp(item.closedAt)) ||
      pendingDifferences.some((other) => other.closingId === item.closingId)
    )
      return null;
    pendingDifferences.push({
      closingId: item.closingId,
      shift: item.shift,
      status: item.status,
      cashDifference: item.cashDifference,
      voucherDifference: item.voucherDifference,
      differenceReason: item.differenceReason,
      closedAt: item.closedAt,
    });
  }
  if (closings.count !== shifts.length) return null;
  return {
    store: {
      id: value.store.id,
      name: value.store.name,
      city: value.store.city,
      isActive: value.store.isActive,
    },
    sales: { ...sales, byPaymentMethod },
    cardTips,
    closings: { ...closings, shifts },
    pendingDifferences,
    alerts: { dtRegistration, tipPayment },
  };
}

export function parseSalesDashboard(value: unknown): SalesDashboard | null {
  if (
    !isRecord(value) ||
    !isCalendarDate(value.businessDate) ||
    !isText(value.timeZone, 64) ||
    !isTimestamp(value.periodStart) ||
    !isTimestamp(value.periodEnd) ||
    !isTimestamp(value.calculatedAt) ||
    !Array.isArray(value.stores) ||
    !isRecord(value.totals)
  )
    return null;
  const stores: StoreDashboard[] = [];
  for (const candidate of value.stores) {
    const store = parseStore(candidate);
    if (!store || stores.some((other) => other.store.id === store.store.id))
      return null;
    stores.push(store);
  }
  const totals = amounts(
    value.totals,
    [
      'salesCount',
      'netAmount',
      'closedNetAmount',
      'unclosedNetAmount',
      'cardTipsRegisteredAmount',
      'cardTipsClosingsAmount',
      'closingsCount',
      'cashDifference',
      'voucherDifference',
      'pendingDifferencesCount',
    ] as const,
    ['cashDifference', 'voucherDifference'] as const,
  );
  const dtRegistrationAlerts = counts(value.totals.dtRegistrationAlerts);
  const tipPaymentAlerts = counts(value.totals.tipPaymentAlerts);
  if (!totals || !dtRegistrationAlerts || !tipPaymentAlerts) return null;
  return {
    businessDate: value.businessDate,
    timeZone: value.timeZone,
    periodStart: value.periodStart,
    periodEnd: value.periodEnd,
    calculatedAt: value.calculatedAt,
    stores,
    totals: { ...totals, dtRegistrationAlerts, tipPaymentAlerts },
  };
}

export function storeBalance(store: StoreDashboard): StoreBalance {
  if (store.closings.count === 0) return 'NO_CLOSINGS';
  return store.pendingDifferences.length ? 'UNBALANCED' : 'BALANCED';
}

export function storeBalanceLabel(balance: StoreBalance): string {
  return balance === 'NO_CLOSINGS'
    ? 'Sin cierres'
    : balance === 'BALANCED'
      ? 'Cuadrado'
      : 'No cuadrado';
}

// Un cierre pendiente con totales en 0 tiene líneas que se compensan entre
// medios: se advierte para que nadie lo lea como cuadrado.
export function isCompensatedDifference(item: PendingDifference): boolean {
  return item.cashDifference === 0 && item.voucherDifference === 0;
}

// Propina registrada en el día y la informada por los vouchers no coinciden.
export function hasTipMismatch(store: StoreDashboard): boolean {
  return (
    store.closings.count > 0 &&
    store.cardTips.registeredAmount !== store.cardTips.closingsAmount
  );
}

export function alertTotal(counts: AlertCounts): number {
  return counts.overdue + counts.upcoming;
}

// Día de negocio actual en Chile (YYYY-MM-DD), igual al valor por defecto del
// backend.
export function chileToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Santiago',
  }).formatToParts(now);
  const part = (type: string): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return part('year') + '-' + part('month') + '-' + part('day');
}

export function isDashboardDate(value: unknown): value is string {
  return isCalendarDate(value);
}
