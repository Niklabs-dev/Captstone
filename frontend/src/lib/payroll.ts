import type { Role } from './auth';

// Contrato interno propuesto. Confirmar con Swagger de SPRINT-2-T13/T14.
export const MAX_PAYROLL_BYTES = 25 * 1024 * 1024;
export type PayrollWorker = {
  id: string;
  name: string;
  store: { id: string; name: string };
  isActive: boolean;
};
export type Payroll = {
  id: string;
  worker: PayrollWorker;
  period: string;
  fileName: string;
  size: number;
  sha256: string;
  createdAt: string;
  publishedAt: string | null;
  status: 'PENDING_SIGNATURE' | 'PUBLISHED';
  revision: string;
  canPublish: boolean;
};
export type PayrollPolicy = {
  maxBytes: number;
  allowedMimes: ['application/pdf'];
  canUpload: boolean;
};
export type PayrollCollection = {
  items: Payroll[];
  workers: PayrollWorker[];
  policy: PayrollPolicy;
};
export function canReadPayroll(role: Role): boolean {
  return role === 'CONTADOR' || role === 'ADMINISTRADOR';
}
export function canManagePayroll(role: Role): boolean {
  return role === 'CONTADOR';
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 200): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f]/.test(value)
  );
}
function uuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function isPayrollPeriod(value: unknown): value is string {
  return (
    typeof value === 'string' && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value)
  );
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
function worker(value: unknown): PayrollWorker | null {
  if (
    !record(value) ||
    !uuid(value.id) ||
    !text(value.name) ||
    typeof value.isActive !== 'boolean' ||
    !record(value.store) ||
    !uuid(value.store.id) ||
    !text(value.store.name)
  )
    return null;
  return {
    id: value.id,
    name: value.name,
    isActive: value.isActive,
    store: { id: value.store.id, name: value.store.name },
  };
}
export function parsePayroll(value: unknown): Payroll | null {
  if (!record(value)) return null;
  const person = worker(value.worker);
  if (
    !person ||
    !uuid(value.id) ||
    !isPayrollPeriod(value.period) ||
    !text(value.fileName) ||
    !/\.pdf$/i.test(value.fileName) ||
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > MAX_PAYROLL_BYTES ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.sha256) ||
    !timestamp(value.createdAt) ||
    !text(value.revision, 128) ||
    typeof value.canPublish !== 'boolean' ||
    (value.status !== 'PENDING_SIGNATURE' && value.status !== 'PUBLISHED') ||
    (value.status === 'PUBLISHED'
      ? !timestamp(value.publishedAt) || value.canPublish
      : value.publishedAt !== null)
  )
    return null;
  return {
    id: value.id,
    worker: person,
    period: value.period,
    fileName: value.fileName,
    size: value.size,
    sha256: value.sha256,
    createdAt: value.createdAt,
    publishedAt: value.publishedAt as string | null,
    status: value.status,
    revision: value.revision,
    canPublish: value.canPublish,
  };
}
export function parsePayrollCollection(
  value: unknown,
): PayrollCollection | null {
  if (
    !record(value) ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.workers) ||
    !record(value.policy) ||
    typeof value.policy.maxBytes !== 'number' ||
    !Number.isSafeInteger(value.policy.maxBytes) ||
    value.policy.maxBytes <= 0 ||
    value.policy.maxBytes > MAX_PAYROLL_BYTES ||
    !Array.isArray(value.policy.allowedMimes) ||
    value.policy.allowedMimes.length !== 1 ||
    value.policy.allowedMimes[0] !== 'application/pdf' ||
    typeof value.policy.canUpload !== 'boolean'
  )
    return null;
  const workers: PayrollWorker[] = [];
  const items: Payroll[] = [];
  for (const candidate of value.workers) {
    const person = worker(candidate);
    if (!person || workers.some((previous) => previous.id === person.id))
      return null;
    workers.push(person);
  }
  for (const candidate of value.items) {
    const item = parsePayroll(candidate);
    if (
      !item ||
      items.some(
        (previous) =>
          previous.id === item.id ||
          (previous.worker.id === item.worker.id &&
            previous.period === item.period),
      )
    )
      return null;
    items.push(item);
  }
  // Los registros históricos conservan su local; no se exige que el trabajador siga activo o en la nómina de carga.
  return {
    items,
    workers,
    policy: {
      maxBytes: value.policy.maxBytes,
      allowedMimes: ['application/pdf'],
      canUpload: value.policy.canUpload,
    },
  };
}
export function validatePayrollUpload(
  workerId: string,
  period: string,
  file: Pick<File, 'name' | 'type' | 'size'> | null,
  collection: PayrollCollection,
): string | null {
  if (!collection.policy.canUpload)
    return 'La carga no está habilitada para tu cuenta.';
  if (
    !collection.workers.some(
      (person) => person.id === workerId && person.isActive,
    )
  )
    return 'Selecciona un trabajador activo.';
  if (!isPayrollPeriod(period))
    return 'Selecciona un período válido (año y mes).';
  if (
    collection.items.some(
      (item) => item.worker.id === workerId && item.period === period,
    )
  )
    return 'Ya existe una liquidación para ese trabajador y período. Actualiza el listado.';
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0)
    return 'Selecciona un archivo PDF no vacío.';
  if (file.type !== 'application/pdf' || !/\.pdf$/i.test(file.name))
    return 'El archivo debe tener formato PDF.';
  if (file.size > Math.min(collection.policy.maxBytes, MAX_PAYROLL_BYTES))
    return 'El archivo supera el tamaño permitido.';
  return null;
}
export async function payrollFileHash(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('El archivo no tiene una cabecera PDF válida.');
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (part) => part.toString(16).padStart(2, '0'),
  ).join('');
}
export function filterPayroll(
  items: Payroll[],
  store: string,
  period: string,
  status: string,
): Payroll[] {
  return items
    .filter(
      (item) =>
        (!store || item.worker.store.id === store) &&
        (!period || item.period === period) &&
        (!status || item.status === status),
    )
    .sort(
      (a, b) =>
        b.period.localeCompare(a.period) ||
        a.worker.name.localeCompare(b.worker.name, 'es'),
    );
}
export function payrollPeriodLabel(period: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(period + '-01T12:00:00Z'));
}
