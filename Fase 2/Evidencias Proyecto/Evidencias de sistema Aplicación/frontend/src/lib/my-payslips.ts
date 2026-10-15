import type { Role } from './auth';

// Contrato interno del frontend, pendiente de confirmar con Swagger de T15.
export const MAX_PAYSLIP_BYTES = 25 * 1024 * 1024;
export type OwnPayslip = {
  id: string;
  versionId: string;
  workerId: string;
  period: string;
  status: 'PUBLISHED';
  fileName: string;
  mime: 'application/pdf';
  size: number;
  sha256: string;
  publishedAt: string;
};
export type PayslipIntegrity = {
  payslipId: string;
  versionId: string;
  workerId: string;
  valid: boolean;
  expectedHash: string;
  actualHash: string;
  checkedAt: string;
};
export function canReadOwnPayslips(role: Role): boolean {
  return role === 'TRABAJADOR';
}
export function payslipUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function timestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  return (
    new Date(value.slice(0, 10) + 'T12:00:00Z').toISOString().slice(0, 10) ===
    value.slice(0, 10)
  );
}
export function parseOwnPayslip(
  value: unknown,
  workerId: string,
): OwnPayslip | null {
  if (
    !object(value) ||
    !payslipUuid(workerId) ||
    value.workerId !== workerId ||
    !payslipUuid(value.id) ||
    !payslipUuid(value.versionId) ||
    value.status !== 'PUBLISHED' ||
    typeof value.period !== 'string' ||
    !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value.period) ||
    typeof value.fileName !== 'string' ||
    value.fileName.length > 200 ||
    !/\.pdf$/i.test(value.fileName) ||
    /[\u0000-\u001f\u007f\/\\]/.test(value.fileName) ||
    value.mime !== 'application/pdf' ||
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > MAX_PAYSLIP_BYTES ||
    !hash(value.sha256) ||
    !timestamp(value.publishedAt)
  )
    return null;
  return {
    id: value.id,
    versionId: value.versionId,
    workerId,
    period: value.period,
    status: 'PUBLISHED',
    fileName: value.fileName,
    mime: 'application/pdf',
    size: value.size,
    sha256: value.sha256,
    publishedAt: value.publishedAt,
  };
}
export function parseOwnPayslips(
  value: unknown,
  workerId: string,
): OwnPayslip[] | null {
  if (!object(value) || !Array.isArray(value.items) || !payslipUuid(workerId))
    return null;
  const items: OwnPayslip[] = [];
  for (const candidate of value.items) {
    const item = parseOwnPayslip(candidate, workerId);
    // Una respuesta mezclada se rechaza completa; no se muestra ni siquiera parcialmente.
    if (
      !item ||
      items.some(
        (previous) =>
          previous.id === item.id ||
          previous.versionId === item.versionId ||
          previous.period === item.period,
      )
    )
      return null;
    items.push(item);
  }
  return items.sort((a, b) => b.period.localeCompare(a.period));
}
export function parsePayslipIntegrity(
  value: unknown,
  payslip: OwnPayslip,
): PayslipIntegrity | null {
  if (
    !object(value) ||
    value.payslipId !== payslip.id ||
    value.versionId !== payslip.versionId ||
    value.workerId !== payslip.workerId ||
    value.expectedHash !== payslip.sha256 ||
    !hash(value.actualHash) ||
    typeof value.valid !== 'boolean' ||
    value.valid !== (value.expectedHash === value.actualHash) ||
    !timestamp(value.checkedAt)
  )
    return null;
  return {
    payslipId: payslip.id,
    versionId: payslip.versionId,
    workerId: payslip.workerId,
    valid: value.valid,
    expectedHash: payslip.sha256,
    actualHash: value.actualHash,
    checkedAt: value.checkedAt,
  };
}
export async function payslipHash(bytes: ArrayBuffer): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (part) => part.toString(16).padStart(2, '0'),
  ).join('');
}
export function payslipDownloadName(value: string, period: string): string {
  const leaf = value.split(/[\/\\]/).pop() ?? '';
  const stem = leaf
    .replace(/\.pdf$/i, '')
    .replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 176);
  return (stem || 'liquidacion-' + period) + '.pdf';
}
export function payslipPeriodLabel(period: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(period + '-01T12:00:00Z'));
}
