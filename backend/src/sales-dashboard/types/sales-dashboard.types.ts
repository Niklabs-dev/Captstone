import type { CashClosingStatus } from '../../generated/prisma/client.js';

// Contrato de la consulta consolidada de ventas, alertas y diferencias por
// local (SPRINT-4-T13, E1-H4; medios de pago dinámicos en SPRINT-4-T32).
// Todos los montos son CLP enteros.
//
// Para no contar dos veces la misma plata, cada concepto es independiente:
// - sales: ventas NETAS (gross_amount - tip_amount); la propina nunca es venta.
// - cardTips: propina pagada con tarjeta, por separado y desde sus fuentes
//   (registro diario de propinas y vouchers de Mercado Pago de los cierres).
// - closings: cifras de los cierres del día; voucherDifference es el
//   descuadre de conciliación de vouchers (Mercado Pago neto - MrComanda),
//   distinto de la diferencia de caja contada (cashDifference), que solo se
//   informa agregada y nunca decide el cuadre.
//
// Los medios de pago se resuelven desde el catálogo: cada desglose lleva el
// código estable y el nombre vigente, e incluye los medios activos más los
// históricos con movimientos del día.

export interface SalesDashboardStore {
  id: string;
  name: string;
  city: string;
  isActive: boolean;
}

export interface PaymentMethodSales {
  paymentMethod: string;
  paymentMethodName: string;
  salesCount: number;
  netAmount: number;
}

// Ventas del día de negocio en hora de Chile, por sold_at.
export interface StoreSalesSummary {
  salesCount: number;
  netAmount: number;
  // Parte de las ventas del día ya conciliada en un cierre de caja.
  closedSalesCount: number;
  closedNetAmount: number;
  // Ventas del día que todavía no pertenecen a ningún cierre.
  unclosedSalesCount: number;
  unclosedNetAmount: number;
  byPaymentMethod: PaymentMethodSales[];
}

export interface StoreCardTipsSummary {
  // Registro diario de propinas con medio conciliable con tarjeta
  // (tip_entries): la fuente de los repartos.
  registeredAmount: number;
  // Propina informada por los vouchers de Mercado Pago de los cierres del día.
  closingsAmount: number;
}

export interface StoreClosingsSummary {
  count: number;
  shifts: number[];
  // Ventas netas conciliadas por los cierres (lo esperado sin fondo de caja).
  netSalesAmount: number;
  countedAmount: number;
  // Suma de las diferencias por medio de pago (contado - esperado). Cifra
  // informativa: no decide el cuadre (una compensación puede sumar 0).
  cashDifference: number;
  // Suma de los descuadres de conciliación de vouchers.
  voucherDifference: number;
  mrcomandaNetSales: number;
  mercadoPagoNetSales: number;
}

// Estado de cuadre de un cierre: cualquier línea o la conciliación de
// vouchers con diferencia distinta de 0 lo deja NO_CUADRADO, aunque la
// diferencia de caja total se compense a 0.
export const CLOSING_BALANCE_STATUSES = ['CUADRADO', 'NO_CUADRADO'] as const;
export type ClosingBalanceStatus = (typeof CLOSING_BALANCE_STATUSES)[number];

// Línea de cierre con diferencia distinta de cero (contado vs. esperado).
export interface ClosingLineDifference {
  paymentMethod: string;
  paymentMethodName: string;
  expectedAmount: number;
  countedAmount: number;
  difference: number;
}

// Cierre del día con diferencia de caja o descuadre de vouchers distinto de 0.
export interface PendingClosingDifference {
  closingId: string;
  shift: number;
  status: CashClosingStatus;
  // Suma de las diferencias de línea del cierre (informativa).
  cashDifference: number;
  voucherDifference: number;
  // Detalle de las líneas descuadradas, con medio y montos.
  lineDifferences: ClosingLineDifference[];
  // true si alguna línea o la conciliación de vouchers está descuadrada.
  hasDifferences: boolean;
  isBalanced: boolean;
  balanceStatus: ClosingBalanceStatus;
  differenceReason: string | null;
  closedAt: Date | null;
}

export interface AlertCounts {
  overdue: number;
  upcoming: number;
}

// Alertas vigentes al momento de la consulta (no dependen de la fecha).
export interface StoreAlertsSummary {
  dtRegistration: AlertCounts;
  tipPayment: AlertCounts;
}

export interface StoreDashboard {
  store: SalesDashboardStore;
  sales: StoreSalesSummary;
  cardTips: StoreCardTipsSummary;
  closings: StoreClosingsSummary;
  pendingDifferences: PendingClosingDifference[];
  alerts: StoreAlertsSummary;
}

export interface SalesDashboardTotals {
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
  // Día de negocio consultado (YYYY-MM-DD).
  businessDate: string;
  timeZone: string;
  // Instantes [periodStart, periodEnd) que cubren el día en hora de Chile.
  periodStart: Date;
  periodEnd: Date;
  calculatedAt: Date;
  stores: StoreDashboard[];
  totals: SalesDashboardTotals;
}
