import type { SalesDayStatus } from '../../operating-days/calculation/sales-day-status.js';
import type {
  CashDifference,
  CashDifferenceLine,
  CashDifferenceTotals,
  DailyOperationFigures,
  ImportClosure,
  ImportedSales,
  ImportStatusInfo,
  ImportStatusSummary,
  PaymentMethodAmount,
  PaymentMethodColumn,
  ReportDay,
  ReportStore,
  SalesReportTotals,
  SalesTotals,
  StoreReport,
  TipsTotals,
} from '../types/sales-reports.types.js';

// Consolidación pura de ventas importadas, operación diaria y estado de
// importación por local y día (SPRINT-4R-T13). Sin NestJS ni base de datos,
// para probarla directamente. Reglas:
// - Las ventas salen solo de la importación vigente; sin ella el día no tiene
//   cifra de ventas (null) y no se inventa un cero.
// - Propinas y diferencia de efectivo salen solo de la operación diaria y se
//   totalizan aparte: nunca se suman a las ventas.
// - Las diferencias de efectivo no se compensan: sobrantes y faltantes se
//   suman por separado y cada línea distinta de cero se lista con su signo y
//   motivo.
// - Los medios de pago son columnas dinámicas del catálogo: los activos más
//   los inactivos con ventas en el período, en el orden del catálogo.

export interface CatalogMethod {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface ImportInput {
  importId: string;
  storeId: string;
  businessDate: string;
  version: number;
  confirmedAt: Date | null;
  totalAmount: number;
  lines: { paymentMethodId: string; amount: number }[];
}

export interface OperationInput {
  operationId: string;
  storeId: string;
  businessDate: string;
  cardTipAmount: number;
  cashTipAmount: number;
  tipFundAmount: number;
  cashDifference: number;
  differenceReason: string | null;
}

// Importación cargada sin confirmar (PENDING): nunca es venta, solo se
// informa como pendiente.
export interface PendingImportInput {
  importId: string;
  storeId: string;
  businessDate: string;
  version: number;
}

// Estado diario calculado por GET /sales-days (SPRINT-4R-T12).
export interface SalesDayStatusInput {
  storeId: string;
  businessDate: string;
  status: SalesDayStatus;
  activeImportId: string | null;
  pendingImportId: string | null;
  closure: ImportClosure | null;
}

export interface ConsolidationInput {
  stores: ReportStore[];
  paymentMethods: CatalogMethod[];
  imports: ImportInput[];
  operations: OperationInput[];
  salesDays: SalesDayStatusInput[];
  // Todas las versiones pendientes del período: /sales-days solo las informa
  // para locales activos con el día informado.
  pendingImports: PendingImportInput[];
}

export interface Consolidation {
  paymentMethods: PaymentMethodColumn[];
  stores: StoreReport[];
  cashDifferences: CashDifferenceLine[];
  totals: SalesReportTotals;
}

export function emptyImportStatusSummary(): ImportStatusSummary {
  return { IMPORTADO: 0, PENDIENTE: 0, ATRASADO: 0, CERRADO: 0 };
}

export function cashDifferenceOf(
  amount: number,
  reason: string | null,
): CashDifference {
  if (amount > 0) return { amount, type: 'SOBRANTE', reason };
  if (amount < 0) return { amount, type: 'FALTANTE', reason };
  return { amount: 0, type: 'SIN_DIFERENCIA', reason };
}

function compareMethods(left: CatalogMethod, right: CatalogMethod): number {
  return (
    left.sortOrder - right.sortOrder ||
    (left.code < right.code ? -1 : left.code > right.code ? 1 : 0)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Columnas del período: activos del catálogo más inactivos con historial.
function paymentMethodColumns(
  catalog: CatalogMethod[],
  imports: ImportInput[],
): CatalogMethod[] {
  const used = new Set(
    imports.flatMap((item) => item.lines.map((line) => line.paymentMethodId)),
  );
  const known = new Set(catalog.map((method) => method.id));
  for (const id of used) {
    if (!known.has(id)) {
      throw new Error(`Medio de pago ${id} fuera del catálogo`);
    }
  }
  return catalog
    .filter((method) => method.isActive || used.has(method.id))
    .sort(compareMethods);
}

function amountsByMethod(
  columns: CatalogMethod[],
  totals: ReadonlyMap<string, number>,
): PaymentMethodAmount[] {
  return columns.map((method) => ({
    paymentMethod: method.code,
    paymentMethodName: method.name,
    isActive: method.isActive,
    amount: totals.get(method.id) ?? 0,
  }));
}

// Acumula los montos de las líneas por medio de pago (un medio puede tener
// varias etiquetas en el mismo reporte) y devuelve el mismo mapa.
function addLines(
  target: Map<string, number>,
  lines: ImportInput['lines'],
): Map<string, number> {
  for (const line of lines) {
    target.set(
      line.paymentMethodId,
      (target.get(line.paymentMethodId) ?? 0) + line.amount,
    );
  }
  return target;
}

function importedSalesOf(
  item: ImportInput,
  columns: CatalogMethod[],
): ImportedSales {
  const totals = addLines(new Map<string, number>(), item.lines);
  return {
    importId: item.importId,
    version: item.version,
    confirmedAt: item.confirmedAt,
    totalAmount: item.totalAmount,
    byPaymentMethod: amountsByMethod(columns, totals),
  };
}

function operationFiguresOf(item: OperationInput): DailyOperationFigures {
  return {
    operationId: item.operationId,
    cardTipAmount: item.cardTipAmount,
    cashTipAmount: item.cashTipAmount,
    tipFundAmount: item.tipFundAmount,
    cashDifference: cashDifferenceOf(
      item.cashDifference,
      item.differenceReason,
    ),
  };
}

function emptyTips(): TipsTotals {
  return {
    operationsCount: 0,
    cardTipAmount: 0,
    cashTipAmount: 0,
    tipFundAmount: 0,
  };
}

function emptyDifferences(): CashDifferenceTotals {
  return {
    count: 0,
    surplusCount: 0,
    shortageCount: 0,
    surplusAmount: 0,
    shortageAmount: 0,
  };
}

function tipsOf(item: OperationInput): TipsTotals {
  return {
    operationsCount: 1,
    cardTipAmount: item.cardTipAmount,
    cashTipAmount: item.cashTipAmount,
    tipFundAmount: item.tipFundAmount,
  };
}

function differencesOf(item: OperationInput): CashDifferenceTotals {
  const amount = item.cashDifference;
  return {
    count: amount !== 0 ? 1 : 0,
    surplusCount: amount > 0 ? 1 : 0,
    shortageCount: amount < 0 ? 1 : 0,
    surplusAmount: amount > 0 ? amount : 0,
    shortageAmount: amount < 0 ? amount : 0,
  };
}

function sumTips(left: TipsTotals, right: TipsTotals): TipsTotals {
  return {
    operationsCount: left.operationsCount + right.operationsCount,
    cardTipAmount: left.cardTipAmount + right.cardTipAmount,
    cashTipAmount: left.cashTipAmount + right.cashTipAmount,
    tipFundAmount: left.tipFundAmount + right.tipFundAmount,
  };
}

function sumDifferences(
  left: CashDifferenceTotals,
  right: CashDifferenceTotals,
): CashDifferenceTotals {
  return {
    count: left.count + right.count,
    surplusCount: left.surplusCount + right.surplusCount,
    shortageCount: left.shortageCount + right.shortageCount,
    surplusAmount: left.surplusAmount + right.surplusAmount,
    shortageAmount: left.shortageAmount + right.shortageAmount,
  };
}

function sumSummaries(
  left: ImportStatusSummary,
  right: ImportStatusSummary,
): ImportStatusSummary {
  return {
    IMPORTADO: left.IMPORTADO + right.IMPORTADO,
    PENDIENTE: left.PENDIENTE + right.PENDIENTE,
    ATRASADO: left.ATRASADO + right.ATRASADO,
    CERRADO: left.CERRADO + right.CERRADO,
  };
}

function importStatusOf(
  salesDay: SalesDayStatusInput | undefined,
  item: ImportInput | undefined,
  pending: PendingImportInput | undefined,
): ImportStatusInfo {
  if (salesDay) {
    return {
      status: salesDay.status,
      activeImportId: salesDay.activeImportId,
      pendingImportId: salesDay.pendingImportId,
      closure: salesDay.closure,
    };
  }
  // /sales-days no informa locales inactivos ni días sin calendario: si aun
  // así hay importación vigente, el día está importado (misma regla 2 de
  // sales-day-status), y la versión pendiente se informa igual.
  return {
    status: item ? 'IMPORTADO' : null,
    activeImportId: item?.importId ?? null,
    pendingImportId: pending?.importId ?? null,
    closure: null,
  };
}

export function consolidateSales(input: ConsolidationInput): Consolidation {
  const columns = paymentMethodColumns(input.paymentMethods, input.imports);
  const key = (storeId: string, date: string): string => `${storeId}|${date}`;
  const importByDay = new Map(
    input.imports.map((item) => [key(item.storeId, item.businessDate), item]),
  );
  const operationByDay = new Map(
    input.operations.map((item) => [
      key(item.storeId, item.businessDate),
      item,
    ]),
  );
  const salesDayByDay = new Map(
    input.salesDays.map((item) => [key(item.storeId, item.businessDate), item]),
  );
  // La última versión pendiente prevalece, como en /sales-days.
  const pendingByDay = new Map<string, PendingImportInput>();
  for (const item of input.pendingImports) {
    const dayKey = key(item.storeId, item.businessDate);
    const current = pendingByDay.get(dayKey);
    if (!current || item.version > current.version) {
      pendingByDay.set(dayKey, item);
    }
  }

  const stores = [...input.stores].sort(
    (left, right) =>
      compareText(left.name, right.name) || compareText(left.id, right.id),
  );
  const grandSales = new Map<string, number>();
  const cashDifferences: CashDifferenceLine[] = [];

  // Fechas de cada local en una sola pasada por las fuentes.
  const datesByStore = new Map<string, Set<string>>();
  for (const source of [
    input.imports,
    input.operations,
    input.salesDays,
    input.pendingImports,
  ]) {
    for (const item of source) {
      const dates = datesByStore.get(item.storeId) ?? new Set<string>();
      dates.add(item.businessDate);
      datesByStore.set(item.storeId, dates);
    }
  }

  const storeReports = stores.map((store): StoreReport => {
    const dates = datesByStore.get(store.id) ?? new Set<string>();
    const storeSales = new Map<string, number>();
    let importedDays = 0;
    let totalAmount = 0;
    let tips = emptyTips();
    let differences = emptyDifferences();
    let importStatus = emptyImportStatusSummary();

    const days = [...dates].sort(compareText).map((date): ReportDay => {
      const dayKey = key(store.id, date);
      const imported = importByDay.get(dayKey);
      const operation = operationByDay.get(dayKey);
      const status = importStatusOf(
        salesDayByDay.get(dayKey),
        imported,
        pendingByDay.get(dayKey),
      );
      if (status.status !== null) {
        importStatus = {
          ...importStatus,
          [status.status]: importStatus[status.status] + 1,
        };
      }
      if (imported) {
        importedDays += 1;
        totalAmount += imported.totalAmount;
        addLines(storeSales, imported.lines);
        addLines(grandSales, imported.lines);
      }
      if (operation) {
        tips = sumTips(tips, tipsOf(operation));
        differences = sumDifferences(differences, differencesOf(operation));
        if (operation.cashDifference !== 0) {
          cashDifferences.push({
            store: { id: store.id, name: store.name },
            businessDate: date,
            operationId: operation.operationId,
            amount: operation.cashDifference,
            type: operation.cashDifference > 0 ? 'SOBRANTE' : 'FALTANTE',
            reason: operation.differenceReason,
          });
        }
      }
      return {
        businessDate: date,
        importStatus: status,
        sales: imported ? importedSalesOf(imported, columns) : null,
        dailyOperation: operation ? operationFiguresOf(operation) : null,
      };
    });

    return {
      store,
      sales: {
        importedDays,
        totalAmount,
        byPaymentMethod: amountsByMethod(columns, storeSales),
      },
      tips,
      cashDifferences: differences,
      importStatus,
      days,
    };
  });

  const sales: SalesTotals = {
    importedDays: storeReports.reduce(
      (sum, report) => sum + report.sales.importedDays,
      0,
    ),
    totalAmount: storeReports.reduce(
      (sum, report) => sum + report.sales.totalAmount,
      0,
    ),
    byPaymentMethod: amountsByMethod(columns, grandSales),
  };
  const totals: SalesReportTotals = {
    sales,
    tips: storeReports
      .map((report) => report.tips)
      .reduce(sumTips, emptyTips()),
    cashDifferences: storeReports
      .map((report) => report.cashDifferences)
      .reduce(sumDifferences, emptyDifferences()),
    importStatus: storeReports
      .map((report) => report.importStatus)
      .reduce(sumSummaries, emptyImportStatusSummary()),
  };

  cashDifferences.sort(
    (left, right) =>
      compareText(left.businessDate, right.businessDate) ||
      compareText(left.store.name, right.store.name) ||
      compareText(left.store.id, right.store.id),
  );

  return {
    paymentMethods: columns.map((method) => ({
      paymentMethod: method.code,
      paymentMethodName: method.name,
      isActive: method.isActive,
    })),
    stores: storeReports,
    cashDifferences,
    totals,
  };
}
