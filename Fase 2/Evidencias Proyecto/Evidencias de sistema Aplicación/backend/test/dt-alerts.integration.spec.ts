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
import type { DocumentResponse } from '../src/documents/types/documents.types.js';
import {
  addDays,
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../src/documents/utils/document-dates.util.js';
import type {
  DtAlert,
  DtAlertCollection,
  DtRegistrationResponse,
} from '../src/dt-alerts/types/dt-alerts.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP de las alertas de registro en la DT
// (SPRINT-2-T08) contra PostgreSQL real. Se omiten si no se define
// TEST_DATABASE_URL. Igual que en documents.integration.spec.ts, los datos van
// por HTTP (no se pueden envolver en una transacción revertida): usan el
// dominio @dt-alerts-test.moi-food.cl y un local propio, y se eliminan al
// finalizar. Los archivos se guardan en una carpeta temporal que también se
// elimina.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@dt-alerts-test.moi-food.cl';
const STORE_NAME = 'Subway DT Alerts Test';

function uniquePdf(): Buffer {
  return Buffer.from(`%PDF-1.7\n% prueba ${randomUUID()}\n`);
}

describe.skipIf(!databaseUrl)(
  'Alertas de registro en la DT (SPRINT-2-T08)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storagePath: string;
    let workerId: string;
    let adminId: string;
    const tokens: Record<string, string> = {};
    const today = businessDateOf(new Date());

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

    async function upload(
      documentTypeCode: string,
      title: string,
      issuedAt: string,
    ): Promise<DocumentResponse> {
      const res = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .field('workerId', workerId)
        .field('documentTypeCode', documentTypeCode)
        .field('title', title)
        .field('issuedAt', issuedAt)
        .attach('file', uniquePdf(), {
          filename: 'documento.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      return res.body as DocumentResponse;
    }

    // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
    function listAlerts(tokenName: string) {
      return request(app.getHttpServer())
        .get('/dt-alerts')
        .set('Authorization', `Bearer ${tokens[tokenName]}`);
    }

    function register(
      alertId: string,
      body: Record<string, unknown>,
      tokenName = 'admin',
    ) {
      return request(app.getHttpServer())
        .post(`/dt-alerts/${alertId}/registration`)
        .set('Authorization', `Bearer ${tokens[tokenName]}`)
        .send(body);
    }

    // Alertas de los documentos de este test (la BD puede tener otras).
    async function ownAlerts(): Promise<DtAlert[]> {
      const res = await listAlerts('admin').expect(200);
      return (res.body as DtAlertCollection).items.filter(
        (alert) => alert.worker.id === workerId,
      );
    }

    beforeAll(async () => {
      storagePath = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moi-food-dt-alerts-'),
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
      await createUser(ROLE.SUPERVISOR, 'supervisor', store.id);
      await createUser(ROLE.CONTADOR, 'contador', null);
      adminId = await createUser(ROLE.ADMINISTRADOR, 'admin', null);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
      await fs.rm(storagePath, { recursive: true, force: true });
    });

    it('lista vencidos y próximos a vencer con días restantes, sin los tipos que no exigen registro', async () => {
      const todayText = formatDbDate(toDbDate(today));
      const vigente = await upload('CONTRATO', 'Contrato vigente', todayText);
      const vencido = await upload('ANEXO', 'Anexo atrasado', '2026-01-05');
      const pacto = await upload('PACTO', 'Pacto de horas', todayText);

      const alerts = await ownAlerts();
      expect(alerts.map((alert) => alert.id)).toEqual([vencido.id, vigente.id]);
      expect(alerts.map((alert) => alert.documentId)).not.toContain(pacto.id);

      const [overdue, upcoming] = alerts;
      expect(overdue).toMatchObject({
        documentId: vencido.id,
        documentType: 'ANEXO',
        contractTitle: 'Anexo atrasado',
        deadline: '2026-01-20',
        status: 'OVERDUE',
        canRegister: true,
        worker: { id: workerId, name: 'trabajador Test' },
        store: { name: STORE_NAME },
      });
      expect(overdue.daysRemaining).toBeLessThan(0);
      expect(upcoming).toMatchObject({
        documentId: vigente.id,
        deadline: formatDbDate(toDbDate(addDays(today, 15))),
        daysRemaining: 15,
        status: 'UPCOMING',
      });
      expect(typeof upcoming.revision).toBe('string');
    });

    it('marca el registro con quién y cuándo, y la alerta deja de listarse', async () => {
      const contrato = await upload(
        'CONTRATO',
        'Contrato a registrar',
        '2026-10-01',
      );
      const alert = (await ownAlerts()).find(
        (item) => item.documentId === contrato.id,
      );
      expect(alert).toBeDefined();
      if (!alert) return;

      const res = await register(alert.id, {
        documentId: alert.documentId,
        revision: alert.revision,
      }).expect(200);
      const body = res.body as DtRegistrationResponse;
      expect(body).toMatchObject({
        alertId: alert.id,
        documentId: contrato.id,
        status: 'REGISTERED',
      });

      const document = await prisma.document.findUniqueOrThrow({
        where: { id: contrato.id },
      });
      expect(document.dtRegisteredById).toBe(adminId);
      expect(document.dtRegisteredAt?.toISOString()).toBe(body.registeredAt);
      expect((await ownAlerts()).map((item) => item.id)).not.toContain(
        alert.id,
      );

      // Una segunda confirmación (doble envío u otra pestaña) responde 409.
      await register(alert.id, {
        documentId: alert.documentId,
        revision: alert.revision,
      }).expect(409);
    });

    it('rechaza con 409 una revisión desactualizada y no registra', async () => {
      const contrato = await upload(
        'FINIQUITO',
        'Finiquito a registrar',
        '2026-10-10',
      );
      await register(contrato.id, {
        documentId: contrato.id,
        revision: '2000-01-01T00:00:00.000Z',
      }).expect(409);
      const document = await prisma.document.findUniqueOrThrow({
        where: { id: contrato.id },
      });
      expect(document.dtRegisteredAt).toBeNull();
    });

    it('valida la alerta y el cuerpo', async () => {
      const contrato = await upload(
        'CONTRATO',
        'Contrato validación',
        '2026-10-12',
      );
      const pacto = await upload('PACTO', 'Pacto validación', '2026-10-12');
      const revision = '2026-10-17T15:00:00.000Z';

      await register(contrato.id, {
        documentId: randomUUID(),
        revision,
      }).expect(400);
      await register(contrato.id, { documentId: contrato.id }).expect(400);
      await register('no-es-uuid', {
        documentId: contrato.id,
        revision,
      }).expect(400);
      const unknown = randomUUID();
      await register(unknown, { documentId: unknown, revision }).expect(404);
      // El pacto no exige registro en la DT: no tiene alerta.
      await register(pacto.id, { documentId: pacto.id, revision }).expect(404);
    });

    it('solo el administrador consulta y registra alertas', async () => {
      const contrato = await upload(
        'CONTRATO',
        'Contrato permisos',
        '2026-10-13',
      );
      const body = { documentId: contrato.id, revision: 'x' };
      for (const name of ['trabajador', 'supervisor', 'contador']) {
        await listAlerts(name).expect(403);
        await register(contrato.id, body, name).expect(403);
      }
      await request(app.getHttpServer()).get('/dt-alerts').expect(401);
    });
  },
);
