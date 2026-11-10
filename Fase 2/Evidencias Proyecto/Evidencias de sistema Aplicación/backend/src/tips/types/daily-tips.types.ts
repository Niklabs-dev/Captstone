// Tipos de la propina diaria por trabajador (SPRINT-4A-T02 a T04). La unidad
// es la asignación diaria de un trabajador en una operación diaria; el pago
// se registra como lote por local y período (SPRINT-4A-T06).

/// Estado de pago de la propina diaria (enum TipAllocationStatus de la base).
export const TIP_ALLOCATION_STATUSES = ['UNPAID', 'PAID'] as const;
export type TipAllocationStatusCode = (typeof TIP_ALLOCATION_STATUSES)[number];

/// Rango máximo (días corridos, ambos extremos incluidos) de las consultas
/// de propinas por período (SPRINT-4A-T04): dos meses de 31 días.
export const MAX_DAILY_TIPS_RANGE_DAYS = 62;

/// Estado de pago de un día o de un conjunto de propinas: PAID si todas
/// están pagadas, PARTIAL si solo algunas y UNPAID si ninguna (también un día
/// sin propinas, con total 0).
export const DAILY_TIP_SETTLEMENT_STATUSES = [
  'UNPAID',
  'PARTIAL',
  'PAID',
] as const;
export type DailyTipSettlementStatus =
  (typeof DAILY_TIP_SETTLEMENT_STATUSES)[number];

export interface DailyTipPerson {
  id: string;
  name: string;
}

export interface DailyTipStore {
  id: string;
  name: string;
}

/// Montos de un conjunto de propinas en CLP entero.
export interface DailyTipAmounts {
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
}

/// Total de un día del local (GET /daily-tips/days).
export interface DailyTipDaySummary extends DailyTipAmounts {
  operationId: string;
  businessDate: string;
  tipFundAmount: number;
  participantCount: number;
  status: DailyTipSettlementStatus;
}

export interface DailyTipDaysResponse {
  store: DailyTipStore;
  from: string;
  to: string;
  days: DailyTipDaySummary[];
  totals: DailyTipAmounts & { dayCount: number };
}

/// Propina de un trabajador en un día (GET /daily-tips/day).
export interface DailyTipAllocationDetail {
  id: string;
  worker: DailyTipPerson;
  amount: number;
  status: TipAllocationStatusCode;
  paymentBatchId: string | null;
  paidAt: Date | null;
}

export interface DailyTipDayDetailResponse extends DailyTipDaySummary {
  store: DailyTipStore;
  allocations: DailyTipAllocationDetail[];
}

/// Totales de un trabajador en el período (GET /daily-tips/summary).
export interface DailyTipWorkerSummary extends DailyTipAmounts {
  worker: DailyTipPerson;
  dayCount: number;
}

export interface DailyTipSummaryResponse {
  store: DailyTipStore;
  from: string;
  to: string;
  status: TipAllocationStatusCode | null;
  workers: DailyTipWorkerSummary[];
  totals: DailyTipAmounts & { workerCount: number; dayCount: number };
}

/// Propina diaria normalizada (montos como number) que reutilizan la
/// consulta, la exportación Excel (SPRINT-4A-T05), el pago por período
/// (SPRINT-4A-T06) y el portal del trabajador (SPRINT-4A-T09).
export interface DailyTipAllocationFact {
  id: string;
  operationId: string;
  businessDate: string;
  worker: DailyTipPerson;
  amount: number;
  status: TipAllocationStatusCode;
  paymentBatchId: string | null;
}

/// Archivo Excel de propinas del período (GET /daily-tips/export,
/// SPRINT-4A-T05). workerCount y allocationCount van a la auditoría; los
/// montos y los datos personales solo viajan en el archivo.
export interface DailyTipsExportFile {
  store: DailyTipStore;
  from: string;
  to: string;
  fileName: string;
  content: Buffer;
  workerCount: number;
  allocationCount: number;
}
