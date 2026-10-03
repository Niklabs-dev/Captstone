import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import {
  STORE_SCOPE_KEY,
  type StoreScopeMetadata,
} from '../decorators/store-scoped.decorator.js';
import { canAccessStore } from '../policies/store-access.policy.js';
import type { AuthUser } from '../types/auth.types.js';

interface StoreScopedRequest {
  user?: AuthUser;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

// Guard global de autorización por local: se ejecuta después del RolesGuard.
// Solo actúa en endpoints con @StoreScoped(): lee el ID del local de la
// solicitud y responde 403 si el usuario no tiene acceso a ese local.
@Injectable()
export class StoreAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const scope = this.reflector.getAllAndOverride<
      StoreScopeMetadata | undefined
    >(STORE_SCOPE_KEY, targets);
    if (!scope) return true;

    const request = context.switchToHttp().getRequest<StoreScopedRequest>();
    const storeId = this.readStoreId(request, scope);
    if (storeId === null) {
      throw new BadRequestException(
        `Falta el identificador del local (${scope.field})`,
      );
    }
    if (!request.user || !canAccessStore(request.user, storeId)) {
      throw new ForbiddenException('No tienes acceso a este local');
    }
    return true;
  }

  private readStoreId(
    request: StoreScopedRequest,
    scope: StoreScopeMetadata,
  ): string | null {
    const container = request[scope.source];
    if (typeof container !== 'object' || container === null) return null;
    const value: unknown = (container as Record<string, unknown>)[scope.field];
    // Solo se acepta un valor único no vacío (ej. se descarta ?storeId=a&storeId=b).
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
