import { isRecord } from './auth';
import { isUuid } from './users';
import { isTipDate } from './tips';
export const POOL_STATUS = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  PAID: 'Enterado',
} as const;
export type PoolStatus = keyof typeof POOL_STATUS;
export type PoolAction = 'observations' | 'confirm' | 'pay';
export interface PoolPeriod {
  storeId: string;
  periodStart: string;
  periodEnd: string;
}
export interface PoolPerson {
  id: string;
  name: string;
}
export interface PoolLine {
  userId: string;
  workerName: string;
  hoursWorked: string;
  amount: number;
}
export interface TipPool {
  id: string;
  version: number;
  status: PoolStatus;
  store: PoolPerson;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  totalHours: string;
  agreement: {
    id: string;
    name: string;
    rule: string;
    validFrom: string;
    validTo: string | null;
  } | null;
  lines: PoolLine[];
  sources: {
    tipEntryId: string;
    businessDate: string;
    paymentMethod: string;
    amount: number;
  }[];
  reconciled: boolean;
  notes: string | null;
  calculatedBy: PoolPerson;
  calculatedAt: string;
  confirmedBy: PoolPerson | null;
  confirmedAt: string | null;
  paidBy: PoolPerson | null;
  paidAt: string | null;
  paymentDate: string | null;
  receiptsCount: number;
}
export interface PaymentAlert {
  id: string;
  store: PoolPerson;
  businessDate: string;
  amount: number;
  deadline: string;
  daysRemaining: number;
  status: 'UPCOMING' | 'OVERDUE';
  pool: { id: string; periodStart: string; periodEnd: string } | null;
}
export interface PoolReceipt {
  id: string;
  poolId: string;
  userId: string;
  workerName: string;
  amount: number;
  paymentDate: string;
  paidBy: PoolPerson;
}
const person = (v: unknown): v is PoolPerson =>
  isRecord(v) && isUuid(v.id) && typeof v.name === 'string';
const projectPerson = (v: PoolPerson): PoolPerson => ({
  id: v.id,
  name: v.name,
});
const money = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const hours = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d+(\.\d{1,2})?$/.test(v) &&
  Number.isFinite(Number(v));
const instant = (v: unknown): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v));
export function parsePeriod(v: unknown): PoolPeriod | null {
  if (
    !isRecord(v) ||
    Object.keys(v).length !== 3 ||
    !isUuid(v.storeId) ||
    !isTipDate(v.periodStart) ||
    !isTipDate(v.periodEnd) ||
    v.periodEnd < v.periodStart
  )
    return null;
  return {
    storeId: v.storeId,
    periodStart: v.periodStart,
    periodEnd: v.periodEnd,
  };
}
export function parsePool(v: unknown): TipPool | null {
  if (
    !isRecord(v) ||
    !isUuid(v.id) ||
    !Number.isSafeInteger(v.version) ||
    Number(v.version) < 1 ||
    !['DRAFT', 'CONFIRMED', 'PAID'].includes(String(v.status)) ||
    !person(v.store) ||
    !isTipDate(v.periodStart) ||
    !isTipDate(v.periodEnd) ||
    v.periodStart > v.periodEnd ||
    !money(v.totalAmount) ||
    !hours(v.totalHours) ||
    !person(v.calculatedBy) ||
    !instant(v.calculatedAt) ||
    !(v.notes === null || typeof v.notes === 'string') ||
    !Array.isArray(v.lines) ||
    !Array.isArray(v.sources) ||
    typeof v.reconciled !== 'boolean' ||
    !money(v.receiptsCount)
  )
    return null;
  const lines: PoolLine[] = [];
  for (const l of v.lines) {
    if (
      !isRecord(l) ||
      !isUuid(l.userId) ||
      typeof l.workerName !== 'string' ||
      !hours(l.hoursWorked) ||
      !money(l.amount)
    )
      return null;
    lines.push({
      userId: l.userId,
      workerName: l.workerName,
      hoursWorked: l.hoursWorked,
      amount: l.amount,
    });
  }
  const sources: TipPool['sources'] = [];
  for (const s of v.sources) {
    if (
      !isRecord(s) ||
      !isUuid(s.tipEntryId) ||
      !isTipDate(s.businessDate) ||
      !['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER'].includes(
        String(s.paymentMethod),
      ) ||
      !money(s.amount)
    )
      return null;
    sources.push({
      tipEntryId: s.tipEntryId,
      businessDate: s.businessDate,
      paymentMethod: String(s.paymentMethod),
      amount: s.amount,
    });
  }
  if (
    new Set(lines.map((l) => l.userId)).size !== lines.length ||
    new Set(sources.map((s) => s.tipEntryId)).size !== sources.length
  )
    return null;
  const reconciled =
    lines.reduce((a, l) => a + l.amount, 0) === v.totalAmount &&
    sources.reduce((a, s) => a + s.amount, 0) === v.totalAmount;
  if (v.reconciled !== reconciled) return null;
  let agreement: TipPool['agreement'] = null;
  if (v.agreement !== null) {
    const a = v.agreement;
    if (
      !isRecord(a) ||
      !isUuid(a.id) ||
      typeof a.name !== 'string' ||
      typeof a.rule !== 'string' ||
      !isTipDate(a.validFrom) ||
      !(a.validTo === null || isTipDate(a.validTo))
    )
      return null;
    agreement = {
      id: a.id,
      name: a.name,
      rule: a.rule,
      validFrom: a.validFrom,
      validTo: a.validTo,
    };
  }
  if (
    ![v.confirmedBy, v.paidBy].every((p) => p === null || person(p)) ||
    ![v.confirmedAt, v.paidAt].every((d) => d === null || instant(d)) ||
    !(v.paymentDate === null || isTipDate(v.paymentDate))
  )
    return null;
  return {
    id: v.id,
    version: Number(v.version),
    status: v.status as PoolStatus,
    store: projectPerson(v.store),
    periodStart: v.periodStart,
    periodEnd: v.periodEnd,
    totalAmount: v.totalAmount,
    totalHours: v.totalHours,
    agreement,
    lines,
    sources,
    reconciled,
    notes: v.notes,
    calculatedBy: projectPerson(v.calculatedBy),
    calculatedAt: v.calculatedAt,
    confirmedBy: v.confirmedBy
      ? projectPerson(v.confirmedBy as PoolPerson)
      : null,
    confirmedAt: v.confirmedAt as string | null,
    paidBy: v.paidBy ? projectPerson(v.paidBy as PoolPerson) : null,
    paidAt: v.paidAt as string | null,
    paymentDate: v.paymentDate,
    receiptsCount: v.receiptsCount,
  };
}
export function parseAlerts(
  v: unknown,
): { items: PaymentAlert[]; calculatedAt: string } | null {
  if (!isRecord(v) || !instant(v.calculatedAt) || !Array.isArray(v.items))
    return null;
  const items: PaymentAlert[] = [];
  for (const a of v.items) {
    if (
      !isRecord(a) ||
      !isUuid(a.id) ||
      !person(a.store) ||
      !isTipDate(a.businessDate) ||
      !isTipDate(a.deadline) ||
      !money(a.amount) ||
      !Number.isSafeInteger(a.daysRemaining) ||
      !['UPCOMING', 'OVERDUE'].includes(String(a.status))
    )
      return null;
    let pool: PaymentAlert['pool'] = null;
    if (a.pool !== null) {
      if (
        !isRecord(a.pool) ||
        !isUuid(a.pool.id) ||
        !isTipDate(a.pool.periodStart) ||
        !isTipDate(a.pool.periodEnd)
      )
        return null;
      pool = {
        id: a.pool.id,
        periodStart: a.pool.periodStart,
        periodEnd: a.pool.periodEnd,
      };
    }
    items.push({
      id: a.id,
      store: projectPerson(a.store),
      businessDate: a.businessDate,
      deadline: a.deadline,
      amount: a.amount,
      daysRemaining: Number(a.daysRemaining),
      status: a.status as PaymentAlert['status'],
      pool,
    });
  }
  return { items, calculatedAt: v.calculatedAt };
}
export function parseReceipts(
  v: unknown,
  poolId: string,
): PoolReceipt[] | null {
  if (!Array.isArray(v)) return null;
  const result: PoolReceipt[] = [];
  for (const r of v) {
    if (
      !isRecord(r) ||
      !isUuid(r.id) ||
      r.poolId !== poolId ||
      !isUuid(r.userId) ||
      typeof r.workerName !== 'string' ||
      !money(r.amount) ||
      !isTipDate(r.paymentDate) ||
      !person(r.paidBy)
    )
      return null;
    result.push({
      id: r.id,
      poolId,
      userId: r.userId,
      workerName: r.workerName,
      amount: r.amount,
      paymentDate: r.paymentDate,
      paidBy: projectPerson(r.paidBy),
    });
  }
  return new Set(result.map((r) => r.userId)).size === result.length
    ? result
    : null;
}
export function parsePoolAction(
  v: unknown,
  action: PoolAction,
): Record<string, string | number> | null {
  if (
    !isRecord(v) ||
    !Number.isSafeInteger(v.expectedVersion) ||
    Number(v.expectedVersion) < 1
  )
    return null;
  const allowed =
    action === 'observations'
      ? ['expectedVersion', 'notes']
      : action === 'pay'
        ? ['expectedVersion', 'paymentDate']
        : ['expectedVersion'];
  if (Object.keys(v).some((k) => !allowed.includes(k))) return null;
  const result: Record<string, string | number> = {
    expectedVersion: Number(v.expectedVersion),
  };
  if (action === 'observations') {
    if (
      typeof v.notes !== 'string' ||
      !v.notes.trim() ||
      v.notes.trim().length > 255
    )
      return null;
    result.notes = v.notes.trim();
  }
  if (action === 'pay' && v.paymentDate !== undefined) {
    if (!isTipDate(v.paymentDate)) return null;
    result.paymentDate = v.paymentDate;
  }
  return result;
}
export const POOL_ISSUES: Record<string, string> = {
  AGREEMENT_MISSING: 'No hay un pacto vigente para el período.',
  AGREEMENT_CHANGES_IN_PERIOD:
    'El pacto cambia durante el período. Divide la consulta.',
  AGREEMENT_RULE_UNSUPPORTED: 'La regla del pacto no admite este cálculo.',
  TIP_ENTRIES_MISSING: 'No hay propinas registradas para el período.',
  TIP_ENTRY_ALREADY_USED: 'Hay propinas incluidas en otro reparto.',
  WORK_HOURS_MISSING: 'Faltan horas de los trabajadores.',
  WORK_HOURS_PERIOD_MISMATCH: 'Las horas no corresponden al período.',
  WORK_HOURS_TOTAL_ZERO: 'Las horas totales deben ser mayores que cero.',
  WORKER_NOT_IN_STORE: 'Un trabajador no pertenece al local.',
};
export function poolError(status: number): string {
  return (
    (
      {
        400: 'Revisa el local, las fechas y los campos ingresados.',
        401: 'Tu sesión venció. Inicia sesión nuevamente.',
        403: 'Tu cuenta no tiene permiso para realizar esta acción.',
        404: 'No se encontró el reparto solicitado.',
        409: 'El reparto cambió desde que lo revisaste. Actualiza el reparto antes de continuar.',
        422: 'No se puede calcular con los datos disponibles. Revisa el pacto, las horas y los registros del período.',
        429: 'Hay demasiadas solicitudes. Espera un momento y vuelve a intentar.',
      } as Record<number, string>
    )[status] ??
    'No se pudo completar la operación. Conservamos tus campos; vuelve a intentar.'
  );
}

export function parsePoolForPeriod(
  value: unknown,
  period: PoolPeriod,
): TipPool | null {
  const pool = parsePool(value);
  return pool &&
    pool.store.id === period.storeId &&
    pool.periodStart === period.periodStart &&
    pool.periodEnd === period.periodEnd
    ? pool
    : null;
}
