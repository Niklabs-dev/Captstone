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
import type { DocumentListResponse } from '../src/documents/types/documents.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type {
  PayslipCollection,
  PayslipResponse,
} from '../src/payroll/types/payroll.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP de la carga y consulta de liquidaciones
// (SPRINT-2-T13) contra PostgreSQL real. Se omiten si no se define
// TEST_DATABASE_URL. Los datos van por HTTP (no se pueden envolver en una
// transacción revertida): usan el dominio @payroll-test.moi-food.cl y un local
// propio, y se eliminan al finalizar. Los archivos se guardan en una carpeta
// temporal que también se elimina.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@payroll-test.moi-food.cl';
const STORE_NAME = 'Subway Payroll Test';

function uniquePdf(): Buffer {
  return Buffer.from(`%PDF-1.7\n% liquidación ${randomUUID()}\n`);
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe.skipIf(!databaseUrl)(
  'Carga y consulta de liquidaciones (SPRINT-2-T13)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storagePath: string;
    let storeId: string;
    const ids: Record<string, string> = {};
    const tokens: Record<string, string> = {};

    async function cleanup(): Promise<void> {
      // Las versiones son inmutables y los documentos deben conservarse: se
      // purgan como mantenimiento con session_replication_role = replica
      // (superusuario de TEST_DATABASE_URL), igual que purgeTestAuditLogs.
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
      isActive = true,
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
          isActive,
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

    // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
    function upload(
      fields: { workerId: string; period: string },
      content: Buffer,
      tokenName = 'contador',
      filename = 'liquidacion.pdf',
    ) {
      return request(app.getHttpServer())
        .post('/payroll')
        .set('Authorization', `Bearer ${tokens[tokenName]}`)
        .field('workerId', fields.workerId)
        .field('period', fields.period)
        .attach('file', content, {
          filename,
          contentType: filename.endsWith('.png')
            ? 'image/png'
            : 'application/pdf',
        });
    }

    function get(url: string, tokenName: string) {
      return request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${tokens[tokenName]}`);
    }

    beforeAll(async () => {
      storagePath = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moi-food-payroll-'),
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
      await createUser(ROLE.SUPERVISOR, 'supervisor', store.id);
      await createUser(ROLE.TRABAJADOR, 'inactivo', store.id, false);
      await createUser(ROLE.CONTADOR, 'contador', null);
      await createUser(ROLE.ADMINISTRADOR, 'admin', null);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
      await fs.rm(storagePath, { recursive: true, force: true });
    });

    it('el contador carga una liquidación pendiente de firma guardada en el gestor documental', async () => {
      const content = uniquePdf();
      const res = await upload(
        { workerId: ids.trabajador, period: '2026-08' },
        content,
        'contador',
        'liquidación-agosto.pdf',
      ).expect(201);
      const payslip = res.body as PayslipResponse;

      expect(payslip).toMatchObject({
        worker: {
          id: ids.trabajador,
          name: 'trabajador Test',
          store: { id: storeId, name: STORE_NAME },
          isActive: true,
        },
        period: '2026-08',
        fileName: 'liquidación-agosto.pdf',
        size: content.length,
        sha256: sha256(content),
        status: 'PENDING_SIGNATURE',
        signedAt: null,
        publishedAt: null,
        canPublish: true,
      });

      // El archivo queda como documento LIQUIDACION versionado, con su hash.
      const stored = await prisma.payslip.findUniqueOrThrow({
        where: { id: payslip.id },
        include: {
          document: {
            include: { documentType: true, currentVersion: true },
          },
        },
      });
      expect(stored.document.documentType.code).toBe('LIQUIDACION');
      expect(stored.document.subjectUserId).toBe(ids.trabajador);
      expect(stored.document.currentVersion).toMatchObject({
        versionNumber: 1,
        sha256Hash: sha256(content),
        mimeType: 'application/pdf',
      });
      const file = await fs.readFile(
        path.join(storagePath, stored.document.currentVersion?.filePath ?? ''),
      );
      expect(sha256(file)).toBe(sha256(content));

      // Queda auditada con el local de la liquidación, sin el contenido.
      const [audit] = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTION.PAYSLIP_UPLOADED,
          entityId: payslip.id,
        },
      });
      expect(audit).toMatchObject({
        entityType: 'payslips',
        userId: ids.contador,
        storeId,
        detail: {
          workerId: ids.trabajador,
          period: '2026-08',
          sha256: sha256(content),
          status: 'PENDING_SIGNATURE',
        },
      });

      // No es visible para el trabajador: no aparece entre sus documentos.
      const own = await get('/documents', 'trabajador').expect(200);
      expect(
        (own.body as DocumentListResponse).items.map((item) => item.id),
      ).not.toContain(stored.documentId);
    });

    it('lista liquidaciones, trabajadores activos y reglas de carga al contador y al administrador', async () => {
      const contador = await get('/payroll', 'contador').expect(200);
      const body = contador.body as PayslipCollection;
      const mine = body.items.filter(
        (item) => item.worker.store.id === storeId,
      );
      expect(mine.length).toBeGreaterThan(0);
      expect(body.policy).toEqual({
        maxBytes: 1024 * 1024,
        allowedMimes: ['application/pdf'],
        canUpload: true,
      });
      // Selector: trabajadores y supervisores activos con local, sin datos extra.
      const workers = body.workers.filter(
        (worker) => worker.store.id === storeId,
      );
      expect(workers.map((worker) => worker.id).sort()).toEqual(
        [ids.trabajador, ids.supervisor].sort(),
      );
      expect(Object.keys(workers[0]).sort()).toEqual([
        'id',
        'isActive',
        'name',
        'store',
      ]);

      // El administrador consulta, pero no carga ni publica.
      const admin = await get(`/payroll?storeId=${storeId}`, 'admin').expect(
        200,
      );
      const adminBody = admin.body as PayslipCollection;
      expect(adminBody.policy.canUpload).toBe(false);
      expect(adminBody.items.length).toBe(mine.length);
      expect(adminBody.items.every((item) => !item.canPublish)).toBe(true);

      // Filtros por período y estado.
      const filtered = await get(
        `/payroll?storeId=${storeId}&period=2026-08&status=PENDING_SIGNATURE`,
        'contador',
      ).expect(200);
      expect(
        (filtered.body as PayslipCollection).items.map((item) => item.period),
      ).toEqual(['2026-08']);
      await get('/payroll?period=2026-13', 'contador').expect(400);
    });

    it('solo el contador carga; trabajadores y supervisores no acceden', async () => {
      const fields = { workerId: ids.trabajador, period: '2026-07' };
      await upload(fields, uniquePdf(), 'admin').expect(403);
      await upload(fields, uniquePdf(), 'trabajador').expect(403);
      await get('/payroll', 'trabajador').expect(403);
      await get('/payroll', 'supervisor').expect(403);
      await request(app.getHttpServer()).get('/payroll').expect(401);
    });

    it('rechaza una segunda liquidación del mismo trabajador y período, y un archivo ya registrado', async () => {
      const content = uniquePdf();
      await upload(
        { workerId: ids.supervisor, period: '2026-06' },
        content,
      ).expect(201);
      await upload(
        { workerId: ids.supervisor, period: '2026-06' },
        uniquePdf(),
      ).expect(409);
      // Mismo archivo para otro período: el hash ya está registrado.
      await upload(
        { workerId: ids.supervisor, period: '2026-05' },
        content,
      ).expect(409);
      expect(
        await prisma.payslip.count({ where: { workerId: ids.supervisor } }),
      ).toBe(1);
    });

    it('valida el período, el trabajador, el archivo y su tipo', async () => {
      // Período inválido o posterior al mes en curso.
      await upload(
        { workerId: ids.trabajador, period: '2026-13' },
        uniquePdf(),
      ).expect(400);
      await upload(
        { workerId: ids.trabajador, period: '2099-01' },
        uniquePdf(),
      ).expect(400);
      // Trabajador inactivo, inexistente o que no es trabajador.
      await upload(
        { workerId: ids.inactivo, period: '2026-08' },
        uniquePdf(),
      ).expect(400);
      await upload(
        { workerId: randomUUID(), period: '2026-08' },
        uniquePdf(),
      ).expect(404);
      await upload(
        { workerId: ids.contador, period: '2026-08' },
        uniquePdf(),
      ).expect(400);
      // Solo PDF: una imagen PNG válida se rechaza.
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from(randomUUID()),
      ]);
      await upload(
        { workerId: ids.trabajador, period: '2026-04' },
        png,
        'contador',
        'liquidacion.png',
      ).expect(415);
      // Sin archivo.
      await request(app.getHttpServer())
        .post('/payroll')
        .set('Authorization', `Bearer ${tokens.contador}`)
        .field('workerId', ids.trabajador)
        .field('period', '2026-04')
        .expect(400);
      expect(
        await prisma.payslip.count({
          where: { workerId: { in: [ids.trabajador, ids.inactivo] } },
        }),
      ).toBe(1);
    });
  },
);
