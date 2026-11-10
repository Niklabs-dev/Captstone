import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type {
  DailyTipSummaryResponse,
  TipPaymentBatchListResponse,
  TipPaymentBatchResponse,
} from '../src/tips/types/daily-tips.types.js';
import {
  createDailyTipsFixture,
  TIPS_D1,
  TIPS_D2,
  type DailyTipsFixture,
} from './helpers/daily-tips-fixture.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;
type Fixture = DailyTipsFixture & { tx: Tx };

// Tests de integración HTTP del pago por período de las propinas diarias
// (SPRINT-4A-T06) contra PostgreSQL real con datos ficticios: el lote marca
// todas las No pagadas del período y responde total y cantidades; sin
// pendientes responde 409 sin crear lote; las pagadas no cambian; la
// operación diaria pagada ya no admite correcciones de monto o
// participantes; acceso por rol; validación; auditoría; historial. Todo
// corre dentro de withinRollback: la base se revierte. La carrera con
// transacciones reales está en tip-payment-batches-concurrency.
const databaseUrl = process.env.TEST_DATABASE_URL;

const FROM = '2026-11-01';
const TO = '2026-11-30';
const PATH = '/daily-tips/payment-batches';
const NO_PENDING = 'No hay propinas pendientes de pago en el período';

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

describe.skipIf(!databaseUrl)(
  'API de pago por período de propinas diarias (SPRINT-4A-T06)',
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

    function pay(body: object, user: AuthUser | null): request.Test {
      return authorize(
        request(app.getHttpServer()).post(PATH).send(body),
        user,
      );
    }

    function get(path: string, user: AuthUser | null): request.Test {
      return authorize(request(app.getHttpServer()).get(path), user);
    }

    function query(params: Record<string, string>): string {
      return new URLSearchParams(params).toString();
    }

    async function withinRollback(
      run: (fixture: Fixture) => Promise<void>,
      payFirstDay = false,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            const fixture = await createDailyTipsFixture(tx, {
              storePrefix: 'Subway Pago Propinas',
              emailDomain: '@tip-payment-batches-test.invalid',
              payFirstDay,
            });
            // Las propinas del fixture cumplen la conciliación de la base.
            // Luego se vuelve al modo diferido, como en una transacción real
            // (el lote se inserta antes de marcar sus propinas), y al final
            // se verifican los totales de los lotes como lo haría el commit.
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
            await run({ ...fixture, tx });
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

    it('marca todas las No pagadas del período en un lote y responde total y cantidades', async () => {
      await withinRollback(async (f) => {
        const response = await pay(
          { storeId: f.storeId, from: FROM, to: TO },
          f.accountant,
        ).expect(201);
        const batch = response.body as TipPaymentBatchResponse;
        expect(batch).toEqual({
          id: expect.any(String) as string,
          store: { id: f.storeId, name: f.storeName },
          periodStart: FROM,
          periodEnd: TO,
          totalAmount: 50_000,
          allocationCount: 7,
          workerCount: 4,
          paidBy: { id: f.accountant.id, name: 'Contador Ficticia' },
          paidAt: expect.any(String) as string,
        });

        // Todas las propinas del período quedaron Pagadas en ese lote.
        const tips = await f.tx.dailyTipAllocation.findMany({
          where: { storeId: f.storeId },
        });
        expect(tips).toHaveLength(7);
        for (const tip of tips) {
          expect(tip).toMatchObject({
            status: 'PAID',
            paymentBatchId: batch.id,
          });
        }
        const stored = await f.tx.tipPaymentBatch.findUniqueOrThrow({
          where: { id: batch.id },
        });
        expect(stored).toMatchObject({
          storeId: f.storeId,
          totalAmount: 50_000n,
          allocationCount: 7,
          paidById: f.accountant.id,
          legacyPoolId: null,
        });
        expect(stored.paidAt.toISOString()).toBe(batch.paidAt);

        // Cuadra con la consulta: ya no queda nada pendiente.
        const summary = (
          await get(
            `/daily-tips/summary?${query({ storeId: f.storeId, from: FROM, to: TO })}`,
            f.admin,
          ).expect(200)
        ).body as DailyTipSummaryResponse;
        expect(summary.totals).toMatchObject({
          totalAmount: 50_000,
          paidAmount: 50_000,
          unpaidAmount: 0,
        });

        // El pago diario no toca los repartos por período (tip_pools).
        expect(
          await f.tx.tipPool.count({ where: { storeId: f.storeId } }),
        ).toBe(0);
      });
    });

    it('solo paga lo pendiente: las ya pagadas no se modifican', async () => {
      await withinRollback(async (f) => {
        const before = await f.tx.dailyTipAllocation.findMany({
          where: { storeId: f.storeId, status: 'PAID' },
          orderBy: { id: 'asc' },
        });
        expect(before).toHaveLength(5);
        const pending = await f.tx.dailyTipAllocation.findMany({
          where: { storeId: f.storeId, status: 'UNPAID' },
        });
        const pendingTotal = pending.reduce(
          (sum, tip) => sum + Number(tip.amount),
          0,
        );

        const batch = (
          await pay({ storeId: f.storeId, from: FROM, to: TO }, f.admin).expect(
            201,
          )
        ).body as TipPaymentBatchResponse;
        expect(batch).toMatchObject({
          totalAmount: pendingTotal,
          allocationCount: 2,
          workerCount: 2,
          paidBy: { id: f.admin.id, name: 'Admin Ficticia' },
        });
        // Pendientes: las de Beto y Sofía en D2 (la de Ana ya estaba pagada).
        const anaD2 = await f.tx.dailyTipAllocation.findFirstOrThrow({
          where: { operationId: f.operations[TIPS_D2], workerId: f.ana.id },
        });
        expect(pendingTotal).toBe(10_000 - Number(anaD2.amount));

        // Las pagadas antes siguen en su lote original, sin cambios.
        const after = await f.tx.dailyTipAllocation.findMany({
          where: { id: { in: before.map((tip) => tip.id) } },
          orderBy: { id: 'asc' },
        });
        expect(after).toEqual(before);
        const marked = await f.tx.dailyTipAllocation.findMany({
          where: { paymentBatchId: batch.id },
        });
        expect(marked.map((tip) => tip.id).sort()).toEqual(
          pending.map((tip) => tip.id).sort(),
        );
      }, true);
    });

    it('sin pendientes responde 409 sin crear el lote', async () => {
      await withinRollback(async (f) => {
        await pay(
          { storeId: f.storeId, from: FROM, to: TO },
          f.accountant,
        ).expect(201);
        const batches = await f.tx.tipPaymentBatch.count({
          where: { storeId: f.storeId },
        });

        // Doble envío del mismo período.
        const again = await pay(
          { storeId: f.storeId, from: FROM, to: TO },
          f.accountant,
        ).expect(409);
        expect(again.body).toEqual({
          statusCode: 409,
          message: NO_PENDING,
          error: 'Conflict',
        });

        // Período sin propinas.
        const empty = await pay(
          { storeId: f.storeId, from: '2026-12-01', to: '2026-12-31' },
          f.admin,
        ).expect(409);
        expect((empty.body as { message: string }).message).toBe(NO_PENDING);

        expect(
          await f.tx.tipPaymentBatch.count({ where: { storeId: f.storeId } }),
        ).toBe(batches);
        expect(
          await f.tx.auditLog.count({
            where: { action: AUDIT_ACTION.DAILY_TIPS_PAID, storeId: f.storeId },
          }),
        ).toBe(1);
      });
    });

    it('paga solo el período indicado: los días fuera del rango siguen pendientes', async () => {
      await withinRollback(async (f) => {
        const batch = (
          await pay(
            { storeId: f.storeId, from: TIPS_D2, to: TIPS_D2 },
            f.accountant,
          ).expect(201)
        ).body as TipPaymentBatchResponse;
        expect(batch).toMatchObject({
          periodStart: TIPS_D2,
          periodEnd: TIPS_D2,
          totalAmount: 10_000,
          allocationCount: 3,
          workerCount: 3,
        });
        const d1 = await f.tx.dailyTipAllocation.findMany({
          where: { operationId: f.operations[TIPS_D1] },
        });
        expect(d1.every((tip) => tip.status === 'UNPAID')).toBe(true);
      });
    });

    it('la operación diaria pagada ya no admite corregir monto ni participantes (409)', async () => {
      await withinRollback(async (f) => {
        await pay(
          { storeId: f.storeId, from: TIPS_D1, to: TIPS_D1 },
          f.accountant,
        ).expect(201);
        const operationId = f.operations[TIPS_D1];
        const amount = await authorize(
          request(app.getHttpServer())
            .patch(`/daily-operations/${operationId}`)
            .field('cashTipAmount', '12000'),
          f.supervisor,
        ).expect(409);
        expect(JSON.stringify(amount.body)).toContain('propinas pagadas');
        const participants = await authorize(
          request(app.getHttpServer())
            .patch(`/daily-operations/${operationId}`)
            .field('participantIds', f.ana.id),
          f.supervisor,
        ).expect(409);
        expect(JSON.stringify(participants.body)).toContain('propinas pagadas');
        const stored = await f.tx.dailyOperation.findUniqueOrThrow({
          where: { id: operationId },
        });
        expect(stored.cashTipAmount).toBe(40_000n);
      });
    });

    it('audita quién, cuándo, el local, el período y el total', async () => {
      await withinRollback(async (f) => {
        const batch = (
          await pay(
            { storeId: f.storeId, from: FROM, to: TO },
            f.accountant,
          ).expect(201)
        ).body as TipPaymentBatchResponse;
        const audit = await f.tx.auditLog.findFirstOrThrow({
          where: { action: AUDIT_ACTION.DAILY_TIPS_PAID, entityId: batch.id },
        });
        expect(audit).toMatchObject({
          entityType: 'tip_payment_batches',
          userId: f.accountant.id,
          storeId: f.storeId,
        });
        expect(audit.createdAt).toBeInstanceOf(Date);
        expect(audit.detail).toEqual({
          storeId: f.storeId,
          periodStart: FROM,
          periodEnd: TO,
          totalAmount: 50_000,
          allocationCount: 7,
          workerCount: 4,
          paidAt: batch.paidAt,
        });
      });
    });

    it('lista el historial de pagos del rango, del más reciente al más antiguo', async () => {
      await withinRollback(async (f) => {
        const paid = (
          await pay(
            { storeId: f.storeId, from: FROM, to: TO },
            f.accountant,
          ).expect(201)
        ).body as TipPaymentBatchResponse;

        const body = (
          await get(
            `${PATH}?${query({ storeId: f.storeId, from: FROM, to: TO })}`,
            f.admin,
          ).expect(200)
        ).body as TipPaymentBatchListResponse;
        expect(body.batches.map((batch) => batch.id)).toEqual([
          paid.id,
          f.batchId,
        ]);
        expect(body.batches[0]).toEqual(paid);
        expect(body.batches[1]).toEqual({
          id: f.batchId,
          store: { id: f.storeId, name: f.storeName },
          periodStart: TIPS_D1,
          periodEnd: TIPS_D2,
          totalAmount: 50_000 - paid.totalAmount,
          allocationCount: 5,
          workerCount: 4,
          paidBy: { id: f.accountant.id, name: 'Contador Ficticia' },
          paidAt: '2026-11-06T15:00:00.000Z',
        });

        // Solo los lotes cuyo período se cruza con el rango.
        const later = (
          await get(
            `${PATH}?${query({ storeId: f.storeId, from: '2026-12-01', to: '2026-12-31' })}`,
            f.accountant,
          ).expect(200)
        ).body as TipPaymentBatchListResponse;
        expect(later.batches).toEqual([]);
        const second = (
          await get(
            `${PATH}?${query({ storeId: f.storeId, from: TIPS_D2, to: TIPS_D2 })}`,
            f.accountant,
          ).expect(200)
        ).body as TipPaymentBatchListResponse;
        expect(second.batches).toHaveLength(2);
      }, true);
    });

    it('solo ADMINISTRADOR y CONTADOR: SUPERVISOR y TRABAJADOR reciben 403', async () => {
      await withinRollback(async (f) => {
        const body = { storeId: f.storeId, from: FROM, to: TO };
        const list = `${PATH}?${query(body)}`;
        for (const user of [f.supervisor, f.ana]) {
          await pay(body, user).expect(403);
          await get(list, user).expect(403);
        }
        await pay(body, null).expect(401);
        await get(list, null).expect(401);
        expect(
          await f.tx.tipPaymentBatch.count({ where: { storeId: f.storeId } }),
        ).toBe(0);
        await get(list, f.accountant).expect(200);
      });
    });

    it('valida el rango como /days (400) y el local (404)', async () => {
      await withinRollback(async (f) => {
        for (const body of [
          { storeId: f.storeId, from: '2026-11-10', to: '2026-11-01' },
          { storeId: f.storeId, from: '2026-11-01', to: '2027-01-02' },
          { storeId: f.storeId, from: '2026-02-30', to: '2026-03-01' },
          { storeId: 'no-es-uuid', from: FROM, to: TO },
          { storeId: f.storeId, from: FROM },
          { storeId: f.storeId, from: FROM, to: TO, totalAmount: 1 },
        ]) {
          await pay(body, f.admin).expect(400);
        }
        await get(
          `${PATH}?${query({ storeId: f.storeId, from: '2026-11-01', to: '2027-01-02' })}`,
          f.admin,
        ).expect(400);
        const missing = '00000000-0000-4000-8000-000000000000';
        await pay({ storeId: missing, from: FROM, to: TO }, f.admin).expect(
          404,
        );
        await get(
          `${PATH}?${query({ storeId: missing, from: FROM, to: TO })}`,
          f.admin,
        ).expect(404);
        expect(
          await f.tx.tipPaymentBatch.count({ where: { storeId: f.storeId } }),
        ).toBe(0);
      });
    });
  },
);
