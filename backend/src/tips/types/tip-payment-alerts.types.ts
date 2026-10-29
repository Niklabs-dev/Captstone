import type { TipPoolStatusCode } from './tip-pools.types.js';
import type { PaymentMethodCode } from './tips.types.js';

export const TIP_PAYMENT_ALERT_STATUSES = ['UPCOMING', 'OVERDUE'] as const;
export type TipPaymentAlertStatus = (typeof TIP_PAYMENT_ALERT_STATUSES)[number];

export interface TipPaymentAlertPool {
  id: string;
  status: TipPoolStatusCode;
  periodStart: string;
  periodEnd: string;
}

export interface TipPaymentAlert {
  id: string;
  tipEntryId: string;
  store: { id: string; name: string };
  businessDate: string;
  paymentMethod: PaymentMethodCode;
  amount: number;
  pool: TipPaymentAlertPool | null;
  deadline: string;
  daysRemaining: number;
  status: TipPaymentAlertStatus;
}

export interface TipPaymentAlertCollection {
  items: TipPaymentAlert[];
  calculatedAt: Date;
}
