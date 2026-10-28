import type { AuthUser } from '../../auth/types/auth.types.js';
import type { AuditAction } from '../constants/audit-actions.constants.js';

// Orígenes soportados para el ID de la entidad en una operación exitosa:
// - 'response.id': la respuesta es la entidad (ej. usuario creado).
// - 'response.user.id': la entidad viene anidada en la respuesta (ej. login).
// - 'params.<nombre>': el ID viaja en la ruta (ej. 'params.id' en
//   PATCH /users/:id/deactivate o 'params.versionId' en la descarga de una
//   versión). Es el único origen disponible también en los rechazos.
// - 'context.entityId': lo fija el endpoint con setAuditContext cuando la
//   respuesta es un archivo y la ruta no trae el ID (ej. la constancia de
//   pago de propinas, SPRINT-3-T13).
export type AuditEntityIdSource =
  'response.id' | 'response.user.id' | `params.${string}` | 'context.entityId';

// Elige la acción según la solicitud y la respuesta, para endpoints con más
// de un resultado posible (ej. carga de un documento nuevo o de una nueva
// versión, SPRINT-2-T09).
export type AuditActionResolver = (
  info: AuditRequestInfo,
  response: unknown,
) => AuditAction;

// Metadatos que @Audited() declara en un endpoint crítico (SPRINT-1-T13).
export interface AuditedOptions {
  /** Acción a registrar cuando la operación tiene éxito. */
  action: AuditAction | AuditActionResolver;
  /** Tipo de entidad afectada: tabla o módulo, ej. 'users', 'auth'. */
  entityType: string;
  /** De dónde tomar el ID de la entidad; si se omite, queda null. */
  entityIdFrom?: AuditEntityIdSource;
  /**
   * Campos del cuerpo de la solicitud que se copian a detail. Es una lista
   * blanca: el cuerpo puede traer contraseñas que jamás deben auditarse.
   */
  detailFromBody?: string[];
  /**
   * Campos de la respuesta que se copian a detail: clave en detail → ruta en
   * la respuesta, con puntos para campos anidados (ej. versionNumber →
   * 'latestVersion.number'). También es una lista blanca.
   */
  detailFromResponse?: Record<string, string>;
  /**
   * Si se define, los rechazos cuyo estado HTTP esté en failureStatuses
   * también se auditan, con esta acción (ej. login fallido).
   */
  failureAction?: AuditAction;
  /** Estados HTTP de error que se auditan con failureAction (defecto [401]). */
  failureStatuses?: number[];
}

// Datos que el propio endpoint aporta al evento cuando la respuesta no los
// trae, por ejemplo una descarga, que responde con el archivo (SPRINT-2-T09).
// Se fijan con setAuditContext (utils/audit-context.util.ts).
export interface AuditContext {
  /** ID de la entidad afectada, para entityIdFrom: 'context.entityId'. */
  entityId?: string;
  /** Local de la entidad afectada. */
  storeId?: string | null;
  /** Campos adicionales para detail; nunca contenido de archivos. */
  detail?: Record<string, unknown>;
  /** Omite el evento si una operación idempotente no cambió el estado. */
  skipAudit?: boolean;
}

// Datos de la solicitud HTTP que el interceptor extrae para armar el evento.
// Interfaz propia (no la Request de Express) para que el armado del evento
// sea una función pura y testeable sin levantar el servidor.
export interface AuditRequestInfo {
  user?: AuthUser;
  // Mismo tipo que los params de Express 5: string | string[] por clave.
  params: Record<string, string | string[]>;
  body: unknown;
  ip?: string;
  userAgent?: string;
  // Contexto fijado por el endpoint durante la solicitud, si lo hay.
  context?: AuditContext;
}

// Evento de auditoría listo para persistir en audit_logs.
export interface AuditEvent {
  action: string;
  entityType: string;
  entityId: string | null;
  detail: Record<string, unknown> | null;
  userId: string | null;
  storeId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

// Usuario responsable de una operación auditada (SPRINT-1-T14).
export interface AuditLogUserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

// Local donde ocurrió la operación auditada (SPRINT-1-T14).
export interface AuditLogStoreSummary {
  id: string;
  name: string;
}

// Registro de auditoría tal como lo devuelve la API de consulta.
export interface AuditLogResponse {
  // BIGSERIAL serializado como texto: JSON no representa BigInt.
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  // null en logins fallidos (actor no identificado) o usuarios eliminados.
  user: AuditLogUserSummary | null;
  // null en operaciones globales (sin local asociado).
  store: AuditLogStoreSummary | null;
}

// Página de resultados de la consulta de auditoría.
export interface AuditLogPage {
  items: AuditLogResponse[];
  total: number;
  limit: number;
  offset: number;
}
