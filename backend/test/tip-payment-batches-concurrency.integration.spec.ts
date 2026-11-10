import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { TipPaymentBatchResponse } from '../src/tips/types/daily-tips.types.js';
import {
  createDailyTipsFixture,
  TIPS_D1,
  type DailyTipsFixture,
} from './helpers/daily-tips-fixture.js';

type App = Parameters<typeof request>[0];

// Tests de concurrencia HTTP del pago por período (SPRINT-4A-T06) contra
// PostgreSQL real con transacciones reales (sin el harness withinRollback:
// cada solicitud abre su propia transacción y la carrera es genuina). Dos
// pagos simultáneos del mismo período (o un doble clic) crean un solo lote:
// uno responde 201 y el otro 409 sin crear nada. Un pago simultáneo con la
// corrección de un día del período se serializa: o la corrección entra antes
// y se paga el reparto corregido, o el pago entra antes y la corrección
// responde 409. Los datos van con un local propio por corrida y se eliminan
// al finalizar junto con su auditoría (como mantenimiento: lotes y propinas
// pagadas son inmutables).
const databaseUrl = process.env.TEST_DATABASE_URL;

const STORE_PREFIX = 'Subway Pago Concurrencia';
const DOMAIN = '@tip-payment-concurrency-test.invalid';
const FROM = '2026-11-01';
const TO = '2026-11-30';
const PATH = '/daily-tips/payment-batches';

describe.skipIf(!databaseUrl)(
  'Concurrencia del pago por período de propinas (SPRINT-4A-T06)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    const fixtures: DailyTipsFixture[] = [];

    function authorize(req: request.Test, user: AuthUser): request.Test {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return req.set('Authorization', `Bearer ${jwt.sign(payload)}`);
    }

    function pay(f: DailyTipsFixture, user: AuthUser): request.Test {
      return authorize(
        request(app.getHttpServer())
          .post(PATH)
          .send({ storeId: f.storeId, from: FROM, to: TO }),
        user,
      );
    }

    async function fixture(): Promise<DailyTipsFixture> {
      const created = await createDailyTipsFixture(prisma, {
        storePrefix: STORE_PREFIX,
        emailDomain: DOMAIN,
      });
      fixtures.push(created);
      return created;
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
      // Mantenimiento de la base de pruebas: lotes, propinas pagadas y
      // auditoría son inmutables (triggers), así que se eliminan con
      // session_replication_role = replica (superusuario de
      // TEST_DATABASE_URL). En ese modo no corren las cascadas, por eso se
      // borra cada tabla de forma explícita. La aplicación nunca usa esta vía.
      const storeIds = fixtures.flatMap((f) => [f.storeId, f.otherStoreId]);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.auditLog.deleteMany({
          where: {
            OR: [
              { storeId: { in: storeIds } },
              { user: { email: { endsWith: DOMAIN } } },
            ],
          },
        });
        await tx.dailyTipAllocation.deleteMany({
          where: { storeId: { in: storeIds } },
        });
        await tx.tipPaymentBatch.deleteMany({
          where: { storeId: { in: storeIds } },
        });
        await tx.dailyOperationParticipant.deleteMany({
          where: { operation: { storeId: { in: storeIds } } },
        });
        await tx.dailyOperation.deleteMany({
          where: { storeId: { in: storeIds } },
        });
        await tx.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
        await tx.store.deleteMany({ where: { id: { in: storeIds } } });
      });
      await prisma.$disconnect();
      await app.close();
    });

    it('dos pagos simultáneos del mismo período crean un solo lote (201 + 409)', async () => {
      const f = await fixture();
      const [first, second] = await Promise.all([
        pay(f, f.accountant),
        pay(f, f.admin),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const created = (
        first.status === 201 ? first.body : second.body
      ) as TipPaymentBatchResponse;
      const conflict = (first.status === 409 ? first.body : second.body) as {
        message: string;
      };
      expect(conflict.message).toBe(
        'No hay propinas pendientes de pago en el período',
      );
      expect(created).toMatchObject({
        totalAmount: 50_000,
        allocationCount: 7,
        workerCount: 4,
      });

      // Un solo lote, todas las propinas en él y una sola auditoría; la
      // conciliación diferida de la base corrió en el commit real.
      const batches = await prisma.tipPaymentBatch.findMany({
        where: { storeId: f.storeId },
      });
      expect(batches.map((batch) => batch.id)).toEqual([created.id]);
      const tips = await prisma.dailyTipAllocation.findMany({
        where: { storeId: f.storeId },
      });
      expect(tips).toHaveLength(7);
      expect(tips.every((tip) => tip.paymentBatchId === created.id)).toBe(true);
      expect(
        await prisma.auditLog.count({
          where: { action: AUDIT_ACTION.DAILY_TIPS_PAID, storeId: f.storeId },
        }),
      ).toBe(1);
    });

    it('un doble clic (cinco envíos a la vez) no duplica el pago', async () => {
      const f = await fixture();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => pay(f, f.accountant)),
      );
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      expect(
        await prisma.tipPaymentBatch.count({ where: { storeId: f.storeId } }),
      ).toBe(1);
      expect(
        await prisma.dailyTipAllocation.count({
          where: { storeId: f.storeId, status: 'UNPAID' },
        }),
      ).toBe(0);
    });

    it('un pago simultáneo con la corrección de un día se serializa sin perder montos', async () => {
      const f = await fixture();
      const operationId = f.operations[TIPS_D1];
      const [payment, correction] = await Promise.all([
        pay(f, f.accountant),
        authorize(
          request(app.getHttpServer())
            .patch(`/daily-operations/${operationId}`)
            .field('cashTipAmount', '20000'),
          f.supervisor,
        ),
      ]);
      expect(payment.status).toBe(201);
      const batch = payment.body as TipPaymentBatchResponse;
      const operation = await prisma.dailyOperation.findUniqueOrThrow({
        where: { id: operationId },
      });
      if (correction.status === 200) {
        // La corrección entró antes: se pagó el reparto corregido.
        expect(operation.cashTipAmount).toBe(20_000n);
        expect(batch.totalAmount).toBe(30_000);
      } else {
        // El pago entró antes: la corrección ya no aplica.
        expect(correction.status).toBe(409);
        expect(operation.cashTipAmount).toBe(40_000n);
        expect(batch.totalAmount).toBe(50_000);
      }
      const tips = await prisma.dailyTipAllocation.findMany({
        where: { storeId: f.storeId },
      });
      expect(tips.every((tip) => tip.paymentBatchId === batch.id)).toBe(true);
      expect(tips.reduce((sum, tip) => sum + Number(tip.amount), 0)).toBe(
        batch.totalAmount,
      );
    });
  },
);
