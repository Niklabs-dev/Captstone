import { isRecord, type AuthUser } from './auth';
import {
  callBackend,
  verifyAccessToken,
  type BackendResult,
} from './auth-backend';
import {
  auditQuery,
  isAuditStore,
  mergeAuditStores,
  parseAuditPage,
  type AuditFilters,
  type AuditPage,
  type AuditStore,
} from './audit';

export interface AuditAdministrator {
  user: AuthUser;
  stores: AuditStore[];
}
async function auditRequest(
  path: string,
  token: string,
): Promise<BackendResult<unknown>> {
  const response = await callBackend(path, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
  });
  if (!response)
    return {
      ok: false,
      status: 503,
      message: 'No se pudo conectar con el servicio. Intenta nuevamente.',
    };
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: 'Los filtros enviados no son válidos.',
      401: 'La sesión venció. Inicia sesión nuevamente.',
      403: 'Tu cuenta no tiene permiso para consultar la auditoría.',
    };
    return {
      ok: false,
      status: messages[response.status] ? response.status : 502,
      message:
        messages[response.status] ??
        'El servicio no está disponible. Intenta nuevamente.',
    };
  }
  const data: unknown = await response.json().catch(() => null);
  return { ok: true, data };
}
export async function verifyAuditAdministrator(
  token: string,
): Promise<BackendResult<AuditAdministrator>> {
  const session = await verifyAccessToken(token);
  if (!session.ok) return session;
  if (session.data.role !== 'ADMINISTRADOR')
    return {
      ok: false,
      status: 403,
      message: 'Tu cuenta no tiene permiso para consultar la auditoría.',
    };
  // Comprueba el estado actual para rechazar un JWT anterior a la desactivación.
  const response = await auditRequest('/users', token);
  if (!response.ok) return response;
  if (!Array.isArray(response.data))
    return {
      ok: false,
      status: 502,
      message: 'No se pudo verificar la cuenta.',
    };
  const stores: AuditStore[] = [];
  let administrator: Record<string, unknown> | undefined;
  for (const value of response.data) {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.isActive !== 'boolean' ||
      !isRecord(value.role) ||
      typeof value.role.code !== 'string' ||
      !(value.store === null || isAuditStore(value.store))
    )
      return {
        ok: false,
        status: 502,
        message: 'No se pudo verificar la cuenta.',
      };
    if (value.id === session.data.id) administrator = value;
    if (isAuditStore(value.store))
      stores.push({ id: value.store.id, name: value.store.name });
  }
  if (!administrator || administrator.isActive !== true)
    return {
      ok: false,
      status: 401,
      message: 'La cuenta ya no está activa. Inicia sesión nuevamente.',
    };
  if (
    !isRecord(administrator.role) ||
    administrator.role.code !== 'ADMINISTRADOR'
  )
    return {
      ok: false,
      status: 403,
      message: 'Tu cuenta no tiene permiso para consultar la auditoría.',
    };
  return {
    ok: true,
    data: { user: session.data, stores: mergeAuditStores(stores) },
  };
}
export async function fetchAuditPage(
  token: string,
  filters: AuditFilters,
): Promise<BackendResult<AuditPage>> {
  const response = await auditRequest(
    '/audit-logs?' + auditQuery(filters),
    token,
  );
  if (!response.ok) return response;
  const page = parseAuditPage(response.data);
  if (!page || page.limit !== filters.limit || page.offset !== filters.offset)
    return {
      ok: false,
      status: 502,
      message: 'El servicio devolvió un registro de auditoría inválido.',
    };
  return { ok: true, data: page };
}
