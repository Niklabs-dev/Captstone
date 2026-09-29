import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleCode } from '../constants/roles.constants.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { hasAnyRole } from '../policies/store-access.policy.js';
import type { AuthUser } from '../types/auth.types.js';

// Guard global de autorización por rol: se ejecuta después del JwtAuthGuard.
// Los endpoints sin @Roles() quedan disponibles para cualquier usuario
// autenticado; con @Roles() solo pasan los roles listados (403 en otro caso).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const roles = this.reflector.getAllAndOverride<RoleCode[] | undefined>(
      ROLES_KEY,
      targets,
    );
    if (!roles || roles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!user || !hasAnyRole(user, roles)) {
      throw new ForbiddenException(
        'No tienes permisos para realizar esta acción',
      );
    }
    return true;
  }
}
