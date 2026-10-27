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

export interface TipPoolResponse {
  id: string;
  status: TipPoolStatusCode;
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
  calculatedBy: { id: string; name: string };
  calculatedAt: Date;
}

export interface TipPoolPreviewResult {
  pool: TipPoolResponse;
  created: boolean;
}
