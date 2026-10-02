import { AUDIT_ACTION } from '../constants/audit-actions.constants.js';
import type { AuditedOptions, AuditRequestInfo } from '../types/audit.types.js';
import {
  buildAuditEvent,
  buildFailureAuditEvent,
  resolveActor,
  resolveDetail,
  resolveEntityId,
} from './audit-extract.util.js';

// Tests unitarios del armado del evento de auditoría (SPRINT-1-T13).

const LOGIN_OPTIONS: AuditedOptions = {
  action: AUDIT_ACTION.USER_LOGIN,
  entityType: 'auth',
  entityIdFrom: 'response.user.id',
  detailFromBody: ['email'],
  failureAction: AUDIT_ACTION.USER_LOGIN_FAILED,
};

const CREATE_USER_OPTIONS: AuditedOptions = {
  action: AUDIT_ACTION.USER_CREATED,
  entityType: 'users',
  entityIdFrom: 'response.id',
  detailFromBody: ['email', 'roleCode'],
};

function info(overrides: Partial<AuditRequestInfo> = {}): AuditRequestInfo {
  return {
    params: {},
    body: {},
    ip: '192.168.1.10',
    userAgent: 'agente-de-prueba',
    ...overrides,
  };
}

describe('resolveEntityId', () => {
  it('toma el ID de la respuesta cuando entityIdFrom es response.id', () => {
    const entityId = resolveEntityId(CREATE_USER_OPTIONS, info(), {
      id: 'user-1',
      email: 'a@moi-food.cl',
    });
    expect(entityId).toBe('user-1');
  });

  it('toma el ID anidado cuando entityIdFrom es response.user.id', () => {
    const entityId = resolveEntityId(LOGIN_OPTIONS, info(), {
      accessToken: 'token',
      user: { id: 'user-2', storeId: 'store-1' },
    });
    expect(entityId).toBe('user-2');
  });

  it('toma el ID de la ruta cuando entityIdFrom es params.id', () => {
    const entityId = resolveEntityId(
      {
        action: AUDIT_ACTION.USER_DEACTIVATED,
        entityType: 'users',
        entityIdFrom: 'params.id',
      },
      info({ params: { id: 'user-3' } }),
      { id: 'ignorado' },
    );
    expect(entityId).toBe('user-3');
  });

  it('devuelve null si no se declaró origen o el campo no es un string', () => {
    expect(resolveEntityId(CREATE_USER_OPTIONS, info(), { id: 42 })).toBeNull();
    expect(
      resolveEntityId(
        { action: AUDIT_ACTION.USER_CREATED, entityType: 'users' },
        info(),
        { id: 'user-1' },
      ),
    ).toBeNull();
  });
});

describe('resolveActor', () => {
  it('prefiere al usuario autenticado como responsable', () => {
    const actor = resolveActor(
      info({
        user: {
          id: 'admin-1',
          email: 'admin@moi-food.cl',
          role: 'ADMINISTRADOR',
          storeId: null,
        },
      }),
      { id: 'user-1', store: { id: 'store-9' } },
    );
    expect(actor.userId).toBe('admin-1');
  });

  it('toma el usuario de la respuesta en endpoints públicos (login)', () => {
    const actor = resolveActor(info(), {
      user: { id: 'user-2', storeId: 'store-1' },
    });
    expect(actor).toEqual({ userId: 'user-2', storeId: 'store-1' });
  });

  it('prefiere el local de la entidad afectada sobre el del actor', () => {
    // Un administrador global (sin local) crea un trabajador con local:
    // la auditoría debe quedar asociada al local del trabajador.
    const actor = resolveActor(
      info({
        user: {
          id: 'admin-1',
          email: 'admin@moi-food.cl',
          role: 'ADMINISTRADOR',
          storeId: null,
        },
      }),
      { id: 'user-1', store: { id: 'store-9' } },
    );
    expect(actor.storeId).toBe('store-9');
  });

  it('usa el local del actor cuando la respuesta no trae local', () => {
    const actor = resolveActor(
      info({
        user: {
          id: 'sup-1',
          email: 'sup@moi-food.cl',
          role: 'SUPERVISOR',
          storeId: 'store-2',
        },
      }),
      { ok: true },
    );
    expect(actor.storeId).toBe('store-2');
  });

  it('devuelve nulls cuando no hay actor identificable', () => {
    expect(resolveActor(info(), 'texto')).toEqual({
      userId: null,
      storeId: null,
    });
  });
});

describe('resolveDetail', () => {
  it('copia solo los campos declarados, nunca la contraseña', () => {
    const detail = resolveDetail(CREATE_USER_OPTIONS, {
      ...info(),
      body: {
        email: 'nuevo@moi-food.cl',
        roleCode: 'TRABAJADOR',
        password: 'secreta-123',
      },
    });
    expect(detail).toEqual({
      email: 'nuevo@moi-food.cl',
      roleCode: 'TRABAJADOR',
    });
    expect(detail).not.toHaveProperty('password');
  });

  it('devuelve null sin campos declarados o sin cuerpo', () => {
    expect(
      resolveDetail(
        { action: AUDIT_ACTION.USER_DEACTIVATED, entityType: 'users' },
        info({ body: { email: 'a@moi-food.cl' } }),
      ),
    ).toBeNull();
    expect(resolveDetail(LOGIN_OPTIONS, info({ body: null }))).toBeNull();
    expect(resolveDetail(LOGIN_OPTIONS, info({ body: {} }))).toBeNull();
  });
});

describe('buildAuditEvent', () => {
  it('arma el evento completo de una operación exitosa', () => {
    const event = buildAuditEvent(
      CREATE_USER_OPTIONS,
      info({
        user: {
          id: 'admin-1',
          email: 'admin@moi-food.cl',
          role: 'ADMINISTRADOR',
          storeId: null,
        },
        body: {
          email: 'nuevo@moi-food.cl',
          roleCode: 'TRABAJADOR',
          password: 'secreta-123',
        },
      }),
      { id: 'user-1', store: { id: 'store-9' } },
    );
    expect(event).toEqual({
      action: 'USER_CREATED',
      entityType: 'users',
      entityId: 'user-1',
      detail: { email: 'nuevo@moi-food.cl', roleCode: 'TRABAJADOR' },
      userId: 'admin-1',
      storeId: 'store-9',
      ipAddress: '192.168.1.10',
      userAgent: 'agente-de-prueba',
    });
  });

  it('deja ip y userAgent en null cuando la solicitud no los trae', () => {
    const event = buildAuditEvent(
      LOGIN_OPTIONS,
      { params: {}, body: {} },
      {
        user: { id: 'user-2', storeId: null },
      },
    );
    expect(event.ipAddress).toBeNull();
    expect(event.userAgent).toBeNull();
  });
});

describe('buildFailureAuditEvent', () => {
  it('arma el evento de rechazo sin entidad ni actor identificado', () => {
    const event = buildFailureAuditEvent(
      LOGIN_OPTIONS,
      AUDIT_ACTION.USER_LOGIN_FAILED,
      info({ body: { email: 'intruso@moi-food.cl', password: 'x' } }),
    );
    expect(event).toEqual({
      action: 'USER_LOGIN_FAILED',
      entityType: 'auth',
      entityId: null,
      detail: { email: 'intruso@moi-food.cl' },
      userId: null,
      storeId: null,
      ipAddress: '192.168.1.10',
      userAgent: 'agente-de-prueba',
    });
  });
});
