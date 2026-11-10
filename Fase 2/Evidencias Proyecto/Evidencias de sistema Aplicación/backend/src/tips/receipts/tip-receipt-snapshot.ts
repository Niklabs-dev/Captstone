import {
  TIP_POOL_RULES,
  type TipAgreementSnapshot,
  type TipPoolLineResponse,
  type TipPoolReceiptDetail,
  type TipPoolRule,
} from '../types/tip-pools.types.js';

// Lectura de la foto que guarda cada constancia de pago (SPRINT-3-T13).
// Función pura, sin NestJS ni base de datos. Las constancias se emitían al
// pagar un reparto por período, acción retirada en SPRINT-4A-T08: las
// existentes se conservan y se siguen leyendo y descargando. Desde
// SPRINT-4R-T04 la foto incluye la regla aplicada y las horas son null en los
// repartos equitativos.

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseLine(value: unknown): TipPoolLineResponse | null {
  const line = asRecord(value);
  if (
    !line ||
    typeof line.userId !== 'string' ||
    typeof line.workerName !== 'string' ||
    (typeof line.hoursWorked !== 'string' && line.hoursWorked !== null) ||
    typeof line.amount !== 'number'
  ) {
    return null;
  }
  return {
    userId: line.userId,
    workerName: line.workerName,
    hoursWorked: line.hoursWorked,
    amount: line.amount,
  };
}

function parseAgreement(value: unknown): TipAgreementSnapshot | null {
  const agreement = asRecord(value);
  if (
    !agreement ||
    typeof agreement.id !== 'string' ||
    typeof agreement.name !== 'string' ||
    typeof agreement.rule !== 'string' ||
    typeof agreement.validFrom !== 'string'
  ) {
    return null;
  }
  return {
    id: agreement.id,
    name: agreement.name,
    rule: agreement.rule,
    validFrom: agreement.validFrom,
    validTo: typeof agreement.validTo === 'string' ? agreement.validTo : null,
    ...(typeof agreement.capturedAt === 'string'
      ? { capturedAt: agreement.capturedAt }
      : {}),
  };
}

function isRule(value: unknown): value is TipPoolRule {
  return TIP_POOL_RULES.some((rule) => rule === value);
}

// Lee el detalle JSON guardado sin confiar en su forma. Lo escribía solo el
// pago del reparto, así que una forma inválida es un dato corrupto. Las
// constancias anteriores a SPRINT-4R-T04 no guardan la regla: todas son del
// reparto proporcional histórico.
export function parseReceiptDetail(value: unknown): TipPoolReceiptDetail {
  const detail = asRecord(value);
  const lines = Array.isArray(detail?.lines) ? detail.lines.map(parseLine) : [];
  if (
    !detail ||
    typeof detail.totalAmount !== 'number' ||
    (typeof detail.totalHours !== 'string' && detail.totalHours !== null) ||
    (detail.rule !== undefined && !isRule(detail.rule)) ||
    lines.some((line) => line === null)
  ) {
    throw new Error('El detalle guardado de la constancia no es válido');
  }
  return {
    rule: isRule(detail.rule) ? detail.rule : 'PROPORTIONAL_TO_HOURS',
    agreementSnapshot: parseAgreement(detail.agreementSnapshot),
    totalAmount: detail.totalAmount,
    totalHours: detail.totalHours,
    lines: lines.filter((line): line is TipPoolLineResponse => line !== null),
  };
}
