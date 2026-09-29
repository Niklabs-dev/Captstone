import { GLOBAL_ROLES, type RoleCode } from '../constants/roles.constants.js';
import type { AuthUser } from '../types/auth.types.js';

// Indica si el rol del usuario es global (acceso a todos los locales).
export function isGlobalRole(role: string): boolean {
  return (GLOBAL_ROLES as readonly string[]).includes(role);
}

// Indica si el rol del usuario está entre los permitidos.
export function hasAnyRole(
  user: AuthUser,
  allowedRoles: readonly RoleCode[],
): boolean {
  return (allowedRoles as readonly string[]).includes(user.role);
}

// Regla de acceso por local: los roles globales acceden a cualquier local;
// el resto solo a su local asignado. Un usuario no global sin local asignado
// no accede a ninguno. Los servicios la reutilizan para filtrar consultas.
export function canAccessStore(user: AuthUser, storeId: string): boolean {
  if (isGlobalRole(user.role)) return true;
  return user.storeId !== null && user.storeId === storeId;
}
