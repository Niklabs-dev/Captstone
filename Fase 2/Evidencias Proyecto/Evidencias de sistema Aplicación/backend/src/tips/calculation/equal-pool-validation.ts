import {
  TIP_POOL_ISSUE_CODE,
  type TipPoolIssue,
} from '../types/tip-pools.types.js';

// Validación de las fuentes de un reparto equitativo antes de calcularlo
// (SPRINT-4R-T04). Función pura: recibe las operaciones diarias que el
// servicio leyó de la base y junta TODAS las causas que impiden el cálculo,
// no solo la primera. Las fechas viajan como YYYY-MM-DD.

export interface DailyOperationCandidate {
  id: string;
  businessDate: string;
  // Fondo del día (propina de tarjeta + efectivo) en CLP enteros.
  tipFundAmount: number;
  participantIds: readonly string[];
  // Reparto que ya usa la operación como fuente, si lo hay.
  usedByPoolId: string | null;
}

export interface EqualPoolValidationInput {
  periodStart: string;
  periodEnd: string;
  // Borrador del mismo local y período que se va a reemplazar, si existe:
  // sus fuentes no cuentan como "ya usadas".
  currentPoolId: string | null;
  // Operaciones diarias del local dentro del período.
  operations: readonly DailyOperationCandidate[];
}

export function validateEqualPoolSources(
  input: EqualPoolValidationInput,
): TipPoolIssue[] {
  const issues: TipPoolIssue[] = [];
  if (input.operations.length === 0) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.DAILY_OPERATIONS_MISSING,
      message: `No hay operaciones diarias registradas en el local entre el ${input.periodStart} y el ${input.periodEnd}.`,
    });
    return issues;
  }

  const used = input.operations.filter(
    (operation) =>
      operation.usedByPoolId !== null &&
      operation.usedByPoolId !== input.currentPoolId,
  );
  if (used.length > 0) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.DAILY_OPERATION_ALREADY_USED,
      message: `${used.length} operación(es) diaria(s) del período ya forman parte de otro reparto.`,
      details: {
        operations: used.map((operation) => ({
          operationId: operation.id,
          businessDate: operation.businessDate,
          poolId: operation.usedByPoolId,
        })),
      },
    });
  }

  const withoutParticipants = input.operations.filter(
    (operation) =>
      operation.tipFundAmount > 0 && operation.participantIds.length === 0,
  );
  if (withoutParticipants.length > 0) {
    issues.push({
      code: TIP_POOL_ISSUE_CODE.DAILY_PARTICIPANTS_MISSING,
      message: `${withoutParticipants.length} día(s) del período tienen propinas por repartir y ningún trabajador participante; corrige la operación diaria antes de calcular.`,
      details: {
        operations: withoutParticipants.map((operation) => ({
          operationId: operation.id,
          businessDate: operation.businessDate,
          tipFundAmount: operation.tipFundAmount,
        })),
      },
    });
  }
  return issues;
}
