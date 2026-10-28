import type { PaymentMethodCode } from './tips.types.js';

// Tipos del cálculo y vista previa del reparto de propinas (SPRINT-3-T12).

export const TIP_POOL_STATUSES = ['DRAFT', 'CONFIRMED', 'PAID'] as const;
export type TipPoolStatusCode = (typeof TIP_POOL_STATUSES)[number];

export const SUPPORTED_AGREEMENT_RULE = 'PROPORTIONAL_TO_HOURS';

// Causas que impiden generar la vista previa. Los códigos son estables (los
// usa el frontend) y el mensaje va en español para el contador.
export const TIP_POOL_ISSUE_CODE = {
  AGREEMENT_MISSING: 'AGREEMENT_MISSING',
  AGREEMENT_CHANGES_IN_PERIOD: 'AGREEMENT_CHANGES_IN_PERIOD',
  AGREEMENT_RULE_UNSUPPORTED: 'AGREEMENT_RULE_UNSUPPORTED',
  TIP_ENTRIES_MISSING: 'TIP_ENTRIES_MISSING',
  TIP_ENTRY_ALREADY_USED: 'TIP_ENTRY_ALREADY_USED',
  WORK_HOURS_MISSING: 'WORK_HOURS_MISSING',
  WORK_HOURS_PERIOD_MISMATCH: 'WORK_HOURS_PERIOD_MISMATCH',
  WORK_HOURS_TOTAL_ZERO: 'WORK_HOURS_TOTAL_ZERO',
  WORKER_NOT_IN_STORE: 'WORKER_NOT_IN_STORE',
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
// Mismas claves que el seed demo de SPRINT-3-T09 (TIP_DEMO_POOL).
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
  hoursWorked: string;
  amount: number;
}

export interface TipPoolSourceResponse {
  tipEntryId: string;
  businessDate: string;
  paymentMethod: PaymentMethodCode;
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
  // null solo en repartos históricos sin snapshot del pacto.
  agreement: TipAgreementSnapshot | null;
  totalAmount: number;
  totalHours: string;
  lines: TipPoolLineResponse[];
  sources: TipPoolSourceResponse[];
  // Σ líneas = total y Σ fuentes = total.
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
// para que cada constancia se explique sola.
export interface TipPoolReceiptDetail {
  agreementSnapshot: TipAgreementSnapshot | null;
  totalAmount: number;
  totalHours: string;
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
  hoursWorked: string;
  amount: number;
  paymentDate: string;
  paidBy: TipPoolPersonResponse;
  detail: TipPoolReceiptDetail;
  createdAt: Date;
}
