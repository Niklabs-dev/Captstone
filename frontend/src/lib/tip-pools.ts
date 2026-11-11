import { isRecord } from './auth';
import { isUuid } from './users';
import type { StatusTone } from './daily-tips';
import { isTipDate, isTipMethodCode } from './tips';
// Repartos de propinas por período: histórico de solo lectura desde
// SPRINT-4A-T08. El reparto vigente es la propina diaria por trabajador
// (/propinas); aquí solo se consultan los repartos guardados y se descargan
// las constancias de los pagados.
export const POOL_STATUS = {
  DRAFT: 'Borrador sin efecto',
  CONFIRMED: 'Confirmado sin pago',
  PAID: 'Pagado',
} as const;
export type PoolStatus = keyof typeof POOL_STATUS;
// Explicación de cada estado para quien revisa el histórico.
export const POOL_STATUS_NOTE: Record<PoolStatus, string> = {
  DRAFT:
    'Nunca se confirmó ni se pagó: no tiene efecto. Las propinas de esos días se consultan y pagan en Propinas.',
  CONFIRMED:
    'Se confirmó, pero no se registró su pago por período. Las propinas diarias de esos días se pagan en Propinas.',
  PAID: 'Se pagó por período y cada trabajador tiene su constancia.',
};
export const POOL_STATUS_TONE: Record<PoolStatus, StatusTone> = {
  DRAFT: 'neutral',
  CONFIRMED: 'info',
  PAID: 'ok',
};
// Las horas solo existen en los repartos proporcionales anteriores a
// SPRINT-4R-T04.
export type PoolRule = 'PROPORTIONAL_TO_HOURS' | 'EQUAL_SHARES';
export interface PoolPerson {
  id: string;
  name: string;
}
export interface PoolLine {
  userId: string;
  workerName: string;
  hoursWorked: string | null;
  amount: number;
}
export interface PoolDailySource {
  operationId: string;
  businessDate: string;
  cardTipAmount: number;
  cashTipAmount: number;
  amount: number;
}
export interface TipPool {
  id: string;
  version: number;
  status: PoolStatus;
  store: PoolPerson;
  periodStart: string;
  periodEnd: string;
  rule: PoolRule;
  totalAmount: number;
  totalHours: string | null;
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
  dailySources: PoolDailySource[];
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
const isPoolRule = (v: unknown): v is PoolRule =>
  v === 'PROPORTIONAL_TO_HOURS' || v === 'EQUAL_SHARES';
export function poolRuleLabel(rule: PoolRule): string {
  return rule === 'EQUAL_SHARES'
    ? 'Reparto equitativo diario entre participantes'
    : 'Proporcional a las horas trabajadas';
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
    !isPoolRule(v.rule) ||
    !money(v.totalAmount) ||
    !(v.rule === 'EQUAL_SHARES'
      ? v.totalHours === null
      : hours(v.totalHours)) ||
    !person(v.calculatedBy) ||
    !instant(v.calculatedAt) ||
    !(v.notes === null || typeof v.notes === 'string') ||
    !Array.isArray(v.lines) ||
    !Array.isArray(v.sources) ||
    !Array.isArray(v.dailySources) ||
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
      !(v.rule === 'EQUAL_SHARES'
        ? l.hoursWorked === null
        : hours(l.hoursWorked)) ||
      !money(l.amount)
    )
      return null;
    lines.push({
      userId: l.userId,
      workerName: l.workerName,
      hoursWorked: l.hoursWorked as string | null,
      amount: l.amount,
    });
  }
  const sources: TipPool['sources'] = [];
  for (const s of v.sources) {
    if (
      !isRecord(s) ||
      !isUuid(s.tipEntryId) ||
      !isTipDate(s.businessDate) ||
      !isTipMethodCode(s.paymentMethod) ||
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
  const dailySources: PoolDailySource[] = [];
  for (const s of v.dailySources) {
    if (
      !isRecord(s) ||
      !isUuid(s.operationId) ||
      !isTipDate(s.businessDate) ||
      !money(s.cardTipAmount) ||
      !money(s.cashTipAmount) ||
      !money(s.amount)
    )
      return null;
    dailySources.push({
      operationId: s.operationId,
      businessDate: s.businessDate,
      cardTipAmount: s.cardTipAmount,
      cashTipAmount: s.cashTipAmount,
      amount: s.amount,
    });
  }
  if (
    new Set(lines.map((l) => l.userId)).size !== lines.length ||
    new Set(sources.map((s) => s.tipEntryId)).size !== sources.length ||
    new Set(dailySources.map((s) => s.operationId)).size !== dailySources.length
  )
    return null;
  // Misma regla del backend: líneas y fuentes de ambos tipos suman el fondo.
  const reconciled =
    lines.reduce((a, l) => a + l.amount, 0) === v.totalAmount &&
    sources.reduce((a, s) => a + s.amount, 0) +
      dailySources.reduce((a, s) => a + s.amount, 0) ===
      v.totalAmount;
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
    rule: v.rule,
    totalAmount: v.totalAmount,
    totalHours: v.totalHours as string | null,
    agreement,
    lines,
    sources,
    dailySources,
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
export function poolError(status: number): string {
  return (
    (
      {
        400: 'La dirección del reparto o de la constancia no es válida.',
        401: 'Tu sesión venció. Inicia sesión nuevamente.',
        403: 'Tu cuenta no tiene permiso para consultar los repartos anteriores.',
        404: 'No se encontró el reparto o la constancia solicitada.',
        409: 'El reparto no se pagó por período, así que no tiene constancias.',
        429: 'Hay demasiadas solicitudes. Espera un momento y vuelve a intentar.',
      } as Record<number, string>
    )[status] ??
    'No se pudieron cargar los repartos anteriores. Intenta nuevamente en unos momentos.'
  );
}

// Lista del histórico: todas las fotos deben ser válidas.
export function parsePools(v: unknown): TipPool[] | null {
  if (!Array.isArray(v)) return null;
  const pools = v.map(parsePool);
  return pools.every((pool): pool is TipPool => pool !== null) ? pools : null;
}

// Los borradores sin efecto se separan para no confundirlos con repartos
// que se confirmaron o pagaron; el orden del backend se conserva.
export function groupPoolHistory(pools: readonly TipPool[]): {
  closed: TipPool[];
  drafts: TipPool[];
} {
  return {
    closed: pools.filter((pool) => pool.status !== 'DRAFT'),
    drafts: pools.filter((pool) => pool.status === 'DRAFT'),
  };
}

// Descarga de la constancia por el BFF autenticado (el token no sale del
// servidor).
export function poolReceiptHref(poolId: string, userId: string): string {
  return `/api/tip-pools/${poolId}/receipts/${userId}/download`;
}
