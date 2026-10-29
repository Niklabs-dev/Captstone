import { isRecord, type Role } from './auth';
import { isUuid } from './users';
import { isTipDate } from './tips';
export interface OwnTipReceipt {
  id: string;
  userId: string;
  status: 'PAID';
  storeName: string;
  periodStart: string;
  periodEnd: string;
  hoursWorked: string;
  amount: number;
  paymentDate: string;
  paidByName: string;
  createdAt: string;
}
export const MAX_RECEIPT_BYTES = 1024 * 1024;
export const canReadOwnTipReceipts = (role: Role): boolean =>
  role === 'TRABAJADOR';
export function ownReceiptPath(
  path: string[],
  query: URLSearchParams,
): string | null {
  if (query.size) return null;
  if (!path.length) return '/my-tip-receipts';
  if (path.length === 2 && isUuid(path[0]) && path[1] === 'download')
    return '/my-tip-receipts/' + path[0] + '/download';
  return null;
}
export function parseOwnReceipts(
  value: unknown,
  workerId: string,
): OwnTipReceipt[] | null {
  if (!isUuid(workerId) || !Array.isArray(value)) return null;
  const result: OwnTipReceipt[] = [];
  for (const r of value) {
    if (
      !isRecord(r) ||
      !isUuid(r.id) ||
      r.userId !== workerId ||
      r.status !== 'PAID' ||
      typeof r.storeName !== 'string' ||
      !isTipDate(r.periodStart) ||
      !isTipDate(r.periodEnd) ||
      r.periodStart > r.periodEnd ||
      typeof r.hoursWorked !== 'string' ||
      !/^\d+(\.\d{1,2})?$/.test(r.hoursWorked) ||
      typeof r.amount !== 'number' ||
      !Number.isSafeInteger(r.amount) ||
      r.amount < 0 ||
      !isTipDate(r.paymentDate) ||
      typeof r.paidByName !== 'string' ||
      typeof r.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(r.createdAt))
    )
      return null;
    result.push({
      id: r.id,
      userId: workerId,
      status: 'PAID',
      storeName: r.storeName,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      hoursWorked: r.hoursWorked,
      amount: r.amount,
      paymentDate: r.paymentDate,
      paidByName: r.paidByName,
      createdAt: r.createdAt,
    });
  }
  return new Set(result.map((r) => r.id)).size === result.length
    ? result
    : null;
}
export function ownReceiptError(status: number): string {
  return (
    (
      {
        401: 'Tu sesión venció. Inicia sesión nuevamente.',
        403: 'Tu cuenta no tiene permiso para consultar estas constancias.',
        404: 'La constancia no está disponible. Actualiza el listado.',
        502: 'No se pudo verificar la respuesta o el archivo. Vuelve a intentar.',
      } as Record<number, string>
    )[status] ??
    'No se pudieron consultar tus propinas. Vuelve a intentar en unos momentos.'
  );
}
export async function verifyReceiptBytes(
  bytes: ArrayBuffer,
  hash: string,
): Promise<boolean> {
  if (
    !/^[a-f0-9]{64}$/.test(hash) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_RECEIPT_BYTES ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-'
  )
    return false;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return (
    Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('') === hash
  );
}
