import {
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  catchError,
  concatMap,
  from,
  mergeMap,
  throwError,
  type Observable,
} from 'rxjs';
import type { AuthUser } from '../auth/types/auth.types.js';
import { AuditService } from './audit.service.js';
import { AUDITED_KEY } from './decorators/audited.decorator.js';
import type { AuditedOptions, AuditRequestInfo } from './types/audit.types.js';
import {
  buildAuditEvent,
  buildFailureAuditEvent,
} from './utils/audit-extract.util.js';

// Interceptor global que registra en audit_logs las operaciones críticas
// marcadas con @Audited() (SPRINT-1-T13). Escribe el evento tras una
// respuesta exitosa y, si el endpoint declaró failureAction, también los
// rechazos cuyo estado HTTP esté en failureStatuses (por defecto solo 401:
// un 400 de validación no es un intento de operación).
@Injectable()
export class AuditInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const options = this.reflector.get<AuditedOptions | undefined>(
      AUDITED_KEY,
      context.getHandler(),
    );
    if (!options) return next.handle();

    const info = this.requestInfo(context);
    return next.handle().pipe(
      concatMap(async (response: unknown) => {
        await this.auditService.record(
          buildAuditEvent(options, info, response),
        );
        return response;
      }),
      catchError((error: unknown) => {
        const failureAction = this.failureActionFor(options, error);
        if (failureAction === null) return throwError(() => error);
        return from(
          this.auditService.record(
            buildFailureAuditEvent(options, failureAction, info),
          ),
        ).pipe(mergeMap(() => throwError(() => error)));
      }),
    );
  }

  private requestInfo(context: ExecutionContext): AuditRequestInfo {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    return {
      user: request.user,
      params: request.params,
      body: request.body as unknown,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  private failureActionFor(
    options: AuditedOptions,
    error: unknown,
  ): string | null {
    if (!options.failureAction || !(error instanceof HttpException)) {
      return null;
    }
    const statuses = options.failureStatuses ?? [401];
    return statuses.includes(error.getStatus()) ? options.failureAction : null;
  }
}
