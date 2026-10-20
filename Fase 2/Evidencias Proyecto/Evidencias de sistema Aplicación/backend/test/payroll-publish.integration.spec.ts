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
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../src/documents/utils/document-dates.util.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type {
  PayslipCollection,
  PayslipResponse,
} from '../src/payroll/types/payroll.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP de la publicación de liquidaciones (SPRINT-2-T14)
// contra PostgreSQL real. Se omiten si no se define TEST_DATABASE_URL. Igual
// que en payroll.integration.spec.ts, los datos van por HTTP: usan el dominio
// @payroll-publish-test.moi-food.cl y un local propio, y se eliminan al
// finalizar junto con la carpeta temporal de archivos.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@payroll-publish-test.moi-food.cl';
const STORE_NAME = 'Subway Payroll Publish Test';

function uniquePdf(): Buffer {
  return Buffer.from(`%PDF-1.7\n% liquidación ${randomUUID()}\n`);
}

describe.skipIf(!databaseUrl)(
  'Publicación de liquidaciones (SPRINT-2-T14)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storagePath: string;
    let storeId: string;
    const ids: Record<string, string> = {};
    const tokens: Record<string, string> = {};

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

    async function uploadPayslip(period: string): Promise<PayslipResponse> {
      const res = await request(app.getHttpServer())
        .post('/payroll')
        .set('Authorization', `Bearer ${tokens.contador}`)
        .field('workerId', ids.trabajador)
        .field('period', period)
        .attach('file', uniquePdf(), {
          filename: `liquidacion-${period}.pdf`,
          contentType: 'application/pdf',
        })
        .expect(201);
      return res.body as PayslipResponse;
    }

    // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
    function publish(
      id: string,
      body: Record<string, unknown>,
      tokenName = 'contador',
    ) {
      return request(app.getHttpServer())
        .post(`/payroll/${id}/publish`)
        .set('Authorization', `Bearer ${tokens[tokenName]}`)
        .send(body);
    }

    beforeAll(async () => {
      storagePath = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moi-food-payroll-publish-'),
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
      await createUser(ROLE.CONTADOR, 'contador', null);
      await createUser(ROLE.ADMINISTRADOR, 'admin', null);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
      await fs.rm(storagePath, { recursive: true, force: true });
    });

    it('el contador publica una liquidación pendiente y queda auditada con responsable y fecha', async () => {
      const pending = await uploadPayslip('2026-09');
      const res = await publish(pending.id, {
        revision: pending.revision,
      }).expect(200);
      const published = res.body as PayslipResponse;

      const today = formatDbDate(toDbDate(businessDateOf(new Date())));
      expect(published).toMatchObject({
        id: pending.id,
        worker: pending.worker,
        period: '2026-09',
        sha256: pending.sha256,
        fileName: pending.fileName,
        createdAt: pending.createdAt,
        status: 'PUBLISHED',
        signedAt: today,
        canPublish: false,
      });
      expect(published.publishedAt).not.toBeNull();
      expect(published.revision).not.toBe(pending.revision);

      const stored = await prisma.payslip.findUniqueOrThrow({
        where: { id: pending.id },
      });
      expect(stored.publishedById).toBe(ids.contador);

      const [audit] = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTION.PAYSLIP_PUBLISHED,
          entityId: pending.id,
        },
      });
      expect(audit).toMatchObject({
        entityType: 'payslips',
        userId: ids.contador,
        storeId,
        detail: {
          workerId: ids.trabajador,
          period: '2026-09',
          signedAt: today,
          publishedAt: published.publishedAt,
          sha256: pending.sha256,
        },
      });

      // El listado la muestra publicada y sin acción de publicar.
      const list = await request(app.getHttpServer())
        .get(`/payroll?storeId=${storeId}&status=PUBLISHED`)
        .set('Authorization', `Bearer ${tokens.contador}`)
        .expect(200);
      expect(
        (list.body as PayslipCollection).items.map((item) => [
          item.id,
          item.canPublish,
        ]),
      ).toEqual([[pending.id, false]]);
    });

    it('solo permite publicar una vez y con la revisión vigente', async () => {
      const pending = await uploadPayslip('2026-08');
      await publish(pending.id, { revision: 'revision-antigua' }).expect(409);
      await publish(pending.id, {
        revision: pending.revision,
        signedAt: '2099-01-01',
      }).expect(400);

      await publish(pending.id, { revision: pending.revision }).expect(200);
      // Ya publicada: no vuelve a publicarse ni se puede cargar otra para el período.
      await publish(pending.id, { revision: pending.revision }).expect(409);
      await request(app.getHttpServer())
        .post('/payroll')
        .set('Authorization', `Bearer ${tokens.contador}`)
        .field('workerId', ids.trabajador)
        .field('period', '2026-08')
        .attach('file', uniquePdf(), {
          filename: 'otra.pdf',
          contentType: 'application/pdf',
        })
        .expect(409);
    });

    it('acepta una fecha de firma entre la carga y hoy', async () => {
      const pending = await uploadPayslip('2026-07');
      const uploadedOn = formatDbDate(
        toDbDate(businessDateOf(new Date(pending.createdAt))),
      );
      const res = await publish(pending.id, {
        revision: pending.revision,
        signedAt: uploadedOn,
      }).expect(200);
      expect((res.body as PayslipResponse).signedAt).toBe(uploadedOn);
    });

    it('no publica un archivo alterado', async () => {
      const pending = await uploadPayslip('2026-06');
      const stored = await prisma.payslip.findUniqueOrThrow({
        where: { id: pending.id },
        include: { document: { include: { currentVersion: true } } },
      });
      await fs.appendFile(
        path.join(storagePath, stored.document.currentVersion?.filePath ?? ''),
        'modificado',
      );
      await publish(pending.id, { revision: pending.revision }).expect(409);
      expect(
        (await prisma.payslip.findUniqueOrThrow({ where: { id: pending.id } }))
          .status,
      ).toBe('PENDING_SIGNATURE');
    });

    it('solo el contador publica; valida el ID y la existencia', async () => {
      const pending = await uploadPayslip('2026-05');
      await publish(pending.id, { revision: pending.revision }, 'admin').expect(
        403,
      );
      await publish(
        pending.id,
        { revision: pending.revision },
        'trabajador',
      ).expect(403);
      await publish(randomUUID(), { revision: pending.revision }).expect(404);
      await publish('no-es-uuid', { revision: pending.revision }).expect(400);
      await publish(pending.id, {}).expect(400);
      await request(app.getHttpServer())
        .post(`/payroll/${pending.id}/publish`)
        .send({ revision: pending.revision })
        .expect(401);
    });
  },
);
