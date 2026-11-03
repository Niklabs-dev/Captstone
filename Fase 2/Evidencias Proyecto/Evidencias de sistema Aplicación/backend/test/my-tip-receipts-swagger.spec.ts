import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

// Verifica la documentación Swagger de las constancias propias del trabajador
// (SPRINT-4-T01) leyendo el mismo documento OpenAPI que main.ts publica en
// /api/docs. No necesita base de datos: la aplicación se compila pero no se
// inicializa, así que PrismaService no se conecta.

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

const LIST_PATH = '/my-tip-receipts';
const DOWNLOAD_PATH = '/my-tip-receipts/{id}/download';

describe('Swagger de las constancias propias (SPRINT-4-T01)', () => {
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

  it.each([
    { path: LIST_PATH, statuses: ['200', '400', '401', '403'] },
    { path: DOWNLOAD_PATH, statuses: ['200', '400', '401', '403', '404'] },
  ])(
    'GET $path documenta tag, resumen, JWT y respuestas',
    ({ path, statuses }) => {
      const op = operation(path);
      expect(op.tags).toContain('my-tip-receipts');
      expect(op.summary).toEqual(expect.any(String));
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
    },
  );

  it('no ofrece parámetros para indicar otro trabajador', () => {
    expect(operation(LIST_PATH).parameters ?? []).toEqual([]);
    expect(
      (operation(DOWNLOAD_PATH).parameters ?? []).map((parameter) =>
        'name' in parameter ? parameter.name : parameter.$ref,
      ),
    ).toEqual(['id']);
  });

  it('el listado responde la proyección personal con ejemplos en cada campo', () => {
    expect(operation(LIST_PATH).responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: { $ref: '#/components/schemas/OwnTipReceiptDto' },
          },
        },
      },
    });
    const schema = document.components?.schemas?.OwnTipReceiptDto as {
      properties: Record<string, { description?: string; example?: unknown }>;
    };
    expect(Object.keys(schema.properties)).not.toContain('detail');
    for (const property of Object.values(schema.properties)) {
      expect(property.description).toEqual(expect.any(String));
      expect(property.example).toBeDefined();
    }
  });

  it('la descarga se documenta como PDF con sus cabeceras', () => {
    expect(operation(DOWNLOAD_PATH).responses['200']).toMatchObject({
      content: { 'application/pdf': expect.anything() as unknown },
      headers: {
        'Cache-Control': expect.anything() as unknown,
        'Content-Disposition': expect.anything() as unknown,
        'X-Content-SHA256': expect.anything() as unknown,
        'X-Content-Type-Options': expect.anything() as unknown,
      },
    });
  });
});
