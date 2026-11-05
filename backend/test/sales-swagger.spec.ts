import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

describe('Swagger del ingreso de ventas MrComanda (SPRINT-4-T32)', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      'postgresql://postgres:postgres@localhost:5433/sin-conexion';
    process.env.JWT_SECRET ??= 'secreto-de-pruebas';
    process.env.JWT_EXPIRES_IN ??= '1h';
    process.env.JWT_REFRESH_EXPIRES_IN ??= '7d';
    process.env.DOCUMENTS_STORAGE_PATH ??= './storage/test-documents';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    document = createSwaggerDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  function operation(method: 'post', path: string): Operation {
    const found = document.paths[path]?.[method];
    if (!found) throw new Error(`Falta ${method.toUpperCase()} ${path}`);
    return found;
  }

  it('POST /sales/mrcomanda documenta JWT, resumen y errores', () => {
    const op = operation('post', '/sales/mrcomanda');
    expect(op.tags).toContain('sales');
    expect(op.summary).toEqual(expect.any(String));
    expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
    expect(Object.keys(op.responses).sort()).toEqual(
      ['201', '400', '401', '403', '404', '409'].sort(),
    );
  });

  it('expone la solicitud con local, período con zona horaria y totales por código', () => {
    const schemas = document.components?.schemas ?? {};
    const create = schemas.CreateMrComandaSalesDto as {
      required: string[];
      properties: Record<string, { type?: string; items?: unknown }>;
    };
    expect(create.required.sort()).toEqual(
      ['periodEnd', 'periodStart', 'storeId', 'totals'].sort(),
    );
    expect(create.properties.storeId).toMatchObject({ type: 'string' });
    expect(create.properties.periodStart).toMatchObject({ type: 'string' });
    expect(create.properties.totals).toMatchObject({ type: 'array' });
    expect(create.properties.totals.items).toMatchObject({
      $ref: '#/components/schemas/MrComandaTotalDto',
    });

    const total = schemas.MrComandaTotalDto as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(total.required.sort()).toEqual(
      ['netAmount', 'paymentMethod'].sort(),
    );
    expect(total.properties).not.toHaveProperty('paymentMethodName');
  });

  it('tipa la respuesta con código, nombre, neto y flag de creación', () => {
    const schemas = document.components?.schemas ?? {};
    const response = schemas.MrComandaSalesResponseDto as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(response.properties)).toEqual(
      expect.arrayContaining([
        'storeId',
        'periodStart',
        'periodEnd',
        'created',
        'totalNetAmount',
        'totals',
      ]),
    );

    const totalResponse = schemas.MrComandaSaleTotalResponseDto as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(totalResponse.properties)).toEqual(
      expect.arrayContaining([
        'saleId',
        'paymentMethod',
        'paymentMethodName',
        'netAmount',
      ]),
    );

    expect(
      operation('post', '/sales/mrcomanda').responses['201'],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/MrComandaSalesResponseDto' },
        },
      },
    });
  });
});
