import {
  type CashClosingStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import {
  type AlertCounts,
  type ClosingBalanceStatus,
  type ClosingLineDifference,
  type PendingClosingDifference,
  type SalesDashboardStore,
  type SalesDashboardTotals,
  type StoreDashboard,
} from '../types/sales-dashboard.types.js';

// Consolidación por local de la consulta de ventas (SPRINT-4-T13; medios de
// pago dinámicos desde el catálogo en SPRINT-4-T32). Funciones puras, sin
// NestJS ni base de datos: reciben lo ya leído de cada fuente y arman el
// resumen, para testear las reglas de conciliación directamente.

type Decimal = Prisma.Decimal;

// Medio de pago del catálogo, ya ordenado por sortOrder/código por quien
// consulta; el agregador lo usa para armar desgloses dinámicos.
export interface PaymentMethodInput {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

// Ventas del día agrupadas por local, medio de pago y si ya pertenecen a un
// cierre (resultado de un groupBy).
export interface SaleGroupInput {
  storeId: string;
  paymentMethodId: string;
  closed: boolean;
  salesCount: number;
  grossAmount: Decimal;
  tipAmount: Decimal;
}

// Propina con medio conciliable con tarjeta del registro diario, por local.
export interface CardTipInput {
  storeId: string;
  amount: Decimal;
}

export interface ClosingLineInput {
  paymentMethodId: string;
  expectedAmount: Decimal;
  countedAmount: Decimal;
  difference: Decimal;
}

export interface ClosingInput {
  id: string;
  storeId: string;
  shift: number;
  status: CashClosingStatus;
  openingCash: Decimal;
  mrcomandaNetSales: Decimal;
  mercadoPagoGrossAmount: Decimal;
  mercadoPagoTipAmount: Decimal;
  reconciliationDifference: Decimal;
  differenceReason: string | null;
  closedAt: Date | null;
  lines: ClosingLineInput[];
}

export interface StoreAlertInput {
  storeId: string;
  status: 'OVERDUE' | 'UPCOMING';
}

export interface SalesDashboardInput {
  stores: SalesDashboardStore[];
  paymentMethods: PaymentMethodInput[];
  sales: SaleGroupInput[];
  cardTips: CardTipInput[];
  closings: ClosingInput[];
  dtAlerts: StoreAlertInput[];
  tipAlerts: StoreAlertInput[];
}

export interface ConsolidatedDashboard {
  stores: StoreDashboard[];
  totals: SalesDashboardTotals;
}

const ZERO = (): Decimal => new Prisma.Decimal(0);

function sum(values: Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), ZERO());
}

function toAmount(value: Decimal): number {
  // Evita "-0" cuando una suma de diferencias se compensa.
  return value.toNumber() + 0;
}

// Venta neta: lo cobrado menos la propina incluida.
function netOf(group: SaleGroupInput): Decimal {
  return group.grossAmount.minus(group.tipAmount);
}

function countAlerts(alerts: StoreAlertInput[]): AlertCounts {
  return {
    overdue: alerts.filter((alert) => alert.status === 'OVERDUE').length,
    upcoming: alerts.filter((alert) => alert.status === 'UPCOMING').length,
  };
}

function summarizeClosing(closing: ClosingInput) {
  const expected = sum(closing.lines.map((line) => line.expectedAmount));
  return {
    // Lo esperado incluye el fondo de caja en la línea CASH (SPRINT-4-T09):
    // se descuenta para obtener solo la venta neta conciliada.
    netSales: expected.minus(closing.openingCash),
    counted: sum(closing.lines.map((line) => line.countedAmount)),
    cashDifference: sum(closing.lines.map((line) => line.difference)),
    voucherDifference: closing.reconciliationDifference,
    mercadoPagoNetSales: closing.mercadoPagoGrossAmount.minus(
      closing.mercadoPagoTipAmount,
    ),
  };
}

// Misma regla que exige motivo al cerrar (hasClosingDifferences de
// SPRINT-4-T09): cualquier línea descuadrada, aunque otra la compense, o un
// descuadre de vouchers deja el cierre NO_CUADRADO.
function balanceStatusOf(closing: ClosingInput): {
  status: ClosingBalanceStatus;
  hasDifferences: boolean;
} {
  const hasDifferences =
    closing.lines.some((line) => !line.difference.isZero()) ||
    !closing.reconciliationDifference.isZero();
  return {
    status: hasDifferences ? 'NO_CUADRADO' : 'CUADRADO',
    hasDifferences,
  };
}

function buildStore(
  store: SalesDashboardStore,
  input: SalesDashboardInput,
  methodById: Map<string, PaymentMethodInput>,
): StoreDashboard {
  const sales = input.sales.filter((group) => group.storeId === store.id);
  const closed = sales.filter((group) => group.closed);
  const unclosed = sales.filter((group) => !group.closed);
  const count = (groups: SaleGroupInput[]): number =>
    groups.reduce((total, group) => total + group.salesCount, 0);
  const net = (groups: SaleGroupInput[]): number =>
    toAmount(sum(groups.map(netOf)));

  const closings = input.closings
    .filter((closing) => closing.storeId === store.id)
    .sort((left, right) => left.shift - right.shift);
  const summaries = closings.map((closing) => ({
    closing,
    ...summarizeClosing(closing),
    ...balanceStatusOf(closing),
  }));

  // Desglose dinámico del local: medios activos del catálogo más los medios
  // históricos (inactivos) que tengan ventas en el día, en el orden del
  // catálogo (sortOrder/código).
  const storeMethodIds = new Set(sales.map((group) => group.paymentMethodId));
  const storeMethods = input.paymentMethods.filter(
    (method) => method.isActive || storeMethodIds.has(method.id),
  );

  const pendingDifferences: PendingClosingDifference[] = summaries
    .filter((summary) => summary.hasDifferences)
    .map((summary) => ({
      closingId: summary.closing.id,
      shift: summary.closing.shift,
      status: summary.closing.status,
      cashDifference: toAmount(summary.cashDifference),
      voucherDifference: toAmount(summary.voucherDifference),
      // Orden estable por el catálogo (sortOrder/código): el orden físico de
      // las líneas leídas de la base no está garantizado y el contrato de la
      // respuesta es determinista, igual que las líneas del detalle del
      // cierre (SPRINT-4-T09).
      lineDifferences: summary.closing.lines
        .filter((line) => !line.difference.isZero())
        .slice()
        .sort((left, right) => {
          const leftMethod = methodById.get(left.paymentMethodId);
          const rightMethod = methodById.get(right.paymentMethodId);
          return (
            (leftMethod?.sortOrder ?? 0) - (rightMethod?.sortOrder ?? 0) ||
            (leftMethod?.code ?? '').localeCompare(rightMethod?.code ?? '')
          );
        })
        .map((line): ClosingLineDifference => ({
          paymentMethod: methodById.get(line.paymentMethodId)?.code ?? '',
          paymentMethodName: methodById.get(line.paymentMethodId)?.name ?? '',
          expectedAmount: toAmount(line.expectedAmount),
          countedAmount: toAmount(line.countedAmount),
          difference: toAmount(line.difference),
        })),
      hasDifferences: summary.hasDifferences,
      isBalanced: !summary.hasDifferences,
      balanceStatus: summary.status,
      differenceReason: summary.closing.differenceReason,
      closedAt: summary.closing.closedAt,
    }));

  return {
    store,
    sales: {
      salesCount: count(sales),
      netAmount: net(sales),
      closedSalesCount: count(closed),
      closedNetAmount: net(closed),
      unclosedSalesCount: count(unclosed),
      unclosedNetAmount: net(unclosed),
      byPaymentMethod: storeMethods.map((method) => {
        const groups = sales.filter(
          (group) => group.paymentMethodId === method.id,
        );
        return {
          paymentMethod: method.code,
          paymentMethodName: method.name,
          salesCount: count(groups),
          netAmount: net(groups),
        };
      }),
    },
    cardTips: {
      registeredAmount: toAmount(
        sum(
          input.cardTips
            .filter((tip) => tip.storeId === store.id)
            .map((tip) => tip.amount),
        ),
      ),
      closingsAmount: toAmount(
        sum(closings.map((closing) => closing.mercadoPagoTipAmount)),
      ),
    },
    closings: {
      count: closings.length,
      shifts: closings.map((closing) => closing.shift),
      netSalesAmount: toAmount(sum(summaries.map((s) => s.netSales))),
      countedAmount: toAmount(sum(summaries.map((s) => s.counted))),
      cashDifference: toAmount(sum(summaries.map((s) => s.cashDifference))),
      voucherDifference: toAmount(
        sum(summaries.map((s) => s.voucherDifference)),
      ),
      mrcomandaNetSales: toAmount(
        sum(closings.map((closing) => closing.mrcomandaNetSales)),
      ),
      mercadoPagoNetSales: toAmount(
        sum(summaries.map((s) => s.mercadoPagoNetSales)),
      ),
    },
    pendingDifferences,
    alerts: {
      dtRegistration: countAlerts(
        input.dtAlerts.filter((alert) => alert.storeId === store.id),
      ),
      tipPayment: countAlerts(
        input.tipAlerts.filter((alert) => alert.storeId === store.id),
      ),
    },
  };
}

function addCounts(left: AlertCounts, right: AlertCounts): AlertCounts {
  return {
    overdue: left.overdue + right.overdue,
    upcoming: left.upcoming + right.upcoming,
  };
}

function buildTotals(stores: StoreDashboard[]): SalesDashboardTotals {
  const total = (pick: (store: StoreDashboard) => number): number =>
    stores.reduce((acc, store) => acc + pick(store), 0) + 0;
  const none: AlertCounts = { overdue: 0, upcoming: 0 };
  return {
    salesCount: total((s) => s.sales.salesCount),
    netAmount: total((s) => s.sales.netAmount),
    closedNetAmount: total((s) => s.sales.closedNetAmount),
    unclosedNetAmount: total((s) => s.sales.unclosedNetAmount),
    cardTipsRegisteredAmount: total((s) => s.cardTips.registeredAmount),
    cardTipsClosingsAmount: total((s) => s.cardTips.closingsAmount),
    closingsCount: total((s) => s.closings.count),
    cashDifference: total((s) => s.closings.cashDifference),
    voucherDifference: total((s) => s.closings.voucherDifference),
    pendingDifferencesCount: total((s) => s.pendingDifferences.length),
    dtRegistrationAlerts: stores
      .map((s) => s.alerts.dtRegistration)
      .reduce(addCounts, none),
    tipPaymentAlerts: stores
      .map((s) => s.alerts.tipPayment)
      .reduce(addCounts, none),
  };
}

// Arma el resumen de cada local (en el orden recibido) y el total general.
// Un local sin movimientos aparece igual, con ceros, para que el panel siempre
// muestre los tres locales.
export function buildSalesDashboard(
  input: SalesDashboardInput,
): ConsolidatedDashboard {
  const methodById = new Map(
    input.paymentMethods.map((method) => [method.id, method]),
  );
  const stores = input.stores.map((store) =>
    buildStore(store, input, methodById),
  );
  return { stores, totals: buildTotals(stores) };
}
