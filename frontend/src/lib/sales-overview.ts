import { isRecord } from './auth';
import { formatClp, isTipDate } from './tips';
import { isUuid } from './users';

// Panel, reportes y calendario de ventas del administrador (SPRINT-4R-T14):
// contratos de GET /sales-dashboard, GET /sales-reports (SPRINT-4R-T13),
// GET /sales-days y /stores/:id/operating-calendar (SPRINT-4R-T12).
// Funciones puras, compartidas por las páginas, el BFF y las pruebas.
//
// Regla transversal: un dato ausente llega como null y se muestra como
// «Sin dato», nunca como $0; sobrantes y faltantes no se compensan.

export const SALES_DAY_STATUSES = [
  'IMPORTADO',
  'PENDIENTE',
  'ATRASADO',
  'CERRADO',
] as const;
export type SalesDayStatus = (typeof SALES_DAY_STATUSES)[number];
export type CashDifferenceType = 'SOBRANTE' | 'FALTANTE' | 'SIN_DIFERENCIA';
export const MAX_REPORT_DAYS = 366;
export const MAX_CLOSURE_REASON_LENGTH = 300;
export const MISSING_VALUE = 'Sin dato';

export interface StoreRef {
  id: string;
  name: string;
}
export interface ReportStore extends StoreRef {
  city: string;
  isActive: boolean;
}
export interface PaymentMethodColumn {
  paymentMethod: string;
  paymentMethodName: string;
  isActive: boolean;
}
export interface PaymentMethodAmount {
  paymentMethod: string;
  amount: number;
}
export interface ImportStatusInfo {
  status: SalesDayStatus | null;
  activeImportId: string | null;
  pendingImportId: string | null;
  closure: { id: string; reason: string } | null;
}
export interface ImportedSales {
  importId: string;
  version: number;
  totalAmount: number;
  byPaymentMethod: PaymentMethodAmount[];
}
export interface CashDifference {
  amount: number;
  type: CashDifferenceType;
  reason: string | null;
}
export interface DailyOperationFigures {
  operationId: string;
  cardTipAmount: number;
  cashTipAmount: number;
  tipFundAmount: number;
  cashDifference: CashDifference;
}
export interface CashDifferenceLine {
  store: StoreRef;
  businessDate: string;
  operationId: string;
  amount: number;
  type: Exclude<CashDifferenceType, 'SIN_DIFERENCIA'>;
  reason: string | null;
}
export interface SalesTotals {
  importedDays: number;
  totalAmount: number;
  byPaymentMethod: PaymentMethodAmount[];
}
export interface TipsTotals {
  operationsCount: number;
  cardTipAmount: number;
  cashTipAmount: number;
  tipFundAmount: number;
}
export interface CashDifferenceTotals {
  count: number;
  surplusCount: number;
  shortageCount: number;
  surplusAmount: number;
  shortageAmount: number;
}
export type ImportStatusSummary = Record<SalesDayStatus, number>;
export interface AlertCounts {
  overdue: number;
  upcoming: number;
}
export interface StoreDashboard {
  store: ReportStore;
  importStatus: ImportStatusInfo;
  sales: ImportedSales | null;
  dailyOperation: DailyOperationFigures | null;
  alerts: { dtRegistration: AlertCounts; tipPayment: AlertCounts };
}
export interface SalesDashboard {
  businessDate: string;
  today: string;
  alertsAsOf: string;
  paymentMethods: PaymentMethodColumn[];
  stores: StoreDashboard[];
  cashDifferences: CashDifferenceLine[];
  totals: {
    sales: SalesTotals;
    storesWithoutImport: number;
    tips: TipsTotals;
    storesWithoutDailyOperation: number;
    cashDifferences: CashDifferenceTotals;
    importStatus: ImportStatusSummary;
    dtRegistrationAlerts: AlertCounts;
    tipPaymentAlerts: AlertCounts;
  };
}
export interface ReportDay {
  businessDate: string;
  importStatus: ImportStatusInfo;
  sales: ImportedSales | null;
  dailyOperation: DailyOperationFigures | null;
}
export interface StoreReport {
  store: ReportStore;
  sales: SalesTotals;
  tips: TipsTotals;
  cashDifferences: CashDifferenceTotals;
  importStatus: ImportStatusSummary;
  days: ReportDay[];
}
export interface SalesReport {
  from: string;
  to: string;
  today: string;
  storeId: string | null;
  paymentMethods: PaymentMethodColumn[];
  stores: StoreReport[];
  cashDifferences: CashDifferenceLine[];
  totals: {
    sales: SalesTotals;
    tips: TipsTotals;
    cashDifferences: CashDifferenceTotals;
    importStatus: ImportStatusSummary;
  };
}
export interface SalesDayItem {
  store: StoreRef;
  businessDate: string;
  status: SalesDayStatus;
  activeImportId: string | null;
  pendingImportId: string | null;
  closure: { id: string; reason: string } | null;
}
export interface SalesDays {
  today: string;
  from: string;
  to: string;
  summary: ImportStatusSummary;
  items: SalesDayItem[];
}
export interface StoreClosure {
  id: string;
  date: string;
  reason: string;
  createdAt: string;
  createdBy: StoreRef;
}
export interface OperatingCalendar {
  store: StoreRef;
  configured: boolean;
  weekdays: number[];
  trackingStartDate: string | null;
  updatedAt: string | null;
  updatedBy: StoreRef | null;
  closures: StoreClosure[];
}

// --- Validación del contrato -------------------------------------------------

const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
const count = (value: unknown): value is number => integer(value) && value >= 0;
const instant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalUuid = (value: unknown): value is string | null =>
  value === null || isUuid(value);
const optionalText = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
export function isSalesDayStatus(value: unknown): value is SalesDayStatus {
  return SALES_DAY_STATUSES.some((status) => status === value);
}

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
function parseStoreRef(value: unknown): StoreRef | null {
  return isRecord(value) && isUuid(value.id) && text(value.name)
    ? { id: value.id, name: value.name }
    : null;
}
function parseReportStore(value: unknown): ReportStore | null {
  const ref = parseStoreRef(value);
  return ref &&
    isRecord(value) &&
    typeof value.city === 'string' &&
    typeof value.isActive === 'boolean'
    ? { ...ref, city: value.city, isActive: value.isActive }
    : null;
}
function parseColumn(value: unknown): PaymentMethodColumn | null {
  return isRecord(value) &&
    text(value.paymentMethod) &&
    text(value.paymentMethodName) &&
    typeof value.isActive === 'boolean'
    ? {
        paymentMethod: value.paymentMethod,
        paymentMethodName: value.paymentMethodName,
        isActive: value.isActive,
      }
    : null;
}
function parseMethodAmount(value: unknown): PaymentMethodAmount | null {
  return isRecord(value) && text(value.paymentMethod) && integer(value.amount)
    ? { paymentMethod: value.paymentMethod, amount: value.amount }
    : null;
}
function parseClosureRef(value: unknown): ImportStatusInfo['closure'] | null {
  return isRecord(value) && isUuid(value.id) && typeof value.reason === 'string'
    ? { id: value.id, reason: value.reason }
    : null;
}
function parseImportStatus(value: unknown): ImportStatusInfo | null {
  if (
    !isRecord(value) ||
    !(value.status === null || isSalesDayStatus(value.status)) ||
    !optionalUuid(value.activeImportId) ||
    !optionalUuid(value.pendingImportId)
  )
    return null;
  const closure =
    value.closure === null ? null : parseClosureRef(value.closure);
  if (value.closure !== null && closure === null) return null;
  return {
    status: value.status,
    activeImportId: value.activeImportId,
    pendingImportId: value.pendingImportId,
    closure,
  };
}
function parseImportedSales(value: unknown): ImportedSales | null {
  if (
    !isRecord(value) ||
    !isUuid(value.importId) ||
    !count(value.version) ||
    !integer(value.totalAmount)
  )
    return null;
  const byPaymentMethod = list(value.byPaymentMethod, parseMethodAmount);
  return byPaymentMethod
    ? {
        importId: value.importId,
        version: value.version,
        totalAmount: value.totalAmount,
        byPaymentMethod,
      }
    : null;
}
function parseCashDifference(value: unknown): CashDifference | null {
  if (!isRecord(value) || !integer(value.amount) || !optionalText(value.reason))
    return null;
  const expected: CashDifferenceType =
    value.amount > 0
      ? 'SOBRANTE'
      : value.amount < 0
        ? 'FALTANTE'
        : 'SIN_DIFERENCIA';
  return value.type === expected
    ? { amount: value.amount, type: expected, reason: value.reason }
    : null;
}
function parseFigures(value: unknown): DailyOperationFigures | null {
  if (
    !isRecord(value) ||
    !isUuid(value.operationId) ||
    !count(value.cardTipAmount) ||
    !count(value.cashTipAmount) ||
    !count(value.tipFundAmount)
  )
    return null;
  const cashDifference = parseCashDifference(value.cashDifference);
  return cashDifference
    ? {
        operationId: value.operationId,
        cardTipAmount: value.cardTipAmount,
        cashTipAmount: value.cashTipAmount,
        tipFundAmount: value.tipFundAmount,
        cashDifference,
      }
    : null;
}
// Ventas y operación diaria: null es ausencia de datos; un valor inválido
// invalida toda la respuesta (undefined).
function nullable<T>(
  value: unknown,
  parse: (item: unknown) => T | null,
): T | null | undefined {
  if (value === null) return null;
  return parse(value) ?? undefined;
}
function parseDifferenceLine(value: unknown): CashDifferenceLine | null {
  if (
    !isRecord(value) ||
    !isTipDate(value.businessDate) ||
    !isUuid(value.operationId) ||
    !integer(value.amount) ||
    value.amount === 0 ||
    value.type !== (value.amount > 0 ? 'SOBRANTE' : 'FALTANTE') ||
    !optionalText(value.reason)
  )
    return null;
  const store = parseStoreRef(value.store);
  return store
    ? {
        store,
        businessDate: value.businessDate,
        operationId: value.operationId,
        amount: value.amount,
        type: value.amount > 0 ? 'SOBRANTE' : 'FALTANTE',
        reason: value.reason,
      }
    : null;
}
function parseSalesTotals(value: unknown): SalesTotals | null {
  if (
    !isRecord(value) ||
    !count(value.importedDays) ||
    !integer(value.totalAmount)
  )
    return null;
  const byPaymentMethod = list(value.byPaymentMethod, parseMethodAmount);
  return byPaymentMethod
    ? {
        importedDays: value.importedDays,
        totalAmount: value.totalAmount,
        byPaymentMethod,
      }
    : null;
}
function parseTips(value: unknown): TipsTotals | null {
  return isRecord(value) &&
    count(value.operationsCount) &&
    count(value.cardTipAmount) &&
    count(value.cashTipAmount) &&
    count(value.tipFundAmount)
    ? {
        operationsCount: value.operationsCount,
        cardTipAmount: value.cardTipAmount,
        cashTipAmount: value.cashTipAmount,
        tipFundAmount: value.tipFundAmount,
      }
    : null;
}
function parseDifferenceTotals(value: unknown): CashDifferenceTotals | null {
  return isRecord(value) &&
    count(value.count) &&
    count(value.surplusCount) &&
    count(value.shortageCount) &&
    count(value.surplusAmount) &&
    integer(value.shortageAmount) &&
    value.shortageAmount <= 0
    ? {
        count: value.count,
        surplusCount: value.surplusCount,
        shortageCount: value.shortageCount,
        surplusAmount: value.surplusAmount,
        shortageAmount: value.shortageAmount,
      }
    : null;
}
function parseStatusSummary(value: unknown): ImportStatusSummary | null {
  if (!isRecord(value)) return null;
  const summary: ImportStatusSummary = {
    IMPORTADO: 0,
    PENDIENTE: 0,
    ATRASADO: 0,
    CERRADO: 0,
  };
  for (const status of SALES_DAY_STATUSES) {
    const amount = value[status];
    if (!count(amount)) return null;
    summary[status] = amount;
  }
  return summary;
}
function parseAlerts(value: unknown): AlertCounts | null {
  return isRecord(value) && count(value.overdue) && count(value.upcoming)
    ? { overdue: value.overdue, upcoming: value.upcoming }
    : null;
}
function parseStoreDashboard(value: unknown): StoreDashboard | null {
  if (!isRecord(value) || !isRecord(value.alerts)) return null;
  const store = parseReportStore(value.store);
  const importStatus = parseImportStatus(value.importStatus);
  const sales = nullable(value.sales, parseImportedSales);
  const dailyOperation = nullable(value.dailyOperation, parseFigures);
  const dtRegistration = parseAlerts(value.alerts.dtRegistration);
  const tipPayment = parseAlerts(value.alerts.tipPayment);
  if (
    !store ||
    !importStatus ||
    sales === undefined ||
    dailyOperation === undefined ||
    !dtRegistration ||
    !tipPayment
  )
    return null;
  return {
    store,
    importStatus,
    sales,
    dailyOperation,
    alerts: { dtRegistration, tipPayment },
  };
}

export function parseSalesDashboard(value: unknown): SalesDashboard | null {
  if (
    !isRecord(value) ||
    !isTipDate(value.businessDate) ||
    !isTipDate(value.today) ||
    !isTipDate(value.alertsAsOf) ||
    !isRecord(value.totals)
  )
    return null;
  const totals = value.totals;
  const paymentMethods = list(value.paymentMethods, parseColumn);
  const stores = list(value.stores, parseStoreDashboard);
  const cashDifferences = list(value.cashDifferences, parseDifferenceLine);
  const sales = parseSalesTotals(totals.sales);
  const tips = parseTips(totals.tips);
  const differences = parseDifferenceTotals(totals.cashDifferences);
  const importStatus = parseStatusSummary(totals.importStatus);
  const dtRegistrationAlerts = parseAlerts(totals.dtRegistrationAlerts);
  const tipPaymentAlerts = parseAlerts(totals.tipPaymentAlerts);
  if (
    !paymentMethods ||
    !stores ||
    !cashDifferences ||
    !sales ||
    !tips ||
    !differences ||
    !importStatus ||
    !dtRegistrationAlerts ||
    !tipPaymentAlerts ||
    !count(totals.storesWithoutImport) ||
    !count(totals.storesWithoutDailyOperation)
  )
    return null;
  return {
    businessDate: value.businessDate,
    today: value.today,
    alertsAsOf: value.alertsAsOf,
    paymentMethods,
    stores,
    cashDifferences,
    totals: {
      sales,
      storesWithoutImport: totals.storesWithoutImport,
      tips,
      storesWithoutDailyOperation: totals.storesWithoutDailyOperation,
      cashDifferences: differences,
      importStatus,
      dtRegistrationAlerts,
      tipPaymentAlerts,
    },
  };
}

function parseReportDay(value: unknown): ReportDay | null {
  if (!isRecord(value) || !isTipDate(value.businessDate)) return null;
  const importStatus = parseImportStatus(value.importStatus);
  const sales = nullable(value.sales, parseImportedSales);
  const dailyOperation = nullable(value.dailyOperation, parseFigures);
  if (!importStatus || sales === undefined || dailyOperation === undefined)
    return null;
  return {
    businessDate: value.businessDate,
    importStatus,
    sales,
    dailyOperation,
  };
}
function parseStoreReport(value: unknown): StoreReport | null {
  if (!isRecord(value)) return null;
  const store = parseReportStore(value.store);
  const sales = parseSalesTotals(value.sales);
  const tips = parseTips(value.tips);
  const cashDifferences = parseDifferenceTotals(value.cashDifferences);
  const importStatus = parseStatusSummary(value.importStatus);
  const days = list(value.days, parseReportDay);
  return store && sales && tips && cashDifferences && importStatus && days
    ? { store, sales, tips, cashDifferences, importStatus, days }
    : null;
}
export function parseSalesReport(value: unknown): SalesReport | null {
  if (
    !isRecord(value) ||
    !isTipDate(value.from) ||
    !isTipDate(value.to) ||
    !isTipDate(value.today) ||
    !optionalUuid(value.storeId) ||
    !isRecord(value.totals)
  )
    return null;
  const paymentMethods = list(value.paymentMethods, parseColumn);
  const stores = list(value.stores, parseStoreReport);
  const cashDifferences = list(value.cashDifferences, parseDifferenceLine);
  const sales = parseSalesTotals(value.totals.sales);
  const tips = parseTips(value.totals.tips);
  const differences = parseDifferenceTotals(value.totals.cashDifferences);
  const importStatus = parseStatusSummary(value.totals.importStatus);
  if (
    !paymentMethods ||
    !stores ||
    !cashDifferences ||
    !sales ||
    !tips ||
    !differences ||
    !importStatus
  )
    return null;
  return {
    from: value.from,
    to: value.to,
    today: value.today,
    storeId: value.storeId,
    paymentMethods,
    stores,
    cashDifferences,
    totals: { sales, tips, cashDifferences: differences, importStatus },
  };
}

function parseSalesDayItem(value: unknown): SalesDayItem | null {
  if (
    !isRecord(value) ||
    !isTipDate(value.businessDate) ||
    !isSalesDayStatus(value.status) ||
    !optionalUuid(value.activeImportId) ||
    !optionalUuid(value.pendingImportId)
  )
    return null;
  const store = parseStoreRef(value.store);
  const closure =
    value.closure === null ? null : parseClosureRef(value.closure);
  if (!store || (value.closure !== null && closure === null)) return null;
  return {
    store,
    businessDate: value.businessDate,
    status: value.status,
    activeImportId: value.activeImportId,
    pendingImportId: value.pendingImportId,
    closure,
  };
}
export function parseSalesDays(value: unknown): SalesDays | null {
  if (
    !isRecord(value) ||
    !isTipDate(value.today) ||
    !isTipDate(value.from) ||
    !isTipDate(value.to)
  )
    return null;
  const summary = parseStatusSummary(value.summary);
  const items = list(value.items, parseSalesDayItem);
  return summary && items
    ? { today: value.today, from: value.from, to: value.to, summary, items }
    : null;
}

export function parseStoreClosure(value: unknown): StoreClosure | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isTipDate(value.date) ||
    !text(value.reason) ||
    !instant(value.createdAt)
  )
    return null;
  const createdBy = parseStoreRef(value.createdBy);
  return createdBy
    ? {
        id: value.id,
        date: value.date,
        reason: value.reason,
        createdAt: value.createdAt,
        createdBy,
      }
    : null;
}
export function parseOperatingCalendar(
  value: unknown,
): OperatingCalendar | null {
  if (
    !isRecord(value) ||
    typeof value.configured !== 'boolean' ||
    !Array.isArray(value.weekdays) ||
    !value.weekdays.every((day) => integer(day) && day >= 1 && day <= 7) ||
    !(value.trackingStartDate === null || isTipDate(value.trackingStartDate)) ||
    !(value.updatedAt === null || instant(value.updatedAt))
  )
    return null;
  const store = parseStoreRef(value.store);
  const updatedBy =
    value.updatedBy === null ? null : parseStoreRef(value.updatedBy);
  const closures = list(value.closures, parseStoreClosure);
  if (!store || !closures || (value.updatedBy !== null && !updatedBy))
    return null;
  return {
    store,
    configured: value.configured,
    weekdays: [...(value.weekdays as number[])].sort((a, b) => a - b),
    trackingStartDate: value.trackingStartDate,
    updatedAt: value.updatedAt,
    updatedBy,
    closures,
  };
}

// --- Entradas del BFF del calendario -----------------------------------------

export interface CalendarInput {
  weekdays: number[];
  trackingStartDate: string;
}
export interface ClosureInput {
  date: string;
  reason: string;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}
export function parseCalendarInput(value: unknown): CalendarInput | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['weekdays', 'trackingStartDate']) ||
    !Array.isArray(value.weekdays) ||
    value.weekdays.length === 0 ||
    value.weekdays.length > 7 ||
    !value.weekdays.every((day) => integer(day) && day >= 1 && day <= 7) ||
    new Set(value.weekdays).size !== value.weekdays.length ||
    !isTipDate(value.trackingStartDate)
  )
    return null;
  return {
    weekdays: [...(value.weekdays as number[])].sort((a, b) => a - b),
    trackingStartDate: value.trackingStartDate,
  };
}
export function parseClosureInput(value: unknown): ClosureInput | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['date', 'reason']) ||
    !isTipDate(value.date) ||
    typeof value.reason !== 'string'
  )
    return null;
  const reason = value.reason.trim();
  return reason.length > 0 && reason.length <= MAX_CLOSURE_REASON_LENGTH
    ? { date: value.date, reason }
    : null;
}
export function closureFormError(date: string, reason: string): string | null {
  if (!isTipDate(date)) return 'Indica la fecha del cierre.';
  const trimmed = reason.trim();
  if (!trimmed) return 'Indica el motivo del cierre.';
  if (trimmed.length > MAX_CLOSURE_REASON_LENGTH)
    return `El motivo no puede superar ${MAX_CLOSURE_REASON_LENGTH} caracteres.`;
  return null;
}
export function calendarFormError(
  weekdays: readonly number[],
  trackingStartDate: string,
): string | null {
  if (weekdays.length === 0)
    return 'Marca al menos un día en que abre el local.';
  if (!isTipDate(trackingStartDate))
    return 'Indica desde qué fecha se exigen las ventas importadas.';
  return null;
}

// --- Fechas y filtros ---------------------------------------------------------

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
function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
function displayDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}-${month}-${year}`;
}

export type SearchValue = string | string[] | undefined;
export type DashboardDateResult =
  { ok: true; date: string } | { ok: false; value: string; message: string };
// Día del panel: por defecto hoy; nunca un día futuro ni una fecha inválida.
export function parseDashboardDate(
  value: SearchValue,
  today: string,
): DashboardDateResult {
  const date = single(value)?.trim() ?? '';
  if (!date) return { ok: true, date: today };
  if (!isTipDate(date))
    return {
      ok: false,
      value: date,
      message: 'La fecha no es válida. Usa el formato día, mes y año.',
    };
  if (date > today)
    return {
      ok: false,
      value: date,
      message: `El panel no informa días futuros. Elige una fecha hasta hoy (${displayDate(today)}).`,
    };
  return { ok: true, date };
}

export interface ReportFilters {
  from: string;
  to: string;
  storeId: string;
}
export type ReportFiltersResult =
  | { ok: true; filters: ReportFilters }
  | { ok: false; filters: ReportFilters; message: string };
// Rango del reporte: por defecto los últimos 7 días hasta hoy. Valida lo
// mismo que el backend para explicar el problema sin consultarlo.
export function parseReportFilters(
  params: { from?: SearchValue; to?: SearchValue; storeId?: SearchValue },
  today: string,
): ReportFiltersResult {
  const rawFrom = single(params.from)?.trim() ?? '';
  const rawTo = single(params.to)?.trim() ?? '';
  const storeId = single(params.storeId)?.trim() ?? '';
  const filters: ReportFilters = {
    from: rawFrom || (rawTo ? '' : addDays(today, -6)),
    to: rawTo || (rawFrom ? '' : today),
    storeId,
  };
  const fail = (message: string): ReportFiltersResult => ({
    ok: false,
    filters,
    message,
  });
  if (!filters.from || !filters.to)
    return fail('Indica la fecha de inicio y la de término del reporte.');
  if (!isTipDate(filters.from) || !isTipDate(filters.to))
    return fail('Alguna fecha no es válida. Usa el formato día, mes y año.');
  if (filters.from > filters.to)
    return fail('La fecha de inicio no puede ser posterior a la de término.');
  if (filters.to > today)
    return fail(
      `El reporte no incluye días futuros. La fecha de término debe ser hasta hoy (${displayDate(today)}).`,
    );
  if (daysInRange(filters.from, filters.to) > MAX_REPORT_DAYS)
    return fail(`El rango no puede superar ${MAX_REPORT_DAYS} días.`);
  if (storeId && !isUuid(storeId)) return fail('Selecciona un local válido.');
  return { ok: true, filters };
}
export function reportQuery(filters: ReportFilters): string {
  const query = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.storeId) query.set('storeId', filters.storeId);
  return query.toString();
}

// --- Presentación -------------------------------------------------------------

// Monto confirmado o «Sin dato»: la ausencia nunca se muestra como $0.
export function formatAmount(value: number | null | undefined): string {
  return value === null || value === undefined
    ? MISSING_VALUE
    : formatClp(value);
}
export function formatSignedAmount(value: number): string {
  if (value > 0) return '+' + formatClp(value);
  if (value < 0) return '-' + formatClp(Math.abs(value));
  return formatClp(0);
}
// Monto de un medio en unas ventas importadas: null sin importación; un medio
// que no figura en el Excel vigente vale 0 (la venta del día sí existe).
export function methodAmount(
  sales: { byPaymentMethod: PaymentMethodAmount[] } | null,
  code: string,
): number | null {
  if (sales === null) return null;
  return (
    sales.byPaymentMethod.find((item) => item.paymentMethod === code)?.amount ??
    0
  );
}

export type StatusTone = 'ok' | 'info' | 'crit' | 'neutral';
export const SALES_DAY_LABELS: Record<SalesDayStatus, string> = {
  IMPORTADO: 'Importado',
  PENDIENTE: 'Pendiente hoy',
  ATRASADO: 'Atrasado',
  CERRADO: 'Cerrado',
};
// PENDIENTE (hoy, informativo) y ATRASADO (alerta) nunca comparten tono.
export function salesDayPresentation(status: SalesDayStatus | null): {
  label: string;
  tone: StatusTone;
} {
  if (status === null) return { label: 'Sin seguimiento', tone: 'neutral' };
  const tones: Record<SalesDayStatus, StatusTone> = {
    IMPORTADO: 'ok',
    PENDIENTE: 'info',
    ATRASADO: 'crit',
    CERRADO: 'neutral',
  };
  return { label: SALES_DAY_LABELS[status], tone: tones[status] };
}
export function cashDifferenceLabel(type: CashDifferenceType): string {
  if (type === 'SOBRANTE') return 'Sobrante';
  if (type === 'FALTANTE') return 'Faltante';
  return 'Sin diferencia';
}

// Días que debían informar ventas y no las tienen: CERRADO e IMPORTADO
// nunca son faltantes. Primero los atrasados, luego del más reciente.
export function missingSalesDays(
  items: readonly SalesDayItem[],
): SalesDayItem[] {
  return items
    .filter((item) => item.status === 'ATRASADO' || item.status === 'PENDIENTE')
    .sort(
      (a, b) =>
        Number(b.status === 'ATRASADO') - Number(a.status === 'ATRASADO') ||
        b.businessDate.localeCompare(a.businessDate) ||
        a.store.name.localeCompare(b.store.name, 'es'),
    );
}

export const WEEKDAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
] as const;
export function weekdaysSummary(weekdays: readonly number[]): string {
  if (weekdays.length === 7) return 'Todos los días';
  const labels = WEEKDAYS.filter((day) => weekdays.includes(day.value)).map(
    (day, index) => (index === 0 ? day.label : day.label.toLowerCase()),
  );
  if (labels.length <= 1) return labels.join('');
  return labels.slice(0, -1).join(', ') + ' y ' + labels[labels.length - 1];
}

// Enlaces a cada fuente: el Excel importado y la operación diaria.
export function importDetailHref(importId: string): string {
  return `/admin/importacion-ventas?importacion=${importId}#sales-detail-title`;
}
export function operationDetailHref(operationId: string): string {
  return `/admin/panel-ventas/operaciones/${operationId}`;
}
export function dashboardHref(date: string): string {
  return `/admin/panel-ventas?date=${date}`;
}

export function salesOverviewError(status: number): string {
  const messages: Record<number, string> = {
    400: 'Revisa los filtros: las fechas deben ser válidas, hasta hoy y con un rango de hasta 366 días.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'Solo el administrador puede consultar el panel y los reportes de ventas.',
    404: 'El local o el registro solicitado ya no existe. Actualiza la vista.',
    429: 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.',
    502: 'No se pudo verificar la respuesta del servicio. Intenta nuevamente.',
    503: 'No se pudo conectar con el servicio. Intenta nuevamente más tarde.',
  };
  return messages[status] ?? messages[502];
}
export function calendarError(status: number): string {
  const messages: Record<number, string> = {
    400: 'Revisa los datos: el local debe estar activo y las fechas ser válidas.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'Solo el administrador puede gestionar el calendario de los locales.',
    404: 'El local o el cierre ya no existe. Actualiza la vista.',
    409: 'Ya existe un cierre registrado para ese local y fecha.',
    429: 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.',
    502: 'No se pudo verificar la respuesta del servicio. Intenta nuevamente.',
    503: 'No se pudo conectar con el servicio. Intenta nuevamente más tarde.',
  };
  return messages[status] ?? messages[502];
}
