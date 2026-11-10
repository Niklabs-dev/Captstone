import type {
  CashDifference,
  CashDifferenceLine,
  CashDifferenceTotals,
  DailyOperationFigures,
  ImportClosure,
  ImportedSales,
  ImportStatusInfo,
  ImportStatusSummary,
  LegacyClosing,
  LegacyClosingLineDifference,
  LegacySales,
  PaymentMethodAmount,
  PaymentMethodColumn,
  ReportDay,
  ReportStore,
  SalesReportTotals,
  SalesTotals,
  StoreRef,
  StoreReport,
  TipsTotals,
} from '../types/sales-reports.types.js';

// Ejemplos de Swagger de los reportes y del panel (SPRINT-4R-T13): un solo
// escenario coherente (un local, un día y su semana) para que cada objeto
// anidado documente su forma con cifras que cuadran entre sí.

// Forma JSON de un contrato: las fechas viajan como texto ISO 8601.
export type Json<T> = T extends Date
  ? string
  : T extends (infer Item)[]
    ? Json<Item>[]
    : T extends object
      ? { [Key in keyof T]: Json<T[Key]> }
      : T;

const IMPORT_ID = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const OPERATION_ID = '3f2e1d0c-9b8a-4765-8432-10fedcba9876';

export const EXAMPLE_STORE_REF: StoreRef = {
  id: '1010021e-9bab-42d5-851c-417e9e2503bf',
  name: 'Santa María',
};

export const EXAMPLE_STORE: ReportStore = {
  ...EXAMPLE_STORE_REF,
  city: 'Melipilla',
  isActive: true,
};

const CASH: PaymentMethodColumn = {
  paymentMethod: 'CASH',
  paymentMethodName: 'Efectivo',
  isActive: true,
};

const DEBIT: PaymentMethodColumn = {
  paymentMethod: 'DEBIT_CARD',
  paymentMethodName: 'Tarjeta de débito',
  isActive: true,
};

export const EXAMPLE_PAYMENT_METHODS: PaymentMethodColumn[] = [CASH, DEBIT];

// Ventas de un día por medio (suman EXAMPLE_IMPORTED_SALES.totalAmount).
export const EXAMPLE_DAY_AMOUNTS: PaymentMethodAmount[] = [
  { ...CASH, amount: 421230 },
  { ...DEBIT, amount: 254300 },
];

// Ventas del período por medio (suman EXAMPLE_PERIOD_SALES.totalAmount).
export const EXAMPLE_PERIOD_AMOUNTS: PaymentMethodAmount[] = [
  { ...CASH, amount: 2527380 },
  { ...DEBIT, amount: 1525800 },
];

export const EXAMPLE_IMPORTED_SALES: Json<ImportedSales> = {
  importId: IMPORT_ID,
  version: 2,
  confirmedAt: '2026-11-07T13:05:00.000Z',
  totalAmount: 675530,
  byPaymentMethod: EXAMPLE_DAY_AMOUNTS,
};

export const EXAMPLE_CASH_DIFFERENCE: CashDifference = {
  amount: -2500,
  type: 'FALTANTE',
  reason: 'Vuelto mal entregado',
};

export const EXAMPLE_DAILY_OPERATION: DailyOperationFigures = {
  operationId: OPERATION_ID,
  cardTipAmount: 12000,
  cashTipAmount: 8000,
  tipFundAmount: 20000,
  cashDifference: EXAMPLE_CASH_DIFFERENCE,
  hasVoucher: true,
};

export const EXAMPLE_CLOSURE: ImportClosure = {
  id: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
  reason: 'Feriado de Navidad',
};

export const EXAMPLE_IMPORT_STATUS: ImportStatusInfo = {
  status: 'IMPORTADO',
  activeImportId: IMPORT_ID,
  pendingImportId: null,
  closure: null,
};

export const EXAMPLE_REPORT_DAY: Json<ReportDay> = {
  businessDate: '2026-11-06',
  importStatus: EXAMPLE_IMPORT_STATUS,
  sales: EXAMPLE_IMPORTED_SALES,
  dailyOperation: EXAMPLE_DAILY_OPERATION,
};

export const EXAMPLE_CASH_DIFFERENCE_LINE: CashDifferenceLine = {
  store: EXAMPLE_STORE_REF,
  businessDate: '2026-11-06',
  operationId: OPERATION_ID,
  amount: -2500,
  type: 'FALTANTE',
  reason: 'Vuelto mal entregado',
};

export const EXAMPLE_PERIOD_IMPORT_STATUS: ImportStatusSummary = {
  IMPORTADO: 6,
  PENDIENTE: 1,
  ATRASADO: 0,
  CERRADO: 1,
};

export const EXAMPLE_PERIOD_SALES: SalesTotals = {
  importedDays: 6,
  totalAmount: 4053180,
  byPaymentMethod: EXAMPLE_PERIOD_AMOUNTS,
};

export const EXAMPLE_PERIOD_TIPS: TipsTotals = {
  operationsCount: 6,
  cardTipAmount: 72000,
  cashTipAmount: 48000,
  tipFundAmount: 120000,
};

export const EXAMPLE_PERIOD_CASH_DIFFERENCES: CashDifferenceTotals = {
  count: 2,
  surplusCount: 1,
  shortageCount: 1,
  surplusAmount: 1500,
  shortageAmount: -2500,
};

export const EXAMPLE_STORE_REPORT: Json<StoreReport> = {
  store: EXAMPLE_STORE,
  sales: EXAMPLE_PERIOD_SALES,
  tips: EXAMPLE_PERIOD_TIPS,
  cashDifferences: EXAMPLE_PERIOD_CASH_DIFFERENCES,
  importStatus: EXAMPLE_PERIOD_IMPORT_STATUS,
  days: [EXAMPLE_REPORT_DAY],
};

export const EXAMPLE_REPORT_TOTALS: SalesReportTotals = {
  sales: EXAMPLE_PERIOD_SALES,
  tips: EXAMPLE_PERIOD_TIPS,
  cashDifferences: EXAMPLE_PERIOD_CASH_DIFFERENCES,
  importStatus: EXAMPLE_PERIOD_IMPORT_STATUS,
};

// Cierre histórico con dos líneas que se compensan: la suma neta es 0, pero
// el cierre queda NO_CUADRADO.
export const EXAMPLE_LEGACY_LINE_DIFFERENCES: LegacyClosingLineDifference[] = [
  {
    paymentMethod: 'DEBIT_CARD',
    paymentMethodName: 'Tarjeta de débito',
    expectedAmount: 80000,
    countedAmount: 80500,
    difference: 500,
  },
  {
    paymentMethod: 'CASH',
    paymentMethodName: 'Efectivo',
    expectedAmount: 20000,
    countedAmount: 19500,
    difference: -500,
  },
];

export const EXAMPLE_LEGACY_CLOSING: Json<LegacyClosing> = {
  closingId: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  store: EXAMPLE_STORE_REF,
  businessDate: '2026-10-30',
  shift: 1,
  status: 'CLOSED',
  mrcomandaNetSales: 511730,
  mercadoPagoGrossAmount: 543332,
  mercadoPagoTipAmount: 31602,
  voucherDifference: 0,
  cashDifference: 0,
  balanceStatus: 'NO_CUADRADO',
  lineDifferences: EXAMPLE_LEGACY_LINE_DIFFERENCES,
  differenceReason: 'Billete falso detectado',
  closedAt: '2026-10-31T02:10:00.000Z',
};

export const EXAMPLE_LEGACY_SALES: LegacySales = {
  store: EXAMPLE_STORE_REF,
  paymentMethod: 'CASH',
  paymentMethodName: 'Efectivo',
  source: 'MANUAL',
  salesCount: 42,
  netAmount: 164000,
};
