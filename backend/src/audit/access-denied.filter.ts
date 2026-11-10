import {
  Catch,
  ForbiddenException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
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
// guard o de un servicio. Responde igual que el manejador por defecto de Nest
// y registra ACCESS_DENIED sin hacer esperar al cliente.
@Catch(ForbiddenException)
export class AccessDeniedAuditFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(AccessDeniedAuditFilter.name);

  constructor(private readonly auditService: AuditService) {
    super();
  }

  catch(exception: ForbiddenException, host: ArgumentsHost): void {
    // El evento se arma antes de responder, con la solicitud aún intacta.
    const event =
      host.getType() === 'http' ? this.eventOf(exception, host) : null;
    super.catch(exception, host);
    if (!event) return;
    this.auditService.record(event).catch((error: unknown) => {
      this.logger.error(
        'No se pudo auditar un acceso denegado',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  private eventOf(
    exception: ForbiddenException,
    host: ArgumentsHost,
  ): ReturnType<typeof buildAccessDeniedEvent> {
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
    return buildAccessDeniedEvent(info);
  }
}
