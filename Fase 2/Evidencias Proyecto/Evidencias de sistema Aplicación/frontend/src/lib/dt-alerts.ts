// Contrato interno propuesto del frontend; pendiente de confirmar con Swagger de T08.
export type DtAlert = {
  id: string;
  documentId: string;
  contractTitle: string;
  worker: { id: string; name: string };
  store: { id: string; name: string };
  deadline: string;
  daysRemaining: number;
  status: 'UPCOMING' | 'OVERDUE';
  revision: string;
  canRegister: boolean;
};
export type DtAlertCollection = { items: DtAlert[]; calculatedAt: string };
export type DtRegistration = {
  alertId: string;
  documentId: string;
  status: 'REGISTERED';
  registeredAt: string;
};
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, limit = 200): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= limit &&
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
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}
function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + 'T12:00:00Z');
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
export function parseDtAlert(value: unknown): DtAlert | null {
  if (
    !object(value) ||
    !uuid(value.id) ||
    !uuid(value.documentId) ||
    !text(value.contractTitle) ||
    !object(value.worker) ||
    !uuid(value.worker.id) ||
    !text(value.worker.name) ||
    !object(value.store) ||
    !uuid(value.store.id) ||
    !text(value.store.name) ||
    !calendarDate(value.deadline) ||
    typeof value.daysRemaining !== 'number' ||
    !Number.isSafeInteger(value.daysRemaining) ||
    Math.abs(value.daysRemaining) > 100000 ||
    !text(value.revision, 128) ||
    typeof value.canRegister !== 'boolean' ||
    (value.status !== 'UPCOMING' && value.status !== 'OVERDUE') ||
    (value.status === 'OVERDUE') !== value.daysRemaining < 0
  )
    return null;
  return {
    id: value.id,
    documentId: value.documentId,
    contractTitle: value.contractTitle,
    worker: { id: value.worker.id, name: value.worker.name },
    store: { id: value.store.id, name: value.store.name },
    deadline: value.deadline,
    daysRemaining: value.daysRemaining,
    status: value.status,
    revision: value.revision,
    canRegister: value.canRegister,
  };
}
export function parseDtAlerts(value: unknown): DtAlertCollection | null {
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    !timestamp(value.calculatedAt)
  )
    return null;
  const items: DtAlert[] = [];
  for (const candidate of value.items) {
    const item = parseDtAlert(candidate);
    if (
      !item ||
      items.some(
        (previous) =>
          previous.id === item.id || previous.documentId === item.documentId,
      )
    )
      return null;
    items.push(item);
  }
  return { items, calculatedAt: value.calculatedAt };
}
export function parseDtRegistration(
  value: unknown,
  alert: DtAlert,
): DtRegistration | null {
  if (
    !object(value) ||
    value.alertId !== alert.id ||
    value.documentId !== alert.documentId ||
    value.status !== 'REGISTERED' ||
    !timestamp(value.registeredAt)
  )
    return null;
  return {
    alertId: alert.id,
    documentId: alert.documentId,
    status: 'REGISTERED',
    registeredAt: value.registeredAt,
  };
}
export function filterDtAlerts(
  items: DtAlert[],
  search: string,
  store: string,
  status: string,
): DtAlert[] {
  const query = search.trim().toLocaleLowerCase('es');
  return items
    .filter(
      (item) =>
        (!store || item.store.id === store) &&
        (!status || item.status === status) &&
        (item.worker.name + ' ' + item.contractTitle)
          .toLocaleLowerCase('es')
          .includes(query),
    )
    .sort(
      (a, b) =>
        a.daysRemaining - b.daysRemaining ||
        a.worker.name.localeCompare(b.worker.name, 'es'),
    );
}
export function dtRemainingLabel(days: number): string {
  if (days < 0)
    return 'Vencido hace ' + Math.abs(days) + (days === -1 ? ' día' : ' días');
  if (days === 0) return 'Vence hoy';
  return 'Queda' + (days === 1 ? ' 1 día' : 'n ' + days + ' días');
}
export function dtDate(value: string): string {
  // La fecha límite es una fecha de calendario del servidor, sin conversión de zona horaria.
  return value.split('-').reverse().join('-');
}
