// Tipos del cálculo y vista previa del reparto de propinas (SPRINT-3-T12 y
// SPRINT-4R-T04).

export const TIP_POOL_STATUSES = ['DRAFT', 'CONFIRMED', 'PAID'] as const;
export type TipPoolStatusCode = (typeof TIP_POOL_STATUSES)[number];

// Regla aplicada por el reparto. Todo cálculo nuevo es EQUAL_SHARES: el fondo
// de cada operación diaria se divide entre sus participantes (SPRINT-4R-T04).
// PROPORTIONAL_TO_HOURS solo identifica los repartos históricos guardados,
// que se conservan, confirman, pagan y consultan tal cual.
export const TIP_POOL_RULES = [
  'PROPORTIONAL_TO_HOURS',
  'EQUAL_SHARES',
] as const;
export type TipPoolRule = (typeof TIP_POOL_RULES)[number];

// Copia de la regla que guarda el reparto equitativo en agreement_snapshot.
// No hay pacto (agreement_id NULL): la regla es la del flujo operativo y los
// triggers de la base la leen desde el snapshot para exigir horas NULL.
export const EQUAL_SHARES_RULE_NAME =
  'Reparto equitativo diario entre los participantes de cada operación';

// Causas que impiden generar la vista previa. Los códigos son estables (los
// usa el frontend) y el mensaje va en español para el contador.
export const TIP_POOL_ISSUE_CODE = {
  DAILY_OPERATIONS_MISSING: 'DAILY_OPERATIONS_MISSING',
  DAILY_OPERATION_ALREADY_USED: 'DAILY_OPERATION_ALREADY_USED',
  DAILY_PARTICIPANTS_MISSING: 'DAILY_PARTICIPANTS_MISSING',
} as const;

export type TipPoolIssueCode =
  (typeof TIP_POOL_ISSUE_CODE)[keyof typeof TIP_POOL_ISSUE_CODE];

export interface TipPoolIssue {
  code: TipPoolIssueCode;
  message: string;
  details?: Record<string, unknown>;
}

// Cuerpo de la respuesta 422 con todas las causas encontradas.
export interface TipPoolValidationErrorBody {
  statusCode: 422;
  message: string;
  issues: TipPoolIssue[];
}

// Copia del pacto aplicado que se guarda en tip_pools.agreement_snapshot.
// Mismas claves que el seed demo de SPRINT-3-T09 (TIP_DEMO_POOL). Solo los
// repartos proporcionales históricos tienen pacto; los equitativos guardan
// únicamente la regla (ver EQUAL_SHARES_RULE_NAME).
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
  // Bloqueo optimista: las acciones lo reciben como expectedVersion.
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
  // Solo cambia al calcular o recalcular el borrador.
  calculatedAt: Date;
  // Cambia con cualquier acción: observar, recalcular, confirmar o pagar.
  updatedAt: Date;
  // Observación vigente del contador; el recálculo la limpia (SPRINT-3-T13).
  notes: string | null;
  confirmedBy: TipPoolPersonResponse | null;
  confirmedAt: Date | null;
  paidBy: TipPoolPersonResponse | null;
  paidAt: Date | null;
  // Fecha en que se enteró el pago (YYYY-MM-DD).
  paymentDate: string | null;
  receiptsCount: number;
}

export interface TipPoolPreviewResult {
  pool: TipPoolResponse;
  created: boolean;
  // Observación que el recálculo descartó (null si no había o si es el
  // primer cálculo); el controller la deja en la auditoría.
  previousNotes: string | null;
}

// Confirmación, observaciones y pago del reparto (SPRINT-3-T13).

// Cuerpo de las respuestas 409 de las acciones: el estado y la versión
// actuales permiten a la vista del contador recargar sin otra consulta.
export interface TipPoolConflictBody {
  statusCode: 409;
  message: string;
  currentStatus: TipPoolStatusCode;
  currentVersion: number;
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
