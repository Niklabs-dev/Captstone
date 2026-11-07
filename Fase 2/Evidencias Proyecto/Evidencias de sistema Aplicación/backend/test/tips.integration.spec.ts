import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { TipEntryResponse } from '../src/tips/types/tips.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';
import {
  ensureDefaultPaymentMethods,
  paymentMethodIdOf,
} from './helpers/payment-methods.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP del registro diario histórico de propinas
// (SPRINT-3-T10) contra PostgreSQL real. Desde SPRINT-4R-T01 los endpoints de
// escritura (POST/PATCH/DELETE) se retiraron: la operación diaria
// (daily_operations) es la fuente de ambos montos de propina. Estos tests
// cubren las lecturas históricas que se conservan y documentan la
// desactivación de las escrituras. Los datos van con un local propio
// ("Subway Tips API Test") y correos @tips-api-test.invalid, y se eliminan al
// finalizar junto con su auditoría.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@tips-api-test.invalid';
const STORE_NAME = 'Subway Tips API Test';
const OTHER_STORE_NAME = 'Subway Tips API Test Otro';

describe.skipIf(!databaseUrl)(
  'API de registro diario histórico de propinas (SPRINT-3-T10, lectura SPRINT-4R-T01)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storeId: string;
    let otherStoreId: string;
    const ids: Record<string, string> = {};
    const tokens: Record<string, string> = {};

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

    async function cleanup(): Promise<void> {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        const storeWhere = { name: { startsWith: STORE_NAME } };
        await tx.sale.deleteMany({ where: { store: storeWhere } });
        await tx.tipPoolSource.deleteMany({
          where: { tipEntry: { store: storeWhere } },
        });
        await tx.tipPoolLine.deleteMany({
          where: { pool: { store: storeWhere } },
        });
        await tx.tipPool.deleteMany({ where: { store: storeWhere } });
        await tx.tipAgreement.deleteMany({ where: { store: storeWhere } });
        await tx.workHoursRecord.deleteMany({ where: { store: storeWhere } });
        await tx.tipEntry.deleteMany({ where: { store: storeWhere } });
      });
      await purgeTestAuditLogs(prisma, {
        OR: [
          { user: { email: { endsWith: DOMAIN } } },
          { store: { name: { startsWith: STORE_NAME } } },
        ],
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({
        where: { name: { startsWith: STORE_NAME } },
      });
    }

    async function createUser(
      name: string,
      roleCode: RoleCode,
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
          lastName: 'Tips',
          roleId: role.id,
          storeId: userStoreId,
        },
      });
      ids[name] = user.id;
      tokens[name] = await tokenFor(user.id, roleCode, userStoreId);
    }

    function listTips(query: string, token = tokens.supervisor) {
      return request(app.getHttpServer())
        .get(`/tips${query}`)
        .set('Authorization', `Bearer ${token}`);
    }

    function getTip(id: string, token = tokens.supervisor) {
      return request(app.getHttpServer())
        .get(`/tips/${id}`)
        .set('Authorization', `Bearer ${token}`);
    }

    function createTip(body: object, token = tokens.supervisor) {
      return request(app.getHttpServer())
        .post('/tips')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function patchTip(id: string, body: object, token = tokens.supervisor) {
      return request(app.getHttpServer())
        .patch(`/tips/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function deleteTip(id: string, token = tokens.supervisor) {
      return request(app.getHttpServer())
        .delete(`/tips/${id}`)
        .set('Authorization', `Bearer ${token}`);
    }

    async function seedEntry(
      businessDate: string,
      paymentMethodCode: string,
      amount: number,
    ): Promise<string> {
      const paymentMethodId = await paymentMethodIdOf(
        prisma,
        paymentMethodCode,
      );
      const entry = await prisma.tipEntry.create({
        data: {
          storeId,
          businessDate: new Date(`${businessDate}T00:00:00.000Z`),
          paymentMethodId,
          amount,
          responsibleId: ids.supervisor,
        },
      });
      return entry.id;
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
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

      // Roles por si la BD no está sembrada.
      for (const code of Object.values(ROLE)) {
        await prisma.role.upsert({
          where: { code },
          update: {},
          create: { code, name: code },
        });
      }

      const store = await prisma.store.create({
        data: { name: STORE_NAME, city: 'Melipilla', address: 'Calle 123' },
      });
      storeId = store.id;
      const otherStore = await prisma.store.create({
        data: {
          name: OTHER_STORE_NAME,
          city: 'Calera',
          address: 'Otra calle 456',
        },
      });
      otherStoreId = otherStore.id;

      await ensureDefaultPaymentMethods(prisma);

      await createUser('supervisor', ROLE.SUPERVISOR, store.id);
      await createUser('worker', ROLE.TRABAJADOR, store.id);
      await createUser('accountant', ROLE.CONTADOR, null);
      await createUser('admin', ROLE.ADMINISTRADOR, null);
      await createUser('otherSupervisor', ROLE.SUPERVISOR, otherStore.id);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
    });

    it('lista las propinas históricas del local y fecha ordenadas por medio', async () => {
      const debitId = await seedEntry('2026-10-20', 'DEBIT_CARD', 12500);
      await seedEntry('2026-10-20', 'CASH', 5000);

      const list = (
        await listTips(`?storeId=${storeId}&businessDate=2026-10-20`).expect(
          200,
        )
      ).body as TipEntryResponse[];
      expect(list.map((entry) => entry.paymentMethod)).toEqual([
        'CASH',
        'DEBIT_CARD',
      ]);
      expect(list[1]).toMatchObject({
        id: debitId,
        businessDate: '2026-10-20',
        paymentMethod: 'DEBIT_CARD',
        paymentMethodName: 'Tarjeta de débito',
        amount: 12500,
        store: { id: storeId, name: STORE_NAME },
        responsible: { id: ids.supervisor, name: 'supervisor Tips' },
      });
    });

    it('devuelve arreglo vacío cuando el día no tiene registros', async () => {
      const list = (
        await listTips(`?storeId=${storeId}&businessDate=2026-10-21`).expect(
          200,
        )
      ).body as TipEntryResponse[];
      expect(list).toEqual([]);
    });

    it('obtiene un registro histórico por su ID', async () => {
      const id = await seedEntry('2026-10-22', 'CREDIT_CARD', 7700);
      const found = (await getTip(id).expect(200)).body as TipEntryResponse;
      expect(found).toMatchObject({
        id,
        amount: 7700,
        paymentMethod: 'CREDIT_CARD',
      });

      await getTip('00000000-0000-4000-8000-000000000000').expect(404);
      await getTip('no-es-uuid').expect(400);
    });

    it('aplica JWT, rol y aislamiento por local en las lecturas', async () => {
      await listTips(`?storeId=${storeId}&businessDate=2026-10-20`, '').expect(
        401,
      );
      await listTips(
        `?storeId=${storeId}&businessDate=2026-10-20`,
        tokens.worker,
      ).expect(403);
      await listTips(
        `?storeId=${otherStoreId}&businessDate=2026-10-20`,
        tokens.supervisor,
      ).expect(403);
      await listTips(
        `?storeId=${storeId}&businessDate=2026-10-20`,
        tokens.accountant,
      ).expect(200);
      await listTips(
        `?storeId=${storeId}&businessDate=2026-10-20`,
        tokens.admin,
      ).expect(200);
    });

    it('retiró los endpoints de escritura sin borrar los históricos', async () => {
      const id = await seedEntry('2026-10-23', 'DEBIT_CARD', 1500);

      // Las escrituras respondieron 404: la operación diaria reemplaza el
      // flujo (SPRINT-4R-T01) y no debe operar en paralelo.
      await createTip({
        storeId,
        businessDate: '2026-10-23',
        paymentMethod: 'DEBIT_CARD',
        amount: 999,
      }).expect(404);
      await patchTip(id, { amount: 1 }).expect(404);
      await deleteTip(id).expect(404);

      // El histórico sigue intacto y consultable.
      const found = (await getTip(id).expect(200)).body as TipEntryResponse;
      expect(found.amount).toBe(1500);
    });
  },
);
