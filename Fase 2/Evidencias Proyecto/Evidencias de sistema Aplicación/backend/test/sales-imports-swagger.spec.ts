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
    { type?: string; format?: string; nullable?: boolean; example?: unknown }
  >;
}

// Contrato OpenAPI de la importación diaria de ventas MrComanda
// (SPRINT-4R-T10): JWT en todos los endpoints, resumen en español, respuestas
// de éxito y error completas, multipart con el archivo binario y DTOs
// tipados con descripción y ejemplo en cada campo.
describe('Swagger de la importación de ventas (SPRINT-4R-T10)', () => {
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
    method: 'get' | 'post' | 'delete',
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
      method: 'post' as const,
      path: '/sales-imports/preview',
      statuses: ['200', '201', '400', '401', '403', '409', '413', '415', '422'],
    },
    {
      method: 'post' as const,
      path: '/sales-imports/confirm-with-resolution',
      statuses: ['200', '400', '401', '403', '409', '413', '415', '422'],
    },
    {
      method: 'post' as const,
      path: '/sales-imports/{id}/confirm',
      statuses: ['200', '400', '401', '403', '404', '409', '422'],
    },
    {
      method: 'delete' as const,
      path: '/sales-imports/{id}',
      statuses: ['200', '400', '401', '403', '404', '409'],
    },
    {
      method: 'get' as const,
      path: '/sales-imports',
      statuses: ['200', '400', '401', '403'],
    },
    {
      method: 'get' as const,
      path: '/sales-imports/{id}',
      statuses: ['200', '400', '401', '403', '404'],
    },
    {
      method: 'get' as const,
      path: '/sales-imports/{id}/file',
      statuses: ['200', '400', '401', '403', '404'],
    },
  ])(
    '$method $path documenta JWT, resumen y respuestas',
    ({ method, path, statuses }) => {
      const op = operation(method, path);
      expect(op.tags).toContain('sales-imports');
      expect(op.summary).toEqual(expect.any(String));
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
    },
  );

  it('documenta la carga multipart con el archivo binario', () => {
    const op = operation('post', '/sales-imports/preview');
    expect(op.requestBody).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: { $ref: '#/components/schemas/PreviewSalesImportFormDto' },
        },
      },
    });
    expect(schema('PreviewSalesImportFormDto').properties.file).toMatchObject({
      type: 'string',
      format: 'binary',
    });
  });

  // SPRINT-4A-T18: la resolución manual viaja en multipart junto al archivo
  // y su esquema JSON queda documentado como modelo propio.
  it('documenta la resolución manual con el archivo y su esquema JSON', () => {
    const op = operation('post', '/sales-imports/confirm-with-resolution');
    expect(op.requestBody).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: {
            $ref: '#/components/schemas/ConfirmResolvedSalesImportFormDto',
          },
        },
      },
    });
    const form = schema('ConfirmResolvedSalesImportFormDto');
    expect(form.properties.file).toMatchObject({
      type: 'string',
      format: 'binary',
    });
    expect(form.properties.resolution).toMatchObject({ type: 'string' });
    const resolution = schema('SalesImportResolutionDto');
    expect(resolution.required).toEqual(
      expect.arrayContaining(['expectedActiveImportId', 'lines']),
    );
    const line = schema('SalesImportLineResolutionDto');
    expect(Object.keys(line.properties)).toEqual(
      expect.arrayContaining([
        'lineNumber',
        'action',
        'paymentMethodId',
        'remember',
      ]),
    );
    for (const name of [
      'SalesImportResolutionDto',
      'SalesImportStoreResolutionDto',
      'SalesImportLineResolutionDto',
      'SalesImportStoreOptionDto',
      'SalesImportResolutionOptionsDto',
      'SalesImportSkippedLineDto',
    ]) {
      for (const property of Object.values(schema(name).properties)) {
        expect(property).toHaveProperty('description');
      }
    }
    expect(Object.keys(schema('SalesImportPreviewDto').properties)).toContain(
      'resolutionOptions',
    );
    expect(Object.keys(schema('SalesImportDetailDto').properties)).toEqual(
      expect.arrayContaining([
        'storeResolution',
        'resolvedBy',
        'resolvedAt',
        'skippedLines',
      ]),
    );
  });

  it('la confirmación exige expectedActiveImportId (UUID o null)', () => {
    const confirm = schema('ConfirmSalesImportDto');
    expect(confirm.required).toContain('expectedActiveImportId');
    expect(confirm.properties.expectedActiveImportId).toMatchObject({
      format: 'uuid',
      nullable: true,
    });
  });

  it('los errores del archivo documentan código y fila', () => {
    const error = schema('SalesImportReportErrorDto');
    expect(Object.keys(error.properties)).toEqual(
      expect.arrayContaining(['statusCode', 'message', 'code', 'row']),
    );
  });

  it.each([
    'SalesImportPreviewDto',
    'SalesImportDetailDto',
    'SalesImportSummaryDto',
    'SalesImportLineDto',
    'SalesImportVersionDto',
    'SalesImportIssueDto',
    'SalesImportReportErrorDto',
    'SalesImportConflictDto',
  ])('%s no expone la ruta privada del archivo', (name) => {
    const properties = Object.keys(schema(name).properties);
    expect(properties).not.toContain('filePath');
    expect(properties).not.toContain('isCurrent');
  });

  it('el detalle no expone propinas ni diferencias de efectivo', () => {
    const properties = Object.keys(schema('SalesImportDetailDto').properties);
    for (const forbidden of ['tipAmount', 'cashDifference', 'tipFundAmount']) {
      expect(properties).not.toContain(forbidden);
    }
  });
});
