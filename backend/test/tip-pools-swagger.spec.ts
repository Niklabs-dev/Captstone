import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

// Verifica la documentación Swagger de los repartos por período: las
// consultas históricas de solo lectura (SPRINT-3-T13 y T15) y las acciones
// retiradas en SPRINT-4A-T08, que responden 410. Lee el mismo documento
// OpenAPI que main.ts publica en /api/docs. No necesita base de datos: la
// aplicación se compila pero no se inicializa, así que PrismaService no se
// conecta.

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

const READ_ROUTES: { path: string; statuses: string[] }[] = [
  { path: '/tip-pools', statuses: ['200', '400', '401', '403'] },
  { path: '/tip-pools/{id}', statuses: ['200', '400', '401', '403', '404'] },
  {
    path: '/tip-pools/{id}/receipts',
    statuses: ['200', '400', '401', '403', '404', '409'],
  },
  {
    path: '/tip-pools/{id}/receipts/{userId}/download',
    statuses: ['200', '400', '401', '403', '404', '409'],
  },
];

const RETIRED_ROUTES = [
  '/tip-pools/preview',
  '/tip-pools/{id}/observations',
  '/tip-pools/{id}/confirm',
  '/tip-pools/{id}/pay',
];

describe('Swagger de los repartos por período (SPRINT-3-T13 y SPRINT-4A-T08)', () => {
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

  function operation(method: 'get' | 'post', path: string): Operation {
    const found = document.paths[path]?.[method];
    if (!found) throw new Error(`Falta ${method.toUpperCase()} ${path}`);
    return found;
  }

  it.each(READ_ROUTES)(
    'GET $path documenta tag, resumen, JWT y respuestas',
    ({ path, statuses }) => {
      const op = operation('get', path);
      expect(op.tags).toContain('tip-pools');
      expect(op.summary).toEqual(expect.any(String));
      expect(op.deprecated).toBeUndefined();
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
    },
  );

  it.each(RETIRED_ROUTES)(
    'POST %s está retirado: obsoleto, sin cuerpo y solo 410 o 401',
    (path) => {
      const op = operation('post', path);
      expect(op.tags).toContain('tip-pools');
      expect(op.summary).toMatch(/^Retirado: /);
      expect(op.description).toEqual(expect.stringContaining('SPRINT-4A-T08'));
      expect(op.deprecated).toBe(true);
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(op.requestBody).toBeUndefined();
      expect(Object.keys(op.responses).sort()).toEqual(['401', '410']);
      expect(op.responses['410']).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/TipPoolRetiredActionDto' },
          },
        },
      });
      if (path.includes('{id}')) {
        expect(op.parameters).toEqual([
          expect.objectContaining({ name: 'id', in: 'path' }),
        ]);
      }
    },
  );

  it('el 410 y los filtros opcionales de la consulta documentan cada campo con ejemplo', () => {
    const schemas = document.components?.schemas ?? {};
    const retired = schemas.TipPoolRetiredActionDto as {
      required: string[];
      properties: Record<string, { description?: string; example?: unknown }>;
    };
    expect(retired.required.sort()).toEqual(
      ['error', 'message', 'statusCode'].sort(),
    );
    for (const field of ['statusCode', 'message', 'error']) {
      expect(retired.properties[field]).toMatchObject({
        description: expect.any(String) as unknown,
        example: expect.anything() as unknown,
      });
    }
    expect(retired.properties.statusCode.example).toBe(410);
    // Los DTOs de las acciones retiradas ya no se publican.
    for (const name of [
      'CalculateTipPoolDto',
      'ObserveTipPoolDto',
      'ConfirmTipPoolDto',
      'PayTipPoolDto',
      'TipPoolConflictDto',
      'TipPoolValidationErrorDto',
    ]) {
      expect(schemas[name]).toBeUndefined();
    }

    const list = operation('get', '/tip-pools');
    const params = (list.parameters ?? []) as {
      name: string;
      required?: boolean;
      description?: string;
      schema?: { example?: unknown };
    }[];
    expect(params.map((param) => param.name).sort()).toEqual(
      ['periodEnd', 'periodStart', 'storeId'].sort(),
    );
    for (const param of params) {
      expect(param.required).toBe(false);
      expect(param.description).toEqual(expect.any(String));
      expect(param.schema?.example).toEqual(expect.anything());
    }
    expect(list.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: { $ref: '#/components/schemas/TipPoolResponseDto' },
          },
        },
      },
    });
  });

  it('el reparto conserva su foto: estado, regla, fuentes diarias y horas nulas', () => {
    const schemas = document.components?.schemas ?? {};
    const pool = schemas.TipPoolResponseDto as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(pool.properties.status).toMatchObject({
      enum: ['DRAFT', 'CONFIRMED', 'PAID'],
      description: expect.stringContaining('borrador sin efecto') as unknown,
    });
    expect(pool.properties.rule).toMatchObject({
      enum: ['PROPORTIONAL_TO_HOURS', 'EQUAL_SHARES'],
    });
    expect(pool.properties.totalHours).toMatchObject({ nullable: true });
    expect(pool.properties.dailySources).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/TipPoolDailySourceResponseDto' },
    });
    const line = schemas.TipPoolLineResponseDto as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(line.properties.hoursWorked).toMatchObject({ nullable: true });
  });

  it('la descarga se documenta como PDF con nosniff y Content-Disposition', () => {
    const download = operation(
      'get',
      '/tip-pools/{id}/receipts/{userId}/download',
    );
    expect(download.responses['200']).toMatchObject({
      content: { 'application/pdf': expect.anything() as unknown },
      headers: {
        'Cache-Control': expect.anything() as unknown,
        'Content-Disposition': expect.anything() as unknown,
        'X-Content-Type-Options': expect.anything() as unknown,
      },
    });
  });
});
