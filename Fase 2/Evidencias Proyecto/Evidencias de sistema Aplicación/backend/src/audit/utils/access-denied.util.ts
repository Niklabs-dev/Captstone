import {
  ROLE_FORBIDDEN_MESSAGE,
  STORE_FORBIDDEN_MESSAGE,
} from '../../auth/constants/forbidden-messages.constants.js';
import type { AuthUser } from '../../auth/types/auth.types.js';
import { AUDIT_ACTION } from '../constants/audit-actions.constants.js';
import type { AuditEvent } from '../types/audit.types.js';

// Auditoría de accesos denegados (SPRINT-4R-T15). Funciones puras, sin
// NestJS ni base de datos, para testear qué datos se guardan y cuáles no.

// Motivo del rechazo: ROLE (el rol no puede usar la ruta), STORE (el local
// pedido no es el del usuario) o RESOURCE (el servicio negó un recurso
// concreto, ej. un documento ajeno).
export type AccessDeniedReason = 'ROLE' | 'STORE' | 'RESOURCE';

// Datos de la solicitud rechazada. Interfaz propia (no la Request de
// Express) para que el armado del evento sea testeable. Nunca incluye el
// cuerpo ni la consulta completa: pueden traer correos, RUT o montos.
export interface AccessDeniedRequestInfo {
  user?: AuthUser;
  method: string;
  // Plantilla de la ruta (ej. /daily-operations/:id), no la URL real.
  route: string | null;
  params: Record<string, unknown>;
  // Solo el storeId de la consulta, si lo hay; el resto se descarta.
  queryStoreId: unknown;
  // Mensaje del ForbiddenException; solo se usa para clasificar el motivo.
  message: unknown;
  ip?: string;
  userAgent?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ENTITY_TYPE_LENGTH = 60;
const MAX_USER_AGENT_LENGTH = 255;

function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

export function accessDeniedReason(message: unknown): AccessDeniedReason {
  if (message === ROLE_FORBIDDEN_MESSAGE) return 'ROLE';
  if (message === STORE_FORBIDDEN_MESSAGE) return 'STORE';
  return 'RESOURCE';
}

// Primer segmento de la plantilla (ej. 'sales-dashboard'), que identifica el
// módulo de la ruta; 'unknown' si Express no resolvió una ruta.
function entityTypeOf(route: string | null): string {
  const segment = route?.split('/').find((part) => part.length > 0);
  return (segment ?? 'unknown').slice(0, MAX_ENTITY_TYPE_LENGTH);
}

// Evento ACCESS_DENIED listo para persistir. Guarda quién (userId y rol),
// dónde (método y plantilla de la ruta, ID de la entidad y local pedidos
// solo si son UUID) y por qué (motivo clasificado). El local del registro es
// el del usuario: el pedido puede no existir y audit_logs.store_id es una FK.
// Sin usuario autenticado no hay intento que auditar (ese caso es un 401).
export function buildAccessDeniedEvent(
  info: AccessDeniedRequestInfo,
): AuditEvent | null {
  if (!info.user) return null;
  const requestedStoreId =
    asUuid(info.params.storeId) ?? asUuid(info.queryStoreId);
  return {
    action: AUDIT_ACTION.ACCESS_DENIED,
    entityType: entityTypeOf(info.route),
    entityId: asUuid(info.params.id),
    detail: {
      method: info.method,
      route: info.route,
      role: info.user.role,
      reason: accessDeniedReason(info.message),
      ...(requestedStoreId ? { requestedStoreId } : {}),
    },
    userId: info.user.id,
    storeId: info.user.storeId,
    ipAddress: info.ip ?? null,
    userAgent: info.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
  };
}
