import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

// Documentación OpenAPI de la consulta histórica de cierres de caja
// (SPRINT-4-T09). Desde SPRINT-4R-T01 la confirmación (POST /cash-closings)
// se retiró: el documento conserva solo la lectura y no expone el DTO de
// creación.
describe('Swagger de cierres de caja (SPRINT-4-T09, lectura SPRINT-4R-T01)', () => {
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

  it('GET /cash-closings/{id} documenta JWT, resumen y errores', () => {
    const op = document.paths['/cash-closings/{id}']?.['get'];
    if (!op) throw new Error('Falta GET /cash-closings/{id}');
    expect(op.tags).toContain('cash-closings');
    expect(op.summary).toEqual(expect.any(String));
    expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
    expect(Object.keys(op.responses).sort()).toEqual(
      ['200', '400', '401', '403', '404'].sort(),
    );
  });

  it('no expone la confirmación ni el DTO de creación', () => {
    expect(document.paths['/cash-closings']?.['post']).toBeUndefined();
    const schemas = document.components?.schemas ?? {};
    expect(schemas.CreateCashClosingDto).toBeUndefined();
    expect(schemas.CreateCashClosingLineDto).toBeUndefined();
    expect(schemas.CreateCashClosingVoucherDto).toBeUndefined();
  });

  it('conserva el detalle tipado de la respuesta histórica', () => {
    const schemas = document.components?.schemas ?? {};
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
        'tipEntries',
        'tipFundAmount',
        'balanceStatus',
      ]),
    );
  });
});
