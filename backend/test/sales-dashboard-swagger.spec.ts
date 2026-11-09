import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

// Swagger del panel consolidado y de los reportes con ventas importadas
// (SPRINT-4R-T13): rutas, filtros, JWT, permisos, conceptos separados y
// ausencia de los campos del flujo antiguo en el contrato vigente.
describe('Swagger del panel y los reportes de ventas (SPRINT-4R-T13)', () => {
  let app: INestApplication;
  let document: OpenAPIObject;
  let storageRoot: string;

  type Schema = {
    properties?: Record<string, { enum?: string[]; nullable?: boolean }>;
  };

  function schemas(): Record<string, Schema> {
    return (document.components?.schemas ?? {}) as Record<string, Schema>;
  }

  function keys(name: string): string[] {
    return Object.keys(schemas()[name]?.properties ?? {});
  }

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      'postgresql://postgres:postgres@localhost:5433/sin-conexion';
    process.env.JWT_SECRET ??= 'secreto-de-pruebas';
    process.env.JWT_EXPIRES_IN ??= '1h';
    process.env.JWT_REFRESH_EXPIRES_IN ??= '7d';
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-swg-'));
    process.env.DOCUMENTS_STORAGE_PATH = storageRoot;
    process.env.DOCUMENTS_MAX_SIZE_MB ??= '1';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    document = createSwaggerDocument(app);
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  it('documenta el panel con su filtro de fecha, JWT y permisos', () => {
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

  it('documenta el reporte y el legado con rango, local, JWT y errores', () => {
    for (const [route, schema] of [
      ['/sales-reports', 'SalesReportDto'],
      ['/sales-reports/legacy', 'LegacySalesReportDto'],
    ] as const) {
      const operation = document.paths[route]?.get;
      expect(operation).toBeDefined();
      if (!operation) return;
      expect(operation.tags).toContain('sales-reports');
      expect(operation.summary).toEqual(expect.any(String));
      expect(operation.security).toEqual(
        expect.arrayContaining([{ bearer: [] }]),
      );
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'from', required: true }),
          expect.objectContaining({ name: 'to', required: true }),
          expect.objectContaining({ name: 'storeId', required: false }),
        ]),
      );
      expect(Object.keys(operation.responses).sort()).toEqual([
        '200',
        '400',
        '401',
        '403',
        '404',
      ]);
      expect(operation.responses['200']).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${schema}` },
          },
        },
      });
    }
  });

  it('separa ventas importadas, estado diario, operación diaria y alertas', () => {
    expect(keys('SalesDashboardDto')).toEqual([
      'businessDate',
      'today',
      'alertsAsOf',
      'timeZone',
      'calculatedAt',
      'paymentMethods',
      'stores',
      'cashDifferences',
      'totals',
    ]);
    expect(keys('StoreDashboardDto')).toEqual([
      'store',
      'importStatus',
      'sales',
      'dailyOperation',
      'alerts',
    ]);
    expect(keys('StoreReportDto')).toEqual([
      'store',
      'sales',
      'tips',
      'cashDifferences',
      'importStatus',
      'days',
    ]);
    expect(keys('DailyOperationFiguresDto')).toEqual([
      'operationId',
      'cardTipAmount',
      'cashTipAmount',
      'tipFundAmount',
      'cashDifference',
    ]);
    expect(keys('CashDifferenceTotalsDto')).toEqual([
      'count',
      'surplusCount',
      'shortageCount',
      'surplusAmount',
      'shortageAmount',
    ]);
    expect(keys('PaymentMethodAmountDto')).toEqual([
      'paymentMethod',
      'paymentMethodName',
      'isActive',
      'amount',
    ]);
    const difference = schemas()['CashDifferenceDto']?.properties ?? {};
    expect(difference['type']?.enum).toEqual([
      'SOBRANTE',
      'FALTANTE',
      'SIN_DIFERENCIA',
    ]);
    const status = schemas()['ImportStatusInfoDto']?.properties ?? {};
    expect(status['status']?.enum).toEqual([
      'IMPORTADO',
      'PENDIENTE',
      'ATRASADO',
      'CERRADO',
    ]);
    expect(status['status']?.nullable).toBe(true);
    const store = schemas()['StoreDashboardDto']?.properties ?? {};
    expect(store['sales']?.nullable).toBe(true);
    expect(store['dailyOperation']?.nullable).toBe(true);
  });

  it('elimina del contrato vigente los campos del flujo antiguo y los deja en el legado', () => {
    const legacyFields = [
      'mercadoPagoGrossAmount',
      'mercadoPagoTipAmount',
      'mercadoPagoNetSales',
      'mrcomandaNetSales',
      'voucherDifference',
      'closings',
      'pendingDifferences',
      'cardTips',
    ];
    const current = Object.keys(schemas()).filter(
      (name) =>
        !name.startsWith('Legacy') &&
        !name.startsWith('CashClosing') &&
        (name.includes('Dashboard') ||
          name.includes('Report') ||
          name.includes('PaymentMethodAmount') ||
          name.includes('ImportedSales') ||
          name.includes('DailyOperationFigures') ||
          name.includes('CashDifference')),
    );
    expect(current).toEqual(
      expect.arrayContaining(['SalesDashboardDto', 'SalesReportDto']),
    );
    for (const name of current) {
      for (const field of legacyFields) {
        expect(keys(name)).not.toContain(field);
      }
    }
    // Los esquemas del consolidado antiguo ya no se publican.
    for (const name of [
      'StoreClosingsSummaryDto',
      'StoreCardTipsSummaryDto',
      'PendingClosingDifferenceDto',
      'ClosingLineDifferenceDto',
      'PaymentMethodSalesDto',
    ]) {
      expect(schemas()[name]).toBeUndefined();
    }
    expect(keys('LegacyClosingDto')).toEqual(
      expect.arrayContaining([
        'mrcomandaNetSales',
        'mercadoPagoGrossAmount',
        'mercadoPagoTipAmount',
        'voucherDifference',
      ]),
    );
    expect(keys('LegacyClosingDto')).toEqual(
      expect.arrayContaining(['balanceStatus', 'lineDifferences']),
    );
    expect(
      schemas()['LegacyClosingDto']?.properties?.['balanceStatus']?.enum,
    ).toEqual(['CUADRADO', 'NO_CUADRADO']);
    expect(keys('LegacySalesReportDto')).toEqual([
      'from',
      'to',
      'timeZone',
      'storeId',
      'notice',
      'closings',
      'sales',
    ]);
  });
});
