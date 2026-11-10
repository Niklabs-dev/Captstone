import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import type { DailyOperationResponse } from '../src/daily-operations/types/daily-operations.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { epochDay } from '../src/tips/calculation/equal-daily-distribution.calculator.js';
import type {
  DailyTipSummaryResponse,
  TipPaymentBatchResponse,
} from '../src/tips/types/daily-tips.types.js';
import type { TipPoolRetiredActionBody } from '../src/tips/types/tip-pools.types.js';
import { minimalJpeg } from './helpers/jpeg.js';
import { ensureDefaultPaymentMethods } from './helpers/payment-methods.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Verificación de punta a punta del flujo diario y el reparto equitativo
// (SPRINT-4R-T07, con el reparto automático y el pago por período de
// SPRINT-4A-T03/T06 desde SPRINT-4A-T08) contra PostgreSQL real y el
// pipeline HTTP completo.
//
// A diferencia de los tests por módulo, que siembran las operaciones directo
// en la base, aquí todo pasa por la API como en el uso real: el supervisor
// registra tres días (tarjeta + efectivo con voucher y diferencia positiva;
// solo efectivo con diferencia negativa; un día en cero) con participantes
// distintos y cada día queda repartido al guardarlo; el supervisor corrige un
// día y su reparto se recalcula; el contador paga el período y desde ahí la
// operación no se corrige. El reparto por período (vista previa,
// confirmación y pago) ya no existe: responde 410 y no crea repartos.
// Además se comprueba que el cierre por turno y la captura de ventas/vouchers
// de Mercado Pago ya no existen, y que los cierres y repartos proporcionales
// históricos no cambian.
//
// Todo corre en withinRollback: la base se revierte y los vouchers se escriben
// en una carpeta temporal que se elimina al terminar.
const databaseUrl = process.env.TEST_DATABASE_URL;

// Período en el pasado, ya cerrado al pagarlo.
const PERIOD = { start: '2026-09-07', end: '2026-09-13' } as const;
const DAY_MIXED = '2026-09-07';
const DAY_CASH = '2026-09-08';
const DAY_ZERO = '2026-09-09';
const LEGACY_POOL_DATE = '2026-08-03';
const LEGACY_CLOSING_DATE = '2026-03-10';

const JPEG = minimalJpeg('voucher-flujo-diario');

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  storeId: string;
  supervisor: AuthUser;
  accountant: AuthUser;
  ana: AuthUser;
  beto: AuthUser;
  carla: AuthUser;
  // Trabajadora inactiva: no aparece entre los elegibles.
  cora: AuthUser;
}

interface DayFields {
  businessDate: string;
  cardTipAmount: number;
  cashTipAmount: number;
  cashDifference: number;
  differenceReason?: string;
}

// Monto esperado de un día por participante, con la regla documentada del
// calculador: base para todos y el peso extra en la posición
// (díaDesdeEpoch mod n) del orden por ID.
function expectedSplit(
  businessDate: string,
  fund: number,
  participantIds: readonly string[],
): Record<string, number> {
  const sorted = [...participantIds].sort();
  const base = Math.floor(fund / sorted.length);
  const residual = fund % sorted.length;
  const offset = epochDay(businessDate) % sorted.length;
  return Object.fromEntries(
    sorted.map((id, index) => [
      id,
      base +
        ((index - offset + sorted.length) % sorted.length < residual ? 1 : 0),
    ]),
  );
}

function addAmounts(
  ...parts: Record<string, number>[]
): Record<string, number> {
  const total: Record<string, number> = {};
  for (const part of parts) {
    for (const [id, amount] of Object.entries(part)) {
      total[id] = (total[id] ?? 0) + amount;
    }
  }
  return total;
}

describe.skipIf(!databaseUrl)(
  'Flujo diario, reparto automático y pago por período de punta a punta (SPRINT-4R-T07 y SPRINT-4A-T08)',
  { timeout: 90_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;
    let voucherRoot: string;

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    function server() {
      return request(app.getHttpServer());
    }

    function postDay(
      f: Fixture,
      fields: DayFields,
      participantIds: string[],
      withVoucher: boolean,
    ): request.Test {
      let req = server()
        .post('/daily-operations')
        .set('Authorization', `Bearer ${token(f.supervisor)}`)
        .field('storeId', f.storeId)
        .field('businessDate', fields.businessDate)
        .field('cardTipAmount', String(fields.cardTipAmount))
        .field('cashTipAmount', String(fields.cashTipAmount))
        .field('cashDifference', String(fields.cashDifference));
      if (fields.differenceReason !== undefined) {
        req = req.field('differenceReason', fields.differenceReason);
      }
      for (const participantId of participantIds) {
        req = req.field('participantIds', participantId);
      }
      if (withVoucher) {
        req = req.attach('voucher', JPEG, 'voucher-terminal.jpg');
      }
      return req;
    }

    // Propinas del período por trabajador según la consulta del contador.
    async function summaryOf(f: Fixture): Promise<Record<string, number>> {
      const summary = (
        await server()
          .get(
            `/daily-tips/summary?storeId=${f.storeId}&from=${PERIOD.start}&to=${PERIOD.end}`,
          )
          .set('Authorization', `Bearer ${token(f.accountant)}`)
          .expect(200)
      ).body as DailyTipSummaryResponse;
      return Object.fromEntries(
        summary.workers.map((row) => [row.worker.id, row.totalAmount]),
      );
    }

    // Un rechazo de trigger aborta la transacción de PostgreSQL. En uso real
    // cada request tiene la suya; aquí todas comparten la del test, así que
    // el intento rechazado se aísla en un SAVEPOINT y se revierte a él para
    // poder continuar el recorrido.
    async function expectFrozen(
      f: Fixture,
      operationId: string,
      cashTipAmount: string,
    ): Promise<undefined> {
      await f.tx.$executeRaw`SAVEPOINT correccion_rechazada`;
      const rejected = await server()
        .patch(`/daily-operations/${operationId}`)
        .set('Authorization', `Bearer ${token(f.supervisor)}`)
        .field('cashTipAmount', cashTipAmount)
        .expect(409);
      expect(JSON.stringify(rejected.body)).toContain('propinas pagadas');
      await f.tx.$executeRaw`ROLLBACK TO SAVEPOINT correccion_rechazada`;
      return undefined;
    }

    async function createUser(
      tx: Tx,
      role: RoleCode,
      storeId: string | null,
      firstName: string,
      active = true,
    ): Promise<AuthUser> {
      const roleRecord = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const id = randomUUID();
      const email = `${id}@daily-flow-test.invalid`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName,
          lastName: 'Flujo',
          isActive: active,
          roleId: roleRecord.id,
          storeId,
        },
      });
      return { id, email, role, storeId };
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      await ensureDefaultPaymentMethods(tx);
      const store = await tx.store.create({
        data: {
          name: `Subway Flujo Diario ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 707',
        },
      });
      return {
        tx,
        storeId: store.id,
        supervisor: await createUser(tx, ROLE.SUPERVISOR, store.id, 'Sofia'),
        accountant: await createUser(tx, ROLE.CONTADOR, null, 'Carmen'),
        ana: await createUser(tx, ROLE.TRABAJADOR, store.id, 'Ana'),
        beto: await createUser(tx, ROLE.TRABAJADOR, store.id, 'Beto'),
        carla: await createUser(tx, ROLE.TRABAJADOR, store.id, 'Carla'),
        cora: await createUser(tx, ROLE.TRABAJADOR, store.id, 'Cora', false),
      };
    }

    // Grafo histórico del cierre por turno (flujo reemplazado por T01):
    // cierre CLOSED con línea, voucher de Mercado Pago y venta vinculada.
    async function createLegacyClosing(f: Fixture): Promise<string> {
      const cashMethod = await f.tx.paymentMethod.findUniqueOrThrow({
        where: { code: 'CASH' },
      });
      const sale = await f.tx.sale.create({
        data: {
          soldAt: new Date(`${LEGACY_CLOSING_DATE}T12:00:00-03:00`),
          paymentMethodId: cashMethod.id,
          grossAmount: 100000,
          tipAmount: 0,
          storeId: f.storeId,
          registeredById: f.supervisor.id,
        },
      });
      const closing = await f.tx.cashClosing.create({
        data: {
          storeId: f.storeId,
          businessDate: new Date(`${LEGACY_CLOSING_DATE}T00:00:00.000Z`),
          shift: 1,
          openingCash: 50000,
          status: 'OPEN',
          responsibleId: f.supervisor.id,
        },
      });
      await f.tx.cashClosingLine.create({
        data: {
          closingId: closing.id,
          paymentMethodId: cashMethod.id,
          expectedAmount: 150000,
          countedAmount: 150000,
          difference: 0,
        },
      });
      await f.tx.cashClosingVoucher.create({
        data: {
          closingId: closing.id,
          source: 'MERCADO_PAGO',
          periodStart: new Date(`${LEGACY_CLOSING_DATE}T08:00:00-03:00`),
          periodEnd: new Date(`${LEGACY_CLOSING_DATE}T16:00:00-03:00`),
          amount: 0,
          tipIncludedAmount: 0,
        },
      });
      await f.tx.sale.update({
        where: { id: sale.id },
        data: { cashClosingId: closing.id },
      });
      await f.tx.cashClosing.update({
        where: { id: closing.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(`${LEGACY_CLOSING_DATE}T16:05:00-03:00`),
          closedById: f.supervisor.id,
        },
      });
      return closing.id;
    }

    // Reparto proporcional a horas histórico (DRAFT) del mismo local, fuera
    // del período del flujo: ni el cálculo ni el pago nuevos deben tocarlo.
    async function createLegacyProportionalPool(f: Fixture): Promise<string> {
      const agreement = await f.tx.tipAgreement.create({
        data: {
          name: 'Pacto proporcional histórico',
          rule: 'PROPORTIONAL_TO_HOURS',
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          storeId: f.storeId,
          createdById: f.supervisor.id,
        },
      });
      const day = new Date(`${LEGACY_POOL_DATE}T00:00:00.000Z`);
      const pool = await f.tx.tipPool.create({
        data: {
          storeId: f.storeId,
          periodStart: day,
          periodEnd: day,
          totalAmount: new Prisma.Decimal(1500),
          calculatedById: f.accountant.id,
          agreementId: agreement.id,
          agreementSnapshot: {
            id: agreement.id,
            name: agreement.name,
            rule: 'PROPORTIONAL_TO_HOURS',
          },
        },
      });
      await f.tx.tipPoolLine.create({
        data: {
          poolId: pool.id,
          userId: f.ana.id,
          hoursWorked: new Prisma.Decimal(8),
          amount: new Prisma.Decimal(1500),
        },
      });
      return pool.id;
    }

    // Foto serializada de los registros históricos, con sus updatedAt: si
    // algo los modifica, la comparación falla.
    async function legacySnapshot(
      f: Fixture,
      closingId: string,
      poolId: string,
    ): Promise<string> {
      const closing = await f.tx.cashClosing.findUniqueOrThrow({
        where: { id: closingId },
        include: { lines: true, vouchers: true, sales: true },
      });
      const pool = await f.tx.tipPool.findUniqueOrThrow({
        where: { id: poolId },
        include: { lines: true, sources: true, dailyOperationSources: true },
      });
      return JSON.stringify({ closing, pool });
    }

    async function withinRollback(
      run: (fixture: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            await run(await createFixture(tx));
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 80_000 },
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
      voucherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-flow-'));
      process.env.DOCUMENTS_STORAGE_PATH = voucherRoot;
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';

      switchable = createSwitchablePrisma();
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(switchable.service)
        .compile();
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
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
      await fs.rm(voucherRoot, { recursive: true, force: true });
    });

    it('registra tres días por la API, cada día queda repartido, la corrección recalcula y el contador paga el período', async () => {
      await withinRollback(async (f) => {
        const legacyClosingId = await createLegacyClosing(f);
        const legacyPoolId = await createLegacyProportionalPool(f);
        const legacyBefore = await legacySnapshot(
          f,
          legacyClosingId,
          legacyPoolId,
        );

        // 1. El supervisor ve como elegibles solo a los activos de su local,
        //    incluido él mismo (SPRINT-4A-T01: también recibe su parte).
        const eligible = (
          await server()
            .get(`/daily-operations/eligible-workers?storeId=${f.storeId}`)
            .set('Authorization', `Bearer ${token(f.supervisor)}`)
            .expect(200)
        ).body as { id: string }[];
        expect(eligible.map((worker) => worker.id).sort()).toEqual(
          [f.ana.id, f.beto.id, f.carla.id, f.supervisor.id].sort(),
        );

        // 2. Día con tarjeta + efectivo ($10.000 entre tres), voucher y
        //    diferencia positiva con motivo.
        const mixedFields: DayFields = {
          businessDate: DAY_MIXED,
          cardTipAmount: 7000,
          cashTipAmount: 3000,
          cashDifference: 2000,
          differenceReason: 'Sobrante por vuelto no entregado',
        };
        const everyone = [f.ana.id, f.beto.id, f.carla.id];
        const mixed = (
          await postDay(f, mixedFields, everyone, true).expect(201)
        ).body as DailyOperationResponse;
        expect(mixed).toMatchObject({
          businessDate: DAY_MIXED,
          tipFundAmount: 10000,
          cashDifference: 2000,
          differenceReason: 'Sobrante por vuelto no entregado',
          responsible: { id: f.supervisor.id },
        });
        expect(mixed.voucher?.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
        expect(mixed.participants).toHaveLength(3);

        // Reintento idéntico (otro orden de participantes): mismo ID, 200.
        const retry = (
          await postDay(f, mixedFields, [...everyone].reverse(), true).expect(
            200,
          )
        ).body as DailyOperationResponse;
        expect(retry.id).toBe(mixed.id);

        // 3. Día solo en efectivo con diferencia negativa y otros
        //    participantes (Beto y Carla).
        const cash = (
          await postDay(
            f,
            {
              businessDate: DAY_CASH,
              cardTipAmount: 0,
              cashTipAmount: 6001,
              cashDifference: -1500,
              differenceReason: 'Faltante por error en el vuelto',
            },
            [f.beto.id, f.carla.id],
            false,
          ).expect(201)
        ).body as DailyOperationResponse;
        expect(cash).toMatchObject({
          tipFundAmount: 6001,
          cashDifference: -1500,
          differenceReason: 'Faltante por error en el vuelto',
          voucher: null,
        });

        // 4. Día sin propinas: sin voucher, sin participantes y sin
        //    diferencia.
        const zero = (
          await postDay(
            f,
            {
              businessDate: DAY_ZERO,
              cardTipAmount: 0,
              cashTipAmount: 0,
              cashDifference: 0,
            },
            [],
            false,
          ).expect(201)
        ).body as DailyOperationResponse;
        expect(zero).toMatchObject({
          tipFundAmount: 0,
          voucher: null,
          participants: [],
        });

        // La consulta del supervisor devuelve la diferencia con su signo.
        const listed = (
          await server()
            .get(
              `/daily-operations?storeId=${f.storeId}&businessDate=${DAY_CASH}`,
            )
            .set('Authorization', `Bearer ${token(f.supervisor)}`)
            .expect(200)
        ).body as DailyOperationResponse[];
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({
          id: cash.id,
          cashDifference: -1500,
        });

        // 5. Cada día quedó repartido al guardarlo: el contador ve por
        //    trabajador la suma de sus propinas diarias, sin calcular nada.
        const everyoneSplit = expectedSplit(DAY_MIXED, 10000, everyone);
        expect(await summaryOf(f)).toEqual(
          addAmounts(
            everyoneSplit,
            expectedSplit(DAY_CASH, 6001, [f.beto.id, f.carla.id]),
          ),
        );
        // El día en cero no reparte nada y la trabajadora inactiva no recibe.
        expect(
          await f.tx.dailyTipAllocation.count({
            where: { operationId: zero.id },
          }),
        ).toBe(0);
        expect(
          await f.tx.dailyTipAllocation.count({
            where: { workerId: f.cora.id },
          }),
        ).toBe(0);

        // 6. El supervisor corrige el día en efectivo y su reparto No pagado
        //    se recalcula en la misma transacción.
        await server()
          .patch(`/daily-operations/${cash.id}`)
          .set('Authorization', `Bearer ${token(f.supervisor)}`)
          .field('cashTipAmount', '6002')
          .expect(200);
        const finalExpected = addAmounts(
          everyoneSplit,
          expectedSplit(DAY_CASH, 6002, [f.beto.id, f.carla.id]),
        );
        expect(await summaryOf(f)).toEqual(finalExpected);

        // 7. El reparto por período ya no existe: la vista previa responde
        //    410 y no crea ningún reparto del período.
        const retired = await server()
          .post('/tip-pools/preview')
          .set('Authorization', `Bearer ${token(f.accountant)}`)
          .send({
            storeId: f.storeId,
            periodStart: PERIOD.start,
            periodEnd: PERIOD.end,
          })
          .expect(410);
        expect((retired.body as TipPoolRetiredActionBody).statusCode).toBe(410);
        expect(
          await f.tx.tipPool.count({
            where: { storeId: f.storeId, periodStart: new Date(PERIOD.start) },
          }),
        ).toBe(0);

        // 8. El contador paga el período: un lote con todas las propinas
        //    No pagadas, que suma el fondo de los tres días.
        const batch = (
          await server()
            .post('/daily-tips/payment-batches')
            .set('Authorization', `Bearer ${token(f.accountant)}`)
            .send({ storeId: f.storeId, from: PERIOD.start, to: PERIOD.end })
            .expect(201)
        ).body as TipPaymentBatchResponse;
        expect(batch).toMatchObject({
          periodStart: PERIOD.start,
          periodEnd: PERIOD.end,
          totalAmount: 16002,
          allocationCount: 5,
        });
        expect(
          await f.tx.dailyTipAllocation.count({
            where: { storeId: f.storeId, status: 'UNPAID' },
          }),
        ).toBe(0);

        // 9. Pagado, ninguna operación del período se puede corregir.
        await expectFrozen(f, cash.id, '7000');
        await expectFrozen(f, mixed.id, '1');

        // 10. Trazabilidad: tres altas (el reintento no se audita), una
        //     corrección, el pago y ninguna acción de reparto por período.
        const operationAudits = await f.tx.auditLog.findMany({
          where: {
            storeId: f.storeId,
            action: {
              in: [
                AUDIT_ACTION.DAILY_OPERATION_CREATED,
                AUDIT_ACTION.DAILY_OPERATION_UPDATED,
              ],
            },
          },
          select: { action: true },
        });
        expect(
          operationAudits.filter(
            (audit) => audit.action === AUDIT_ACTION.DAILY_OPERATION_CREATED,
          ),
        ).toHaveLength(3);
        expect(
          operationAudits.filter(
            (audit) => audit.action === AUDIT_ACTION.DAILY_OPERATION_UPDATED,
          ),
        ).toHaveLength(1);
        expect(
          await f.tx.auditLog.count({
            where: {
              action: AUDIT_ACTION.DAILY_TIPS_PAID,
              entityId: batch.id,
            },
          }),
        ).toBe(1);
        expect(
          await f.tx.auditLog.count({
            where: { storeId: f.storeId, entityType: 'tip_pools' },
          }),
        ).toBe(0);

        // 11. Los registros históricos quedaron intactos.
        expect(await legacySnapshot(f, legacyClosingId, legacyPoolId)).toBe(
          legacyBefore,
        );
      });
    });

    it('ya no existe un segundo cierre ni la captura de ventas o vouchers de Mercado Pago', async () => {
      await withinRollback(async (f) => {
        const legacyClosingId = await createLegacyClosing(f);
        const auth = `Bearer ${token(f.supervisor)}`;

        // Las rutas de escritura del flujo reemplazado no existen (404),
        // ni siquiera para el supervisor del local.
        await server()
          .post('/cash-closings')
          .set('Authorization', auth)
          .send({ storeId: f.storeId, businessDate: DAY_MIXED, shift: 1 })
          .expect(404);
        await server()
          .post(`/cash-closings/${legacyClosingId}/close`)
          .set('Authorization', auth)
          .send({})
          .expect(404);
        await server()
          .post(`/cash-closings/${legacyClosingId}/vouchers`)
          .set('Authorization', auth)
          .send({ source: 'MERCADO_PAGO', amount: 1000 })
          .expect(404);
        await server()
          .post('/sales')
          .set('Authorization', auth)
          .send({ storeId: f.storeId, grossAmount: 1000 })
          .expect(404);

        // La operación diaria no acepta montos de ventas ni de Mercado Pago:
        // el pipe rechaza esos campos en vez de ignorarlos en silencio.
        for (const field of [
          'mercadoPagoGrossAmount',
          'mercadoPagoTipAmount',
          'mrcomandaNetSales',
          'shift',
        ]) {
          const rejected = await server()
            .post('/daily-operations')
            .set('Authorization', auth)
            .field('storeId', f.storeId)
            .field('businessDate', DAY_MIXED)
            .field('cardTipAmount', '0')
            .field('cashTipAmount', '0')
            .field('cashDifference', '0')
            .field(field, '1000')
            .expect(400);
          expect(JSON.stringify(rejected.body)).toContain(field);
        }
        expect(
          await f.tx.dailyOperation.count({ where: { storeId: f.storeId } }),
        ).toBe(0);

        // El histórico sigue legible por su ID.
        await server()
          .get(`/cash-closings/${legacyClosingId}`)
          .set('Authorization', auth)
          .expect(200);
      });
    });
  },
);
