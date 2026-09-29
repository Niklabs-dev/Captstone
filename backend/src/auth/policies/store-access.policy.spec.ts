import { ROLE } from '../constants/roles.constants.js';
import type { AuthUser } from '../types/auth.types.js';
import {
  canAccessStore,
  hasAnyRole,
  isGlobalRole,
} from './store-access.policy.js';

const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';

function user(role: string, storeId: string | null): AuthUser {
  return { id: 'u1', email: 'u@moi-food.cl', role, storeId };
}

describe('store-access.policy', () => {
  it('considera globales solo a ADMINISTRADOR y CONTADOR', () => {
    expect(isGlobalRole(ROLE.ADMINISTRADOR)).toBe(true);
    expect(isGlobalRole(ROLE.CONTADOR)).toBe(true);
    expect(isGlobalRole(ROLE.SUPERVISOR)).toBe(false);
    expect(isGlobalRole(ROLE.TRABAJADOR)).toBe(false);
    expect(isGlobalRole('DESCONOCIDO')).toBe(false);
  });

  it('valida el rol contra la lista de roles permitidos', () => {
    const supervisor = user(ROLE.SUPERVISOR, STORE_A);
    expect(hasAnyRole(supervisor, [ROLE.ADMINISTRADOR, ROLE.SUPERVISOR])).toBe(
      true,
    );
    expect(hasAnyRole(supervisor, [ROLE.ADMINISTRADOR])).toBe(false);
    expect(hasAnyRole(supervisor, [])).toBe(false);
  });

  it('permite a los roles globales acceder a cualquier local', () => {
    expect(canAccessStore(user(ROLE.ADMINISTRADOR, null), STORE_A)).toBe(true);
    expect(canAccessStore(user(ROLE.CONTADOR, null), STORE_B)).toBe(true);
  });

  it('limita a los roles de local a su local asignado', () => {
    expect(canAccessStore(user(ROLE.SUPERVISOR, STORE_A), STORE_A)).toBe(true);
    expect(canAccessStore(user(ROLE.SUPERVISOR, STORE_A), STORE_B)).toBe(false);
    expect(canAccessStore(user(ROLE.TRABAJADOR, STORE_B), STORE_A)).toBe(false);
  });

  it('niega el acceso a un usuario no global sin local asignado', () => {
    expect(canAccessStore(user(ROLE.TRABAJADOR, null), STORE_A)).toBe(false);
  });
});
