import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

describe('Swagger del catálogo de medios de pago (SPRINT-4-T32)', () => {
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
      method: 'get' as const,
      path: '/payment-methods',
      statuses: ['200', '400', '401'],
    },
    {
      method: 'post' as const,
      path: '/payment-methods',
      statuses: ['201', '400', '401', '403', '409'],
    },
    {
      method: 'patch' as const,
      path: '/payment-methods/{id}',
      statuses: ['200', '400', '401', '403', '404'],
    },
    {
      method: 'patch' as const,
      path: '/payment-methods/{id}/deactivate',
      statuses: ['200', '400', '401', '403', '404'],
    },
    {
      method: 'patch' as const,
      path: '/payment-methods/{id}/reactivate',
      statuses: ['200', '400', '401', '403', '404'],
    },
  ])(
    '$method $path documenta JWT, resumen y errores',
    ({ method, path, statuses }) => {
      const op = operation(method, path);
      expect(op.tags).toContain('payment-methods');
      expect(op.summary).toEqual(expect.any(String));
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
    },
  );

  it('expone el alta con los campos del catálogo y sin borrado físico', () => {
    const schemas = document.components?.schemas ?? {};
    const create = schemas.CreatePaymentMethodDto as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(create.required.sort()).toEqual(
      ['availableForTips', 'behavior', 'code', 'name', 'sortOrder'].sort(),
    );
    expect(Object.keys(create.properties)).toEqual(
      expect.arrayContaining([
        'code',
        'name',
        'sortOrder',
        'behavior',
        'availableForTips',
      ]),
    );
    expect(create.properties).not.toHaveProperty('id');
    expect(create.properties).not.toHaveProperty('isActive');

    const operation = document.paths['/payment-methods']?.['delete'];
    expect(operation).toBeUndefined();
  });

  it('tipa la respuesta con código, nombre, orden, comportamiento y propinas', () => {
    const schemas = document.components?.schemas ?? {};
    const response = schemas.PaymentMethodResponseDto as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(response.properties)).toEqual(
      expect.arrayContaining([
        'id',
        'code',
        'name',
        'sortOrder',
        'isActive',
        'behavior',
        'availableForTips',
        'createdAt',
        'updatedAt',
      ]),
    );
    for (const status of ['201']) {
      expect(
        operation('post', '/payment-methods').responses[status],
      ).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/PaymentMethodResponseDto' },
          },
        },
      });
    }
  });
});
