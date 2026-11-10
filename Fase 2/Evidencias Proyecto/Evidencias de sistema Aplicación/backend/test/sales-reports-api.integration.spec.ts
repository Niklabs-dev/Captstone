import {
  BadRequestException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  LEGACY_NOTICE,
  SalesReportsService,
} from '../src/sales-reports/sales-reports.service.js';
import type {
  LegacySalesReport,
  SalesReport,
  StoreReport,
} from '../src/sales-reports/types/sales-reports.types.js';
import { createDailyOperation } from './helpers/daily-operations.js';
import {
  businessDaysAgo,
  businessToday,
  createTestImport,
  createTestMethod,
  createTestStore,
  createTestUser,
  dbDate,
  supersedeTestImport,
  type TestMethod,
  type TestStore,
} from './helpers/sales-consolidation.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración HTTP de los reportes de ventas y diferencias por
// período y local (SPRINT-4R-T13) contra PostgreSQL real: ventas solo de la
// importación vigente, medios dinámicos del catálogo (incluidos inactivos con
// historial), propinas y diferencia de efectivo de la operación diaria como
// conceptos separados, diferencias con signo y motivo sin compensar, estado
// de importación de /sales-days, legado separado, validación de fechas y zona
// horaria, totales conciliados y permisos (solo ADMINISTRADOR). Las fechas son
// relativas al día de negocio actual. Todo corre dentro de withinRollback.
const databaseUrl = process.env.TEST_DATABASE_URL;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Methods {
  card: TestMethod;
  cash: TestMethod;
  old: TestMethod;
  goneCode: string;
}

interface Fixture {
  tx: Tx;
  storeA: TestStore;
  storeB: TestStore;
  methods: Methods;
  admin: AuthUser;
  supervisor: AuthUser;
  accountant: AuthUser;
  worker: AuthUser;
}

// Escenario base: identificadores de lo sembrado.
interface Scenario {
  supersededId: string;
  activeAId: string;
  pendingAId: string;
  activeBId: string;
  operationA2: string;
  operationA1: string;
  operationB1: string;
}

const D5 = (): string => businessDaysAgo(5);
const D4 = (): string => businessDaysAgo(4);
const D3 = (): string => businessDaysAgo(3);
const D2 = (): string => businessDaysAgo(2);
const D1 = (): string => businessDaysAgo(1);

function storeOf(report: SalesReport, storeId: string): StoreReport {
  const store = report.stores.find((item) => item.store.id === storeId);
  if (!store) throw new Error(`Local ${storeId} ausente del reporte`);
  return store;
}

function amountOf(
  items: { paymentMethod: string; amount: number }[],
  code: string,
): number | undefined {
  return items.find((item) => item.paymentMethod === code)?.amount;
}

describe.skipIf(!databaseUrl)(
  'API de reportes de ventas importadas y diferencias (SPRINT-4R-T13)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;
    let storageRoot: string;

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    function get(url: string, user: AuthUser | null): request.Test {
      const req = request(app.getHttpServer()).get(url);
      return user ? req.set('Authorization', `Bearer ${token(user)}`) : req;
    }

    async function report(
      f: Fixture,
      query: Record<string, string>,
    ): Promise<SalesReport> {
      const params = new URLSearchParams(query);
      const response = await get(
        `/sales-reports?${params.toString()}`,
        f.admin,
      ).expect(200);
      return response.body as SalesReport;
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      const storeA = await createTestStore(tx, 'A', 'Melipilla');
      const storeB = await createTestStore(tx, 'B', 'Calera');
      const card = await createTestMethod(tx, 'Tarjeta T13', 1);
      const cash = await createTestMethod(tx, 'Efectivo T13', 2, 'CASH');
      const old = await createTestMethod(tx, 'Vale T13', 3, 'EXTERNAL_OTHER');
      const gone = await tx.paymentMethod.create({
        data: {
          code: `T13_GONE_${storeA.id.slice(0, 8).toUpperCase()}`,
          name: 'Medio retirado T13',
          sortOrder: 4,
          behavior: 'EXTERNAL_OTHER',
          isActive: false,
        },
      });
      return {
        tx,
        storeA,
        storeB,
        methods: { card, cash, old, goneCode: gone.code },
        admin: await createTestUser(tx, ROLE.ADMINISTRADOR, null),
        supervisor: await createTestUser(tx, ROLE.SUPERVISOR, storeA.id),
        accountant: await createTestUser(tx, ROLE.CONTADOR, null),
        worker: await createTestUser(tx, ROLE.TRABAJADOR, storeA.id),
      };
    }

    // Local A con calendario (todos los días desde D5, cierre por excepción
    // en D4); local B sin calendario. Ventas importadas, versiones
    // reemplazadas y pendientes, operaciones diarias con diferencias de
    // distinto signo y un medio que se desactiva después de vender.
    async function seedScenario(f: Fixture): Promise<Scenario> {
      const { tx, storeA, storeB, methods, admin, supervisor } = f;
      await tx.storeOperatingSchedule.create({
        data: {
          storeId: storeA.id,
          opensMonday: true,
          opensTuesday: true,
          opensWednesday: true,
          opensThursday: true,
          opensFriday: true,
          opensSaturday: true,
          opensSunday: true,
          trackingStartDate: dbDate(D5()),
          updatedById: admin.id,
        },
      });
      await tx.storeClosure.create({
        data: {
          storeId: storeA.id,
          closureDate: dbDate(D4()),
          reason: 'Mantención programada',
          createdById: admin.id,
        },
      });

      const first = await createTestImport(tx, {
        store: storeA,
        businessDate: D2(),
        lines: [{ method: methods.card, amount: 999_999 }],
        status: 'ACTIVE',
        confirmedById: admin.id,
      });
      const supersededId = await supersedeTestImport(tx, first);
      const activeAId = await createTestImport(tx, {
        store: storeA,
        businessDate: D2(),
        lines: [
          { method: methods.card, amount: 300_000 },
          { method: methods.cash, amount: 150_000 },
          { method: methods.old, amount: 50_000 },
        ],
        status: 'ACTIVE',
        confirmedById: admin.id,
      });
      const pendingAId = await createTestImport(tx, {
        store: storeA,
        businessDate: D2(),
        lines: [{ method: methods.card, amount: 123 }],
        status: 'PENDING',
        confirmedById: admin.id,
      });
      const activeBId = await createTestImport(tx, {
        store: storeB,
        businessDate: D2(),
        lines: [{ method: methods.card, amount: 200_000 }],
        status: 'ACTIVE',
        confirmedById: admin.id,
      });
      // El medio «Vale» se desactiva después de tener ventas: sigue en el
      // reporte por su historial.
      await tx.paymentMethod.update({
        where: { id: methods.old.id },
        data: { isActive: false },
      });

      const operationA2 = await createDailyOperation(tx, {
        storeId: storeA.id,
        responsibleId: supervisor.id,
        businessDate: D2(),
        cardTipAmount: 12_000,
        cashTipAmount: 8_000,
        cashDifference: -2_500,
        differenceReason: 'Vuelto mal entregado',
      });
      const operationA1 = await createDailyOperation(tx, {
        storeId: storeA.id,
        responsibleId: supervisor.id,
        businessDate: D1(),
        cashTipAmount: 5_000,
        cashDifference: 1_500,
        differenceReason: 'Sobrante sin explicar',
      });
      const operationB1 = await createDailyOperation(tx, {
        storeId: storeB.id,
        responsibleId: supervisor.id,
        businessDate: D1(),
        cashDifference: 2_500,
        differenceReason: 'Propina digitada como venta',
      });
      return {
        supersededId,
        activeAId,
        pendingAId,
        activeBId,
        operationA2,
        operationA1,
        operationB1,
      };
    }

    // Histórico previo a SPRINT-4R-T01 en el local A el día D3: un cierre por
    // turno con conciliación de vouchers y una venta manual de la tabla sales.
    async function seedLegacy(f: Fixture): Promise<string> {
      const closing = await f.tx.cashClosing.create({
        data: {
          storeId: f.storeA.id,
          businessDate: dbDate(D3()),
          shift: 1,
          openingCash: 10_000,
          mrcomandaNetSales: 100_000,
          mercadoPagoGrossAmount: 110_000,
          mercadoPagoTipAmount: 5_000,
          reconciliationDifference: 5_000,
          responsibleId: f.supervisor.id,
          lines: {
            create: [
              {
                paymentMethodId: f.methods.cash.id,
                expectedAmount: 1_000,
                countedAmount: 900,
                difference: -100,
              },
            ],
          },
        },
        select: { id: true },
      });
      await f.tx.sale.create({
        data: {
          soldAt: new Date(`${D3()}T15:00:00.000Z`),
          grossAmount: 40_000,
          tipAmount: 0,
          source: 'MANUAL',
          storeId: f.storeA.id,
          paymentMethodId: f.methods.cash.id,
          registeredById: f.supervisor.id,
        },
      });
      return closing.id;
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
      storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-t13-'));
      process.env.DOCUMENTS_STORAGE_PATH = storageRoot;
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
      await fs.rm(storageRoot, { recursive: true, force: true });
    });

    it('filtra por local y rango: ventas solo de la versión vigente, por día y por medio', async () => {
      await withinRollback(async (f) => {
        const ids = await seedScenario(f);
        await seedLegacy(f);
        const result = await report(f, {
          from: D5(),
          to: businessToday(),
          storeId: f.storeA.id,
        });

        expect(result).toMatchObject({
          from: D5(),
          to: businessToday(),
          today: businessToday(),
          timeZone: 'America/Santiago',
          storeId: f.storeA.id,
        });
        expect(result.stores.map((store) => store.store.id)).toEqual([
          f.storeA.id,
        ]);
        const storeA = result.stores[0];
        // Solo la versión vigente: ni la reemplazada (999.999), ni la
        // pendiente (123), ni la venta manual histórica (40.000).
        expect(storeA.sales.importedDays).toBe(1);
        expect(storeA.sales.totalAmount).toBe(500_000);
        expect(
          amountOf(storeA.sales.byPaymentMethod, f.methods.card.code),
        ).toBe(300_000);
        expect(
          amountOf(storeA.sales.byPaymentMethod, f.methods.cash.code),
        ).toBe(150_000);
        expect(amountOf(storeA.sales.byPaymentMethod, f.methods.old.code)).toBe(
          50_000,
        );
        expect(
          storeA.sales.byPaymentMethod.reduce((s, m) => s + m.amount, 0),
        ).toBe(storeA.sales.totalAmount);

        const days = storeA.days.map((day) => [
          day.businessDate,
          day.importStatus.status,
        ]);
        expect(days).toEqual([
          [D5(), 'ATRASADO'],
          [D4(), 'CERRADO'],
          [D3(), 'ATRASADO'],
          [D2(), 'IMPORTADO'],
          [D1(), 'ATRASADO'],
          [businessToday(), 'PENDIENTE'],
        ]);
        const d2 = storeA.days.find((day) => day.businessDate === D2());
        expect(d2?.importStatus).toEqual({
          status: 'IMPORTADO',
          activeImportId: ids.activeAId,
          pendingImportId: ids.pendingAId,
          closure: null,
        });
        expect(d2?.sales).toMatchObject({
          importId: ids.activeAId,
          version: 2,
          totalAmount: 500_000,
        });
        const d4 = storeA.days.find((day) => day.businessDate === D4());
        expect(d4?.importStatus.closure?.reason).toBe('Mantención programada');
        expect(d4?.importStatus.closure?.id).toEqual(expect.any(String));
        // Ausencia de datos: sin Excel vigente las ventas son null, no 0.
        const d1 = storeA.days.find((day) => day.businessDate === D1());
        expect(d1?.sales).toBeNull();
        expect(d1?.dailyOperation?.operationId).toBe(ids.operationA1);
        // Sin propina de tarjeta no hay voucher (SPRINT-4A-T11).
        expect(d1?.dailyOperation?.hasVoucher).toBe(false);
        const d3 = storeA.days.find((day) => day.businessDate === D3());
        expect(d3).toMatchObject({ sales: null, dailyOperation: null });

        expect(storeA.importStatus).toEqual({
          IMPORTADO: 1,
          PENDIENTE: 1,
          ATRASADO: 3,
          CERRADO: 1,
        });
        const body = JSON.stringify(result);
        expect(body).not.toContain(ids.supersededId);
        expect(body).not.toContain('999999');
      });
    });

    it('devuelve medios con código y nombre del catálogo, incluidos inactivos con historial', async () => {
      await withinRollback(async (f) => {
        await seedScenario(f);
        // Otras suites en paralelo pueden confirmar cambios de estado de sus
        // medios propios mientras corre la consulta (READ COMMITTED): se
        // exigen los activos antes y después del reporte.
        const activeCodes = async (): Promise<Set<string>> =>
          new Set(
            (
              await f.tx.paymentMethod.findMany({
                where: { isActive: true },
                select: { code: true },
              })
            ).map((method) => method.code),
          );
        const before = await activeCodes();
        const result = await report(f, {
          from: D2(),
          to: D2(),
          storeId: f.storeA.id,
        });
        const after = await activeCodes();
        const codes = result.paymentMethods.map((m) => m.paymentMethod);
        expect(result.paymentMethods).toEqual(
          expect.arrayContaining([
            {
              paymentMethod: f.methods.card.code,
              paymentMethodName: 'Tarjeta T13',
              isActive: true,
            },
            {
              paymentMethod: f.methods.old.code,
              paymentMethodName: 'Vale T13',
              isActive: false,
            },
          ]),
        );
        // Inactivo sin historial en el período: no aparece.
        expect(codes).not.toContain(f.methods.goneCode);
        // Todos los activos del catálogo están presentes.
        const stable = [...before].filter((code) => after.has(code));
        expect(stable).toEqual(
          expect.arrayContaining([f.methods.card.code, f.methods.cash.code]),
        );
        expect(codes).toEqual(expect.arrayContaining(stable));
        // Columnas en el orden del catálogo y desglose con esas columnas.
        expect(
          storeOf(result, f.storeA.id).sales.byPaymentMethod.map(
            (m) => m.paymentMethod,
          ),
        ).toEqual(codes);

        // Fuera del período con historial, el medio inactivo desaparece.
        const later = await report(f, {
          from: D1(),
          to: D1(),
          storeId: f.storeA.id,
        });
        expect(later.paymentMethods.map((m) => m.paymentMethod)).not.toContain(
          f.methods.old.code,
        );
      });
    });

    it('todos los locales: propinas y diferencias separadas de las ventas, sin compensar', async () => {
      await withinRollback(async (f) => {
        const ids = await seedScenario(f);
        const inactiveEmpty = await createTestStore(
          f.tx,
          'C',
          'Melipilla',
          false,
        );
        const inactiveWithData = await createTestStore(
          f.tx,
          'D',
          'Calera',
          false,
        );
        await createDailyOperation(f.tx, {
          storeId: inactiveWithData.id,
          responsibleId: f.supervisor.id,
          businessDate: D2(),
        });
        const result = await report(f, { from: D2(), to: D1() });

        expect(result.storeId).toBeNull();
        const storeIds = result.stores.map((store) => store.store.id);
        expect(storeIds).toEqual(
          expect.arrayContaining([
            f.storeA.id,
            f.storeB.id,
            inactiveWithData.id,
          ]),
        );
        expect(storeIds).not.toContain(inactiveEmpty.id);

        const storeA = storeOf(result, f.storeA.id);
        // La propina no se suma a las ventas.
        expect(storeA.sales.totalAmount).toBe(500_000);
        expect(storeA.tips).toEqual({
          operationsCount: 2,
          cardTipAmount: 12_000,
          cashTipAmount: 13_000,
          tipFundAmount: 25_000,
        });
        // Sobrante y faltante del mismo local no se compensan.
        expect(storeA.cashDifferences).toEqual({
          count: 2,
          surplusCount: 1,
          shortageCount: 1,
          surplusAmount: 1_500,
          shortageAmount: -2_500,
        });
        const d2 = storeA.days.find((day) => day.businessDate === D2());
        expect(d2?.dailyOperation).toEqual({
          operationId: ids.operationA2,
          cardTipAmount: 12_000,
          cashTipAmount: 8_000,
          tipFundAmount: 20_000,
          cashDifference: {
            amount: -2_500,
            type: 'FALTANTE',
            reason: 'Vuelto mal entregado',
          },
          hasVoucher: true,
        });

        // Local B sin calendario: D2 importado, D1 sin estado informado pero
        // con su operación diaria; el sobrante de B (+2.500) no anula el
        // faltante de A (-2.500).
        const storeB = storeOf(result, f.storeB.id);
        expect(
          storeB.days.map((day) => [day.businessDate, day.importStatus.status]),
        ).toEqual([
          [D2(), 'IMPORTADO'],
          [D1(), null],
        ]);
        expect(storeB.days[0].dailyOperation).toBeNull();
        expect(storeB.sales.totalAmount).toBe(200_000);

        const lines = result.cashDifferences.filter((line) =>
          [f.storeA.id, f.storeB.id].includes(line.store.id),
        );
        expect(lines).toHaveLength(3);
        expect(lines[0]).toEqual({
          store: { id: f.storeA.id, name: f.storeA.name },
          businessDate: D2(),
          operationId: ids.operationA2,
          amount: -2_500,
          type: 'FALTANTE',
          reason: 'Vuelto mal entregado',
        });
        expect(lines.slice(1)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              operationId: ids.operationA1,
              amount: 1_500,
              type: 'SOBRANTE',
              reason: 'Sobrante sin explicar',
            }),
            expect.objectContaining({
              operationId: ids.operationB1,
              amount: 2_500,
              type: 'SOBRANTE',
              reason: 'Propina digitada como venta',
            }),
          ]),
        );
      });
    });

    it('los totales concilian con la suma de los locales y de los medios', async () => {
      await withinRollback(async (f) => {
        await seedScenario(f);
        const result = await report(f, { from: D5(), to: businessToday() });
        const sum = (pick: (store: StoreReport) => number): number =>
          result.stores.reduce((acc, store) => acc + pick(store), 0);
        const { totals } = result;

        expect(totals.sales.totalAmount).toBe(sum((s) => s.sales.totalAmount));
        expect(totals.sales.importedDays).toBe(
          sum((s) => s.sales.importedDays),
        );
        expect(
          totals.sales.byPaymentMethod.reduce((acc, m) => acc + m.amount, 0),
        ).toBe(totals.sales.totalAmount);
        for (const column of totals.sales.byPaymentMethod) {
          expect(column.amount).toBe(
            sum(
              (s) =>
                amountOf(s.sales.byPaymentMethod, column.paymentMethod) ?? 0,
            ),
          );
        }
        expect(totals.tips.tipFundAmount).toBe(
          sum((s) => s.tips.tipFundAmount),
        );
        expect(totals.tips.tipFundAmount).toBe(
          totals.tips.cardTipAmount + totals.tips.cashTipAmount,
        );
        expect(totals.cashDifferences.surplusAmount).toBe(
          sum((s) => s.cashDifferences.surplusAmount),
        );
        expect(totals.cashDifferences.shortageAmount).toBe(
          sum((s) => s.cashDifferences.shortageAmount),
        );
        expect(totals.cashDifferences.count).toBe(
          result.cashDifferences.length,
        );
        expect(totals.importStatus.ATRASADO).toBe(
          sum((s) => s.importStatus.ATRASADO),
        );
        // Cada día importado concilia su total con su desglose.
        for (const store of result.stores) {
          for (const day of store.days) {
            if (!day.sales) continue;
            expect(
              day.sales.byPaymentMethod.reduce((acc, m) => acc + m.amount, 0),
            ).toBe(day.sales.totalAmount);
          }
        }
      });
    });

    it('el contrato vigente no expone bruto Mercado Pago, neto conciliable ni descuadre de vouchers', async () => {
      await withinRollback(async (f) => {
        await seedScenario(f);
        await seedLegacy(f);
        const result = await report(f, {
          from: D3(),
          to: D3(),
          storeId: f.storeA.id,
        });
        const body = JSON.stringify(result);
        for (const key of [
          'mercadoPago',
          'voucherDifference',
          'mrcomandaNetSales',
          'reconciliation',
          'closings',
        ]) {
          expect(body).not.toContain(key);
        }
        // El histórico de D3 no se mezcla con el indicador vigente.
        expect(result.totals.sales.totalAmount).toBe(0);
        expect(storeOf(result, f.storeA.id).cashDifferences.count).toBe(0);
      });
    });

    it('consulta el histórico como legado, separado del reporte vigente', async () => {
      await withinRollback(async (f) => {
        await seedScenario(f);
        const closingId = await seedLegacy(f);
        const params = new URLSearchParams({
          from: D3(),
          to: D3(),
          storeId: f.storeA.id,
        });
        const response = await get(
          `/sales-reports/legacy?${params.toString()}`,
          f.admin,
        ).expect(200);
        const legacy = response.body as LegacySalesReport;

        expect(legacy).toMatchObject({
          from: D3(),
          to: D3(),
          timeZone: 'America/Santiago',
          storeId: f.storeA.id,
          notice: LEGACY_NOTICE,
        });
        expect(legacy.closings).toEqual([
          {
            closingId,
            store: { id: f.storeA.id, name: f.storeA.name },
            businessDate: D3(),
            shift: 1,
            status: 'OPEN',
            mrcomandaNetSales: 100_000,
            mercadoPagoGrossAmount: 110_000,
            mercadoPagoTipAmount: 5_000,
            voucherDifference: 5_000,
            cashDifference: -100,
            balanceStatus: 'NO_CUADRADO',
            lineDifferences: [
              {
                paymentMethod: f.methods.cash.code,
                paymentMethodName: 'Efectivo T13',
                expectedAmount: 1_000,
                countedAmount: 900,
                difference: -100,
              },
            ],
            differenceReason: null,
            closedAt: null,
          },
        ]);
        expect(legacy.sales).toEqual([
          {
            store: { id: f.storeA.id, name: f.storeA.name },
            paymentMethod: f.methods.cash.code,
            paymentMethodName: 'Efectivo T13',
            source: 'MANUAL',
            salesCount: 1,
            netAmount: 40_000,
          },
        ]);
        // El legado no incluye ventas importadas ni operaciones diarias.
        const body = JSON.stringify(legacy);
        expect(body).not.toContain('tipFundAmount');
        expect(body).not.toContain('importId');

        const other = await get(
          `/sales-reports/legacy?from=${D2()}&to=${D1()}&storeId=${f.storeA.id}`,
          f.admin,
        ).expect(200);
        expect(other.body).toMatchObject({ closings: [], sales: [] });
      });
    });

    it('el legado marca NO_CUADRADO un cierre con líneas que se compensan', async () => {
      await withinRollback(async (f) => {
        // Turno 1: -500 en efectivo y +500 en tarjeta (la suma neta es 0).
        // Turno 2: todo cuadra.
        const line = (
          paymentMethodId: string,
          expectedAmount: number,
          countedAmount: number,
        ): {
          paymentMethodId: string;
          expectedAmount: number;
          countedAmount: number;
          difference: number;
        } => ({
          paymentMethodId,
          expectedAmount,
          countedAmount,
          difference: countedAmount - expectedAmount,
        });
        const closing = (
          shift: number,
          lines: ReturnType<typeof line>[],
        ): Promise<{ id: string }> =>
          f.tx.cashClosing.create({
            data: {
              storeId: f.storeA.id,
              businessDate: dbDate(D3()),
              shift,
              openingCash: 10_000,
              mrcomandaNetSales: 100_000,
              mercadoPagoGrossAmount: 105_000,
              mercadoPagoTipAmount: 5_000,
              reconciliationDifference: 0,
              responsibleId: f.supervisor.id,
              lines: { create: lines },
            },
            select: { id: true },
          });
        const offset = await closing(1, [
          line(f.methods.cash.id, 20_000, 19_500),
          line(f.methods.card.id, 80_000, 80_500),
        ]);
        const balanced = await closing(2, [
          line(f.methods.cash.id, 20_000, 20_000),
        ]);

        const response = await get(
          `/sales-reports/legacy?from=${D3()}&to=${D3()}&storeId=${f.storeA.id}`,
          f.admin,
        ).expect(200);
        const legacy = response.body as LegacySalesReport;
        const byId = new Map(
          legacy.closings.map((item) => [item.closingId, item]),
        );

        // La suma neta no oculta el descuadre: el estado y las líneas lo
        // muestran, ordenadas según el catálogo (tarjeta antes que efectivo).
        expect(byId.get(offset.id)).toMatchObject({
          cashDifference: 0,
          voucherDifference: 0,
          balanceStatus: 'NO_CUADRADO',
          lineDifferences: [
            {
              paymentMethod: f.methods.card.code,
              paymentMethodName: 'Tarjeta T13',
              expectedAmount: 80_000,
              countedAmount: 80_500,
              difference: 500,
            },
            {
              paymentMethod: f.methods.cash.code,
              paymentMethodName: 'Efectivo T13',
              expectedAmount: 20_000,
              countedAmount: 19_500,
              difference: -500,
            },
          ],
        });
        expect(byId.get(balanced.id)).toMatchObject({
          cashDifference: 0,
          balanceStatus: 'CUADRADO',
          lineDifferences: [],
        });
      });
    });

    it('usa días de negocio en hora de Chile y rechaza el futuro según Chile', async () => {
      await withinRollback(async (f) => {
        const service = app.get(SalesReportsService);
        // 01:30 UTC del 11 de marzo = 22:30 del 10 de marzo en Chile (UTC-3).
        const now = new Date('2026-03-11T01:30:00.000Z');
        // Venta del 10 de marzo cuyo período empieza a las 23:00 de Chile
        // (ya es 11 de marzo en UTC): pertenece al día de negocio 10.
        await createTestImport(f.tx, {
          store: f.storeA,
          businessDate: '2026-03-10',
          lines: [{ method: f.methods.card, amount: 7_000 }],
          status: 'ACTIVE',
          confirmedById: f.admin.id,
          startsAt: new Date('2026-03-10T23:00:00-03:00'),
        });

        const sameDay = await service.report(
          { from: '2026-03-10', to: '2026-03-10', storeId: f.storeA.id },
          now,
        );
        expect(sameDay.today).toBe('2026-03-10');
        expect(storeOf(sameDay, f.storeA.id).sales.totalAmount).toBe(7_000);
        await expect(
          service.report(
            { from: '2026-03-10', to: '2026-03-11', storeId: f.storeA.id },
            now,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);

        const later = new Date('2026-03-12T12:00:00.000Z');
        const nextDay = await service.report(
          { from: '2026-03-11', to: '2026-03-11', storeId: f.storeA.id },
          later,
        );
        expect(storeOf(nextDay, f.storeA.id).sales.totalAmount).toBe(0);
        expect(storeOf(nextDay, f.storeA.id).days).toEqual([]);
      });
    });

    it('valida fechas, rango y local', async () => {
      await withinRollback(async (f) => {
        const base = `/sales-reports`;
        const tomorrow = businessDaysAgo(-1);
        for (const url of [
          base,
          `${base}?from=${D2()}`,
          `${base}?to=${D2()}`,
          `${base}?from=2026-02-30&to=2026-03-01`,
          `${base}?from=01-03-2026&to=2026-03-02`,
          `${base}?from=${D1()}&to=${D2()}`,
          `${base}?from=${D1()}&to=${tomorrow}`,
          `${base}?from=${businessDaysAgo(366)}&to=${businessToday()}`,
          `${base}?from=${D2()}&to=${D1()}&storeId=no-es-uuid`,
          `${base}?from=${D2()}&to=${D1()}&desconocido=1`,
          `${base}/legacy?from=${D1()}&to=${D2()}`,
        ]) {
          await get(url, f.admin).expect(400);
        }
        // 366 días exactos es el máximo permitido.
        await get(
          `${base}?from=${businessDaysAgo(365)}&to=${businessToday()}&storeId=${f.storeA.id}`,
          f.admin,
        ).expect(200);
        await get(
          `${base}?from=${D2()}&to=${D1()}&storeId=${MISSING_ID}`,
          f.admin,
        ).expect(404);
        await get(
          `${base}/legacy?from=${D2()}&to=${D1()}&storeId=${MISSING_ID}`,
          f.admin,
        ).expect(404);
      });
    });

    it('sin datos en el período responde vacío con ventas en cero y estados informados', async () => {
      await withinRollback(async (f) => {
        const result = await report(f, {
          from: D2(),
          to: D1(),
          storeId: f.storeB.id,
        });
        expect(result.stores).toHaveLength(1);
        expect(result.stores[0]).toMatchObject({
          sales: { importedDays: 0, totalAmount: 0 },
          tips: { operationsCount: 0, tipFundAmount: 0 },
          cashDifferences: { count: 0 },
          days: [],
        });
        expect(result.cashDifferences).toEqual([]);
      });
    });

    it('solo el administrador consulta los reportes y el legado', async () => {
      await withinRollback(async (f) => {
        for (const path of ['/sales-reports', '/sales-reports/legacy']) {
          const url = `${path}?from=${D2()}&to=${D1()}`;
          await get(url, null).expect(401);
          await get(url, f.supervisor).expect(403);
          await get(url, f.accountant).expect(403);
          await get(url, f.worker).expect(403);
          await get(url, f.admin).expect(200);
        }
      });
    });
  },
);
