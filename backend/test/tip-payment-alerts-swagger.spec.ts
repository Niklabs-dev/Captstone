import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

describe('Swagger de alertas de propinas (SPRINT-3-T14 y SPRINT-4A-T22)', () => {
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

  it('documenta la consulta, JWT, permisos y respuesta tipada', () => {
    const operation = document.paths['/tip-payment-alerts']?.get;
    expect(operation).toBeDefined();
    if (!operation) return;
    expect(operation.tags).toContain('tip-payment-alerts');
    expect(operation.summary).toEqual(expect.any(String));
    expect(operation.security).toEqual(
      expect.arrayContaining([{ bearer: [] }]),
    );
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '401',
      '403',
    ]);
    expect(operation.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/TipPaymentAlertCollectionDto',
          },
        },
      },
    });
  });

  it('expone el plazo vigente, los totales y el detalle por local y trabajador', () => {
    const schemas = document.components?.schemas ?? {};
    const keys = (name: string): string[] =>
      Object.keys((schemas[name] as { properties: object }).properties);
    expect(keys('TipPaymentAlertCollectionDto')).toEqual([
      'legalPaymentDays',
      'asOf',
      'overdueThrough',
      'items',
      'totals',
      'calculatedAt',
    ]);
    expect(keys('TipPaymentAlertDto')).toEqual([
      'store',
      'worker',
      'allocationCount',
      'amount',
      'oldestBusinessDate',
      'newestBusinessDate',
      'deadline',
      'daysOverdue',
    ]);
    expect(keys('TipPaymentAlertSummaryDto')).toEqual([
      'alertCount',
      'allocationCount',
      'amount',
      'oldestBusinessDate',
      'newestBusinessDate',
      'maxDaysOverdue',
    ]);
    // Ya no expone los campos de los registros históricos tip_entries.
    expect(keys('TipPaymentAlertDto')).not.toContain('tipEntryId');
    expect(schemas.TipPaymentAlertPoolDto).toBeUndefined();
    // Cada campo lleva descripción y ejemplo.
    for (const name of [
      'TipPaymentAlertCollectionDto',
      'TipPaymentAlertDto',
      'TipPaymentAlertSummaryDto',
    ]) {
      const properties = (
        schemas[name] as {
          properties: Record<
            string,
            { description?: string; example?: unknown }
          >;
        }
      ).properties;
      for (const [field, property] of Object.entries(properties)) {
        expect(property.description, `${name}.${field}`).toEqual(
          expect.any(String),
        );
        if (!['items', 'totals', 'store', 'worker'].includes(field))
          expect(property.example, `${name}.${field}`).toBeDefined();
      }
    }
  });
});
