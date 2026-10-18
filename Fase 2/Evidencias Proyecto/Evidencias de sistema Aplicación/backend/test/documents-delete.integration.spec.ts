import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { DOCUMENT_TYPES } from '../prisma/seed.js';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import type {
  DocumentDeletionResponse,
  DocumentResponse,
} from '../src/documents/types/documents.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP de la eliminación de documentos (SPRINT-2-T07)
// contra PostgreSQL real. Se omiten si no se define TEST_DATABASE_URL. Igual
// que en documents.integration.spec.ts, los datos van por HTTP (no se pueden
// envolver en una transacción revertida): usan el dominio
// @documents-delete-test.moi-food.cl y un local propio, y se eliminan al
// finalizar. Los archivos se guardan en una carpeta temporal que también se
// elimina.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@documents-delete-test.moi-food.cl';
const STORE_NAME = 'Subway Documents Delete Test';

function uniquePdf(): Buffer {
  return Buffer.from(`%PDF-1.7\n% prueba ${randomUUID()}\n`);
}

describe.skipIf(!databaseUrl)(
  'Eliminación de documentos según el plazo de conservación (SPRINT-2-T07)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storagePath: string;
    let workerId: string;
    const tokens: Record<string, string> = {};

    async function cleanup(): Promise<void> {
      // Documentos en su plazo de conservación y versiones inmutables: se
      // purgan como mantenimiento con session_replication_role = replica
      // (requiere el superusuario de TEST_DATABASE_URL).
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        const where = { subjectUser: { email: { endsWith: DOMAIN } } };
        await tx.documentVersion.deleteMany({ where: { document: where } });
        await tx.document.deleteMany({ where });
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({ where: { name: STORE_NAME } });
    }

    async function createUser(
      roleCode: RoleCode,
      name: string,
      storeId: string | null,
    ): Promise<string> {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: roleCode },
      });
      const user = await prisma.user.create({
        data: {
          email: `${name}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: name,
          lastName: 'Test',
          roleId: role.id,
          storeId,
        },
      });
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: roleCode,
        storeId,
      };
      tokens[name] = await jwt.signAsync(payload);
      return user.id;
    }

    // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
    function remove(documentId: string, tokenName: string) {
      return request(app.getHttpServer())
        .delete(`/documents/${documentId}`)
        .set('Authorization', `Bearer ${tokens[tokenName]}`);
    }

    // Contrato celebrado en issuedAt: se conserva 5 años desde esa fecha.
    async function uploadContract(
      issuedAt: string,
      documentId?: string,
    ): Promise<DocumentResponse> {
      const req = request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .field('workerId', workerId)
        .field('documentTypeCode', 'CONTRATO');
      if (documentId === undefined) {
        req.field('title', 'Contrato').field('issuedAt', issuedAt);
      } else {
        req.field('documentId', documentId);
      }
      const res = await req
        .attach('file', uniquePdf(), {
          filename: 'contrato.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      return res.body as DocumentResponse;
    }

    async function storedFiles(documentId: string): Promise<string[]> {
      const versions = await prisma.documentVersion.findMany({
        where: { documentId },
        select: { filePath: true },
      });
      return versions.map((version) =>
        path.join(storagePath, version.filePath),
      );
    }

    beforeAll(async () => {
      storagePath = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moi-food-docs-delete-'),
      );
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = storagePath;
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      // Mismo pipe de validación que main.ts.
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
      jwt = app.get(JwtService);

      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
      await cleanup();

      // Roles y tipos de documento base por si la BD no está sembrada.
      for (const code of Object.values(ROLE)) {
        await prisma.role.upsert({
          where: { code },
          update: {},
          create: { code, name: code },
        });
      }
      for (const type of DOCUMENT_TYPES) {
        await prisma.documentType.upsert({
          where: { code: type.code },
          update: {},
          create: type,
        });
      }

      const store = await prisma.store.create({
        data: {
          name: STORE_NAME,
          city: 'Melipilla',
          address: 'Calle de prueba 123',
        },
      });
      workerId = await createUser(ROLE.TRABAJADOR, 'trabajador', store.id);
      await createUser(ROLE.CONTADOR, 'contador', null);
      await createUser(ROLE.ADMINISTRADOR, 'admin', null);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
      await fs.rm(storagePath, { recursive: true, force: true });
    });

    it('rechaza con 409 eliminar un documento en su plazo de conservación y lo deja intacto', async () => {
      const issuedAt = new Date().toISOString().slice(0, 10);
      const contrato = await uploadContract(issuedAt);
      const files = await storedFiles(contrato.id);

      const res = await remove(contrato.id, 'admin').expect(409);
      expect((res.body as { message: string }).message).toContain(
        `debe conservarse hasta el ${contrato.retainUntil}`,
      );

      expect(
        await prisma.document.findUnique({ where: { id: contrato.id } }),
      ).not.toBeNull();
      expect(
        await prisma.documentVersion.count({
          where: { documentId: contrato.id },
        }),
      ).toBe(1);
      await expect(fs.access(files[0])).resolves.toBeUndefined();
    });

    it('vencido el plazo, elimina el documento con todas sus versiones y archivos', async () => {
      // Celebrado en 2020: debía conservarse hasta 2025-03-02.
      const contrato = await uploadContract('2020-03-02');
      expect(contrato.retainUntil).toBe('2025-03-02');
      await uploadContract('2020-03-02', contrato.id);
      const files = await storedFiles(contrato.id);
      expect(files).toHaveLength(2);

      const res = await remove(contrato.id, 'admin').expect(200);
      expect(res.body as DocumentDeletionResponse).toEqual({
        id: contrato.id,
        retainUntil: '2025-03-02',
        deletedVersions: 2,
      });

      expect(
        await prisma.document.findUnique({ where: { id: contrato.id } }),
      ).toBeNull();
      expect(
        await prisma.documentVersion.count({
          where: { documentId: contrato.id },
        }),
      ).toBe(0);
      for (const file of files) {
        await expect(fs.access(file)).rejects.toThrow();
      }
      await remove(contrato.id, 'admin').expect(404);
    });

    it('solo el administrador elimina documentos y valida el ID', async () => {
      const contrato = await uploadContract('2020-03-02');
      await remove(contrato.id, 'trabajador').expect(403);
      await remove(contrato.id, 'contador').expect(403);
      await request(app.getHttpServer())
        .delete(`/documents/${contrato.id}`)
        .expect(401);
      await remove(randomUUID(), 'admin').expect(404);
      await remove('no-es-uuid', 'admin').expect(400);
      expect(
        await prisma.document.findUnique({ where: { id: contrato.id } }),
      ).not.toBeNull();
    });
  },
);
