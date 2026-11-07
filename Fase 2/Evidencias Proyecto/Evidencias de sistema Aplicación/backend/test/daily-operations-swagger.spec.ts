import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

// Contrato OpenAPI de la operación diaria (SPRINT-4R-T01): JWT en todos los
// endpoints, resumen en español, respuestas de error completas y esquemas
// tipados sin campos internos.
describe('Swagger de la operación diaria (SPRINT-4R-T01)', () => {
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

  it.each([
    {
      method: 'post' as const,
      path: '/daily-operations',
      statuses: ['200', '201', '400', '401', '403', '404', '409', '413', '415'],
    },
    {
      method: 'get' as const,
      path: '/daily-operations',
      statuses: ['200', '400', '401', '403'],
    },
    {
      method: 'get' as const,
      path: '/daily-operations/{id}',
      statuses: ['200', '400', '401', '403', '404'],
    },
    {
      method: 'get' as const,
      path: '/daily-operations/{id}/voucher',
      statuses: ['200', '400', '401', '403', '404'],
    },
  ])(
    '$method $path documenta JWT, resumen y errores',
    ({ method, path, statuses }) => {
      const op = operation(method, path);
      expect(op.tags).toContain('daily-operations');
      expect(op.summary).toEqual(expect.any(String));
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
    },
  );

  it('documenta el multipart con el voucher binario y los montos obligatorios', () => {
    const op = operation('post', '/daily-operations');
    expect(op.requestBody).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: { $ref: '#/components/schemas/CreateDailyOperationFormDto' },
        },
      },
    });

    const schemas = document.components?.schemas ?? {};
    const create = schemas.CreateDailyOperationFormDto as {
      required: string[];
      properties: Record<string, { type?: string; format?: string }>;
    };
    expect(create.required).toEqual(
      expect.arrayContaining([
        'storeId',
        'businessDate',
        'cardTipAmount',
        'cashTipAmount',
        'cashDifference',
      ]),
    );
    // differenceReason es opcional (obligatoria solo la regla de negocio con
    // diferencia distinta de cero) y el voucher es el archivo binario.
    expect(create.required).not.toContain('differenceReason');
    expect(create.properties.voucher).toMatchObject({
      type: 'string',
      format: 'binary',
    });
    // El cuerpo de creación no expone campos calculados ni internos.
    expect(Object.keys(create.properties)).not.toEqual(
      expect.arrayContaining(['tipFundAmount', 'responsibleId', 'voucherId']),
    );
  });

  it('tipa la respuesta con montos, fondo, voucher anidado y responsable', () => {
    const schemas = document.components?.schemas ?? {};
    const response = schemas.DailyOperationResponseDto as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(response.properties)).toEqual(
      expect.arrayContaining([
        'id',
        'store',
        'businessDate',
        'cardTipAmount',
        'cashTipAmount',
        'tipFundAmount',
        'cashDifference',
        'differenceReason',
        'voucher',
        'responsible',
        'createdAt',
        'updatedAt',
      ]),
    );
    const voucherSchema = schemas.DailyOperationVoucherResponseDto as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(voucherSchema.properties)).toEqual(
      expect.arrayContaining([
        'id',
        'fileName',
        'mimeType',
        'sizeBytes',
        'sha256Hash',
        'createdAt',
      ]),
    );
    for (const status of ['200', '201']) {
      expect(
        operation('post', '/daily-operations').responses[status],
      ).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DailyOperationResponseDto' },
          },
        },
      });
    }
  });

  it('documenta el ID consultable ante un contenido distinto (409)', () => {
    expect(
      operation('post', '/daily-operations').responses['409'],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/DailyOperationConflictDto' },
        },
      },
    });
    const schemas = document.components?.schemas ?? {};
    expect(
      Object.keys(
        (schemas.DailyOperationConflictDto as { properties: object })
          .properties,
      ),
    ).toEqual(
      expect.arrayContaining([
        'statusCode',
        'message',
        'error',
        'existingOperationId',
      ]),
    );
  });

  it('la descarga del voucher responde binario con cabeceras de integridad', () => {
    const op = operation('get', '/daily-operations/{id}/voucher');
    expect(op.responses['200']).toMatchObject({
      content: {
        'image/jpeg': { schema: { type: 'string', format: 'binary' } },
        'image/png': { schema: { type: 'string', format: 'binary' } },
        'image/webp': { schema: { type: 'string', format: 'binary' } },
      },
    });
  });
});
