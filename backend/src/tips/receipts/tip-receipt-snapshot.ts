import type {
  TipAgreementSnapshot,
  TipPoolLineResponse,
  TipPoolPersonResponse,
  TipPoolReceiptDetail,
  TipPoolResponse,
} from '../types/tip-pools.types.js';

// Armado y lectura de la foto que guarda cada constancia de pago
// (SPRINT-3-T13). Funciones puras, sin NestJS ni base de datos.

export interface TipPoolReceiptDraft {
  userId: string;
  workerName: string;
  storeId: string;
  storeName: string;
  periodStart: string;
  periodEnd: string;
  hoursWorked: string;
  amount: number;
  paymentDate: string;
  paidById: string;
  paidByName: string;
  detail: TipPoolReceiptDetail;
}

// Una constancia por línea del reparto, también las de monto 0. Todas llevan
// el mismo detalle: el pacto, el total y todas las líneas al momento del pago.
export function buildTipPoolReceipts(
  pool: TipPoolResponse,
  paymentDate: string,
  paidBy: TipPoolPersonResponse,
): TipPoolReceiptDraft[] {
  const detail: TipPoolReceiptDetail = {
    agreementSnapshot: pool.agreement,
    totalAmount: pool.totalAmount,
    totalHours: pool.totalHours,
    lines: pool.lines.map((line) => ({ ...line })),
  };
  return pool.lines.map((line) => ({
    userId: line.userId,
    workerName: line.workerName,
    storeId: pool.store.id,
    storeName: pool.store.name,
    periodStart: pool.periodStart,
    periodEnd: pool.periodEnd,
    hoursWorked: line.hoursWorked,
    amount: line.amount,
    paymentDate,
    paidById: paidBy.id,
    paidByName: paidBy.name,
    detail,
  }));
}

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
    typeof line.hoursWorked !== 'string' ||
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

// Lee el detalle JSON guardado sin confiar en su forma. Lo escribe solo
// buildTipPoolReceipts, así que una forma inválida es un dato corrupto.
export function parseReceiptDetail(value: unknown): TipPoolReceiptDetail {
  const detail = asRecord(value);
  const lines = Array.isArray(detail?.lines) ? detail.lines.map(parseLine) : [];
  if (
    !detail ||
    typeof detail.totalAmount !== 'number' ||
    typeof detail.totalHours !== 'string' ||
    lines.some((line) => line === null)
  ) {
    throw new Error('El detalle guardado de la constancia no es válido');
  }
  return {
    agreementSnapshot: parseAgreement(detail.agreementSnapshot),
    totalAmount: detail.totalAmount,
    totalHours: detail.totalHours,
    lines: lines.filter((line): line is TipPoolLineResponse => line !== null),
  };
}
