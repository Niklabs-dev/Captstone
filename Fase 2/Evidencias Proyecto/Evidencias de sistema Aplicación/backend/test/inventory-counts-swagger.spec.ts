import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

interface SchemaObject {
  required?: string[];
  properties: Record<
    string,
    { type?: string; enum?: unknown[]; description?: string }
  >;
}

// Contrato OpenAPI de la toma de inventario (SPRINT-5-T05), su finalización
// (SPRINT-5-T06) y su descarga en Excel (SPRINT-5-T08): JWT, resumen en español con los roles, respuestas de error
// y DTOs tipados.
describe('Swagger de la toma de inventario (SPRINT-5-T05)', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      'postgresql://postgres:postgres@localhost:5433/sin-conexion';
    process.env.JWT_SECRET ??= 'secreto-de-pruebas';
    process.env.JWT_EXPIRES_IN ??= '1h';
    process.env.JWT_REFRESH_EXPIRES_IN ??= '7d';
    process.env.DOCUMENTS_STORAGE_PATH ??= './storage/test-documents';
    process.env.DOCUMENTS_MAX_SIZE_MB ??= '1';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    document = createSwaggerDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  function operation(method: 'get' | 'put' | 'post', path: string): Operation {
    const found = document.paths[path]?.[method];
    if (!found) throw new Error(`Falta ${method.toUpperCase()} ${path}`);
    return found;
  }

  function schema(name: string): SchemaObject {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`Falta el esquema ${name}`);
    return found as SchemaObject;
  }

  it.each([
    {
      method: 'post' as const,
      path: '/inventory-counts',
      roles: 'SUPERVISOR',
      statuses: ['201', '400', '401', '403', '409'],
    },
    {
      method: 'get' as const,
      path: '/inventory-counts',
      roles: 'ADMINISTRADOR',
      statuses: ['200', '400', '401', '403'],
    },
    {
      method: 'get' as const,
      path: '/inventory-counts/{id}',
      roles: 'ADMINISTRADOR',
      statuses: ['200', '400', '401', '403', '404'],
    },
    {
      method: 'put' as const,
      path: '/inventory-counts/{id}/lines/{productId}',
      roles: 'SUPERVISOR',
      statuses: ['200', '400', '401', '403', '404', '409'],
    },
    {
      method: 'post' as const,
      path: '/inventory-counts/{id}/finalize',
      roles: 'SUPERVISOR',
      statuses: ['200', '400', '401', '403', '404', '409'],
    },
    {
      method: 'get' as const,
      path: '/inventory-counts/{id}/export',
      roles: 'ADMINISTRADOR',
      statuses: ['200', '400', '401', '403', '404', '409'],
    },
  ])(
    '$method $path documenta JWT, roles y respuestas',
    ({ method, path, roles, statuses }) => {
      const op = operation(method, path);
      expect(op.tags).toContain('inventory-counts');
      expect(op.summary).toEqual(expect.any(String));
      expect(op.description).toContain(roles);
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
    },
  );

  it('la finalización responde la toma con lo contado y lo no contado, y queda auditada', () => {
    const op = operation('post', '/inventory-counts/{id}/finalize');
    expect(op.summary).toBe(
      'Finaliza la toma de inventario y bloquea sus cambios',
    );
    expect(op.description).toContain('INVENTORY_COUNT_FINALIZED');
    const ok = op.responses['200'] as {
      content: Record<string, { schema: { $ref: string } }>;
    };
    expect(ok.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/InventoryCountFinalizationDto',
    );
    const finalization = schema('InventoryCountFinalizationDto');
    expect(Object.keys(finalization.properties)).toEqual(
      expect.arrayContaining([
        'status',
        'finalizedAt',
        'finalizedBy',
        'countedProducts',
        'uncountedProducts',
        'totalProducts',
      ]),
    );
  });

  it('la descarga en Excel devuelve un .xlsx con su nombre y queda auditada (SPRINT-5-T08)', () => {
    const op = operation('get', '/inventory-counts/{id}/export');
    expect(op.summary).toBe(
      'Descarga en Excel una toma de inventario finalizada',
    );
    expect(op.description).toMatch(/^Rol: ADMINISTRADOR /);
    expect(op.description).not.toContain('SUPERVISOR');
    expect(op.description).toContain('una sola hoja');
    expect(op.description).toContain('INVENTORY_COUNT_EXPORTED');
    const ok = op.responses['200'] as {
      content: Record<string, { schema: { type: string; format: string } }>;
      headers: Record<string, unknown>;
    };
    expect(
      ok.content[
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ].schema,
    ).toEqual({ type: 'string', format: 'binary' });
    expect(Object.keys(ok.headers)).toEqual(
      expect.arrayContaining(['Content-Disposition', 'Cache-Control']),
    );
  });

  it('el 409 del inicio indica la toma en curso', () => {
    expect(Object.keys(schema('InventoryCountConflictDto').properties)).toEqual(
      expect.arrayContaining([
        'existingCountId',
        'existingCountDate',
        'errors',
      ]),
    );
  });

  it('los DTOs describen cada campo y la línea expone el total y la copia del producto', () => {
    const line = schema('InventoryCountLineDto');
    expect(Object.keys(line.properties)).toEqual(
      expect.arrayContaining([
        'boxes',
        'packages',
        'looseQuantity',
        'countedQuantity',
        'productSku',
        'productName',
        'unit',
        'boxContent',
        'packageContent',
        'savedAt',
        'savedBy',
      ]),
    );
    for (const name of [
      'InventoryCountSummaryDto',
      'InventoryCountDetailDto',
      'InventoryCountFinalizationDto',
      'InventoryCountItemDto',
      'InventoryCountLineDto',
      'SaveInventoryCountLineDto',
      'StartInventoryCountDto',
    ]) {
      for (const [field, property] of Object.entries(schema(name).properties)) {
        if ('$ref' in property || 'allOf' in property) continue;
        expect(property.description, `${name}.${field}`).toEqual(
          expect.any(String),
        );
      }
    }
    expect(
      Object.keys(schema('SaveInventoryCountLineDto').properties).sort(),
    ).toEqual(['boxes', 'looseQuantity', 'packages']);
  });
});
