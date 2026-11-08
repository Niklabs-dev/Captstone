import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

// Contrato OpenAPI de la operación diaria (SPRINT-4R-T01 y SPRINT-4R-T03):
// JWT en todos los endpoints, resumen en español, respuestas de error
// completas y esquemas tipados sin campos internos ni datos personales de
// los trabajadores.
describe('Swagger de la operación diaria (SPRINT-4R-T01 y SPRINT-4R-T03)', () => {
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
    method: 'get' | 'post' | 'patch',
    path: string,
  ): Operation {
    const found = document.paths[path]?.[method];
    if (!found) throw new Error(`Falta ${method.toUpperCase()} ${path}`);
    return found;
  }

  it.each([
    {
      method: 'post' as const,
      path: '/daily-operations',
      statuses: [
        '200',
        '201',
        '400',
        '401',
        '403',
        '404',
        '409',
        '413',
        '415',
        '422',
      ],
    },
    {
      method: 'patch' as const,
      path: '/daily-operations/{id}',
      statuses: ['200', '400', '401', '403', '404', '409', '413', '415', '422'],
    },
    {
      method: 'get' as const,
      path: '/daily-operations',
      statuses: ['200', '400', '401', '403'],
    },
    {
      method: 'get' as const,
      path: '/daily-operations/eligible-workers',
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
    // diferencia distinta de cero), participantIds se repite (arreglo de
    // strings) y el voucher es el archivo binario.
    expect(create.required).not.toContain('differenceReason');
    expect(create.required).not.toContain('participantIds');
    expect(create.properties.participantIds).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
    expect(create.properties.voucher).toMatchObject({
      type: 'string',
      format: 'binary',
    });
    // El cuerpo de creación no expone campos calculados ni internos.
    expect(Object.keys(create.properties)).not.toEqual(
      expect.arrayContaining(['tipFundAmount', 'responsibleId', 'voucherId']),
    );
  });

  it('documenta el PATCH multipart con voucher de reemplazo y campos opcionales', () => {
    const op = operation('patch', '/daily-operations/{id}');
    expect(op.requestBody).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: { $ref: '#/components/schemas/UpdateDailyOperationFormDto' },
        },
      },
    });

    const schemas = document.components?.schemas ?? {};
    const update = schemas.UpdateDailyOperationFormDto as {
      required: string[] | undefined;
      properties: Record<string, { type?: string; format?: string }>;
    };
    // Solo el voucher del FormDto (el selector binario de Swagger) aparece
    // como requerido en el esquema; los campos de negocio son opcionales.
    expect(update.required ?? []).toEqual(['voucher']);
    expect(Object.keys(update.properties)).toEqual(
      expect.arrayContaining([
        'cardTipAmount',
        'cashTipAmount',
        'cashDifference',
        'differenceReason',
        'participantIds',
        'voucher',
      ]),
    );
    expect(update.properties.voucher).toMatchObject({
      type: 'string',
      format: 'binary',
    });
    expect(update.properties.participantIds).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
    // La corrección no expone local, fecha ni responsable: no cambian.
    expect(Object.keys(update.properties)).not.toEqual(
      expect.arrayContaining(['storeId', 'businessDate', 'responsibleId']),
    );
  });

  it('documenta el catálogo de elegibles como arreglo de id y nombre', () => {
    const op = operation('get', '/daily-operations/eligible-workers');
    expect(op.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'storeId',
          in: 'query',
          required: true,
        }),
      ]),
    );
    expect(op.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'array',
            items: { $ref: '#/components/schemas/DailyOperationPersonDto' },
          },
        },
      },
    });
    const person = (document.components?.schemas ?? {})
      .DailyOperationPersonDto as { properties: Record<string, unknown> };
    // Solo id y nombre: jamás RUT, correo, teléfono ni credenciales.
    expect(Object.keys(person.properties).sort()).toEqual(['id', 'name']);
  });

  it('tipa la respuesta con montos, fondo, voucher, responsable y participantes', () => {
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
        'participants',
        'createdAt',
        'updatedAt',
      ]),
    );
    // Los participantes se entregan como id y nombre (sin datos personales).
    expect(response.properties.participants).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/DailyOperationPersonDto' },
    });
    // La respuesta no expone la ruta física interna del voucher.
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
    expect(Object.keys(voucherSchema.properties)).not.toContain('filePath');
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
    expect(
      operation('patch', '/daily-operations/{id}').responses['200'],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/DailyOperationResponseDto' },
        },
      },
    });
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
