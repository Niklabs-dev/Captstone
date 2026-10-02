import type {
  AuditEvent,
  AuditedOptions,
  AuditRequestInfo,
} from '../types/audit.types.js';

// Armado del evento de auditoría a partir de la solicitud y la respuesta
// (SPRINT-1-T13). Funciones puras: sin Express ni NestJS, para testearlas
// directamente.

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ID de la entidad afectada según el origen declarado en @Audited().
export function resolveEntityId(
  options: AuditedOptions,
  info: AuditRequestInfo,
  response: unknown,
): string | null {
  const responseRecord = asRecord(response);
  switch (options.entityIdFrom) {
    case 'params.id':
      return asString(info.params.id);
    case 'response.id':
      return asString(responseRecord?.id);
    case 'response.user.id':
      return asString(asRecord(responseRecord?.user)?.id);
    default:
      return null;
  }
}

// Responsable de la operación: el usuario autenticado o, en endpoints
// públicos como el login, el usuario que devuelve la respuesta exitosa.
// El local se toma de la entidad afectada (respuesta) antes que del actor:
// un administrador global no tiene local, pero el usuario que crea sí.
export function resolveActor(
  info: AuditRequestInfo,
  response: unknown,
): { userId: string | null; storeId: string | null } {
  const responseRecord = asRecord(response);
  const responseUser = asRecord(responseRecord?.user);
  return {
    userId: info.user?.id ?? asString(responseUser?.id),
    storeId:
      asString(responseUser?.storeId) ??
      asString(asRecord(responseRecord?.store)?.id) ??
      info.user?.storeId ??
      null,
  };
}

// Copia del cuerpo solo los campos declarados en detailFromBody (lista
// blanca): el cuerpo puede traer contraseñas que nunca deben auditarse.
export function resolveDetail(
  options: AuditedOptions,
  info: AuditRequestInfo,
): Record<string, unknown> | null {
  const fields = options.detailFromBody ?? [];
  const body = asRecord(info.body);
  if (fields.length === 0 || body === null) return null;
  const detail: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in body) detail[field] = body[field];
  }
  return Object.keys(detail).length > 0 ? detail : null;
}

// Evento de una operación exitosa.
export function buildAuditEvent(
  options: AuditedOptions,
  info: AuditRequestInfo,
  response: unknown,
): AuditEvent {
  const actor = resolveActor(info, response);
  return {
    action: options.action,
    entityType: options.entityType,
    entityId: resolveEntityId(options, info, response),
    detail: resolveDetail(options, info),
    userId: actor.userId,
    storeId: actor.storeId,
    ipAddress: info.ip ?? null,
    userAgent: info.userAgent ?? null,
  };
}

// Evento de una operación rechazada (ej. login con credenciales inválidas):
// no hay respuesta, así que la entidad queda sin identificar y el actor solo
// se conoce si venía autenticado.
export function buildFailureAuditEvent(
  options: AuditedOptions,
  action: string,
  info: AuditRequestInfo,
): AuditEvent {
  return {
    action,
    entityType: options.entityType,
    entityId: null,
    detail: resolveDetail(options, info),
    userId: info.user?.id ?? null,
    storeId: info.user?.storeId ?? null,
    ipAddress: info.ip ?? null,
    userAgent: info.userAgent ?? null,
  };
}
