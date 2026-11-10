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
import type { OwnTipReceiptDto } from '../src/tips/dto/own-tip-receipt.dto.js';
import type {
  TipPoolReceiptResponse,
  TipPoolResponse,
} from '../src/tips/types/tip-pools.types.js';
import { minimalJpeg } from './helpers/jpeg.js';
import { ensureDefaultPaymentMethods } from './helpers/payment-methods.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Verificación de punta a punta del flujo diario y el reparto equitativo
// (SPRINT-4R-T07) contra PostgreSQL real y el pipeline HTTP completo.
//
// A diferencia de los tests por módulo (T01–T06), que siembran las
// operaciones directo en la base, aquí todo pasa por la API como en el uso
// real: el supervisor registra tres días (tarjeta + efectivo con voucher y
// diferencia positiva; solo efectivo con diferencia negativa; un día en cero)
// con participantes distintos, el contador calcula, el supervisor corrige un
// día en DRAFT, el contador recalcula, confirma y paga, y cada trabajador ve
// en su portal exactamente el monto de su línea. Además se comprueba que el
// cierre por turno y la captura de ventas/vouchers de Mercado Pago ya no
// existen, y que los cierres y repartos proporcionales históricos no cambian.
//
// Todo corre en withinRollback: la base se revierte y los vouchers se escriben
// en una carpeta temporal que se elimina al terminar.
const databaseUrl = process.env.TEST_DATABASE_URL;

// Período en el pasado: el pago sin fecha usa el día de hoy en Chile, que
// debe ser posterior al término del período.
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

function amountsByUser(pool: TipPoolResponse): Record<string, number> {
  return Object.fromEntries(
    pool.lines.map((line) => [line.userId, line.amount]),
  );
}

describe.skipIf(!databaseUrl)(
  'Flujo diario y reparto equitativo de punta a punta (SPRINT-4R-T07)',
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

    function preview(f: Fixture, expectedVersion?: number): request.Test {
      return server()
        .post('/tip-pools/preview')
        .set('Authorization', `Bearer ${token(f.accountant)}`)
        .send({
          storeId: f.storeId,
          periodStart: PERIOD.start,
          periodEnd: PERIOD.end,
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        });
    }

    function poolAction(
      f: Fixture,
      poolId: string,
      name: 'confirm' | 'pay',
      expectedVersion: number,
    ): request.Test {
      return server()
        .post(`/tip-pools/${poolId}/${name}`)
        .set('Authorization', `Bearer ${token(f.accountant)}`)
        .send({ expectedVersion });
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
      expect(JSON.stringify(rejected.body)).toContain(
        'reparto confirmado o pagado',
      );
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

    it('registra tres días por la API, calcula, recalcula el DRAFT, confirma, paga y cada trabajador ve su monto', async () => {
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

        // 5. El contador calcula: cada uno recibe la suma de sus
        //    asignaciones diarias y el reparto concilia exacto.
        const expected = addAmounts(
          expectedSplit(DAY_MIXED, 10000, everyone),
          expectedSplit(DAY_CASH, 6001, [f.beto.id, f.carla.id]),
        );
        const draft = (await preview(f).expect(201)).body as TipPoolResponse;
        expect(draft).toMatchObject({
          status: 'DRAFT',
          version: 1,
          rule: 'EQUAL_SHARES',
          totalAmount: 16001,
          totalHours: null,
          reconciled: true,
          sources: [],
        });
        expect(amountsByUser(draft)).toEqual(expected);
        expect(draft.lines.every((line) => line.hoursWorked === null)).toBe(
          true,
        );
        // El día en cero no reparte nada ni genera líneas para nadie.
        const fundedSources = draft.dailySources.filter(
          (source) => source.amount > 0,
        );
        expect(
          fundedSources.map((source) => [
            source.businessDate,
            source.cardTipAmount,
            source.cashTipAmount,
          ]),
        ).toEqual([
          [DAY_MIXED, 7000, 3000],
          [DAY_CASH, 0, 6001],
        ]);
        expect(
          draft.dailySources.reduce((sum, source) => sum + source.amount, 0),
        ).toBe(draft.totalAmount);
        expect(draft.lines.some((line) => line.userId === f.cora.id)).toBe(
          false,
        );

        // 6. En DRAFT el supervisor aún corrige el día en efectivo; el
        //    contador recalcula sobre el mismo reparto y sube la versión.
        await server()
          .patch(`/daily-operations/${cash.id}`)
          .set('Authorization', `Bearer ${token(f.supervisor)}`)
          .field('cashTipAmount', '6002')
          .expect(200);
        const recalculated = (await preview(f, 1).expect(200))
          .body as TipPoolResponse;
        expect(recalculated).toMatchObject({
          id: draft.id,
          version: 2,
          totalAmount: 16002,
          reconciled: true,
        });
        const finalExpected = addAmounts(
          expectedSplit(DAY_MIXED, 10000, everyone),
          expectedSplit(DAY_CASH, 6002, [f.beto.id, f.carla.id]),
        );
        expect(amountsByUser(recalculated)).toEqual(finalExpected);

        // 7. Confirmado, la operación fuente queda congelada.
        await poolAction(f, draft.id, 'confirm', 2).expect(200);
        await expectFrozen(f, cash.id, '7000');

        // 8. Pago: una constancia por trabajador con el monto de su línea.
        const paid = (await poolAction(f, draft.id, 'pay', 3).expect(200))
          .body as TipPoolResponse;
        expect(paid).toMatchObject({ status: 'PAID', version: 4 });
        expect(amountsByUser(paid)).toEqual(finalExpected);
        const receipts = (
          await server()
            .get(`/tip-pools/${draft.id}/receipts`)
            .set('Authorization', `Bearer ${token(f.accountant)}`)
            .expect(200)
        ).body as TipPoolReceiptResponse[];
        expect(
          Object.fromEntries(
            receipts.map((receipt) => [receipt.userId, receipt.amount]),
          ),
        ).toEqual(finalExpected);

        // 9. Cada trabajador ve en su portal solo su constancia y su monto.
        for (const worker of [f.ana, f.beto, f.carla]) {
          const own = (
            await server()
              .get('/my-tip-receipts')
              .set('Authorization', `Bearer ${token(worker)}`)
              .expect(200)
          ).body as OwnTipReceiptDto[];
          expect(own).toHaveLength(1);
          expect(own[0]).toMatchObject({
            userId: worker.id,
            amount: finalExpected[worker.id],
            periodStart: PERIOD.start,
            periodEnd: PERIOD.end,
            hoursWorked: null,
          });
        }

        // Pagado, tampoco se puede corregir la operación fuente.
        await expectFrozen(f, mixed.id, '1');

        // 10. Trazabilidad: tres altas (el reintento no se audita), una
        //     corrección y el ciclo completo del reparto.
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
        const poolAudits = await f.tx.auditLog.findMany({
          where: { entityType: 'tip_pools', entityId: draft.id },
          orderBy: { id: 'asc' },
          select: { action: true },
        });
        expect(poolAudits.map((audit) => audit.action)).toEqual([
          AUDIT_ACTION.TIP_POOL_CALCULATED,
          AUDIT_ACTION.TIP_POOL_RECALCULATED,
          AUDIT_ACTION.TIP_POOL_CONFIRMED,
          AUDIT_ACTION.TIP_POOL_PAID,
        ]);

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
