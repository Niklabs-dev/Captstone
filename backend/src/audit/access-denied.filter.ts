import { Catch, ForbiddenException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../auth/types/auth.types.js';
import { AuditService } from './audit.service.js';
import {
  buildAccessDeniedEvent,
  type AccessDeniedRequestInfo,
} from './utils/access-denied.util.js';

type DeniedRequest = Request & { user?: AuthUser };

function messageOf(exception: ForbiddenException): unknown {
  const body = exception.getResponse();
  return typeof body === 'object' && body !== null && 'message' in body
    ? body.message
    : body;
}

// Plantilla de la ruta resuelta por Express (ej. /daily-operations/:id). Se
// evita originalUrl a propósito: la consulta puede traer correos o RUT.
function routeOf(request: DeniedRequest): string | null {
  const route: unknown = request.route;
  if (typeof route !== 'object' || route === null || !('path' in route)) {
    return null;
  }
  const path = route.path;
  return typeof path === 'string' ? `${request.baseUrl}${path}` : null;
}

// Filtro global de accesos denegados (SPRINT-4R-T15). Los guards de rol y de
// local corren antes que los interceptores, así que el AuditInterceptor no
// ve sus rechazos; este filtro sí recibe todo ForbiddenException, venga de un
// guard o de un servicio. Registra ACCESS_DENIED y luego responde igual que
// el manejador por defecto de Nest: el cliente recibe el mismo 403.
@Catch(ForbiddenException)
export class AccessDeniedAuditFilter extends BaseExceptionFilter {
  constructor(private readonly auditService: AuditService) {
    super();
  }

  // Nest no espera la promesa de un filtro: la respuesta se envía al terminar
  // de auditar, así el registro ya existe cuando el cliente recibe el 403.
  catch(exception: ForbiddenException, host: ArgumentsHost): void {
    void this.auditAndRespond(exception, host);
  }

  private async auditAndRespond(
    exception: ForbiddenException,
    host: ArgumentsHost,
  ): Promise<void> {
    if (host.getType() === 'http') {
      const request = host.switchToHttp().getRequest<DeniedRequest>();
      const query = request.query as Record<string, unknown> | undefined;
      const info: AccessDeniedRequestInfo = {
        user: request.user,
        method: request.method,
        route: routeOf(request),
        params: request.params,
        queryStoreId: query?.storeId,
        message: messageOf(exception),
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      };
      const event = buildAccessDeniedEvent(info);
      // AuditService.record no lanza: si la base falla, lo registra en el log
      // y el cliente igual recibe su 403.
      if (event) await this.auditService.record(event);
    }
    super.catch(exception, host);
  }
}
