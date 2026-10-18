import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { DOCUMENT_TYPES } from '../prisma/seed.js';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import type {
  DocumentListResponse,
  DocumentResponse,
  DocumentVersionHistory,
  IntegrityCheckResponse,
} from '../src/documents/types/documents.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP de la consulta, descarga y verificación de
// documentos (SPRINT-2-T06) contra PostgreSQL real. Se omiten si no se define
// TEST_DATABASE_URL. Igual que en documents.integration.spec.ts, los datos van
// por HTTP (no se pueden envolver en una transacción revertida): usan el
// dominio @documents-read-test.moi-food.cl y un local propio, y se eliminan al
// finalizar. Los archivos se guardan en una carpeta temporal que también se
// elimina.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@documents-read-test.moi-food.cl';
const STORE_NAME = 'Subway Documents Read Test';

function uniquePdf(): Buffer {
  return Buffer.from(`%PDF-1.7\n% prueba ${randomUUID()}\n`);
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe.skipIf(!databaseUrl)(
  'Consulta, descarga e integridad de documentos (SPRINT-2-T06)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storagePath: string;
    let workerId: string;
    const tokens: Record<string, string> = {};
    let contrato: DocumentResponse;
    let contratoContent: Buffer;

    async function cleanup(): Promise<void> {
      // Las versiones son inmutables (trigger de SPRINT-2-T05): se purgan como
      // mantenimiento con session_replication_role = replica (requiere el
      // superusuario de TEST_DATABASE_URL), igual que purgeTestAuditLogs.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        const where = { subjectUser: { email: { endsWith: DOMAIN } } };
        await tx.documentVersion.deleteMany({ where: { document: where } });
        await tx.document.deleteMany({ where });
      });
      // Las operaciones del gestor documental quedan auditadas (SPRINT-2-T09)
      // y audit_logs impide borrar usuarios o locales con historial.
      await purgeTestAuditLogs(prisma, {
        OR: [
          { user: { email: { endsWith: DOMAIN } } },
          { store: { name: STORE_NAME } },
        ],
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
    function get(url: string, tokenName: string) {
      return request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${tokens[tokenName]}`);
    }

    async function uploadContract(
      title: string,
      content: Buffer,
    ): Promise<DocumentResponse> {
      const res = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .field('workerId', workerId)
        .field('documentTypeCode', 'CONTRATO')
        .field('title', title)
        .attach('file', content, {
          filename: 'contrato.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      return res.body as DocumentResponse;
    }

    beforeAll(async () => {
      storagePath = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moi-food-docs-read-'),
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
      await createUser(ROLE.TRABAJADOR, 'otro', store.id);
      await createUser(ROLE.SUPERVISOR, 'supervisor', store.id);
      await createUser(ROLE.CONTADOR, 'contador', null);
      await createUser(ROLE.ADMINISTRADOR, 'admin', null);

      contratoContent = uniquePdf();
      contrato = await uploadContract('Contrato Año 2026', contratoContent);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
      await fs.rm(storagePath, { recursive: true, force: true });
    });

    it('el administrador y el titular listan el documento; supervisor y otro trabajador no lo ven', async () => {
      const admin = await get(
        `/documents?workerId=${workerId}`,
        'admin',
      ).expect(200);
      const adminBody = admin.body as DocumentListResponse;
      expect(adminBody.items.map((item) => item.id)).toContain(contrato.id);
      expect(adminBody.policy).toMatchObject({
        maxBytes: 1024 * 1024,
        canUpload: true,
      });

      const own = await get('/documents', 'trabajador').expect(200);
      const ownBody = own.body as DocumentListResponse;
      expect(ownBody.items.map((item) => item.id)).toContain(contrato.id);
      expect(ownBody.items.every((item) => item.workerId === workerId)).toBe(
        true,
      );
      expect(ownBody.policy.canUpload).toBe(false);

      // El supervisor solo obtiene sus propios documentos (ninguno).
      const supervisor = await get('/documents', 'supervisor').expect(200);
      expect((supervisor.body as DocumentListResponse).items).toEqual([]);
      await get(`/documents?workerId=${workerId}`, 'otro').expect(403);
    });

    it('el contador no accede a documentos laborales (403) y sin token responde 401', async () => {
      const version = contrato.latestVersion.id;
      await get('/documents', 'contador').expect(403);
      await get(`/documents/${contrato.id}/versions`, 'contador').expect(403);
      await get(`/documents/versions/${version}/download`, 'contador').expect(
        403,
      );
      await get(`/documents/versions/${version}/integrity`, 'contador').expect(
        403,
      );
      await request(app.getHttpServer()).get('/documents').expect(401);
    });

    it('muestra el historial solo al administrador y al titular', async () => {
      const res = await get(
        `/documents/${contrato.id}/versions`,
        'trabajador',
      ).expect(200);
      const body = res.body as DocumentVersionHistory;
      expect(body).toMatchObject({ documentId: contrato.id, workerId });
      expect(body.versions.map((v) => v.id)).toEqual([
        contrato.latestVersion.id,
      ]);

      await get(`/documents/${contrato.id}/versions`, 'otro').expect(403);
      await get(`/documents/${randomUUID()}/versions`, 'admin').expect(404);
      await get('/documents/no-es-uuid/versions', 'admin').expect(400);
    });

    it('descarga el archivo con nombre sin datos personales, nosniff e integridad', async () => {
      const res = await get(
        `/documents/versions/${contrato.latestVersion.id}/download`,
        'trabajador',
      )
        // Entrega el cuerpo binario como Buffer.
        .responseType('blob')
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-document-integrity']).toBe('VALID');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="CONTRATO_Contrato-Ano-2026_v1.pdf"; filename*=UTF-8''CONTRATO_Contrato-A%C3%B1o-2026_v1.pdf`,
      );
      expect(sha256(res.body as Buffer)).toBe(sha256(contratoContent));

      await get(
        `/documents/versions/${contrato.latestVersion.id}/download`,
        'otro',
      ).expect(403);
      await get(`/documents/versions/${randomUUID()}/download`, 'admin').expect(
        404,
      );
    });

    it('verifica la integridad y advierte un archivo alterado o ausente', async () => {
      const valid = await get(
        `/documents/versions/${contrato.latestVersion.id}/integrity`,
        'admin',
      ).expect(200);
      expect(valid.body as IntegrityCheckResponse).toMatchObject({
        versionId: contrato.latestVersion.id,
        status: 'VALID',
        valid: true,
        expectedHash: sha256(contratoContent),
        actualHash: sha256(contratoContent),
      });

      // Se altera el archivo en disco: la verificación y la descarga lo advierten.
      const altered = await uploadContract('Contrato alterado', uniquePdf());
      const alteredVersion = await prisma.documentVersion.findUniqueOrThrow({
        where: { id: altered.latestVersion.id },
      });
      const alteredPath = path.join(storagePath, alteredVersion.filePath);
      await fs.appendFile(alteredPath, 'modificado');

      const check = await get(
        `/documents/versions/${altered.latestVersion.id}/integrity`,
        'admin',
      ).expect(200);
      expect(check.body as IntegrityCheckResponse).toMatchObject({
        status: 'ALTERED',
        valid: false,
      });
      const download = await get(
        `/documents/versions/${altered.latestVersion.id}/download`,
        'admin',
      ).expect(200);
      expect(download.headers['x-document-integrity']).toBe('ALTERED');

      // Sin archivo: la verificación informa MISSING y la descarga responde 404.
      await fs.rm(alteredPath);
      const missing = await get(
        `/documents/versions/${altered.latestVersion.id}/integrity`,
        'admin',
      ).expect(200);
      expect(missing.body as IntegrityCheckResponse).toMatchObject({
        status: 'MISSING',
        actualHash: null,
      });
      await get(
        `/documents/versions/${altered.latestVersion.id}/download`,
        'admin',
      ).expect(404);
    });
  },
);
