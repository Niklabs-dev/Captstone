import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../src/documents/utils/document-dates.util.js';
import { PaymentMethod, PrismaClient } from '../src/generated/prisma/client.js';
import type {
  TipPaymentAlert,
  TipPaymentAlertCollection,
} from '../src/tips/types/tip-payment-alerts.types.js';
import type { TipPoolResponse } from '../src/tips/types/tip-pools.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@tip-payment-alerts-test.invalid';
const STORE_NAME = 'Subway Tip Payment Alerts Test';
const HOLIDAYS = '2026-10-12';

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

describe.skipIf(!databaseUrl)(
  'API de alertas de siete días hábiles (SPRINT-3-T14)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storeId: string;
    const ids: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    const todayText = formatDbDate(toDbDate(businessDateOf(new Date())));

    async function cleanup(): Promise<void> {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.tipPoolReceipt.deleteMany({
          where: { pool: { store: { name: STORE_NAME } } },
        });
        await tx.tipPoolSource.deleteMany({
          where: { pool: { store: { name: STORE_NAME } } },
        });
        await tx.tipPoolLine.deleteMany({
          where: { pool: { store: { name: STORE_NAME } } },
        });
        await tx.tipPool.deleteMany({ where: { store: { name: STORE_NAME } } });
        await tx.tipAgreement.deleteMany({
          where: { store: { name: STORE_NAME } },
        });
        await tx.workHoursRecord.deleteMany({
          where: { store: { name: STORE_NAME } },
        });
        await tx.tipEntry.deleteMany({
          where: { store: { name: STORE_NAME } },
        });
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
          lastName: 'Alerta',
          roleId: role.id,
          storeId: userStoreId,
        },
      });
      ids[name] = user.id;
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: roleCode,
        storeId: userStoreId,
      };
      tokens[name] = await jwt.signAsync(payload);
    }

    function server() {
      return request(app.getHttpServer());
    }

    function listAlerts(token: string | null = tokens.accountant) {
      const req = server().get('/tip-payment-alerts');
      if (token) req.set('Authorization', `Bearer ${token}`);
      return req;
    }

    async function ownAlerts(token?: string): Promise<TipPaymentAlert[]> {
      const response = await listAlerts(token).expect(200);
      const body = response.body as TipPaymentAlertCollection;
      expect(typeof body.calculatedAt).toBe('string');
      return body.items.filter((alert) => alert.store.id === storeId);
    }

    async function seedEntry(
      businessDate: string,
      paymentMethod: PaymentMethod,
      amount: number,
    ): Promise<string> {
      const entry = await prisma.tipEntry.create({
        data: {
          businessDate: day(businessDate),
          paymentMethod,
          amount,
          storeId,
          responsibleId: ids.supervisor,
        },
        select: { id: true },
      });
      return entry.id;
    }

    function poolAction(
      poolId: string,
      action: 'confirm' | 'pay',
      body: Record<string, unknown>,
    ) {
      return server()
        .post(`/tip-pools/${poolId}/${action}`)
        .set('Authorization', `Bearer ${tokens.accountant}`)
        .send(body);
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';
      process.env.TIP_ALERT_HOLIDAYS = HOLIDAYS;

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
      const store = await prisma.store.create({
        data: { name: STORE_NAME, city: 'Melipilla', address: 'Calle 123' },
      });
      storeId = store.id;
      await createUser('accountant', ROLE.CONTADOR, null);
      await createUser('admin', ROLE.ADMINISTRADOR, null);
      await createUser('supervisor', ROLE.SUPERVISOR, storeId);
      await createUser('worker', ROLE.TRABAJADOR, storeId);
      await prisma.tipAgreement.create({
        data: {
          name: 'Pacto Alertas Test',
          rule: 'PROPORTIONAL_TO_HOURS',
          validFrom: day('2026-01-01'),
          storeId,
          createdById: ids.supervisor,
        },
      });
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
    });

    it('lista solo tarjeta pendiente, aplica feriados y ordena primero las vencidas', async () => {
      const olderId = await seedEntry('2026-10-01', 'DEBIT_CARD', 3000);
      const holidayId = await seedEntry('2026-10-02', 'DEBIT_CARD', 4000);
      const upcomingId = await seedEntry(todayText, 'CREDIT_CARD', 5000);
      await seedEntry('2026-10-01', 'CASH', 6000);
      await seedEntry('2026-10-01', 'TRANSFER', 7000);

      const alerts = await ownAlerts();
      expect(alerts.map((alert) => alert.tipEntryId)).toEqual([
        olderId,
        holidayId,
        upcomingId,
      ]);
      expect(alerts[0]).toMatchObject({
        businessDate: '2026-10-01',
        paymentMethod: 'DEBIT_CARD',
        amount: 3000,
        pool: null,
        deadline: '2026-10-13',
        status: 'OVERDUE',
      });
      expect(alerts[0].daysRemaining).toBeLessThan(0);
      expect(alerts[1]).toMatchObject({
        businessDate: '2026-10-02',
        amount: 4000,
        pool: null,
        deadline: '2026-10-14',
        status: 'OVERDUE',
      });
      expect(alerts[2]).toMatchObject({
        businessDate: todayText,
        paymentMethod: 'CREDIT_CARD',
        amount: 5000,
        pool: null,
        status: 'UPCOMING',
      });
      expect(alerts[2].daysRemaining).toBeGreaterThanOrEqual(0);
      expect(alerts.map((alert) => alert.amount)).not.toContain(6000);
      expect(alerts.map((alert) => alert.amount)).not.toContain(7000);
    });

    it('mantiene DRAFT y CONFIRMED, y el pago antes del plazo elimina la alerta del reparto enterado', async () => {
      const entryId = await seedEntry(todayText, 'DEBIT_CARD', 9000);
      await prisma.workHoursRecord.create({
        data: {
          periodStart: day(todayText),
          periodEnd: day(todayText),
          hoursWorked: 10,
          storeId,
          workerId: ids.worker,
          recordedById: ids.supervisor,
        },
      });
      const created = (
        await server()
          .post('/tip-pools/preview')
          .set('Authorization', `Bearer ${tokens.accountant}`)
          .send({
            storeId,
            periodStart: todayText,
            periodEnd: todayText,
          })
          .expect(201)
      ).body as TipPoolResponse;

      const draftAlert = (await ownAlerts()).find(
        (alert) => alert.tipEntryId === entryId,
      );
      expect(draftAlert).toMatchObject({
        status: 'UPCOMING',
        pool: { id: created.id, status: 'DRAFT' },
      });

      const confirmed = (
        await poolAction(created.id, 'confirm', {
          expectedVersion: created.version,
        }).expect(200)
      ).body as TipPoolResponse;
      const confirmedAlert = (await ownAlerts()).find(
        (alert) => alert.tipEntryId === entryId,
      );
      expect(confirmedAlert).toMatchObject({
        status: 'UPCOMING',
        pool: { id: created.id, status: 'CONFIRMED' },
      });

      await poolAction(created.id, 'pay', {
        expectedVersion: confirmed.version,
        paymentDate: todayText,
      }).expect(200);
      expect(
        (await ownAlerts()).some((alert) => alert.tipEntryId === entryId),
      ).toBe(false);
      const paidPool = await prisma.tipPool.findUniqueOrThrow({
        where: { id: created.id },
        select: { status: true, paymentDate: true },
      });
      expect(paidPool.status).toBe('PAID');
      expect(formatDbDate(paidPool.paymentDate ?? new Date(0))).toBe(todayText);
      expect(
        (await ownAlerts()).some((alert) => alert.pool?.id === created.id),
      ).toBe(false);
    });

    it('permite contador y administrador, y rechaza otros roles o ausencia de JWT', async () => {
      expect((await listAlerts(tokens.admin).expect(200)).body).toHaveProperty(
        'items',
      );
      for (const token of [tokens.supervisor, tokens.worker]) {
        await listAlerts(token).expect(403);
      }
      await listAlerts(null).expect(401);
    });
  },
);
