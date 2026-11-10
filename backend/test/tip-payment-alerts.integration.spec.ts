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
import { PrismaClient } from '../src/generated/prisma/client.js';
import type {
  TipPaymentAlert,
  TipPaymentAlertCollection,
} from '../src/tips/types/tip-payment-alerts.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';
import {
  confirmLegacyTipPool,
  payLegacyTipPool,
} from './helpers/legacy-tip-pools.js';
import {
  ensureDefaultPaymentMethods,
  ensurePaymentMethod,
  paymentMethodIdOf,
} from './helpers/payment-methods.js';

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
        // Medios de pago creados solo por estos tests (prefijo propio).
        await tx.paymentMethod.deleteMany({
          where: { code: { startsWith: 'TIPSTEST_ALERTS_' } },
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
      paymentMethodCode: string,
      amount: number,
    ): Promise<string> {
      const paymentMethodId = await paymentMethodIdOf(
        prisma,
        paymentMethodCode,
      );
      const entry = await prisma.tipEntry.create({
        data: {
          businessDate: day(businessDate),
          paymentMethodId,
          amount,
          storeId,
          responsibleId: ids.supervisor,
        },
        select: { id: true },
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
      await ensureDefaultPaymentMethods(prisma);

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
        paymentMethodName: 'Tarjeta de débito',
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

    it('sigue alertando con medios conciliables desactivados y omite externos', async () => {
      // Tarjeta histórica desactivada: la deuda con el trabajador sigue
      // vigente y la alerta conserva código y nombre del catálogo.
      const legacyCard = await ensurePaymentMethod(prisma, {
        code: 'TIPSTEST_ALERTS_CARD_HIST',
        name: 'Tarjeta histórica',
        behavior: 'RECONCILABLE_CARD',
        isActive: false,
        availableForTips: true,
      });
      const legacyId = await seedEntry(
        '2026-10-03',
        'TIPSTEST_ALERTS_CARD_HIST',
        2500,
      );

      // Externo activo (no conciliable): nunca genera alerta de plazo.
      await ensurePaymentMethod(prisma, {
        code: 'TIPSTEST_ALERTS_JUNAEB',
        name: 'Junaeb test',
        behavior: 'EXTERNAL_OTHER',
        isActive: true,
        availableForTips: false,
      });
      await seedEntry('2026-10-03', 'TIPSTEST_ALERTS_JUNAEB', 3500);

      const alerts = await ownAlerts();
      const legacy = alerts.find((alert) => alert.tipEntryId === legacyId);
      expect(legacy).toMatchObject({
        paymentMethod: legacyCard.code,
        paymentMethodName: 'Tarjeta histórica',
        amount: 2500,
        status: 'OVERDUE',
      });
      expect(alerts.map((alert) => alert.amount)).not.toContain(3500);

      await prisma.tipEntry.deleteMany({
        where: { id: { in: [legacyId] } },
      });
    });

    it('mantiene DRAFT y CONFIRMED, y un reparto histórico pagado ya no alerta', async () => {
      const entryId = await seedEntry(todayText, 'DEBIT_CARD', 9000);
      const hours = await prisma.workHoursRecord.create({
        data: {
          periodStart: day(todayText),
          periodEnd: day(todayText),
          hoursWorked: 10,
          storeId,
          workerId: ids.worker,
          recordedById: ids.supervisor,
        },
        select: { id: true },
      });
      // Las alertas siguen sobre los registros diarios históricos
      // (tip_entries). El reparto proporcional que los usa como fuente se
      // construye directamente en la base, como lo hacía el motor anterior,
      // y se confirma y paga con el helper de repartos históricos: desde
      // SPRINT-4A-T08 la API ya no confirma ni paga repartos.
      const agreement = await prisma.tipAgreement.findFirstOrThrow({
        where: { storeId },
        select: { id: true, name: true },
      });
      const created = await prisma.tipPool.create({
        data: {
          storeId,
          periodStart: day(todayText),
          periodEnd: day(todayText),
          totalAmount: 9000,
          agreementId: agreement.id,
          agreementSnapshot: {
            id: agreement.id,
            name: agreement.name,
            rule: 'PROPORTIONAL_TO_HOURS',
            validFrom: '2026-01-01',
            validTo: null,
          },
          calculatedById: ids.accountant,
          sources: { create: { tipEntryId: entryId, amount: 9000 } },
          lines: {
            create: {
              userId: ids.worker,
              workHoursRecordId: hours.id,
              hoursWorked: 10,
              amount: 9000,
            },
          },
        },
        select: { id: true },
      });

      const draftAlert = (await ownAlerts()).find(
        (alert) => alert.tipEntryId === entryId,
      );
      expect(draftAlert).toMatchObject({
        status: 'UPCOMING',
        pool: { id: created.id, status: 'DRAFT' },
      });

      await confirmLegacyTipPool(prisma, created.id, ids.accountant);
      const confirmedAlert = (await ownAlerts()).find(
        (alert) => alert.tipEntryId === entryId,
      );
      expect(confirmedAlert).toMatchObject({
        status: 'UPCOMING',
        pool: { id: created.id, status: 'CONFIRMED' },
      });

      await payLegacyTipPool(prisma, created.id, ids.accountant, todayText);
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
