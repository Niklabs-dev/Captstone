import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createDailyOperation } from './helpers/daily-operations.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP de la auditoría de accesos denegados
// (SPRINT-4R-T15): rutas exclusivas del administrador, descarga directa del
// Excel, acceso cruzado por local en guard y servicio, y ausencia de datos
// personales. La aplicación usa la transacción del test
// (helpers/switchable-prisma.ts), que se revierte al terminar cada caso.
// Requieren TEST_DATABASE_URL (PostgreSQL real); sin él se omiten.
const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@access-denied-test.moi-food.cl';
const PERSONAL_SEARCH = `persona${DOMAIN}`;
const BUSINESS_DATE = '2026-11-02';

class Rollback extends Error {}

interface UserFixture {
  id: string;
  token: string;
}

interface Fixture {
  tx: Prisma.TransactionClient;
  storeA: string;
  storeB: string;
  admin: UserFixture;
  supervisorA: UserFixture;
  supervisorB: UserFixture;
  contador: UserFixture;
  trabajadorA: UserFixture;
  operationB: string;
}

describe.skipIf(!databaseUrl)(
  'Auditoría de accesos denegados (SPRINT-4R-T15)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let switchable: SwitchablePrisma;

    async function createUser(
      tx: Prisma.TransactionClient,
      name: string,
      role: RoleCode,
      storeId: string | null,
    ): Promise<UserFixture> {
      const roleRow = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const user = await tx.user.create({
        data: {
          email: `${name}-${randomUUID()}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: name,
          lastName: 'AccessDenied',
          roleId: roleRow.id,
          storeId,
        },
      });
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role,
        storeId,
      };
      return { id: user.id, token: await jwt.signAsync(payload) };
    }

    async function createStore(
      tx: Prisma.TransactionClient,
      suffix: string,
    ): Promise<string> {
      const store = await tx.store.create({
        data: {
          name: `Subway AccessDenied ${suffix} ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle de prueba 123',
        },
      });
      return store.id;
    }

    async function buildFixture(
      tx: Prisma.TransactionClient,
    ): Promise<Fixture> {
      const storeA = await createStore(tx, 'A');
      const storeB = await createStore(tx, 'B');
      const supervisorB = await createUser(
        tx,
        'supervisorb',
        ROLE.SUPERVISOR,
        storeB,
      );
      return {
        tx,
        storeA,
        storeB,
        admin: await createUser(tx, 'admin', ROLE.ADMINISTRADOR, null),
        supervisorA: await createUser(
          tx,
          'supervisora',
          ROLE.SUPERVISOR,
          storeA,
        ),
        supervisorB,
        contador: await createUser(tx, 'contador', ROLE.CONTADOR, null),
        trabajadorA: await createUser(
          tx,
          'trabajadora',
          ROLE.TRABAJADOR,
          storeA,
        ),
        operationB: await createDailyOperation(tx, {
          storeId: storeB,
          responsibleId: supervisorB.id,
          businessDate: BUSINESS_DATE,
        }),
      };
    }

    // El 403 se responde sin esperar el insert de auditoría: los casos esperan
    // a que termine antes de revertir o de afirmar que no se registró nada.
    function settle(): Promise<void> {
      return delay(150);
    }

    async function withinRollback(
      fn: (fixture: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            await fn(await buildFixture(tx));
            await settle();
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 60_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      } finally {
        switchable.use(null);
      }
    }

    function get(path: string, user?: UserFixture) {
      const req = request(app.getHttpServer()).get(path);
      return user ? req.set('Authorization', `Bearer ${user.token}`) : req;
    }

    function deniedLogsOf(fixture: Fixture, userId: string) {
      return fixture.tx.auditLog.findMany({
        where: { action: AUDIT_ACTION.ACCESS_DENIED, userId },
        orderBy: { id: 'asc' },
      });
    }

    async function waitForDeniedLogs(
      fixture: Fixture,
      userId: string,
      count: number,
    ) {
      await vi.waitFor(
        async () => {
          expect(await deniedLogsOf(fixture, userId)).toHaveLength(count);
        },
        { timeout: 5_000, interval: 50 },
      );
      return deniedLogsOf(fixture, userId);
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';

      switchable = createSwitchablePrisma();
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(switchable.service)
        .compile();
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
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
    });

    it('el administrador consulta el panel sin generar accesos denegados', async () => {
      await withinRollback(async (f) => {
        const response = await get(
          `/sales-dashboard?date=${BUSINESS_DATE}`,
          f.admin,
        );
        expect(response.status).toBe(200);
        await settle();
        expect(await deniedLogsOf(f, f.admin.id)).toHaveLength(0);
      });
    }, 60_000);

    it.each([
      ['SUPERVISOR', (f: Fixture) => f.supervisorA],
      ['CONTADOR', (f: Fixture) => f.contador],
      ['TRABAJADOR', (f: Fixture) => f.trabajadorA],
    ])(
      '%s recibe 403 en el panel y queda un único registro sin datos personales',
      async (role, userOf) => {
        await withinRollback(async (f) => {
          const user = userOf(f);
          const response = await get(
            `/sales-dashboard?date=${BUSINESS_DATE}&search=${PERSONAL_SEARCH}`,
            user,
          );
          expect(response.status).toBe(403);
          expect(response.body).toMatchObject({
            message: 'No tienes permisos para realizar esta acción',
          });

          const [log] = await waitForDeniedLogs(f, user.id, 1);
          expect(log.entityType).toBe('sales-dashboard');
          expect(log.entityId).toBeNull();
          expect(log.detail).toEqual({
            method: 'GET',
            route: '/sales-dashboard',
            role,
            reason: 'ROLE',
          });
          // id es BigInt (no serializable); se revisan los campos de texto.
          expect(
            JSON.stringify([log.entityType, log.entityId, log.detail]),
          ).not.toContain(DOMAIN);
        });
      },
      60_000,
    );

    it.each([
      ['SUPERVISOR', (f: Fixture) => f.supervisorA],
      ['CONTADOR', (f: Fixture) => f.contador],
      ['TRABAJADOR', (f: Fixture) => f.trabajadorA],
    ])(
      '%s no descarga el Excel, no lista ni importa ventas y queda auditado',
      async (role, userOf) => {
        await withinRollback(async (f) => {
          const user = userOf(f);
          const importId = randomUUID();

          expect(
            (await get(`/sales-imports/${importId}/file`, user)).status,
          ).toBe(403);
          let [log] = await waitForDeniedLogs(f, user.id, 1);
          expect(log.entityType).toBe('sales-imports');
          expect(log.entityId).toBe(importId);
          expect(log.detail).toEqual({
            method: 'GET',
            route: '/sales-imports/:id/file',
            role,
            reason: 'ROLE',
          });

          expect((await get('/sales-imports', user)).status).toBe(403);
          await waitForDeniedLogs(f, user.id, 2);
          const preview = await request(app.getHttpServer())
            .post('/sales-imports/preview')
            .set('Authorization', `Bearer ${user.token}`);
          expect(preview.status).toBe(403);
          [, , log] = await waitForDeniedLogs(f, user.id, 3);
          expect(log.detail).toMatchObject({
            method: 'POST',
            route: '/sales-imports/preview',
          });
        });
      },
      60_000,
    );

    it('el administrador pasa la autorización de la descarga directa del Excel', async () => {
      await withinRollback(async (f) => {
        const response = await get(
          `/sales-imports/${randomUUID()}/file`,
          f.admin,
        );
        expect(response.status).toBe(404);
        await settle();
        expect(await deniedLogsOf(f, f.admin.id)).toHaveLength(0);
      });
    }, 60_000);

    it('el supervisor que pide otro local recibe 403 auditado por local', async () => {
      await withinRollback(async (f) => {
        const response = await get(
          `/daily-operations?storeId=${f.storeB}&businessDate=${BUSINESS_DATE}`,
          f.supervisorA,
        );
        expect(response.status).toBe(403);

        const [log] = await waitForDeniedLogs(f, f.supervisorA.id, 1);
        expect(log.storeId).toBe(f.storeA);
        expect(log.detail).toEqual({
          method: 'GET',
          route: '/daily-operations',
          role: ROLE.SUPERVISOR,
          reason: 'STORE',
          requestedStoreId: f.storeB,
        });
      });
    }, 60_000);

    it('el servicio rechaza y audita la operación y el voucher de otro local', async () => {
      await withinRollback(async (f) => {
        expect(
          (await get(`/daily-operations/${f.operationB}`, f.supervisorA))
            .status,
        ).toBe(403);
        await waitForDeniedLogs(f, f.supervisorA.id, 1);
        expect(
          (
            await get(
              `/daily-operations/${f.operationB}/voucher`,
              f.supervisorA,
            )
          ).status,
        ).toBe(403);

        const logs = await waitForDeniedLogs(f, f.supervisorA.id, 2);
        expect(logs.map((entry) => entry.entityId)).toEqual([
          f.operationB,
          f.operationB,
        ]);
        expect(logs.map((entry) => entry.detail)).toEqual([
          {
            method: 'GET',
            route: '/daily-operations/:id',
            role: ROLE.SUPERVISOR,
            reason: 'STORE',
          },
          {
            method: 'GET',
            route: '/daily-operations/:id/voucher',
            role: ROLE.SUPERVISOR,
            reason: 'STORE',
          },
        ]);
      });
    }, 60_000);

    it('el supervisor del local y el contador conservan sus accesos', async () => {
      await withinRollback(async (f) => {
        expect(
          (await get(`/daily-operations/${f.operationB}`, f.supervisorB))
            .status,
        ).toBe(200);
        expect(
          (
            await get(
              `/daily-operations?storeId=${f.storeB}&businessDate=${BUSINESS_DATE}`,
              f.contador,
            )
          ).status,
        ).toBe(200);
        await settle();
        expect(await deniedLogsOf(f, f.supervisorB.id)).toHaveLength(0);
        expect(await deniedLogsOf(f, f.contador.id)).toHaveLength(0);
      });
    }, 60_000);

    it('el trabajador no lista operaciones de su propio local', async () => {
      await withinRollback(async (f) => {
        const response = await get(
          `/daily-operations?storeId=${f.storeA}&businessDate=${BUSINESS_DATE}`,
          f.trabajadorA,
        );
        expect(response.status).toBe(403);
        const [log] = await waitForDeniedLogs(f, f.trabajadorA.id, 1);
        expect(log.detail).toMatchObject({ reason: 'ROLE' });
      });
    }, 60_000);

    it('no audita 401 sin token ni 400 de validación', async () => {
      await withinRollback(async (f) => {
        const since = new Date();
        expect((await get('/sales-dashboard')).status).toBe(401);
        expect(
          (await get('/sales-dashboard?date=2026-02-30', f.admin)).status,
        ).toBe(400);
        await settle();
        expect(
          await f.tx.auditLog.count({
            where: {
              action: AUDIT_ACTION.ACCESS_DENIED,
              userId: null,
              entityType: 'sales-dashboard',
              createdAt: { gte: since },
            },
          }),
        ).toBe(0);
        expect(await deniedLogsOf(f, f.admin.id)).toHaveLength(0);
      });
    }, 60_000);
  },
);
