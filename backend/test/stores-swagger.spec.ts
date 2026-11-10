import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createSwaggerDocument } from '../src/swagger.js';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

interface SchemaProperty {
  description?: string;
  example?: unknown;
  nullable?: boolean;
  pattern?: string;
}

interface ObjectSchema {
  required?: string[];
  properties: Record<string, SchemaProperty>;
}

// Documentación Swagger del ID Subway de los locales (SPRINT-4A-T15).
describe('Swagger de locales con ID Subway (SPRINT-4A-T15)', () => {
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

  function operation(method: 'get' | 'post' | 'patch', path: string) {
    const found: Operation | undefined = document.paths[path]?.[method];
    if (!found) throw new Error(`Falta ${method.toUpperCase()} ${path}`);
    return found;
  }

  function schema(name: string): ObjectSchema {
    return document.components?.schemas?.[name] as ObjectSchema;
  }

  it.each([
    { method: 'post' as const, statuses: ['201', '400', '401', '403', '409'] },
    {
      method: 'patch' as const,
      statuses: ['200', '400', '401', '403', '404', '409'],
    },
  ])(
    '$method documenta el 400 de formato y el 409 de ID Subway repetido',
    ({ method, statuses }) => {
      const op = operation(
        method,
        method === 'post' ? '/stores' : '/stores/{id}',
      );
      expect(op.tags).toContain('stores');
      expect(op.summary).toContain('ID Subway');
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      expect(Object.keys(op.responses).sort()).toEqual([...statuses].sort());
      expect(JSON.stringify(op.responses['400'])).toContain('ID Subway');
      expect(JSON.stringify(op.responses['409'])).toContain('ID Subway');
    },
  );

  it('documenta subwayStoreId opcional con ejemplo 72597 en alta, edición y respuesta', () => {
    for (const name of ['CreateStoreDto', 'UpdateStoreDto']) {
      const dto = schema(name);
      expect(dto.required ?? []).not.toContain('subwayStoreId');
      expect(dto.properties.subwayStoreId).toMatchObject({
        example: '72597',
        nullable: true,
        pattern: '^[0-9]{1,10}$',
      });
      expect(dto.properties.subwayStoreId.description).toEqual(
        expect.any(String),
      );
    }
    const response = schema('StoreResponseDto');
    expect(response.properties.subwayStoreId).toMatchObject({
      example: '72597',
      nullable: true,
    });
  });
});
