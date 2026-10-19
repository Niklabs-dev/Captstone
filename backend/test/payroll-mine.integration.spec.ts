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
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type {
  OwnPayslipIntegrity,
  OwnPayslipList,
  PayslipResponse,
} from '../src/payroll/types/payroll.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP de las liquidaciones publicadas del trabajador
// (SPRINT-2-T15, criterios 2 y 3 de E2-H1) contra PostgreSQL real. Se omiten
// si no se define TEST_DATABASE_URL. Las liquidaciones se cargan y publican
// por la API del contador: usan el dominio @payroll-mine-test.moi-food.cl y un
// local propio, y se eliminan al finalizar junto con la carpeta temporal de
// archivos.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@payroll-mine-test.moi-food.cl';
const STORE_NAME = 'Subway Payroll Mine Test';

function uniquePdf(): Buffer {
  return Buffer.from(`%PDF-1.7\n% liquidación ${randomUUID()}\n`);
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe.skipIf(!databaseUrl)(
  'Liquidaciones publicadas del trabajador (SPRINT-2-T15)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storagePath: string;
    let storeId: string;
    const ids: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    // Liquidaciones de prueba: publicada y pendiente del trabajador, y
    // publicada de otro trabajador.
    let published: PayslipResponse;
    let publishedContent: Buffer;
    let pending: PayslipResponse;
    let othersPublished: PayslipResponse;

    async function cleanup(): Promise<void> {
      // Las liquidaciones publicadas, las versiones y los documentos son
      // inmutables o deben conservarse: se purgan como mantenimiento con
      // session_replication_role = replica (superusuario de TEST_DATABASE_URL).
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        const where = { subjectUser: { email: { endsWith: DOMAIN } } };
        await tx.payslip.deleteMany({
          where: { worker: { email: { endsWith: DOMAIN } } },
        });
        await tx.documentVersion.deleteMany({ where: { document: where } });
        await tx.document.deleteMany({ where });
      });
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
      userStoreId: string | null,
    ): Promise<void> {
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
      ids[name] = user.id;
      tokens[name] = await jwt.signAsync(payload);
    }

    // Carga una liquidación como contador y, si se pide, la publica.
    async function createPayslip(
      workerName: string,
      period: string,
      content: Buffer,
      publish: boolean,
    ): Promise<PayslipResponse> {
      const uploaded = await request(app.getHttpServer())
        .post('/payroll')
        .set('Authorization', `Bearer ${tokens.contador}`)
        .field('workerId', ids[workerName])
        .field('period', period)
        .attach('file', content, {
          filename: `liquidacion-${period}.pdf`,
          contentType: 'application/pdf',
        })
        .expect(201);
      const payslip = uploaded.body as PayslipResponse;
      if (!publish) return payslip;
      const res = await request(app.getHttpServer())
        .post(`/payroll/${payslip.id}/publish`)
        .set('Authorization', `Bearer ${tokens.contador}`)
        .send({ revision: payslip.revision })
        .expect(200);
      return res.body as PayslipResponse;
    }

    async function filePathOf(payslipId: string): Promise<string> {
      const payslip = await prisma.payslip.findUniqueOrThrow({
        where: { id: payslipId },
        include: { document: { include: { currentVersion: true } } },
      });
      return path.join(
        storagePath,
        payslip.document.currentVersion?.filePath ?? '',
      );
    }

    // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
    function get(url: string, tokenName: string) {
      return request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${tokens[tokenName]}`);
    }

    beforeAll(async () => {
      storagePath = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moi-food-payroll-mine-'),
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
      await createUser(ROLE.TRABAJADOR, 'trabajador', store.id);
      await createUser(ROLE.TRABAJADOR, 'otro', store.id);
      await createUser(ROLE.SUPERVISOR, 'supervisor', store.id);
      await createUser(ROLE.CONTADOR, 'contador', null);
      await createUser(ROLE.ADMINISTRADOR, 'admin', null);

      publishedContent = uniquePdf();
      published = await createPayslip(
        'trabajador',
        '2026-09',
        publishedContent,
        true,
      );
      pending = await createPayslip(
        'trabajador',
        '2026-08',
        uniquePdf(),
        false,
      );
      othersPublished = await createPayslip(
        'otro',
        '2026-09',
        uniquePdf(),
        true,
      );
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
      await fs.rm(storagePath, { recursive: true, force: true });
    });

    it('lista solo las liquidaciones publicadas del trabajador del token', async () => {
      const res = await get('/payroll/mine', 'trabajador').expect(200);
      const body = res.body as OwnPayslipList;
      expect(body.items).toHaveLength(1);
      const version = await prisma.payslip.findUniqueOrThrow({
        where: { id: published.id },
        include: { document: true },
      });
      expect(body.items[0]).toEqual({
        id: published.id,
        versionId: version.document.currentVersionId,
        workerId: ids.trabajador,
        period: '2026-09',
        status: 'PUBLISHED',
        fileName: 'liquidacion-2026-09.pdf',
        mime: 'application/pdf',
        size: publishedContent.length,
        sha256: sha256(publishedContent),
        signedAt: published.signedAt,
        publishedAt: published.publishedAt,
      });
      // Ni la pendiente de firma ni la de otro trabajador.
      const listed = body.items.map((item) => item.id);
      expect(listed).not.toContain(pending.id);
      expect(listed).not.toContain(othersPublished.id);

      // El trabajador sale del token: un parámetro no cambia el resultado.
      const withParam = await get(
        `/payroll/mine?workerId=${ids.otro}`,
        'trabajador',
      ).expect(200);
      expect(
        (withParam.body as OwnPayslipList).items.map((item) => item.id),
      ).toEqual([published.id]);

      // Un supervisor sin liquidaciones obtiene una lista vacía.
      const supervisor = await get('/payroll/mine', 'supervisor').expect(200);
      expect((supervisor.body as OwnPayslipList).items).toEqual([]);
    });

    it('descarga la liquidación propia verificando su integridad y queda auditada', async () => {
      const res = await get(
        `/payroll/mine/${published.id}/download`,
        'trabajador',
      )
        // Entrega el cuerpo binario como Buffer.
        .responseType('blob')
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-document-integrity']).toBe('VALID');
      expect(res.headers['content-disposition']).toContain(
        'filename="LIQUIDACION_Liquidacion-de-sueldo-2026-09_v1.pdf"',
      );
      expect(sha256(res.body as Buffer)).toBe(sha256(publishedContent));

      const [audit] = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTION.PAYSLIP_DOWNLOADED,
          entityId: published.id,
        },
      });
      expect(audit).toMatchObject({
        entityType: 'payslips',
        userId: ids.trabajador,
        storeId,
        detail: { integrity: 'VALID' },
      });

      const integrity = await get(
        `/payroll/mine/${published.id}/integrity`,
        'trabajador',
      ).expect(200);
      expect(integrity.body as OwnPayslipIntegrity).toMatchObject({
        payslipId: published.id,
        workerId: ids.trabajador,
        status: 'VALID',
        valid: true,
        expectedHash: sha256(publishedContent),
        actualHash: sha256(publishedContent),
      });
    });

    it('no entrega liquidaciones ajenas ni pendientes de firma (404)', async () => {
      for (const id of [othersPublished.id, pending.id, randomUUID()]) {
        await get(`/payroll/mine/${id}/download`, 'trabajador').expect(404);
        await get(`/payroll/mine/${id}/integrity`, 'trabajador').expect(404);
      }
      await get('/payroll/mine/no-es-uuid/download', 'trabajador').expect(400);
    });

    it('solo trabajadores y supervisores acceden a sus liquidaciones', async () => {
      await get('/payroll/mine', 'contador').expect(403);
      await get('/payroll/mine', 'admin').expect(403);
      await get(`/payroll/mine/${published.id}/download`, 'contador').expect(
        403,
      );
      await request(app.getHttpServer()).get('/payroll/mine').expect(401);
    });

    it('advierte un archivo alterado y responde 404 si falta', async () => {
      const filePath = await filePathOf(othersPublished.id);
      await fs.appendFile(filePath, 'modificado');

      const check = await get(
        `/payroll/mine/${othersPublished.id}/integrity`,
        'otro',
      ).expect(200);
      expect(check.body as OwnPayslipIntegrity).toMatchObject({
        status: 'ALTERED',
        valid: false,
        expectedHash: othersPublished.sha256,
      });
      const download = await get(
        `/payroll/mine/${othersPublished.id}/download`,
        'otro',
      ).expect(200);
      expect(download.headers['x-document-integrity']).toBe('ALTERED');

      await fs.rm(filePath);
      const missing = await get(
        `/payroll/mine/${othersPublished.id}/integrity`,
        'otro',
      ).expect(200);
      expect(missing.body as OwnPayslipIntegrity).toMatchObject({
        status: 'MISSING',
        actualHash: null,
      });
      await get(`/payroll/mine/${othersPublished.id}/download`, 'otro').expect(
        404,
      );
    });
  },
);
