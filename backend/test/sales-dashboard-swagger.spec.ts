import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

describe('Swagger de la consulta consolidada (SPRINT-4-T13)', () => {
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

  it('documenta la consulta, el filtro de fecha, JWT y permisos', () => {
    const operation = document.paths['/sales-dashboard']?.get;
    expect(operation).toBeDefined();
    if (!operation) return;
    expect(operation.tags).toContain('sales-dashboard');
    expect(operation.summary).toEqual(expect.any(String));
    expect(operation.security).toEqual(
      expect.arrayContaining([{ bearer: [] }]),
    );
    expect(operation.parameters).toEqual([
      expect.objectContaining({ name: 'date', in: 'query', required: false }),
    ]);
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
    ]);
    expect(operation.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/SalesDashboardDto' },
        },
      },
    });
  });

  it('expone ventas netas, propinas y descuadres como conceptos separados', () => {
    const schemas = (document.components?.schemas ?? {}) as Record<
      string,
      { properties?: Record<string, unknown> }
    >;
    const keys = (name: string): string[] =>
      Object.keys(schemas[name]?.properties ?? {});

    expect(keys('SalesDashboardDto')).toEqual(
      expect.arrayContaining([
        'businessDate',
        'timeZone',
        'periodStart',
        'periodEnd',
        'stores',
        'totals',
      ]),
    );
    expect(keys('StoreDashboardDto')).toEqual(
      expect.arrayContaining([
        'store',
        'sales',
        'cardTips',
        'closings',
        'pendingDifferences',
        'alerts',
      ]),
    );
    expect(keys('StoreCardTipsSummaryDto')).toEqual([
      'registeredAmount',
      'closingsAmount',
    ]);
    expect(keys('StoreClosingsSummaryDto')).toEqual(
      expect.arrayContaining(['cashDifference', 'voucherDifference']),
    );
  });
});
