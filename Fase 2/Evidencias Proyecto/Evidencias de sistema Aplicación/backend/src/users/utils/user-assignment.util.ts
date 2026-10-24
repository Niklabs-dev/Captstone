import { BadRequestException } from '@nestjs/common';
import { isGlobalRole } from '../../auth/policies/store-access.policy.js';

// Calcula el local final de un usuario al editar su asignación (SPRINT-3-T03)
// y valida su compatibilidad con el rol final, con las mismas reglas del alta:
// - si la solicitud trae storeId (o null para quitarlo), se usa ese;
// - si no lo trae y el rol final es global, el local queda en null;
// - si no lo trae y el rol final es de local, se conserva el actual.
// Los roles globales no admiten local y los de local lo exigen.
export function resolveFinalStoreId(
  finalRoleCode: string,
  currentStoreId: string | null,
  requestedStoreId: string | null | undefined,
): string | null {
  const global = isGlobalRole(finalRoleCode);
  const storeId =
    requestedStoreId !== undefined
      ? requestedStoreId
      : global
        ? null
        : currentStoreId;

  if (global && storeId !== null) {
    throw new BadRequestException(
      `El rol ${finalRoleCode} es global y no admite local asignado`,
    );
  }
  if (!global && storeId === null) {
    throw new BadRequestException(
      `El rol ${finalRoleCode} requiere un local asignado`,
    );
  }
  return storeId;
}
