import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

// Verifica la documentación Swagger de las acciones del contador sobre el
// reparto de propinas (SPRINT-3-T13) leyendo el mismo documento OpenAPI que
// main.ts publica en /api/docs. No necesita base de datos: la aplicación se
// compila pero no se inicializa, así que PrismaService no se conecta.

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

const ROUTES: {
  method: 'get' | 'post';
  path: string;
  statuses: string[];
}[] = [
  {
    method: 'post',
    path: '/tip-pools/{id}/observations',
    statuses: ['200', '400', '401', '403', '404', '409'],
  },
  {
    method: 'post',
    path: '/tip-pools/{id}/confirm',
    statuses: ['200', '400', '401', '403', '404', '409', '422'],
  },
  {
    method: 'post',
    path: '/tip-pools/{id}/pay',
    statuses: ['200', '400', '401', '403', '404', '409'],
  },
  {
    method: 'get',
    path: '/tip-pools/{id}/receipts',
    statuses: ['200', '400', '401', '403', '404', '409'],
  },
  {
    method: 'get',
    path: '/tip-pools/{id}/receipts/{userId}/download',
    statuses: ['200', '400', '401', '403', '404', '409'],
  },
];

describe('Swagger de confirmación y pago del reparto (SPRINT-3-T13)', () => {
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

  it.each(ROUTES)(
    '$method $path documenta tag, resumen, JWT y respuestas',
    ({ method, path, statuses }) => {
      const op = operation(method, path);
      expect(op.tags).toContain('tip-pools');
      expect(op.summary).toEqual(expect.any(String));
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
    },
  );

  it('las acciones piden expectedVersion y responden el reparto con version', () => {
    const schemas = document.components?.schemas ?? {};
    for (const name of [
      'ObserveTipPoolDto',
      'ConfirmTipPoolDto',
      'PayTipPoolDto',
    ]) {
      expect(schemas[name]).toMatchObject({
        required: expect.arrayContaining(['expectedVersion']) as unknown,
      });
    }
    expect(schemas.ObserveTipPoolDto).toMatchObject({
      required: expect.arrayContaining(['notes']) as unknown,
    });
    expect(
      Object.keys(
        (schemas.TipPoolResponseDto as { properties: object }).properties,
      ),
    ).toEqual(
      expect.arrayContaining([
        'version',
        'notes',
        'confirmedBy',
        'confirmedAt',
        'paidBy',
        'paidAt',
        'paymentDate',
        'receiptsCount',
      ]),
    );
    const pay = operation('post', '/tip-pools/{id}/pay');
    expect(pay.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/TipPoolResponseDto' },
        },
      },
    });
    expect(pay.responses['409']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/TipPoolConflictDto' },
        },
      },
    });
  });

  it('la descarga se documenta como PDF con nosniff y Content-Disposition', () => {
    const download = operation(
      'get',
      '/tip-pools/{id}/receipts/{userId}/download',
    );
    expect(download.responses['200']).toMatchObject({
      content: { 'application/pdf': expect.anything() as unknown },
      headers: {
        'Content-Disposition': expect.anything() as unknown,
        'X-Content-Type-Options': expect.anything() as unknown,
      },
    });
  });
});
