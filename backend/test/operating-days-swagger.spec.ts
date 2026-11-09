import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

interface SchemaObject {
  required?: string[];
  properties: Record<string, { type?: string; enum?: unknown[] }>;
}

// Contrato OpenAPI del calendario de operación y del estado diario de ventas
// (SPRINT-4R-T12): JWT, resumen en español, respuestas completas y DTOs
// tipados.
describe('Swagger del calendario de operación (SPRINT-4R-T12)', () => {
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

  function operation(
    method: 'get' | 'put' | 'post' | 'delete',
    path: string,
  ): Operation {
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
      method: 'get' as const,
      path: '/stores/{storeId}/operating-calendar',
      tag: 'operating-calendar',
      statuses: ['200', '400', '401', '403', '404'],
    },
    {
      method: 'put' as const,
      path: '/stores/{storeId}/operating-calendar',
      tag: 'operating-calendar',
      statuses: ['200', '400', '401', '403', '404'],
    },
    {
      method: 'post' as const,
      path: '/stores/{storeId}/closures',
      tag: 'operating-calendar',
      statuses: ['201', '400', '401', '403', '404', '409'],
    },
    {
      method: 'delete' as const,
      path: '/stores/{storeId}/closures/{closureId}',
      tag: 'operating-calendar',
      statuses: ['200', '400', '401', '403', '404'],
    },
    {
      method: 'get' as const,
      path: '/sales-days',
      tag: 'sales-days',
      statuses: ['200', '400', '401', '403', '404'],
    },
  ])(
    '$method $path documenta JWT, resumen y respuestas',
    ({ method, path, tag, statuses }) => {
      const op = operation(method, path);
      expect(op.tags).toContain(tag);
      expect(op.summary).toEqual(expect.any(String));
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
    },
  );

  it('el calendario exige días y fecha de inicio', () => {
    const update = schema('UpdateOperatingCalendarDto');
    expect(update.required).toEqual(
      expect.arrayContaining(['weekdays', 'trackingStartDate']),
    );
    expect(update.properties.weekdays.type).toBe('array');
  });

  it('el cierre exige fecha y motivo', () => {
    expect(schema('CreateStoreClosureDto').required).toEqual(
      expect.arrayContaining(['date', 'reason']),
    );
  });

  it('el estado diario documenta los cuatro estados', () => {
    expect(schema('SalesDayDto').properties.status.enum).toEqual([
      'IMPORTADO',
      'PENDIENTE',
      'ATRASADO',
      'CERRADO',
    ]);
    expect(
      Object.keys(schema('SalesDaysSummaryDto').properties).sort(),
    ).toEqual(['ATRASADO', 'CERRADO', 'IMPORTADO', 'PENDIENTE']);
  });
});
