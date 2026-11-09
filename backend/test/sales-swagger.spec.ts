import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

// El ingreso manual de ventas MrComanda (SPRINT-4-T32) fue reemplazado por la
// operación diaria (SPRINT-4R-T01): las ventas ya no las captura el
// supervisor ni alimentan una conciliación paralela. Este spec documenta la
// desactivación: el endpoint y sus esquemas ya no se publican. Los datos
// históricos de ventas siguen consultables como legado en
// /sales-reports/legacy (SPRINT-4R-T13), separados del panel vigente.
describe('Ingreso MrComanda retirado (SPRINT-4-T32, SPRINT-4R-T01)', () => {
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

  it('no publica el endpoint ni los esquemas del ingreso MrComanda', () => {
    expect(document.paths['/sales/mrcomanda']).toBeUndefined();
    const schemas = document.components?.schemas ?? {};
    expect(schemas.CreateMrComandaSalesDto).toBeUndefined();
    expect(schemas.MrComandaTotalDto).toBeUndefined();
    expect(schemas.MrComandaSalesResponseDto).toBeUndefined();
  });

  it('no publica rutas de escritura de propinas ni de cierres', () => {
    expect(document.paths['/tips']?.['post']).toBeUndefined();
    expect(document.paths['/tips/{id}']?.['patch']).toBeUndefined();
    expect(document.paths['/tips/{id}']?.['delete']).toBeUndefined();
    expect(document.paths['/cash-closings']?.['post']).toBeUndefined();
  });

  it('mantiene la consulta consolidada y el catálogo de medios publicados', () => {
    expect(document.paths['/sales-dashboard']?.['get']).toBeDefined();
    expect(document.paths['/sales-reports/legacy']?.['get']).toBeDefined();
    expect(document.paths['/payment-methods']?.['get']).toBeDefined();
    expect(document.paths['/payment-methods']?.['post']).toBeDefined();
    // Las lecturas históricas se conservan.
    expect(document.paths['/tips']?.['get']).toBeDefined();
    expect(document.paths['/cash-closings/{id}']?.['get']).toBeDefined();
  });
});
