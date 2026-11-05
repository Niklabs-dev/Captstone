import {
  type CashClosingStatus,
  PaymentMethod,
  Prisma,
} from '../../generated/prisma/client.js';
import type {
  AlertCounts,
  PendingClosingDifference,
  SalesDashboardStore,
  SalesDashboardTotals,
  StoreDashboard,
} from '../types/sales-dashboard.types.js';

// Consolidación por local de la consulta de ventas (SPRINT-4-T13). Funciones
// puras, sin NestJS ni base de datos: reciben lo ya leído de cada fuente y
// arman el resumen, para testear las reglas de conciliación directamente.

const PAYMENT_METHODS = [
  PaymentMethod.CASH,
  PaymentMethod.DEBIT_CARD,
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.TRANSFER,
] as const;

type Decimal = Prisma.Decimal;

// Ventas del día agrupadas por local, medio de pago y si ya pertenecen a un
// cierre (resultado de un groupBy).
export interface SaleGroupInput {
  storeId: string;
  paymentMethod: PaymentMethod;
  closed: boolean;
  salesCount: number;
  grossAmount: Decimal;
  tipAmount: Decimal;
}

// Propina con tarjeta del registro diario, sumada por local.
export interface CardTipInput {
  storeId: string;
  amount: Decimal;
}

export interface ClosingLineInput {
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

function buildStore(
  store: SalesDashboardStore,
  input: SalesDashboardInput,
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
  }));

  // Misma regla que exige motivo al cerrar (hasClosingDifferences de
  // SPRINT-4-T09): cualquier línea descuadrada, aunque otra la compense, o un
  // descuadre de vouchers deja el cierre pendiente de revisión.
  const pendingDifferences: PendingClosingDifference[] = summaries
    .filter(
      (summary) =>
        summary.closing.lines.some((line) => !line.difference.isZero()) ||
        !summary.voucherDifference.isZero(),
    )
    .map((summary) => ({
      closingId: summary.closing.id,
      shift: summary.closing.shift,
      status: summary.closing.status,
      cashDifference: toAmount(summary.cashDifference),
      voucherDifference: toAmount(summary.voucherDifference),
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
      byPaymentMethod: PAYMENT_METHODS.map((paymentMethod) => {
        const groups = sales.filter(
          (group) => group.paymentMethod === paymentMethod,
        );
        return {
          paymentMethod,
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
  const stores = input.stores.map((store) => buildStore(store, input));
  return { stores, totals: buildTotals(stores) };
}
