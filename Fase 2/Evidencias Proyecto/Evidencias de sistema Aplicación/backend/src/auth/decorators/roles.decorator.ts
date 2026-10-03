import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import type { RoleCode } from '../constants/roles.constants.js';

// Restringe un endpoint (o un controller completo) a los roles indicados.
// El RolesGuard global responde 403 si el rol del usuario no está en la lista.
// Documenta además la respuesta 403 en Swagger.
export const ROLES_KEY = 'roles';
export const Roles = (
  ...roles: RoleCode[]
): ReturnType<typeof applyDecorators> =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    ApiForbiddenResponse({
      description: `Requiere uno de los roles: ${roles.join(', ')}.`,
    }),
  );
