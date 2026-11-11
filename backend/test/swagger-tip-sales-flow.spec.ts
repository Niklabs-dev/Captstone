import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

interface PathOperation {
  method: string;
  path: string;
  operation: Operation;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

// Rutas de los módulos tocados por el nuevo flujo de propinas y ventas
// (SPRINT-4A): cada endpoint debe explicar qué hace en /api/docs.
const FLOW_PATH_PREFIXES = [
  '/daily-operations',
  '/daily-tips',
  '/tip-payment-alerts',
  '/my-tips',
  '/my-tip-receipts',
  '/tip-pools',
  '/tips',
  '/sales-imports',
  '/payment-methods',
  '/payment-method-aliases',
  '/stores',
  '/sales-days',
  '/sales-dashboard',
  '/sales-reports',
];

// Acciones del flujo de borradores retiradas en SPRINT-4A-T08.
const RETIRED_OPERATIONS = [
  '/tip-pools/preview',
  '/tip-pools/{id}/observations',
  '/tip-pools/{id}/confirm',
  '/tip-pools/{id}/pay',
];

// Contrato OpenAPI del nuevo flujo de propinas y ventas (SPRINT-4A-T14): cada
// grupo usado tiene descripción, cada endpoint del flujo trae resumen y
// descripción con JWT, y las acciones retiradas quedan obsoletas con 410.
describe('Swagger del flujo de propinas y ventas (SPRINT-4A-T14)', () => {
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

  function allOperations(): PathOperation[] {
    return Object.entries(document.paths).flatMap(([path, item]) =>
      HTTP_METHODS.flatMap((method) => {
        const operation = item[method];
        return operation ? [{ method, path, operation }] : [];
      }),
    );
  }

  function flowOperations(): PathOperation[] {
    return allOperations().filter(({ path }) =>
      FLOW_PATH_PREFIXES.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      ),
    );
  }

  it('describe cada grupo de endpoints usado', () => {
    const described = new Map(
      (document.tags ?? []).map((tag) => [tag.name, tag.description]),
    );
    const used = new Set(
      allOperations().flatMap(({ operation }) => operation.tags ?? []),
    );
    for (const tag of used) {
      expect(described.get(tag), `tag ${tag}`).toEqual(expect.any(String));
    }
    expect(described.get('tip-pools')).toContain('solo lectura');
  });

  it('documenta resumen, descripción y JWT en cada endpoint del flujo', () => {
    const operations = flowOperations();
    expect(operations.length).toBeGreaterThan(40);
    for (const { method, path, operation } of operations) {
      const label = `${method.toUpperCase()} ${path}`;
      expect(operation.summary, label).toEqual(expect.any(String));
      expect(operation.description, label).toEqual(expect.any(String));
      expect(operation.security, label).toEqual(
        expect.arrayContaining([{ bearer: [] }]),
      );
      expect(Object.keys(operation.responses), label).toContain('401');
    }
  });

  it.each(RETIRED_OPERATIONS)(
    'POST %s queda obsoleto y documenta solo 410 y 401',
    (path) => {
      const operation = document.paths[path]?.post;
      if (!operation) throw new Error(`Falta POST ${path}`);
      expect(operation.deprecated).toBe(true);
      expect(operation.summary).toMatch(/^Retirado:/);
      expect(Object.keys(operation.responses).sort()).toEqual(['401', '410']);
    },
  );

  it('ningún otro endpoint del flujo vigente queda obsoleto', () => {
    const deprecated = flowOperations()
      .filter(({ operation }) => operation.deprecated === true)
      .map(({ path }) => path)
      .sort();
    expect(deprecated).toEqual([...RETIRED_OPERATIONS].sort());
  });
});
