import type {
  DailyTipAmounts,
  DailyTipStore,
  TipAllocationStatusCode,
} from './daily-tips.types.js';

// Consulta personal de propinas diarias del portal del trabajador
// (SPRINT-4A-T09): la propina de cada día de la persona autenticada con su
// estado de pago. La identidad sale del JWT; nunca de un parámetro.

/// Propina de un día de la persona: el local donde trabajó, el monto y, si
/// ya está pagada, el lote y la fecha de pago.
export interface MyTipDay {
  id: string;
  businessDate: string;
  store: DailyTipStore;
  amount: number;
  status: TipAllocationStatusCode;
  paymentBatchId: string | null;
  paidAt: Date | null;
}

export interface MyTipsResponse {
  from: string;
  to: string;
  days: MyTipDay[];
  totals: DailyTipAmounts & { dayCount: number };
}
