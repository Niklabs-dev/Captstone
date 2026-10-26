export const PAYMENT_METHODS = [
  'CASH',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'TRANSFER',
] as const;

export type PaymentMethodCode = (typeof PAYMENT_METHODS)[number];

export const MAX_TIP_AMOUNT = 9_999_999_999;

export interface TipEntryResponse {
  id: string;
  businessDate: string;
  paymentMethod: PaymentMethodCode;
  amount: number;
  store: {
    id: string;
    name: string;
  };
  responsible: {
    id: string;
    name: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface TipEntryCreateResult {
  entry: TipEntryResponse;
  created: boolean;
}
