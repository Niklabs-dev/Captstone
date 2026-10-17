import { ROLE } from '../../auth/constants/roles.constants.js';
import {
  canAccessStore,
  hasAnyRole,
} from '../../auth/policies/store-access.policy.js';
import type { AuthUser } from '../../auth/types/auth.types.js';

// Datos del documento que decide el acceso.
export interface DocumentAccessTarget {
  storeId: string;
  subjectUserId: string | null;
}

// Regla de lectura de documentos laborales (SPRINT-2-T06):
// - El titular siempre ve los suyos, aunque haya cambiado de local (derecho
//   de acceso de la Ley N°21.719).
// - Los ajenos solo el administrador, sujeto a la regla de acceso por local
//   (es un rol global). Supervisores y contador no ven documentos laborales
//   de otros: contienen datos sensibles (remuneración, causal de término).
export function canReadDocument(
  user: AuthUser,
  document: DocumentAccessTarget,
): boolean {
  if (document.subjectUserId !== null && document.subjectUserId === user.id) {
    return true;
  }
  return (
    hasAnyRole(user, [ROLE.ADMINISTRADOR]) &&
    canAccessStore(user, document.storeId)
  );
}

// Indica si el usuario puede consultar documentos de otros trabajadores.
export function canReadOthersDocuments(user: AuthUser): boolean {
  return hasAnyRole(user, [ROLE.ADMINISTRADOR]);
}
