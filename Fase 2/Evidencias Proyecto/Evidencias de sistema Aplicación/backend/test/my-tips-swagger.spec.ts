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
      $ref?: string;
      allOf?: unknown;
      items?: unknown;
    }
  >;
}

// Contrato OpenAPI del portal de propinas del trabajador (SPRINT-4A-T09):
// JWT, resumen en español, errores, DTO tipado con description y example en
// cada campo y ningún parámetro para indicar otro trabajador o local.
describe('Swagger del portal de propinas (SPRINT-4A-T09)', () => {
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

  function operation(): Operation {
    const found = document.paths['/my-tips']?.get;
    if (!found) throw new Error('Falta GET /my-tips');
    return found;
  }

  it('GET /my-tips documenta tag, resumen, JWT, respuestas y DTO', () => {
    const op = operation();
    expect(op.tags).toContain('my-tips');
    expect(op.summary).toEqual(expect.any(String));
    expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
    expect(Object.keys(op.responses).sort()).toEqual(
      ['200', '400', '401', '403'].sort(),
    );
    expect(op.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/MyTipsResponseDto' },
        },
      },
    });
    expect(
      (op.responses['403'] as { description: string }).description,
    ).toContain('TRABAJADOR, SUPERVISOR');
  });

  it('solo admite el rango: nunca userId ni storeId', () => {
    const names = (operation().parameters ?? []).map((parameter) =>
      'name' in parameter ? parameter.name : '',
    );
    expect(names.sort()).toEqual(['from', 'to']);
  });

  it('cada campo de los DTO tiene description y example', () => {
    for (const name of [
      'MyTipsResponseDto',
      'MyTipDayDto',
      'MyTipsTotalsDto',
    ]) {
      const schema = document.components?.schemas?.[name] as Schema | undefined;
      if (!schema) throw new Error(`Falta el esquema ${name}`);
      for (const [field, property] of Object.entries(schema.properties)) {
        // Las referencias a otro DTO se verifican en ese DTO.
        if (property.$ref || property.allOf || property.items) continue;
        expect(property.description, `${name}.${field}`).toEqual(
          expect.any(String),
        );
        expect('example' in property, `${name}.${field}`).toBe(true);
      }
    }
  });
});
