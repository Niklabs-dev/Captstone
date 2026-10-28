import { AUDIT_ACTION } from '../constants/audit-actions.constants.js';
import type { AuditedOptions, AuditRequestInfo } from '../types/audit.types.js';
import {
  buildAuditEvent,
  buildFailureAuditEvent,
  resolveAction,
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

  it('toma el ID del contexto cuando entityIdFrom es context.entityId', () => {
    const options: AuditedOptions = {
      action: AUDIT_ACTION.TIP_POOL_RECEIPT_DOWNLOADED,
      entityType: 'tip_pool_receipts',
      entityIdFrom: 'context.entityId',
    };
    expect(
      resolveEntityId(
        options,
        info({ context: { entityId: 'receipt-1' } }),
        Buffer.from('%PDF'),
      ),
    ).toBe('receipt-1');
    expect(resolveEntityId(options, info(), undefined)).toBeNull();
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

// Extensiones para el gestor documental (SPRINT-2-T09).
const UPLOAD_OPTIONS: AuditedOptions = {
  action: (requestInfo) =>
    typeof (requestInfo.body as { documentId?: unknown } | null)?.documentId ===
    'string'
      ? AUDIT_ACTION.DOCUMENT_VERSION_ADDED
      : AUDIT_ACTION.DOCUMENT_UPLOADED,
  entityType: 'documents',
  entityIdFrom: 'response.id',
  detailFromBody: ['workerId'],
  detailFromResponse: {
    versionNumber: 'latestVersion.number',
    sha256: 'latestVersion.sha256',
  },
};

const DELETE_OPTIONS: AuditedOptions = {
  action: AUDIT_ACTION.DOCUMENT_DELETED,
  entityType: 'documents',
  entityIdFrom: 'params.id',
  failureAction: AUDIT_ACTION.DOCUMENT_DELETION_BLOCKED,
  failureStatuses: [409],
};

const UPLOADED_DOCUMENT = {
  id: 'doc-1',
  storeId: 'store-3',
  latestVersion: { number: 2, sha256: 'a'.repeat(64) },
};

describe('auditoría del gestor documental (SPRINT-2-T09)', () => {
  it('elige la acción según la solicitud', () => {
    expect(
      resolveAction(UPLOAD_OPTIONS, info({ body: { workerId: 'w-1' } }), {}),
    ).toBe('DOCUMENT_UPLOADED');
    expect(
      resolveAction(
        UPLOAD_OPTIONS,
        info({ body: { documentId: 'doc-1' } }),
        {},
      ),
    ).toBe('DOCUMENT_VERSION_ADDED');
  });

  it('toma el ID de cualquier parámetro de la ruta', () => {
    const entityId = resolveEntityId(
      { ...DELETE_OPTIONS, entityIdFrom: 'params.versionId' },
      info({ params: { versionId: 'version-1' } }),
      undefined,
    );
    expect(entityId).toBe('version-1');
  });

  it('copia de la respuesta solo las rutas declaradas, nunca el resto', () => {
    const detail = resolveDetail(
      UPLOAD_OPTIONS,
      info({ body: { workerId: 'w-1', title: 'Contrato' } }),
      { ...UPLOADED_DOCUMENT, content: 'contenido del archivo' },
    );
    expect(detail).toEqual({
      workerId: 'w-1',
      versionNumber: 2,
      sha256: 'a'.repeat(64),
    });
  });

  it('usa el local del documento de la respuesta o del contexto del endpoint', () => {
    expect(resolveActor(info(), UPLOADED_DOCUMENT).storeId).toBe('store-3');
    expect(
      resolveActor(info({ context: { storeId: 'store-4' } }), undefined)
        .storeId,
    ).toBe('store-4');
  });

  it('agrega al detalle lo que aporta el endpoint (ej. una descarga)', () => {
    const event = buildAuditEvent(
      {
        action: AUDIT_ACTION.DOCUMENT_DOWNLOADED,
        entityType: 'document_versions',
        entityIdFrom: 'params.versionId',
      },
      info({
        params: { versionId: 'version-1' },
        context: {
          storeId: 'store-3',
          detail: { documentId: 'doc-1', integrity: 'VALID' },
        },
      }),
      // La respuesta de una descarga es el archivo: no se copia nada de ella.
      Buffer.from('%PDF-1.7'),
    );
    expect(event).toMatchObject({
      action: 'DOCUMENT_DOWNLOADED',
      entityId: 'version-1',
      storeId: 'store-3',
      detail: { documentId: 'doc-1', integrity: 'VALID' },
    });
  });

  it('identifica la entidad de un rechazo cuando su ID viaja en la ruta', () => {
    const event = buildFailureAuditEvent(
      DELETE_OPTIONS,
      AUDIT_ACTION.DOCUMENT_DELETION_BLOCKED,
      info({
        params: { id: 'doc-1' },
        user: {
          id: 'admin-1',
          email: 'admin@moi-food.cl',
          role: 'ADMINISTRADOR',
          storeId: null,
        },
      }),
    );
    expect(event).toMatchObject({
      action: 'DOCUMENT_DELETION_BLOCKED',
      entityType: 'documents',
      entityId: 'doc-1',
      userId: 'admin-1',
      detail: null,
    });
  });
});
