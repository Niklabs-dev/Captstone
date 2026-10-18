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
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import type { DocumentResponse } from '../src/documents/types/documents.types.js';
import type { DtAlertCollection } from '../src/dt-alerts/types/dt-alerts.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP de la auditoría del gestor documental
// (SPRINT-2-T09) contra PostgreSQL real. Se omiten si no se define
// TEST_DATABASE_URL. Los datos van por HTTP (no se pueden envolver en una
// transacción revertida): usan el dominio @documents-audit-test.moi-food.cl y
// un local propio, y se eliminan al finalizar junto con su auditoría
// (purgeTestAuditLogs). Los archivos se guardan en una carpeta temporal que
// también se elimina.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@documents-audit-test.moi-food.cl';
const STORE_NAME = 'Subway Documents Audit Test';
const USER_AGENT = 'documents-audit-test-agent';

function uniquePdf(marker: string): Buffer {
  return Buffer.from(`%PDF-1.7\n% ${marker} ${randomUUID()}\n`);
}

describe.skipIf(!databaseUrl)(
  'Auditoría del gestor documental (SPRINT-2-T09)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storagePath: string;
    let storeId: string;
    let workerId: string;
    let adminId: string;
    const tokens: Record<string, string> = {};
    const auditScope = {
      OR: [
        { user: { email: { endsWith: DOMAIN } } },
        { store: { name: STORE_NAME } },
      ],
    };

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
      await purgeTestAuditLogs(prisma, auditScope);
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({ where: { name: STORE_NAME } });
    }

    async function createUser(
      roleCode: RoleCode,
      name: string,
      userStoreId: string | null,
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
          storeId: userStoreId,
        },
      });
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: roleCode,
        storeId: userStoreId,
      };
      tokens[name] = await jwt.signAsync(payload);
      return user.id;
    }

    // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
    function call(
      method: 'get' | 'post' | 'delete',
      url: string,
      tokenName = 'admin',
    ) {
      return request(app.getHttpServer())
        [method](url)
        .set('Authorization', `Bearer ${tokens[tokenName]}`)
        .set('User-Agent', USER_AGENT);
    }

    async function upload(
      fields: Record<string, string>,
      content: Buffer,
    ): Promise<DocumentResponse> {
      const req = call('post', '/documents').field('workerId', workerId);
      for (const [name, value] of Object.entries(fields)) {
        req.field(name, value);
      }
      const res = await req
        .attach('file', content, {
          filename: 'documento.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      return res.body as DocumentResponse;
    }

    // El registro de una acción sobre una entidad, dentro del alcance de este
    // archivo.
    function auditOf(action: string, entityId: string) {
      return prisma.auditLog.findMany({
        where: { ...auditScope, action, entityId },
      });
    }

    beforeAll(async () => {
      storagePath = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moi-food-docs-audit-'),
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
      storeId = store.id;
      workerId = await createUser(ROLE.TRABAJADOR, 'trabajador', store.id);
      adminId = await createUser(ROLE.ADMINISTRADOR, 'admin', null);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
      await fs.rm(storagePath, { recursive: true, force: true });
    });

    it('registra la carga y la nueva versión con el local del documento, sin el contenido del archivo', async () => {
      const content = uniquePdf('contenido-secreto');
      const contrato = await upload(
        {
          documentTypeCode: 'CONTRATO',
          title: 'Contrato auditado',
          issuedAt: '2026-10-01',
        },
        content,
      );
      const [uploaded] = await auditOf(
        AUDIT_ACTION.DOCUMENT_UPLOADED,
        contrato.id,
      );
      expect(uploaded).toMatchObject({
        entityType: 'documents',
        userId: adminId,
        storeId,
        userAgent: USER_AGENT,
        detail: {
          workerId,
          documentTypeCode: 'CONTRATO',
          versionId: contrato.latestVersion.id,
          versionNumber: 1,
          sha256: contrato.latestVersion.sha256,
        },
      });
      expect(JSON.stringify(uploaded.detail)).not.toContain(
        'contenido-secreto',
      );

      const v2 = await upload(
        { documentTypeCode: 'CONTRATO', documentId: contrato.id },
        uniquePdf('v2'),
      );
      const [version] = await auditOf(
        AUDIT_ACTION.DOCUMENT_VERSION_ADDED,
        contrato.id,
      );
      expect(version).toMatchObject({
        storeId,
        detail: { versionId: v2.latestVersion.id, versionNumber: 2 },
      });
      // La nueva versión no se registra además como carga.
      expect(
        await auditOf(AUDIT_ACTION.DOCUMENT_UPLOADED, contrato.id),
      ).toHaveLength(1);
    });

    it('registra la descarga con la versión, el local y el resultado de integridad', async () => {
      const contrato = await upload(
        {
          documentTypeCode: 'CONTRATO',
          title: 'Contrato descargado',
          issuedAt: '2026-10-02',
        },
        uniquePdf('descarga'),
      );
      const versionId = contrato.latestVersion.id;
      await call(
        'get',
        `/documents/versions/${versionId}/download`,
        'trabajador',
      ).expect(200);

      const [downloaded] = await auditOf(
        AUDIT_ACTION.DOCUMENT_DOWNLOADED,
        versionId,
      );
      expect(downloaded).toMatchObject({
        entityType: 'document_versions',
        userId: workerId,
        storeId,
        detail: { documentId: contrato.id, integrity: 'VALID' },
      });

      // Una descarga rechazada (403/404) no es una descarga.
      await call('get', `/documents/versions/${randomUUID()}/download`).expect(
        404,
      );
      expect(
        await prisma.auditLog.count({
          where: { ...auditScope, action: AUDIT_ACTION.DOCUMENT_DOWNLOADED },
        }),
      ).toBe(1);
    });

    it('registra el intento de eliminación bloqueado y la eliminación vencido el plazo', async () => {
      const vigente = await upload(
        {
          documentTypeCode: 'CONTRATO',
          title: 'Contrato vigente',
          issuedAt: '2026-10-03',
        },
        uniquePdf('vigente'),
      );
      await call('delete', `/documents/${vigente.id}`).expect(409);
      const [blocked] = await auditOf(
        AUDIT_ACTION.DOCUMENT_DELETION_BLOCKED,
        vigente.id,
      );
      expect(blocked).toMatchObject({
        entityType: 'documents',
        userId: adminId,
      });

      const vencido = await upload(
        {
          documentTypeCode: 'CONTRATO',
          title: 'Contrato vencido',
          issuedAt: '2020-03-02',
        },
        uniquePdf('vencido'),
      );
      await call('delete', `/documents/${vencido.id}`).expect(200);
      const [deleted] = await auditOf(
        AUDIT_ACTION.DOCUMENT_DELETED,
        vencido.id,
      );
      expect(deleted).toMatchObject({
        userId: adminId,
        storeId,
        detail: { retainUntil: '2025-03-02', deletedVersions: 1 },
      });

      // Un 404 no es un intento de eliminar un documento con plazo vigente.
      const unknown = randomUUID();
      await call('delete', `/documents/${unknown}`).expect(404);
      expect(
        await auditOf(AUDIT_ACTION.DOCUMENT_DELETION_BLOCKED, unknown),
      ).toHaveLength(0);
    });

    it('registra la confirmación del registro en la DT', async () => {
      const contrato = await upload(
        {
          documentTypeCode: 'CONTRATO',
          title: 'Contrato DT',
          issuedAt: '2026-10-04',
        },
        uniquePdf('dt'),
      );
      const alerts = (await call('get', '/dt-alerts').expect(200))
        .body as DtAlertCollection;
      const alert = alerts.items.find((item) => item.id === contrato.id);
      expect(alert).toBeDefined();
      if (!alert) return;

      const res = await call('post', `/dt-alerts/${alert.id}/registration`)
        .send({ documentId: alert.documentId, revision: alert.revision })
        .expect(200);
      const [registered] = await auditOf(
        AUDIT_ACTION.DOCUMENT_DT_REGISTERED,
        contrato.id,
      );
      expect(registered).toMatchObject({
        entityType: 'documents',
        userId: adminId,
        storeId,
        detail: {
          registeredAt: (res.body as { registeredAt: string }).registeredAt,
        },
      });
    });
  },
);
