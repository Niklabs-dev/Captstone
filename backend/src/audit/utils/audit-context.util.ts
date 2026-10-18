import type { Response } from 'express';
import type { AuditContext } from '../types/audit.types.js';

// Contexto de auditoría fijado por un endpoint durante la solicitud
// (SPRINT-2-T09). Se guarda en res.locals, que Express reserva para datos de
// la solicitud en curso, y el AuditInterceptor lo lee al registrar el evento.
const AUDIT_CONTEXT_KEY = 'auditContext';

// Aporta datos al evento que la respuesta no trae (ej. el local del
// documento descargado). Nunca debe incluir contenido de archivos.
export function setAuditContext(res: Response, context: AuditContext): void {
  res.locals[AUDIT_CONTEXT_KEY] = context;
}

export function getAuditContext(res: Response): AuditContext | undefined {
  const value: unknown = res.locals[AUDIT_CONTEXT_KEY];
  return typeof value === 'object' && value !== null ? value : undefined;
}
