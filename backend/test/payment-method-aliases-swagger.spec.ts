import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

interface SchemaObject {
  required?: string[];
  properties: Record<string, { description?: string; example?: unknown }>;
}

// Contrato OpenAPI de los alias de medios de pago (SPRINT-4A-T20): JWT,
// resumen en español, respuestas completas y DTOs con descripción y ejemplo.
describe('Swagger de los alias de medios de pago (SPRINT-4A-T20)', () => {
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
    method: 'get' | 'post' | 'delete',
    path: string,
  ): Operation {
    const found = document.paths[path]?.[method];
    if (!found) throw new Error(`Falta ${method.toUpperCase()} ${path}`);
    return found;
  }

  it.each([
    {
      method: 'get' as const,
      path: '/payment-method-aliases',
      statuses: ['200', '401', '403'],
    },
    {
      method: 'post' as const,
      path: '/payment-method-aliases',
      statuses: ['201', '400', '401', '403', '404', '409'],
    },
    {
      method: 'delete' as const,
      path: '/payment-method-aliases/{id}',
      statuses: ['200', '400', '401', '403', '404'],
    },
  ])(
    '$method $path documenta JWT, resumen y respuestas',
    ({ method, path, statuses }) => {
      const op = operation(method, path);
      expect(op.tags).toContain('payment-method-aliases');
      expect(op.summary).toEqual(expect.any(String));
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
    },
  );

  it.each([
    'CreatePaymentMethodAliasDto',
    'PaymentMethodAliasResponseDto',
    'PaymentMethodAliasMethodDto',
  ])('%s describe cada campo', (name) => {
    const schema = document.components?.schemas?.[name] as
      SchemaObject | undefined;
    expect(schema).toBeDefined();
    for (const property of Object.values(schema?.properties ?? {}))
      expect(property.description).toEqual(expect.any(String));
  });

  it('el alta exige etiqueta y medio', () => {
    const schema = document.components?.schemas?.[
      'CreatePaymentMethodAliasDto'
    ] as SchemaObject;
    expect(schema.required).toEqual(
      expect.arrayContaining(['label', 'paymentMethodId']),
    );
  });
});
