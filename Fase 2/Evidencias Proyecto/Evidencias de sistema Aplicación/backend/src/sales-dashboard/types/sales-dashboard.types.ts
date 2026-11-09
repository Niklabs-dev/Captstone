import type {
  CashDifferenceLine,
  CashDifferenceTotals,
  DailyOperationFigures,
  ImportedSales,
  ImportStatusInfo,
  ImportStatusSummary,
  PaymentMethodColumn,
  ReportStore,
  SalesTotals,
  TipsTotals,
} from '../../sales-reports/types/sales-reports.types.js';

// Contrato del panel consolidado del administrador (SPRINT-4R-T13, E1-H4):
// un día de negocio en hora de Chile, agrupado por local. Montos en CLP
// enteros. Reutiliza los conceptos de los reportes (/sales-reports), cada uno
// con su única fuente:
// - sales: la versión vigente del Excel MrComanda (null si no hay).
// - dailyOperation: propinas de tarjeta/efectivo y diferencia de efectivo
//   declarada con signo y motivo (null si no se registró).
// - importStatus: el estado diario de GET /sales-days (SPRINT-4R-T12).
// - alerts: alertas legales vigentes de registro en la DT y de entrega de
//   propinas, tal como las calculan sus módulos.
// Ya no expone ventas manuales, cierres por turno, bruto Mercado Pago, neto
// conciliable ni descuadre de vouchers (legado en /sales-reports/legacy).

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
  store: ReportStore;
  importStatus: ImportStatusInfo;
  sales: ImportedSales | null;
  dailyOperation: DailyOperationFigures | null;
  alerts: StoreAlertsSummary;
}

export interface SalesDashboardTotals {
  sales: SalesTotals;
  storesWithoutImport: number;
  tips: TipsTotals;
  storesWithoutDailyOperation: number;
  cashDifferences: CashDifferenceTotals;
  importStatus: ImportStatusSummary;
  dtRegistrationAlerts: AlertCounts;
  tipPaymentAlerts: AlertCounts;
}

export interface SalesDashboard {
  // Día de negocio consultado (YYYY-MM-DD).
  businessDate: string;
  // Día de negocio actual en Chile.
  today: string;
  timeZone: string;
  calculatedAt: Date;
  paymentMethods: PaymentMethodColumn[];
  stores: StoreDashboard[];
  cashDifferences: CashDifferenceLine[];
  totals: SalesDashboardTotals;
}
