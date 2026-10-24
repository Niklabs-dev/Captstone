import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { StoreResponse } from '../src/stores/types/stores.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

interface ErrorResponse {
  message: string | string[];
}

const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@stores-test.moi-food.cl';
const STORE_PREFIX = 'Subway Stores Test';
const DOCUMENT_PREFIX = 'Subway Stores Test Document';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

function storePayload(suffix: string, extra: object = {}): object {
  return {
    name: `${STORE_PREFIX} ${suffix}`,
    city: 'Melipilla',
    address: 'Calle de prueba 123',
    ...extra,
  };
}

describe.skipIf(!databaseUrl)(
  'Administración de locales (SPRINT-3-T01)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let adminId: string;
    let adminToken: string;

    async function cleanup(): Promise<void> {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.document.deleteMany({
          where: { title: { startsWith: DOCUMENT_PREFIX } },
        });
      });
      await purgeTestAuditLogs(prisma, {
        user: { email: { endsWith: DOMAIN } },
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({
        where: { name: { contains: STORE_PREFIX, mode: 'insensitive' } },
      });
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
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

      for (const code of Object.values(ROLE)) {
        await prisma.role.upsert({
          where: { code },
          update: {},
          create: { code, name: code },
        });
      }
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { code: ROLE.ADMINISTRADOR },
      });
      const admin = await prisma.user.create({
        data: {
          email: `admin${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Admin',
          lastName: 'Stores',
          roleId: adminRole.id,
        },
      });
      adminId = admin.id;
      adminToken = await tokenFor(adminId, ROLE.ADMINISTRADOR, null);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
    });

    function tokenFor(
      sub: string,
      role: RoleCode,
      tokenStoreId: string | null,
    ): Promise<string> {
      const payload: JwtPayload = {
        sub,
        email: `token${DOMAIN}`,
        role,
        storeId: tokenStoreId,
      };
      return jwt.signAsync(payload);
    }

    function createStore(body: object, token = adminToken) {
      return request(app.getHttpServer())
        .post('/stores')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function listStores(query = '', token = adminToken) {
      return request(app.getHttpServer())
        .get(`/stores${query}`)
        .set('Authorization', `Bearer ${token}`);
    }

    function updateStore(id: string, body: object, token = adminToken) {
      return request(app.getHttpServer())
        .patch(`/stores/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function changeState(
      id: string,
      action: 'deactivate' | 'reactivate',
      token = adminToken,
    ) {
      return request(app.getHttpServer())
        .patch(`/stores/${id}/${action}`)
        .set('Authorization', `Bearer ${token}`);
    }

    async function createWorker(
      storeId: string,
      suffix: string,
      isActive = true,
    ): Promise<string> {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: ROLE.TRABAJADOR },
      });
      const worker = await prisma.user.create({
        data: {
          email: `${suffix}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Trabajador',
          lastName: 'Stores',
          roleId: role.id,
          storeId,
          isActive,
        },
      });
      return worker.id;
    }

    it('crea, normaliza, lista y edita un local', async () => {
      const response = await createStore({
        name: `  ${STORE_PREFIX}   Alta  `,
        city: '  Melipilla   Centro ',
        address: '  Calle   de prueba   123 ',
      }).expect(201);
      const created = response.body as StoreResponse;

      expect(created).toMatchObject({
        name: `${STORE_PREFIX} Alta`,
        city: 'Melipilla Centro',
        address: 'Calle de prueba 123',
        isActive: true,
      });

      const active = (await listStores('?isActive=true').expect(200))
        .body as StoreResponse[];
      expect(active.some((store) => store.id === created.id)).toBe(true);

      const updatedResponse = await updateStore(created.id, {
        name: `  ${STORE_PREFIX}   Editado `,
        city: '  Quillota ',
        address: '  Nueva   dirección   456 ',
      }).expect(200);
      expect(updatedResponse.body as StoreResponse).toMatchObject({
        id: created.id,
        name: `${STORE_PREFIX} Editado`,
        city: 'Quillota',
        address: 'Nueva dirección 456',
      });

      await changeState(created.id, 'deactivate').expect(200);
      const inactive = (await listStores('?isActive=false').expect(200))
        .body as StoreResponse[];
      expect(inactive.some((store) => store.id === created.id)).toBe(true);
    });

    it('valida campos obligatorios, filtros, actualizaciones vacías e IDs', async () => {
      for (const body of [
        {},
        storePayload('Inválido', { name: '   ' }),
        storePayload('Inválido', { city: '' }),
        storePayload('Inválido', { address: '  ' }),
        storePayload('Inválido', { name: 'x'.repeat(101) }),
        storePayload('Inválido', { campoExtra: true }),
      ]) {
        await createStore(body).expect(400);
      }
      await listStores('?isActive=quizas').expect(400);

      const created = (
        await createStore(storePayload('Validación')).expect(201)
      ).body as StoreResponse;
      await updateStore(created.id, {}).expect(400);
      await updateStore(created.id, { campoExtra: true }).expect(400);

      await updateStore('no-uuid', { city: 'Melipilla' }).expect(400);
      await changeState('no-uuid', 'deactivate').expect(400);
      await changeState('no-uuid', 'reactivate').expect(400);
      await updateStore(MISSING_ID, { city: 'Melipilla' }).expect(404);
      await changeState(MISSING_ID, 'deactivate').expect(404);
      await changeState(MISSING_ID, 'reactivate').expect(404);
    });

    it('rechaza null en PATCH sin provocar errores de servidor', async () => {
      const store = (await createStore(storePayload('Patch null')).expect(201))
        .body as StoreResponse;

      for (const field of ['name', 'city', 'address']) {
        await updateStore(store.id, { [field]: null }).expect(400);
      }

      expect(
        await prisma.store.findUniqueOrThrow({ where: { id: store.id } }),
      ).toMatchObject({
        name: store.name,
        city: store.city,
        address: store.address,
      });
    });

    it('rechaza caracteres invisibles y valores sin contenido significativo', async () => {
      const invalidValues = [
        { name: '\u200b', city: '\u200b', address: '\u200b' },
        { name: '---', city: 'Melipilla', address: 'Calle 123' },
        { name: 'Local', city: '...', address: 'Calle 123' },
        { name: 'Local', city: 'Melipilla', address: '!!!' },
        { name: '1', city: '2', address: '3' },
      ];
      for (const [index, values] of invalidValues.entries()) {
        await createStore(
          storePayload(`Sin contenido ${index}`, values),
        ).expect(400);
      }

      const store = (
        await createStore(storePayload('Contenido válido')).expect(201)
      ).body as StoreResponse;
      for (const field of ['name', 'city', 'address']) {
        await updateStore(store.id, { [field]: '\u200b' }).expect(400);
        await updateStore(store.id, { [field]: '---' }).expect(400);
      }
      expect(
        await prisma.store.findUniqueOrThrow({ where: { id: store.id } }),
      ).toMatchObject({
        name: store.name,
        city: store.city,
        address: store.address,
      });
    });

    it('rechaza duplicados normalizados y conserva la unicidad en PostgreSQL', async () => {
      const first = (await createStore(storePayload('Duplicado')).expect(201))
        .body as StoreResponse;
      const duplicate = await createStore({
        name: `  ${STORE_PREFIX.toUpperCase()}    DUPLICADO `,
        city: 'Melipilla',
        address: 'Otra dirección 456',
      }).expect(409);
      expect((duplicate.body as ErrorResponse).message).toBe(
        'Ya existe un local con ese nombre',
      );
      await createStore({
        name: `${STORE_PREFIX} Dúplicado`,
        city: 'Melipilla',
        address: 'Duplicado con tilde 456',
      }).expect(409);

      await updateStore(first.id, {
        name: `${STORE_PREFIX.toUpperCase()} DUPLICADO`,
      }).expect(200);
      const second = (
        await createStore(storePayload('Otro nombre')).expect(201)
      ).body as StoreResponse;
      await updateStore(second.id, {
        name: ` ${STORE_PREFIX}   DUPLICADO `,
      }).expect(409);

      await expect(
        prisma.store.create({
          data: {
            name: `${STORE_PREFIX.toLowerCase()}   dúplicado`,
            city: 'Melipilla',
            address: 'Acceso directo a BD',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('bloquea la desactivación con usuarios activos y conserva el historial al desactivar', async () => {
      const store = (await createStore(storePayload('Historial')).expect(201))
        .body as StoreResponse;
      const workerId = await createWorker(store.id, 'activo-historial');
      const documentType = await prisma.documentType.upsert({
        where: { code: 'CONTRATO' },
        update: {},
        create: { code: 'CONTRATO', name: 'Contrato de trabajo' },
      });
      const document = await prisma.document.create({
        data: {
          title: `${DOCUMENT_PREFIX} ${randomUUID()}`,
          storeId: store.id,
          subjectUserId: workerId,
          createdById: adminId,
          documentTypeId: documentType.id,
          retainUntil: new Date('2036-01-01T00:00:00.000Z'),
        },
      });

      const blocked = await changeState(store.id, 'deactivate').expect(409);
      expect((blocked.body as ErrorResponse).message).toContain(
        'deben reasignarse o desactivarse primero',
      );
      expect(
        (await prisma.store.findUniqueOrThrow({ where: { id: store.id } }))
          .isActive,
      ).toBe(true);

      await prisma.user.update({
        where: { id: workerId },
        data: { isActive: false },
      });
      await changeState(store.id, 'deactivate').expect(200);

      const persisted = await prisma.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      expect(persisted.isActive).toBe(false);
      expect(
        await prisma.user.findUnique({ where: { id: workerId } }),
      ).not.toBeNull();
      expect(
        await prisma.document.findUnique({ where: { id: document.id } }),
      ).not.toBeNull();
      expect(
        await prisma.auditLog.findFirst({
          where: {
            entityType: 'stores',
            entityId: store.id,
            action: AUDIT_ACTION.STORE_DEACTIVATED,
          },
        }),
      ).not.toBeNull();

      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: `asignacion-inactiva${DOMAIN}`,
          password: 'ClaveInicial123',
          firstName: 'Sin',
          lastName: 'Asignación',
          roleCode: ROLE.TRABAJADOR,
          storeId: store.id,
        })
        .expect(400);
      await changeState(store.id, 'deactivate').expect(200);
      await changeState(store.id, 'reactivate').expect(200);
      expect(
        (await prisma.store.findUniqueOrThrow({ where: { id: store.id } }))
          .isActive,
      ).toBe(true);
    });

    it('serializa el alta de usuarios y la desactivación sin dejar estados incompatibles', async () => {
      for (let index = 0; index < 4; index += 1) {
        const store = (
          await createStore(storePayload(`Concurrencia ${index}`)).expect(201)
        ).body as StoreResponse;
        const [userResult, deactivateResult] = await Promise.all([
          request(app.getHttpServer())
            .post('/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
              email: `concurrencia-${index}${DOMAIN}`,
              password: 'ClaveInicial123',
              firstName: 'Usuario',
              lastName: 'Concurrente',
              roleCode: ROLE.TRABAJADOR,
              storeId: store.id,
            }),
          changeState(store.id, 'deactivate'),
        ]);

        expect([201, 400]).toContain(userResult.status);
        expect([200, 409]).toContain(deactivateResult.status);
        const persisted = await prisma.store.findUniqueOrThrow({
          where: { id: store.id },
        });
        const activeUsers = await prisma.user.count({
          where: { storeId: store.id, isActive: true },
        });
        if (persisted.isActive) {
          expect(userResult.status).toBe(201);
          expect(deactivateResult.status).toBe(409);
          expect(activeUsers).toBe(1);
        } else {
          expect(userResult.status).toBe(400);
          expect(deactivateResult.status).toBe(200);
          expect(activeUsers).toBe(0);
        }
      }
    });

    it('audita creación, edición, desactivación y reactivación con listas blancas', async () => {
      const store = (await createStore(storePayload('Auditoría')).expect(201))
        .body as StoreResponse;
      await updateStore(store.id, { city: '  Ciudad   Editada ' }).expect(200);
      await changeState(store.id, 'deactivate').expect(200);
      await changeState(store.id, 'reactivate').expect(200);

      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'stores', entityId: store.id },
        orderBy: { id: 'asc' },
      });
      expect(logs.map((log) => log.action)).toEqual([
        AUDIT_ACTION.STORE_CREATED,
        AUDIT_ACTION.STORE_UPDATED,
        AUDIT_ACTION.STORE_DEACTIVATED,
        AUDIT_ACTION.STORE_REACTIVATED,
      ]);
      for (const log of logs) {
        expect(log.userId).toBe(adminId);
        expect(log.storeId).toBe(store.id);
      }
      expect(logs[0].detail).toEqual({
        name: `${STORE_PREFIX} Auditoría`,
        city: 'Melipilla',
        address: 'Calle de prueba 123',
      });
      expect(logs[1].detail).toEqual({ city: 'Ciudad Editada' });
      expect(logs[2].detail).toBeNull();
      expect(logs[3].detail).toBeNull();
    });

    it('no duplica auditorías cuando la desactivación o reactivación no cambia el estado', async () => {
      const store = (
        await createStore(storePayload('Auditoría idempotente')).expect(201)
      ).body as StoreResponse;

      await changeState(store.id, 'reactivate').expect(200);
      await changeState(store.id, 'deactivate').expect(200);
      await changeState(store.id, 'deactivate').expect(200);
      await changeState(store.id, 'reactivate').expect(200);
      await changeState(store.id, 'reactivate').expect(200);

      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'stores', entityId: store.id },
        orderBy: { id: 'asc' },
      });
      expect(logs.map((log) => log.action)).toEqual([
        AUDIT_ACTION.STORE_CREATED,
        AUDIT_ACTION.STORE_DEACTIVATED,
        AUDIT_ACTION.STORE_REACTIVATED,
      ]);
    });

    it('exige JWT, limita las mutaciones al administrador y deja el catálogo disponible', async () => {
      const store = (
        await createStore(storePayload('Autorización')).expect(201)
      ).body as StoreResponse;

      await request(app.getHttpServer()).get('/stores').expect(401);
      await request(app.getHttpServer())
        .post('/stores')
        .send(storePayload('Sin token'))
        .expect(401);
      await request(app.getHttpServer())
        .patch(`/stores/${store.id}`)
        .send({ city: 'Melipilla' })
        .expect(401);
      await request(app.getHttpServer())
        .patch(`/stores/${store.id}/deactivate`)
        .expect(401);
      await request(app.getHttpServer())
        .patch(`/stores/${store.id}/reactivate`)
        .expect(401);

      for (const role of [ROLE.SUPERVISOR, ROLE.TRABAJADOR, ROLE.CONTADOR]) {
        const token = await tokenFor(adminId, role, null);
        await listStores('', token).expect(200);
        await createStore(storePayload(`Sin permiso ${role}`), token).expect(
          403,
        );
        await updateStore(store.id, { city: 'Melipilla' }, token).expect(403);
        await changeState(store.id, 'deactivate', token).expect(403);
        await changeState(store.id, 'reactivate', token).expect(403);
      }
    });
  },
);
