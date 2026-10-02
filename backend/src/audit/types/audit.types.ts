import type { AuthUser } from '../../auth/types/auth.types.js';
import type { AuditAction } from '../constants/audit-actions.constants.js';

// Orígenes soportados para el ID de la entidad en una operación exitosa:
// - 'response.id': la respuesta es la entidad (ej. usuario creado).
// - 'response.user.id': la entidad viene anidada en la respuesta (ej. login).
// - 'params.id': el ID viaja en la ruta (ej. PATCH /users/:id/deactivate).
export type AuditEntityIdSource =
  'response.id' | 'response.user.id' | 'params.id';

// Metadatos que @Audited() declara en un endpoint crítico (SPRINT-1-T13).
export interface AuditedOptions {
  /** Acción a registrar cuando la operación tiene éxito. */
  action: AuditAction;
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
   * Si se define, los rechazos cuyo estado HTTP esté en failureStatuses
   * también se auditan, con esta acción (ej. login fallido).
   */
  failureAction?: AuditAction;
  /** Estados HTTP de error que se auditan con failureAction (defecto [401]). */
  failureStatuses?: number[];
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
