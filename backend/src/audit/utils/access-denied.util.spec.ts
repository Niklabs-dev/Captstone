import {
  ROLE_FORBIDDEN_MESSAGE,
  STORE_FORBIDDEN_MESSAGE,
} from '../../auth/constants/forbidden-messages.constants.js';
import { ROLE } from '../../auth/constants/roles.constants.js';
import { AUDIT_ACTION } from '../constants/audit-actions.constants.js';
import {
  accessDeniedReason,
  buildAccessDeniedEvent,
  type AccessDeniedRequestInfo,
} from './access-denied.util.js';

const USER_ID = '0b9f8c1e-3f4a-4c2b-9d6e-1a2b3c4d5e6f';
const OWN_STORE = '11111111-1111-4111-8111-111111111111';
const OTHER_STORE = '22222222-2222-4222-8222-222222222222';
const ENTITY_ID = '33333333-3333-4333-8333-333333333333';

function info(
  overrides: Partial<AccessDeniedRequestInfo> = {},
): AccessDeniedRequestInfo {
  return {
    user: {
      id: USER_ID,
      email: 'supervisor@moi-food.cl',
      role: ROLE.SUPERVISOR,
      storeId: OWN_STORE,
    },
    method: 'GET',
    route: '/sales-dashboard',
    params: {},
    queryStoreId: undefined,
    message: ROLE_FORBIDDEN_MESSAGE,
    ip: '10.0.0.1',
    userAgent: 'vitest',
    ...overrides,
  };
}

describe('accessDeniedReason (SPRINT-4R-T15)', () => {
  it('clasifica el rechazo por rol, por local o por recurso', () => {
    expect(accessDeniedReason(ROLE_FORBIDDEN_MESSAGE)).toBe('ROLE');
    expect(accessDeniedReason(STORE_FORBIDDEN_MESSAGE)).toBe('STORE');
    expect(accessDeniedReason('No tienes acceso a este documento')).toBe(
      'RESOURCE',
    );
    expect(accessDeniedReason(undefined)).toBe('RESOURCE');
  });
});

describe('buildAccessDeniedEvent (SPRINT-4R-T15)', () => {
  it('registra quién, qué ruta y por qué, con el local del usuario', () => {
    expect(buildAccessDeniedEvent(info())).toEqual({
      action: AUDIT_ACTION.ACCESS_DENIED,
      entityType: 'sales-dashboard',
      entityId: null,
      detail: {
        method: 'GET',
        route: '/sales-dashboard',
        role: ROLE.SUPERVISOR,
        reason: 'ROLE',
      },
      userId: USER_ID,
      storeId: OWN_STORE,
      ipAddress: '10.0.0.1',
      userAgent: 'vitest',
    });
  });

  it('no guarda correo, mensaje ni datos fuera de la lista blanca', () => {
    const event = buildAccessDeniedEvent(
      info({ message: 'Mensaje con correo persona@moi-food.cl' }),
    );
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('@moi-food.cl');
    expect(serialized).not.toContain('Mensaje');
    expect(Object.keys(event?.detail ?? {}).sort()).toEqual([
      'method',
      'reason',
      'role',
      'route',
    ]);
  });

  it('agrega el local pedido y la entidad solo cuando son UUID', () => {
    const event = buildAccessDeniedEvent(
      info({
        route: '/daily-operations/:id',
        params: { id: ENTITY_ID },
        queryStoreId: OTHER_STORE,
        message: STORE_FORBIDDEN_MESSAGE,
      }),
    );
    expect(event?.entityType).toBe('daily-operations');
    expect(event?.entityId).toBe(ENTITY_ID);
    expect(event?.storeId).toBe(OWN_STORE);
    expect(event?.detail).toMatchObject({
      reason: 'STORE',
      requestedStoreId: OTHER_STORE,
    });

    const malformed = buildAccessDeniedEvent(
      info({
        params: { id: 'persona@moi-food.cl', storeId: '12.345.678-9' },
        queryStoreId: ['a', 'b'],
      }),
    );
    expect(malformed?.entityId).toBeNull();
    expect(malformed?.detail).not.toHaveProperty('requestedStoreId');
  });

  it('prefiere el local de la ruta sobre el de la consulta', () => {
    const event = buildAccessDeniedEvent(
      info({ params: { storeId: OTHER_STORE }, queryStoreId: OWN_STORE }),
    );
    expect(event?.detail).toMatchObject({ requestedStoreId: OTHER_STORE });
  });

  it('usa unknown si Express no resolvió la ruta y recorta el user agent', () => {
    const event = buildAccessDeniedEvent(
      info({ route: null, userAgent: 'x'.repeat(400) }),
    );
    expect(event?.entityType).toBe('unknown');
    expect(event?.userAgent).toHaveLength(255);
  });

  it('no audita sin usuario autenticado (eso es un 401)', () => {
    expect(buildAccessDeniedEvent(info({ user: undefined }))).toBeNull();
  });
});
