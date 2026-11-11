import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { parseCalendarDate } from '../src/audit/utils/business-day.util.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import {
  addDays,
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../src/documents/utils/document-dates.util.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  DEFAULT_TIP_LEGAL_PAYMENT_DAYS,
  tipPaymentDaysOverdue,
  tipPaymentDeadline,
} from '../src/tips/alerts/tip-payment-deadline.js';
import type {
  TipPaymentAlert,
  TipPaymentAlertCollection,
} from '../src/tips/types/tip-payment-alerts.types.js';
import { createDailyOperation } from './helpers/daily-operations.js';
import { createTestMethod, dbDate } from './helpers/sales-consolidation.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración HTTP de la alerta legal de pago de propinas
// (SPRINT-4A-T22) contra PostgreSQL real con datos ficticios: una propina
// diaria No pagada alerta cuando su fecha superó TIP_LEGAL_PAYMENT_DAYS días
// hábiles (por defecto 7) y no el día límite; se agrupa por local y
// trabajador; al pagar el período (SPRINT-4A-T06) desaparece; los registros
// históricos tip_entries ya no alertan; acceso por rol. Las fechas son
// relativas a hoy en Chile (el borde se calcula con overdueThrough de la
// respuesta). Todo corre dentro de withinRollback: la base se revierte.
const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@tip-payment-alerts-test.invalid';
const LEGAL_DAYS = DEFAULT_TIP_LEGAL_PAYMENT_DAYS;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  storeId: string;
  storeName: string;
  admin: AuthUser;
  accountant: AuthUser;
  supervisor: AuthUser;
  ana: AuthUser;
  beto: AuthUser;
}

function shift(date: string, days: number): string {
  const parsed = parseCalendarDate(date);
  if (!parsed) throw new Error(`Fecha de prueba inválida: ${date}`);
  return formatDbDate(toDbDate(addDays(parsed, days)));
}

function calendar(date: string) {
  const parsed = parseCalendarDate(date);
  if (!parsed) throw new Error(`Fecha de prueba inválida: ${date}`);
  return parsed;
}

describe.skipIf(!databaseUrl)(
  'API de alertas de propinas diarias no pagadas (SPRINT-4A-T22)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;

    function authorize(req: request.Test, user: AuthUser | null): request.Test {
      if (!user) return req;
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return req.set('Authorization', `Bearer ${jwt.sign(payload)}`);
    }

    function listAlerts(user: AuthUser | null): request.Test {
      return authorize(
        request(app.getHttpServer()).get('/tip-payment-alerts'),
        user,
      );
    }

    async function alertsOf(
      f: Fixture,
      user: AuthUser = f.accountant,
    ): Promise<{ body: TipPaymentAlertCollection; own: TipPaymentAlert[] }> {
      const body = (await listAlerts(user).expect(200))
        .body as TipPaymentAlertCollection;
      return {
        body,
        own: body.items.filter((alert) => alert.store.id === f.storeId),
      };
    }

    async function createUser(
      tx: Tx,
      role: RoleCode,
      storeId: string | null,
      firstName: string,
    ): Promise<AuthUser> {
      const roleRecord = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const id = randomUUID();
      const email = `${id}${DOMAIN}`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName,
          lastName: 'Ficticia',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return { id, email, role, storeId };
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      const storeName = `Subway Alertas Propinas ${randomUUID()}`;
      const store = await tx.store.create({
        data: {
          name: storeName,
          city: 'Melipilla',
          address: 'Calle ficticia 1',
        },
      });
      return {
        tx,
        storeId: store.id,
        storeName,
        admin: await createUser(tx, ROLE.ADMINISTRADOR, null, 'Admin'),
        accountant: await createUser(tx, ROLE.CONTADOR, null, 'Contador'),
        supervisor: await createUser(tx, ROLE.SUPERVISOR, store.id, 'Sofía'),
        ana: await createUser(tx, ROLE.TRABAJADOR, store.id, 'Ana'),
        beto: await createUser(tx, ROLE.TRABAJADOR, store.id, 'Beto'),
      };
    }

    // Operación diaria con propina en efectivo repartida en partes iguales
    // entre los participantes: cada uno queda con una propina No pagada.
    async function seedDay(
      f: Fixture,
      businessDate: string,
      cashTipAmount: number,
      participants: readonly AuthUser[],
    ): Promise<void> {
      await createDailyOperation(f.tx, {
        storeId: f.storeId,
        responsibleId: f.supervisor.id,
        businessDate,
        cashTipAmount,
        participantIds: participants.map((user) => user.id),
      });
    }

    async function withinRollback(
      run: (fixture: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            const fixture = await createFixture(tx);
            await run(fixture);
            // Los lotes de pago se concilian al commit (constraint trigger
            // diferido): se verifican como lo haría el commit.
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 50_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      } finally {
        switchable.use(null);
      }
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';
      // Plazo por defecto y sin feriados: el borde depende solo de hoy.
      delete process.env.TIP_LEGAL_PAYMENT_DAYS;
      process.env.TIP_ALERT_HOLIDAYS = '';

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
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
    });

    it('informa el plazo vigente y la última fecha vencida de hoy', async () => {
      await withinRollback(async (f) => {
        const { body } = await alertsOf(f);
        const today = formatDbDate(toDbDate(businessDateOf(new Date())));
        expect(body.legalPaymentDays).toBe(LEGAL_DAYS);
        expect(body.asOf).toBe(today);
        expect(typeof body.calculatedAt).toBe('string');
        // overdueThrough es la última fecha cuyo límite ya pasó; la
        // siguiente todavía está en plazo hoy (o vence hoy).
        const lastOverdue = tipPaymentDeadline(
          calendar(body.overdueThrough),
          LEGAL_DAYS,
          new Set(),
        );
        expect(formatDbDate(toDbDate(lastOverdue)) < today).toBe(true);
        const firstInTime = tipPaymentDeadline(
          calendar(shift(body.overdueThrough, 1)),
          LEGAL_DAYS,
          new Set(),
        );
        expect(formatDbDate(toDbDate(firstInTime)) >= today).toBe(true);
      });
    });

    it('alerta lo No pagado con más días que el plazo, no el día límite, y agrupa por trabajador', async () => {
      await withinRollback(async (f) => {
        const { body: before } = await alertsOf(f);
        const cutoff = before.overdueThrough;
        const older = shift(cutoff, -10);
        // Vencidas: dos días de Ana (uno compartido con Beto).
        await seedDay(f, older, 10_000, [f.ana, f.beto]);
        await seedDay(f, cutoff, 3_000, [f.ana]);
        // En plazo (el día siguiente al borde): no alerta.
        await seedDay(f, shift(cutoff, 1), 8_000, [f.ana, f.beto]);

        const { body, own } = await alertsOf(f);
        const today = calendar(body.asOf);
        const deadline = tipPaymentDeadline(
          calendar(older),
          LEGAL_DAYS,
          new Set(),
        );
        expect(own).toEqual([
          {
            store: { id: f.storeId, name: f.storeName },
            worker: { id: f.ana.id, name: 'Ana Ficticia' },
            allocationCount: 2,
            amount: 8_000,
            oldestBusinessDate: older,
            newestBusinessDate: cutoff,
            deadline: formatDbDate(toDbDate(deadline)),
            daysOverdue: tipPaymentDaysOverdue(deadline, today),
          },
          {
            store: { id: f.storeId, name: f.storeName },
            worker: { id: f.beto.id, name: 'Beto Ficticia' },
            allocationCount: 1,
            amount: 5_000,
            oldestBusinessDate: older,
            newestBusinessDate: older,
            deadline: formatDbDate(toDbDate(deadline)),
            daysOverdue: tipPaymentDaysOverdue(deadline, today),
          },
        ]);
        expect(own[0].daysOverdue).toBeGreaterThanOrEqual(1);
        // Los totales incluyen estas alertas (otras suites pueden tener las
        // suyas en la misma base).
        expect(body.totals.alertCount).toBe(body.items.length);
        expect(body.totals.amount).toBe(
          body.items.reduce((sum, alert) => sum + alert.amount, 0),
        );
        expect(body.totals.amount - before.totals.amount).toBe(13_000);
        expect(body.totals.maxDaysOverdue).toBeGreaterThanOrEqual(
          own[0].daysOverdue,
        );
      });
    });

    it('al pagar el período con el lote de T06 la alerta desaparece', async () => {
      await withinRollback(async (f) => {
        const { body: before } = await alertsOf(f);
        const cutoff = before.overdueThrough;
        await seedDay(f, shift(cutoff, -3), 6_000, [f.ana, f.beto]);
        expect((await alertsOf(f)).own).toHaveLength(2);

        // Pagar solo un período que no incluye la propina no la resuelve.
        await authorize(
          request(app.getHttpServer())
            .post('/daily-tips/payment-batches')
            .send({
              storeId: f.storeId,
              from: shift(cutoff, -2),
              to: shift(cutoff, -2),
            }),
          f.accountant,
        ).expect(409);
        expect((await alertsOf(f)).own).toHaveLength(2);

        await authorize(
          request(app.getHttpServer())
            .post('/daily-tips/payment-batches')
            .send({
              storeId: f.storeId,
              from: shift(cutoff, -3),
              to: cutoff,
            }),
          f.accountant,
        ).expect(201);
        expect((await alertsOf(f)).own).toEqual([]);
        expect((await alertsOf(f, f.admin)).own).toEqual([]);
      });
    });

    it('los registros históricos tip_entries ya no generan alertas', async () => {
      await withinRollback(async (f) => {
        const { body: before } = await alertsOf(f);
        const card = await createTestMethod(f.tx, 'Tarjeta alertas', 1);
        // Registro con tarjeta antiguo y sin reparto: antes alertaba.
        await f.tx.tipEntry.create({
          data: {
            businessDate: dbDate(shift(before.overdueThrough, -20)),
            paymentMethodId: card.id,
            amount: 4_000,
            storeId: f.storeId,
            responsibleId: f.supervisor.id,
          },
        });
        const { body, own } = await alertsOf(f);
        expect(own).toEqual([]);
        expect(body.totals.amount).toBe(before.totals.amount);
        // El dato histórico sigue guardado.
        expect(
          await f.tx.tipEntry.count({ where: { storeId: f.storeId } }),
        ).toBe(1);
      });
    });

    it('permite contador y administrador, y rechaza otros roles o ausencia de JWT', async () => {
      await withinRollback(async (f) => {
        await listAlerts(f.admin).expect(200);
        await listAlerts(f.accountant).expect(200);
        await listAlerts(f.supervisor).expect(403);
        await listAlerts(f.ana).expect(403);
        await listAlerts(null).expect(401);
      });
    });
  },
);
