import type {
  CashClosingStatus,
  SaleSource,
} from '../../generated/prisma/client.js';
import type { SalesDayStatus } from '../../operating-days/calculation/sales-day-status.js';

// Contrato de los reportes de ventas y diferencias por período y local
// (SPRINT-4R-T13, E1-H4). Todos los montos son CLP enteros y las fechas de
// negocio van como YYYY-MM-DD en hora de Chile (America/Santiago).
//
// Cada concepto sale de UNA sola fuente y nunca se mezcla con otro:
// - Ventas: exclusivamente la versión vigente del Excel de MrComanda
//   (sales_imports ACTIVE con is_current). Sin importación vigente no hay
//   cifra de ventas (null), nunca un cero inventado.
// - Propinas de tarjeta y de efectivo: la operación diaria
//   (daily_operations). Jamás se suman a las ventas.
// - Diferencia de efectivo: la declarada en la operación diaria, con signo y
//   motivo. No se infiere del Excel ni se compensa entre días o locales:
//   sobrantes y faltantes se totalizan por separado.
// - Estado de importación: el mismo cálculo de GET /sales-days
//   (SPRINT-4R-T12).
// Los cierres por turno, el bruto Mercado Pago, el neto conciliable y el
// descuadre de vouchers quedan fuera de este contrato: se consultan como
// legado en GET /sales-reports/legacy.

export const CASH_DIFFERENCE_TYPES = [
  'SOBRANTE',
  'FALTANTE',
  'SIN_DIFERENCIA',
] as const;
export type CashDifferenceType = (typeof CASH_DIFFERENCE_TYPES)[number];

export interface ReportStore {
  id: string;
  name: string;
  city: string;
  isActive: boolean;
}

export interface StoreRef {
  id: string;
  name: string;
}

// Medio de pago presente en el reporte: código estable y nombre vigente del
// catálogo. Incluye los activos y los inactivos con historial en el período.
export interface PaymentMethodColumn {
  paymentMethod: string;
  paymentMethodName: string;
  isActive: boolean;
}

export interface PaymentMethodAmount extends PaymentMethodColumn {
  amount: number;
}

// Ventas de un local y día según la importación vigente.
export interface ImportedSales {
  importId: string;
  version: number;
  confirmedAt: Date | null;
  totalAmount: number;
  byPaymentMethod: PaymentMethodAmount[];
}

export interface CashDifference {
  // Con signo: positiva sobrante, negativa faltante.
  amount: number;
  type: CashDifferenceType;
  reason: string | null;
}

// Cifras declaradas en la operación diaria del local y día.
export interface DailyOperationFigures {
  operationId: string;
  cardTipAmount: number;
  cashTipAmount: number;
  tipFundAmount: number;
  cashDifference: CashDifference;
}

export interface ImportClosure {
  id: string;
  reason: string;
}

export interface ImportStatusInfo {
  // null cuando el día no se informa (local sin calendario, día anterior a
  // la fecha de inicio del calendario o local inactivo sin importación).
  status: SalesDayStatus | null;
  activeImportId: string | null;
  pendingImportId: string | null;
  closure: ImportClosure | null;
}

export interface ReportDay {
  businessDate: string;
  importStatus: ImportStatusInfo;
  sales: ImportedSales | null;
  dailyOperation: DailyOperationFigures | null;
}

// Línea de diferencia de efectivo distinta de cero: nunca se oculta ni se
// compensa con otras.
export interface CashDifferenceLine {
  store: StoreRef;
  businessDate: string;
  operationId: string;
  amount: number;
  type: Exclude<CashDifferenceType, 'SIN_DIFERENCIA'>;
  reason: string | null;
}

export type ImportStatusSummary = Record<SalesDayStatus, number>;

export interface SalesTotals {
  // Días con importación vigente.
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
  // Operaciones con diferencia distinta de cero.
  count: number;
  surplusCount: number;
  shortageCount: number;
  // Suma de los sobrantes (>= 0).
  surplusAmount: number;
  // Suma de los faltantes, con signo (<= 0).
  shortageAmount: number;
}

export interface StoreReport {
  store: ReportStore;
  sales: SalesTotals;
  tips: TipsTotals;
  cashDifferences: CashDifferenceTotals;
  importStatus: ImportStatusSummary;
  days: ReportDay[];
}

export interface SalesReportTotals {
  sales: SalesTotals;
  tips: TipsTotals;
  cashDifferences: CashDifferenceTotals;
  importStatus: ImportStatusSummary;
}

export interface SalesReport {
  from: string;
  to: string;
  // Día de negocio actual en Chile al calcular.
  today: string;
  timeZone: string;
  storeId: string | null;
  calculatedAt: Date;
  paymentMethods: PaymentMethodColumn[];
  stores: StoreReport[];
  cashDifferences: CashDifferenceLine[];
  totals: SalesReportTotals;
}

// --- Legado (flujo previo a SPRINT-4R-T01, solo lectura) ---

export interface LegacyClosing {
  closingId: string;
  store: StoreRef;
  businessDate: string;
  shift: number;
  status: CashClosingStatus;
  mrcomandaNetSales: number;
  mercadoPagoGrossAmount: number;
  mercadoPagoTipAmount: number;
  // Descuadre de conciliación de vouchers (reconciliation_difference).
  voucherDifference: number;
  // Suma de las diferencias por línea del cierre.
  cashDifference: number;
  differenceReason: string | null;
  closedAt: Date | null;
}

export interface LegacySales {
  store: StoreRef;
  paymentMethod: string;
  paymentMethodName: string;
  source: SaleSource;
  salesCount: number;
  netAmount: number;
}

export interface LegacySalesReport {
  from: string;
  to: string;
  timeZone: string;
  storeId: string | null;
  notice: string;
  closings: LegacyClosing[];
  sales: LegacySales[];
}
