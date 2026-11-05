import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

describe('Swagger de cierres de caja (SPRINT-4-T09)', () => {
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
      path: '/cash-closings',
      statuses: ['201', '400', '401', '403', '404', '409'],
    },
    {
      method: 'get' as const,
      path: '/cash-closings/{id}',
      statuses: ['200', '400', '401', '403', '404'],
    },
  ])(
    '$method $path documenta JWT, resumen y errores',
    ({ method, path, statuses }) => {
      const op = operation(method, path);
      expect(op.tags).toContain('cash-closings');
      expect(op.summary).toEqual(expect.any(String));
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
    },
  );

  it('expone entradas controladas y totales de conciliación tipados', () => {
    const schemas = document.components?.schemas ?? {};
    expect(schemas.CreateCashClosingDto).toMatchObject({
      required: expect.arrayContaining([
        'storeId',
        'businessDate',
        'shift',
        'openingCash',
        'lines',
        'vouchers',
      ]) as unknown,
    });
    const createProperties = (
      schemas.CreateCashClosingDto as { properties: object }
    ).properties;
    expect(Object.keys(createProperties)).not.toEqual(
      expect.arrayContaining([
        'expectedAmount',
        'responsibleId',
        'closedAt',
        'status',
        'difference',
      ]),
    );
    expect(
      Object.keys(
        (schemas.CashClosingResponseDto as { properties: object }).properties,
      ),
    ).toEqual(
      expect.arrayContaining([
        'lines',
        'vouchers',
        'responsible',
        'closedAt',
        'totalDifference',
        'mrcomandaNetSales',
        'mercadoPagoGrossAmount',
        'mercadoPagoTipAmount',
        'mercadoPagoNetSales',
        'reconciliationDifference',
        'tipEntries',
        'tipFundAmount',
      ]),
    );
    expect(operation('post', '/cash-closings').responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CashClosingResponseDto' },
        },
      },
    });
  });
});
