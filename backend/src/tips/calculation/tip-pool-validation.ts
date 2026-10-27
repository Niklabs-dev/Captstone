import {
  SUPPORTED_AGREEMENT_RULE,
  TIP_POOL_ISSUE_CODE,
  type TipPoolIssue,
} from '../types/tip-pools.types.js';
import type { PaymentMethodCode } from '../types/tips.types.js';
import { toHundredths } from './tip-distribution.calculator.js';

// Validación de las fuentes de un reparto antes de calcularlo (SPRINT-3-T12).
// Función pura: recibe lo que el servicio leyó de la base y junta TODAS las
// causas que impiden el cálculo, no solo la primera. Las fechas viajan como
// YYYY-MM-DD, que se comparan correctamente como texto.

export interface AgreementCandidate {
  id: string;
  name: string;
  rule: string;
  validFrom: string;
  validTo: string | null;
}

export interface EntryCandidate {
  id: string;
  businessDate: string;
  paymentMethod: PaymentMethodCode;
  // Reparto que ya usa el registro como fuente, si lo hay.
  usedByPoolId: string | null;
}

export interface HoursCandidate {
  id: string;
  workerId: string;
  workerName: string;
  periodStart: string;
  periodEnd: string;
  hoursWorked: string;
  workerStoreId: string | null;
  workerActive: boolean;
}

export interface TipPoolValidationInput {
  storeId: string;
  periodStart: string;
  periodEnd: string;
  // Borrador del mismo local y período que se va a reemplazar, si existe:
  // sus fuentes no cuentan como "ya usadas".
  currentPoolId: string | null;
  fundAmount: number;
  // Pactos del local que se solapan con el período.
  agreements: readonly AgreementCandidate[];
  // Registros diarios del local dentro del período.
  entries: readonly EntryCandidate[];
  // Registros de horas del local que se solapan con el período.
  hours: readonly HoursCandidate[];
}

export interface TipPoolValidationResult {
  issues: TipPoolIssue[];
  // Pacto que cubre el período completo, si existe.
  agreement: AgreementCandidate | null;
  // Registros de horas del período exacto.
  hours: HoursCandidate[];
}

function overlaps(
  start: string,
  end: string | null,
  periodStart: string,
  periodEnd: string,
): boolean {
  return start <= periodEnd && (end === null || end >= periodStart);
}

function agreementSummary(
  agreement: AgreementCandidate,
): Omit<AgreementCandidate, 'rule'> {
  return {
    id: agreement.id,
    name: agreement.name,
    validFrom: agreement.validFrom,
    validTo: agreement.validTo,
  };
}

function validateAgreement(
  input: TipPoolValidationInput,
  issues: TipPoolIssue[],
): AgreementCandidate | null {
  const { periodStart, periodEnd } = input;
  const overlapping = input.agreements.filter((agreement) =>
    overlaps(agreement.validFrom, agreement.validTo, periodStart, periodEnd),
  );
  const covering =
    overlapping.find(
      (agreement) =>
        agreement.validFrom <= periodStart &&
        (agreement.validTo === null || agreement.validTo >= periodEnd),
    ) ?? null;

  if (!covering && overlapping.length === 0) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.AGREEMENT_MISSING,
      message: `No hay un pacto de reparto vigente para el local entre el ${periodStart} y el ${periodEnd}.`,
    });
  } else if (!covering) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.AGREEMENT_CHANGES_IN_PERIOD,
      message: `El pacto de reparto cambia dentro del período: ningún pacto cubre completo del ${periodStart} al ${periodEnd}.`,
      details: { agreements: overlapping.map(agreementSummary) },
    });
  } else if (covering.rule !== SUPPORTED_AGREEMENT_RULE) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.AGREEMENT_RULE_UNSUPPORTED,
      message: `La regla del pacto "${covering.name}" (${covering.rule}) no está soportada; solo se calcula ${SUPPORTED_AGREEMENT_RULE}.`,
      details: { agreement: agreementSummary(covering), rule: covering.rule },
    });
  }
  return covering;
}

function validateEntries(
  input: TipPoolValidationInput,
  issues: TipPoolIssue[],
): void {
  if (input.entries.length === 0) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.TIP_ENTRIES_MISSING,
      message: `No hay propinas diarias registradas en el local entre el ${input.periodStart} y el ${input.periodEnd}.`,
    });
    return;
  }
  const used = input.entries.filter(
    (entry) =>
      entry.usedByPoolId !== null && entry.usedByPoolId !== input.currentPoolId,
  );
  if (used.length > 0) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.TIP_ENTRY_ALREADY_USED,
      message: `${used.length} registro(s) diario(s) del período ya forman parte de otro reparto.`,
      details: {
        tipEntries: used.map((entry) => ({
          tipEntryId: entry.id,
          businessDate: entry.businessDate,
          paymentMethod: entry.paymentMethod,
          poolId: entry.usedByPoolId,
        })),
      },
    });
  }
}

function validateHours(
  input: TipPoolValidationInput,
  issues: TipPoolIssue[],
): HoursCandidate[] {
  const { periodStart, periodEnd } = input;
  const overlapping = input.hours.filter((record) =>
    overlaps(record.periodStart, record.periodEnd, periodStart, periodEnd),
  );
  const exact = overlapping.filter(
    (record) =>
      record.periodStart === periodStart && record.periodEnd === periodEnd,
  );
  const mismatched = overlapping.filter((record) => !exact.includes(record));

  if (exact.length === 0) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.WORK_HOURS_MISSING,
      message: `No hay horas trabajadas registradas para el período exacto del ${periodStart} al ${periodEnd}.`,
    });
  }
  if (mismatched.length > 0) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.WORK_HOURS_PERIOD_MISMATCH,
      message: `${mismatched.length} registro(s) de horas se solapan con el período pero no coinciden exactamente con él.`,
      details: {
        records: mismatched.map((record) => ({
          workHoursRecordId: record.id,
          userId: record.workerId,
          workerName: record.workerName,
          periodStart: record.periodStart,
          periodEnd: record.periodEnd,
        })),
      },
    });
  }

  const totalHours = exact.reduce(
    (sum, record) => sum + toHundredths(record.hoursWorked),
    0n,
  );
  if (exact.length > 0 && totalHours === 0n && input.fundAmount > 0) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.WORK_HOURS_TOTAL_ZERO,
      message: `La suma de horas trabajadas es 0 y hay un fondo de ${input.fundAmount} CLP por repartir.`,
    });
  }

  const outsiders = exact.filter(
    (record) => record.workerStoreId !== input.storeId || !record.workerActive,
  );
  if (outsiders.length > 0) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.WORKER_NOT_IN_STORE,
      message: `${outsiders.length} trabajador(es) con horas no pertenecen al local o están inactivos.`,
      details: {
        workers: outsiders.map((record) => ({
          userId: record.workerId,
          workerName: record.workerName,
          reason: record.workerActive ? 'OTHER_STORE' : 'INACTIVE',
        })),
      },
    });
  }
  return exact;
}

export function validateTipPoolSources(
  input: TipPoolValidationInput,
): TipPoolValidationResult {
  const issues: TipPoolIssue[] = [];
  const agreement = validateAgreement(input, issues);
  validateEntries(input, issues);
  const hours = validateHours(input, issues);
  return { issues, agreement, hours };
}
