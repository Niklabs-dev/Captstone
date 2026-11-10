// Tipos del reparto de propinas por período (SPRINT-3-T12 y SPRINT-4R-T04).
// Desde SPRINT-4A-T08 los repartos son un histórico de solo lectura: las
// propinas se reparten al guardar la operación diaria (daily_tip_allocations)
// y se pagan por lote (tip_payment_batches).

export const TIP_POOL_STATUSES = ['DRAFT', 'CONFIRMED', 'PAID'] as const;
export type TipPoolStatusCode = (typeof TIP_POOL_STATUSES)[number];

// Regla aplicada por el reparto guardado: EQUAL_SHARES en los calculados
// desde las operaciones diarias (SPRINT-4R-T04) y PROPORTIONAL_TO_HOURS en
// los anteriores, calculados con pacto y horas.
export const TIP_POOL_RULES = [
  'PROPORTIONAL_TO_HOURS',
  'EQUAL_SHARES',
] as const;
export type TipPoolRule = (typeof TIP_POOL_RULES)[number];

// Copia del pacto aplicado que se guarda en tip_pools.agreement_snapshot.
// Mismas claves que el seed demo de SPRINT-3-T09 (TIP_DEMO_POOL). Solo los
// repartos proporcionales tienen pacto; los equitativos guardan únicamente
// la regla.
export interface TipAgreementSnapshot {
  id: string;
  name: string;
  rule: string;
  validFrom: string;
  validTo: string | null;
  capturedAt?: string;
}

export interface TipPoolLineResponse {
  userId: string;
  workerName: string;
  // Horas del cálculo proporcional histórico; null en el reparto equitativo.
  hoursWorked: string | null;
  amount: number;
}

export interface TipPoolSourceResponse {
  tipEntryId: string;
  businessDate: string;
  paymentMethod: string;
  paymentMethodName: string;
  amount: number;
}

// Operación diaria usada como fuente de un reparto equitativo. amount es el
// fondo aplicado (copia); la base exige que coincida con tip_fund_amount.
export interface TipPoolDailySourceResponse {
  operationId: string;
  businessDate: string;
  cardTipAmount: number;
  cashTipAmount: number;
  amount: number;
}

export interface TipPoolPersonResponse {
  id: string;
  name: string;
}

export interface TipPoolResponse {
  id: string;
  status: TipPoolStatusCode;
  // Versión que dejó el ciclo de vida del reparto antes de SPRINT-4A-T08.
  version: number;
  store: { id: string; name: string };
  periodStart: string;
  periodEnd: string;
  rule: TipPoolRule;
  // Solo los repartos proporcionales históricos tienen pacto; null en los
  // equitativos y en los históricos sin snapshot.
  agreement: TipAgreementSnapshot | null;
  totalAmount: number;
  // Suma de horas del reparto proporcional; null en el equitativo.
  totalHours: string | null;
  lines: TipPoolLineResponse[];
  // Registros diarios históricos (tip_entries) del reparto proporcional.
  sources: TipPoolSourceResponse[];
  // Operaciones diarias del reparto equitativo.
  dailySources: TipPoolDailySourceResponse[];
  // Σ líneas = total y Σ fuentes (de ambos tipos) = total.
  reconciled: boolean;
  calculatedBy: TipPoolPersonResponse;
  // Instante del último cálculo del borrador.
  calculatedAt: Date;
  // Instante del último cambio (cálculo, observación, confirmación o pago).
  updatedAt: Date;
  // Última observación del contador sobre el borrador (SPRINT-3-T13).
  notes: string | null;
  confirmedBy: TipPoolPersonResponse | null;
  confirmedAt: Date | null;
  paidBy: TipPoolPersonResponse | null;
  paidAt: Date | null;
  // Fecha en que se enteró el pago (YYYY-MM-DD).
  paymentDate: string | null;
  receiptsCount: number;
}

// Cuerpo del 410 de las acciones retiradas en SPRINT-4A-T08 (cálculo,
// observación, confirmación y pago del reparto por período).
export const TIP_POOL_RETIRED_MESSAGE =
  'El reparto por período se retiró: las propinas se reparten al guardar la operación diaria y se pagan por período en POST /daily-tips/payment-batches. Los repartos existentes se consultan como histórico.';

export interface TipPoolRetiredActionBody {
  statusCode: 410;
  message: string;
  error: 'Gone';
}

// Foto del reparto al momento del pago, guardada en tip_pool_receipts.detail
// para que cada constancia se explique sola. rule falta en las constancias
// anteriores a SPRINT-4R-T04, que son todas proporcionales.
export interface TipPoolReceiptDetail {
  rule: TipPoolRule;
  agreementSnapshot: TipAgreementSnapshot | null;
  totalAmount: number;
  totalHours: string | null;
  lines: TipPoolLineResponse[];
}

export interface TipPoolReceiptResponse {
  id: string;
  poolId: string;
  userId: string;
  workerName: string;
  store: { id: string; name: string };
  periodStart: string;
  periodEnd: string;
  hoursWorked: string | null;
  amount: number;
  paymentDate: string;
  paidBy: TipPoolPersonResponse;
  detail: TipPoolReceiptDetail;
  createdAt: Date;
}
