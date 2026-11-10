import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

interface Schema {
  properties: Record<
    string,
    {
      description?: string;
      example?: unknown;
      enum?: unknown;
      $ref?: string;
      allOf?: unknown;
    }
  >;
}

// Contrato OpenAPI de la consulta de propinas diarias (SPRINT-4A-T04): JWT,
// resumen en español, errores completos y DTO de respuesta tipados con
// description y example en cada campo.
describe('Swagger de la consulta de propinas diarias (SPRINT-4A-T04)', () => {
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

  function operation(path: string): Operation {
    const found = document.paths[path]?.get;
    if (!found) throw new Error(`Falta GET ${path}`);
    return found;
  }

  function schema(name: string): Schema {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`Falta el esquema ${name}`);
    return found as Schema;
  }

  it.each([
    { path: '/daily-tips/days', dto: 'DailyTipDaysResponseDto' },
    { path: '/daily-tips/day', dto: 'DailyTipDayDetailResponseDto' },
    { path: '/daily-tips/summary', dto: 'DailyTipSummaryResponseDto' },
  ])('GET $path documenta JWT, resumen, errores y DTO', ({ path, dto }) => {
    const op = operation(path);
    expect(op.tags).toContain('daily-tips');
    expect(op.summary).toEqual(expect.any(String));
    expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
    expect(Object.keys(op.responses).sort()).toEqual(
      ['200', '400', '401', '403', '404'].sort(),
    );
    expect(op.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${dto}` },
        },
      },
    });
  });

  it('documenta los filtros: local, rango y estado', () => {
    const names = (path: string): string[] =>
      (operation(path).parameters ?? []).map((parameter) =>
        'name' in parameter ? parameter.name : '',
      );
    expect(names('/daily-tips/days').sort()).toEqual(
      ['from', 'storeId', 'to'].sort(),
    );
    expect(names('/daily-tips/summary').sort()).toEqual(
      ['from', 'status', 'storeId', 'to'].sort(),
    );
    expect(names('/daily-tips/day').sort()).toEqual(
      ['businessDate', 'storeId'].sort(),
    );
  });

  it('cada campo escalar de los DTO tiene description y example', () => {
    for (const name of [
      'DailyTipDaySummaryDto',
      'DailyTipAllocationDetailDto',
      'DailyTipWorkerSummaryDto',
      'DailyTipSummaryTotalsDto',
      'DailyTipDaysTotalsDto',
      'DailyTipPersonDto',
      'DailyTipStoreDto',
    ]) {
      for (const [field, property] of Object.entries(schema(name).properties)) {
        if (property.$ref || property.allOf) continue;
        expect(property.description, `${name}.${field}`).toEqual(
          expect.any(String),
        );
        expect('example' in property, `${name}.${field}`).toBe(true);
      }
    }
    expect(schema('DailyTipDaySummaryDto').properties.status.enum).toEqual([
      'UNPAID',
      'PARTIAL',
      'PAID',
    ]);
    // Las personas solo exponen id y nombre (Ley N°21.719).
    expect(Object.keys(schema('DailyTipPersonDto').properties).sort()).toEqual([
      'id',
      'name',
    ]);
  });
});
