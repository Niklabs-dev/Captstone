import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';
import { createDailyOperation } from './helpers/daily-operations.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP de la auditoría de accesos denegados
// (SPRINT-4R-T15): panel exclusivo del administrador, acceso cruzado por
// local en guard y servicio, y ausencia de datos personales en el registro.
// Requieren TEST_DATABASE_URL (PostgreSQL real); sin él se omiten.
const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@access-denied-test.moi-food.cl';
const STORE_NAME = 'Subway AccessDenied Test';
const PERSONAL_SEARCH = `persona${DOMAIN}`;

interface UserFixture {
  id: string;
  token: string;
}

describe.skipIf(!databaseUrl)(
  'Auditoría de accesos denegados (SPRINT-4R-T15)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storeA: string;
    let storeB: string;
    let admin: UserFixture;
    let supervisorA: UserFixture;
    let supervisorB: UserFixture;
    let contador: UserFixture;
    let trabajadorA: UserFixture;
    let operationB: string;

    async function cleanup(): Promise<void> {
      await purgeTestAuditLogs(prisma, {
        user: { email: { endsWith: DOMAIN } },
      });
      const stores = await prisma.store.findMany({
        where: { name: { startsWith: STORE_NAME } },
        select: { id: true },
      });
      const storeIds = stores.map((store) => store.id);
      await prisma.dailyOperation.deleteMany({
        where: { storeId: { in: storeIds } },
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    }

    function tokenFor(
      sub: string,
      role: RoleCode,
      storeId: string | null,
    ): Promise<string> {
      const payload: JwtPayload = {
        sub,
        email: `token${DOMAIN}`,
        role,
        storeId,
      };
      return jwt.signAsync(payload);
    }

    async function createUser(
      name: string,
      role: RoleCode,
      storeId: string | null,
    ): Promise<UserFixture> {
      const roleRow = await prisma.role.findUniqueOrThrow({
        where: { code: role },
      });
      const user = await prisma.user.create({
        data: {
          email: `${name}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: name,
          lastName: 'AccessDenied',
          roleId: roleRow.id,
          storeId,
        },
      });
      return { id: user.id, token: await tokenFor(user.id, role, storeId) };
    }

    function get(path: string, user?: UserFixture) {
      const req = request(app.getHttpServer()).get(path);
      return user ? req.set('Authorization', `Bearer ${user.token}`) : req;
    }

    function deniedLogsOf(userId: string) {
      return prisma.auditLog.findMany({
        where: { action: AUDIT_ACTION.ACCESS_DENIED, userId },
        orderBy: { id: 'asc' },
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
      const [a, b] = await Promise.all(
        ['A', 'B'].map((suffix) =>
          prisma.store.create({
            data: {
              name: `${STORE_NAME} ${suffix}`,
              city: 'Melipilla',
              address: 'Calle de prueba 123',
            },
          }),
        ),
      );
      storeA = a.id;
      storeB = b.id;

      admin = await createUser('admin', ROLE.ADMINISTRADOR, null);
      supervisorA = await createUser('supervisora', ROLE.SUPERVISOR, storeA);
      supervisorB = await createUser('supervisorb', ROLE.SUPERVISOR, storeB);
      contador = await createUser('contador', ROLE.CONTADOR, null);
      trabajadorA = await createUser('trabajadora', ROLE.TRABAJADOR, storeA);

      operationB = await createDailyOperation(prisma, {
        storeId: storeB,
        responsibleId: supervisorB.id,
        businessDate: '2026-11-02',
      });
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
    });

    it('el administrador consulta el panel sin generar accesos denegados', async () => {
      const response = await get('/sales-dashboard?date=2026-11-02', admin);
      expect(response.status).toBe(200);
      expect(await deniedLogsOf(admin.id)).toHaveLength(0);
    });

    it.each([
      ['SUPERVISOR', () => supervisorA],
      ['CONTADOR', () => contador],
      ['TRABAJADOR', () => trabajadorA],
    ])(
      '%s recibe 403 en el panel y queda un único registro sin datos personales',
      async (role, userOf) => {
        const user = userOf();
        const response = await get(
          `/sales-dashboard?date=2026-11-02&search=${PERSONAL_SEARCH}`,
          user,
        );
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
          message: 'No tienes permisos para realizar esta acción',
        });

        const logs = await deniedLogsOf(user.id);
        expect(logs).toHaveLength(1);
        const [log] = logs;
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
      },
    );

    it('el supervisor que pide otro local recibe 403 auditado por local', async () => {
      const response = await get(
        `/daily-operations?storeId=${storeB}&businessDate=2026-11-02`,
        supervisorA,
      );
      expect(response.status).toBe(403);

      const [log] = (await deniedLogsOf(supervisorA.id)).filter(
        (entry) => entry.entityType === 'daily-operations',
      );
      expect(log.storeId).toBe(storeA);
      expect(log.detail).toEqual({
        method: 'GET',
        route: '/daily-operations',
        role: ROLE.SUPERVISOR,
        reason: 'STORE',
        requestedStoreId: storeB,
      });
    });

    it('el servicio rechaza y audita la operación y el voucher de otro local', async () => {
      const detail = await get(`/daily-operations/${operationB}`, supervisorA);
      expect(detail.status).toBe(403);
      const voucher = await get(
        `/daily-operations/${operationB}/voucher`,
        supervisorA,
      );
      expect(voucher.status).toBe(403);

      const logs = (await deniedLogsOf(supervisorA.id)).filter(
        (entry) => entry.entityId === operationB,
      );
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

    it('el supervisor del local y el contador conservan sus accesos', async () => {
      const own = await get(`/daily-operations/${operationB}`, supervisorB);
      expect(own.status).toBe(200);
      const contadorList = await get(
        `/daily-operations?storeId=${storeB}&businessDate=2026-11-02`,
        contador,
      );
      expect(contadorList.status).toBe(200);
      expect(await deniedLogsOf(supervisorB.id)).toHaveLength(0);
      expect(
        (await deniedLogsOf(contador.id)).filter(
          (entry) => entry.entityType === 'daily-operations',
        ),
      ).toHaveLength(0);
    });

    it('el trabajador no lista operaciones de su propio local', async () => {
      const response = await get(
        `/daily-operations?storeId=${storeA}&businessDate=2026-11-02`,
        trabajadorA,
      );
      expect(response.status).toBe(403);
      const logs = (await deniedLogsOf(trabajadorA.id)).filter(
        (entry) => entry.entityType === 'daily-operations',
      );
      expect(logs).toHaveLength(1);
      expect(logs[0].detail).toMatchObject({ reason: 'ROLE' });
    });

    it('no audita 401 sin token ni 400 de validación', async () => {
      // Solo filas de esta prueba: anónimas sobre el panel desde este
      // instante o del administrador, por si otros archivos corren en
      // paralelo contra la misma base.
      const since = new Date();
      expect((await get('/sales-dashboard')).status).toBe(401);
      expect(
        (await get('/sales-dashboard?date=2026-02-30', admin)).status,
      ).toBe(400);
      const anonymous = await prisma.auditLog.count({
        where: {
          action: AUDIT_ACTION.ACCESS_DENIED,
          userId: null,
          entityType: 'sales-dashboard',
          createdAt: { gte: since },
        },
      });
      expect(anonymous).toBe(0);
      expect(await deniedLogsOf(admin.id)).toHaveLength(0);
    });
  },
);
