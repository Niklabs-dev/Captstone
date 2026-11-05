import type {
  CashClosingStatus,
  CashClosingVoucherSource,
  PaymentMethod,
} from '../../generated/prisma/client.js';

export const MAX_CASH_AMOUNT = 9_999_999_999;

export interface CashClosingPersonResponse {
  id: string;
  name: string;
}

export interface CashClosingLineResponse {
  id: string;
  paymentMethod: PaymentMethod;
  expectedAmount: number;
  countedAmount: number;
  difference: number;
}

export interface CashClosingVoucherResponse {
  id: string;
  source: CashClosingVoucherSource;
  periodStart: Date;
  periodEnd: Date;
  amount: number;
  tipIncludedAmount: number;
  reference: string | null;
}

export interface CashClosingTipEntryResponse {
  id: string;
  paymentMethod: PaymentMethod;
  amount: number;
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
  createdAt: Date;
  updatedAt: Date;
}
