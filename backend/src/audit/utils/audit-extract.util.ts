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

// Valor de una ruta con puntos dentro de un objeto (ej. 'latestVersion.number').
function valueAt(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split('.')) {
    const record = asRecord(current);
    if (record === null || !(key in record)) return undefined;
    current = record[key];
  }
  return current;
}

const PARAMS_PREFIX = 'params.';

// Acción declarada en @Audited(), o la que elige su función según la
// solicitud y la respuesta.
export function resolveAction(
  options: AuditedOptions,
  info: AuditRequestInfo,
  response: unknown,
): string {
  return typeof options.action === 'function'
    ? options.action(info, response)
    : options.action;
}

// ID de la entidad afectada según el origen declarado en @Audited().
export function resolveEntityId(
  options: AuditedOptions,
  info: AuditRequestInfo,
  response: unknown,
): string | null {
  const source = options.entityIdFrom;
  if (source === undefined) return null;
  if (source === 'context.entityId') {
    return asString(info.context?.entityId);
  }
  if (source.startsWith(PARAMS_PREFIX)) {
    return asString(info.params[source.slice(PARAMS_PREFIX.length)]);
  }
  return asString(valueAt(response, source.slice('response.'.length)));
}

// Responsable de la operación: el usuario autenticado o, en endpoints
// públicos como el login, el usuario que devuelve la respuesta exitosa.
// El local se toma de la entidad afectada (respuesta o contexto del endpoint)
// antes que del actor: un administrador global no tiene local, pero el
// usuario que crea o el documento que carga sí.
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
      asString(responseRecord?.storeId) ??
      asString(info.context?.storeId) ??
      info.user?.storeId ??
      null,
  };
}

// Copia solo los campos declarados (listas blancas): del cuerpo los de
// detailFromBody, que puede traer contraseñas que nunca deben auditarse; de
// la respuesta los de detailFromResponse; y el detalle que aportó el endpoint
// con setAuditContext. Sin respuesta (rechazos) solo cuerpo y contexto.
export function resolveDetail(
  options: AuditedOptions,
  info: AuditRequestInfo,
  response?: unknown,
): Record<string, unknown> | null {
  const detail: Record<string, unknown> = {};
  const body = asRecord(info.body);
  if (body !== null) {
    for (const field of options.detailFromBody ?? []) {
      if (field in body) detail[field] = body[field];
    }
  }
  for (const [key, path] of Object.entries(options.detailFromResponse ?? {})) {
    const value = valueAt(response, path);
    if (value !== undefined) detail[key] = value;
  }
  Object.assign(detail, info.context?.detail);
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
    action: resolveAction(options, info, response),
    entityType: options.entityType,
    entityId: resolveEntityId(options, info, response),
    detail: resolveDetail(options, info, response),
    userId: actor.userId,
    storeId: actor.storeId,
    ipAddress: info.ip ?? null,
    userAgent: info.userAgent ?? null,
  };
}

// Evento de una operación rechazada (ej. login con credenciales inválidas o
// eliminación bloqueada de un documento): no hay respuesta, así que la entidad
// solo se identifica si su ID viaja en la ruta y el actor solo se conoce si
// venía autenticado.
export function buildFailureAuditEvent(
  options: AuditedOptions,
  action: string,
  info: AuditRequestInfo,
): AuditEvent {
  return {
    action,
    entityType: options.entityType,
    entityId: resolveEntityId(options, info, undefined),
    detail: resolveDetail(options, info),
    userId: info.user?.id ?? null,
    storeId: asString(info.context?.storeId) ?? info.user?.storeId ?? null,
    ipAddress: info.ip ?? null,
    userAgent: info.userAgent ?? null,
  };
}
