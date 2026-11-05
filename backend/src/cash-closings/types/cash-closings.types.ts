import type {
  CashClosingStatus,
  CashClosingVoucherSource,
} from '../../generated/prisma/client.js';

export const MAX_CASH_AMOUNT = 9_999_999_999;

/// Estado de cuadre de un cierre: cualquier línea o la conciliación con
/// diferencia distinta de cero lo dejan NO_CUADRADO, aunque el total compense.
export const BALANCE_STATUS = {
  CUADRADO: 'CUADRADO',
  NO_CUADRADO: 'NO_CUADRADO',
} as const;

export type BalanceStatus =
  (typeof BALANCE_STATUS)[keyof typeof BALANCE_STATUS];

export interface CashClosingPersonResponse {
  id: string;
  name: string;
}

export interface CashClosingLineResponse {
  id: string;
  paymentMethod: string;
  paymentMethodName: string;
  expectedAmount: number;
  countedAmount: number;
  difference: number;
}

export interface CashClosingVoucherResponse {
  id: string;
  source: CashClosingVoucherSource;
  paymentMethod: string | null;
  paymentMethodName: string | null;
  periodStart: Date;
  periodEnd: Date;
  amount: number;
  tipIncludedAmount: number;
  reference: string | null;
}

export interface CashClosingTipEntryResponse {
  id: string;
  paymentMethod: string;
  paymentMethodName: string;
  amount: number;
}

export interface CashClosingCreateResult {
  closing: CashClosingResponse;
  created: boolean;
}

export interface CashClosingResponse {
  id: string;
  store: { id: string; name: string };
  businessDate: string;
  shift: number;
  openingCash: number;
  status: CashClosingStatus;
  notes: string | null;
  differenceReason: string | null;
  responsible: CashClosingPersonResponse;
  closedBy: CashClosingPersonResponse | null;
  closedAt: Date | null;
  lines: CashClosingLineResponse[];
  totalExpectedAmount: number;
  totalCountedAmount: number;
  totalDifference: number;
  vouchers: CashClosingVoucherResponse[];
  mrcomandaNetSales: number;
  mercadoPagoGrossAmount: number;
  mercadoPagoTipAmount: number;
  mercadoPagoNetSales: number;
  reconciliationDifference: number;
  tipEntries: CashClosingTipEntryResponse[];
  tipFundAmount: number;
  salesCount: number;
  hasDifferences: boolean;
  isBalanced: boolean;
  balanceStatus: BalanceStatus;
  createdAt: Date;
  updatedAt: Date;
}
