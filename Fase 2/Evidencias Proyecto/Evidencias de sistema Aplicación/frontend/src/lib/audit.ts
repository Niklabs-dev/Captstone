import { isRecord } from './auth';

export const AUDIT_PAGE_SIZE = 25;
export const AUDIT_TIME_ZONE = 'America/Santiago';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface AuditStore {
  id: string;
  name: string;
}
export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
  store: AuditStore | null;
}
export interface AuditPage {
  items: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}
export interface AuditFilters {
  storeId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}
export type AuditFilterResult =
  { ok: true; data: AuditFilters } | { ok: false; message: string };

export function isAuditStore(value: unknown): value is AuditStore {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID.test(value.id) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0
  );
}
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}
export function parseAuditFilters(params: URLSearchParams): AuditFilterResult {
  const allowed = ['storeId', 'from', 'to', 'limit', 'offset'];
  for (const key of params.keys())
    if (!allowed.includes(key) || params.getAll(key).length !== 1)
      return { ok: false, message: 'Los filtros enviados no son válidos.' };
  const storeId = params.get('storeId') || undefined;
  const from = params.get('from') || undefined;
  const to = params.get('to') || undefined;
  if (storeId && !UUID.test(storeId))
    return { ok: false, message: 'Selecciona un local válido.' };
  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to)))
    return {
      ok: false,
      message: 'Ingresa fechas válidas con formato año-mes-día.',
    };
  if (from && to && from > to)
    return {
      ok: false,
      message: 'La fecha inicial no puede ser posterior a la final.',
    };
  const limitText = params.get('limit') ?? String(AUDIT_PAGE_SIZE);
  const offsetText = params.get('offset') ?? '0';
  if (!/^\d+$/.test(limitText) || !/^\d+$/.test(offsetText))
    return { ok: false, message: 'La paginación enviada no es válida.' };
  const limit = Number(limitText),
    offset = Number(offsetText);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset)
  )
    return { ok: false, message: 'La paginación enviada no es válida.' };
  return { ok: true, data: { storeId, from, to, limit, offset } };
}
export function auditQuery(filters: AuditFilters): string {
  const params = new URLSearchParams({
    limit: String(filters.limit),
    offset: String(filters.offset),
  });
  for (const key of ['storeId', 'from', 'to'] as const)
    if (filters[key]) params.set(key, filters[key]);
  return params.toString();
}
export function auditPageHref(filters: AuditFilters, offset: number): string {
  return '/admin/auditoria?' + auditQuery({ ...filters, offset });
}

// Proyección explícita: los detalles arbitrarios, IP y user-agent no llegan al navegador.
export function parseAuditPage(value: unknown): AuditPage | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !Number.isSafeInteger(value.total) ||
    Number(value.total) < 0 ||
    !Number.isSafeInteger(value.limit) ||
    Number(value.limit) < 1 ||
    Number(value.limit) > 200 ||
    !Number.isSafeInteger(value.offset) ||
    Number(value.offset) < 0 ||
    value.items.length > Number(value.limit)
  )
    return null;
  const items: AuditEntry[] = [];
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !/^\d+$/.test(item.id) ||
      typeof item.action !== 'string' ||
      !item.action.trim() ||
      typeof item.entityType !== 'string' ||
      !item.entityType.trim() ||
      !(item.entityId === null || typeof item.entityId === 'string') ||
      typeof item.createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item.createdAt) ||
      !Number.isFinite(Date.parse(item.createdAt)) ||
      !(item.store === null || isAuditStore(item.store))
    )
      return null;
    let user: AuditEntry['user'] = null;
    if (item.user !== null) {
      if (
        !isRecord(item.user) ||
        typeof item.user.id !== 'string' ||
        typeof item.user.email !== 'string' ||
        typeof item.user.firstName !== 'string' ||
        typeof item.user.lastName !== 'string'
      )
        return null;
      user = {
        id: item.user.id,
        email: item.user.email,
        firstName: item.user.firstName,
        lastName: item.user.lastName,
      };
    }
    items.push({
      id: item.id,
      action: item.action,
      entityType: item.entityType,
      entityId: item.entityId,
      createdAt: item.createdAt,
      user,
      store:
        item.store === null
          ? null
          : { id: item.store.id, name: item.store.name },
    });
  }
  return {
    items,
    total: Number(value.total),
    limit: Number(value.limit),
    offset: Number(value.offset),
  };
}
export function mergeAuditStores(...groups: AuditStore[][]): AuditStore[] {
  const stores = new Map<string, AuditStore>();
  for (const group of groups)
    for (const store of group)
      stores.set(store.id, { id: store.id, name: store.name });
  return [...stores.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'es'),
  );
}
export function parseConfiguredAuditStores(
  value: string | undefined,
): AuditStore[] | null {
  try {
    const data: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(data) && data.every(isAuditStore)
      ? mergeAuditStores(data)
      : null;
  } catch {
    return null;
  }
}
export function formatAuditDate(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: AUDIT_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(new Date(value));
}
export function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    USER_LOGIN: 'Inicio de sesión',
    USER_LOGIN_FAILED: 'Inicio de sesión rechazado',
    USER_CREATED: 'Usuario creado',
    USER_DEACTIVATED: 'Usuario desactivado',
  };
  return Object.hasOwn(labels, action) ? labels[action] : action;
}

export function auditModuleLabel(entityType: string): string {
  const labels: Record<string, string> = {
    users: 'Usuarios',
    auth: 'Acceso',
    documents: 'Documentos',
    tip_pools: 'Propinas',
    sales: 'Ventas',
    cash_closings: 'Caja',
    inventory_movements: 'Inventario',
    inventory_counts: 'Inventario',
  };
  return Object.hasOwn(labels, entityType) ? labels[entityType] : entityType;
}
