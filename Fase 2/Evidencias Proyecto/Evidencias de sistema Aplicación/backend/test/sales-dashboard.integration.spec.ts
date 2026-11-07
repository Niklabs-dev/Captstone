import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../src/documents/utils/document-dates.util.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type {
  SalesDashboard,
  StoreDashboard,
} from '../src/sales-dashboard/types/sales-dashboard.types.js';
import {
  ensureDefaultPaymentMethods,
  ensurePaymentMethod,
  paymentMethodIdOf,
} from './helpers/payment-methods.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración de la consulta consolidada de ventas, alertas y
// diferencias por local (SPRINT-4-T13, medios de pago dinámicos de
// SPRINT-4-T32) por HTTP contra PostgreSQL real. Todo corre dentro de
// withinRollback: no deja datos residuales.

// Marzo de 2026: Chile continental está en UTC-3 (horario de verano).
const BUSINESS_DATE = '2026-03-10';
const START = '2026-03-10T08:00:00-03:00';
const END = '2026-03-10T16:00:00-03:00';
const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  closedStoreId: string;
  openStoreId: string;
  emptyStoreId: string;
  supervisor: AuthUser;
  admin: AuthUser;
  accountant: AuthUser;
  worker: AuthUser;
}

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function createUser(
  tx: Tx,
  role: RoleCode,
  storeId: string | null,
): Promise<AuthUser> {
  const roleRecord = await tx.role.upsert({
    where: { code: role },
    update: {},
    create: { code: role, name: role },
  });
  const id = randomUUID();
  const email = `${id}@sales-dashboard-test.invalid`;
  await tx.user.create({
    data: {
      id,
      email,
      passwordHash: '$2b$04$hash-de-prueba',
      firstName: role,
      lastName: 'Consolidado',
      roleId: roleRecord.id,
      storeId,
    },
  });
  return { id, email, role, storeId };
}

// Línea de cierre para la creación directa en transacción: los montos
// esperados replican lo que calculaba la API del flujo histórico (venta neta
// del medio dentro del corte, más el fondo de caja en la primera línea
// CASH), así el escenario queda idéntico al caso de aceptación de
// SPRINT-4-T09.
interface ClosingLineSpec {
  code: string;
  expected: number;
  counted: number;
}

interface ClosingVoucherSpec {
  source: 'MRCOMANDA' | 'MERCADO_PAGO';
  periodStart: string;
  periodEnd: string;
  amount: number;
  tipIncludedAmount?: number;
  methodCode?: string;
}

interface ClosingSpec {
  storeId: string;
  supervisorId: string;
  businessDate: string;
  shift: number;
  openingCash: number;
  lines: ClosingLineSpec[];
  vouchers: ClosingVoucherSpec[];
  mrcomandaNetSales: number;
  mercadoPagoGrossAmount: number;
  mercadoPagoTipAmount: number;
  tipEntryId?: string;
  saleIds: string[];
  differenceReason?: string;
}

// Crea en la transacción el mismo grafo que registraba la API histórica:
// cierre OPEN con líneas, vouchers, vínculo a propinas y ventas asociadas, y
// cierre del ciclo (CLOSED con responsable y fecha). El POST /cash-closings
// se retiró en SPRINT-4R-T01; los dashboards leen el histórico conservado.
async function createClosedClosing(tx: Tx, spec: ClosingSpec): Promise<string> {
  const closing = await tx.cashClosing.create({
    data: {
      storeId: spec.storeId,
      businessDate: new Date(`${spec.businessDate}T00:00:00.000Z`),
      shift: spec.shift,
      openingCash: spec.openingCash,
      status: 'OPEN',
      responsibleId: spec.supervisorId,
      mrcomandaNetSales: spec.mrcomandaNetSales,
      mercadoPagoGrossAmount: spec.mercadoPagoGrossAmount,
      mercadoPagoTipAmount: spec.mercadoPagoTipAmount,
      reconciliationDifference:
        spec.mercadoPagoGrossAmount -
        spec.mercadoPagoTipAmount -
        spec.mrcomandaNetSales,
      differenceReason: spec.differenceReason ?? null,
    },
  });
  for (const line of spec.lines) {
    const paymentMethod = await paymentMethodIdOf(tx, line.code);
    await tx.cashClosingLine.create({
      data: {
        closingId: closing.id,
        paymentMethodId: paymentMethod,
        expectedAmount: line.expected,
        countedAmount: line.counted,
        difference: line.counted - line.expected,
      },
    });
  }
  for (const voucher of spec.vouchers) {
    const paymentMethodId = voucher.methodCode
      ? await paymentMethodIdOf(tx, voucher.methodCode)
      : null;
    await tx.cashClosingVoucher.create({
      data: {
        closingId: closing.id,
        source: voucher.source,
        periodStart: new Date(voucher.periodStart),
        periodEnd: new Date(voucher.periodEnd),
        amount: voucher.amount,
        tipIncludedAmount: voucher.tipIncludedAmount ?? 0,
        paymentMethodId,
      },
    });
  }
  if (spec.tipEntryId) {
    await tx.cashClosingTipEntry.create({
      data: { closingId: closing.id, tipEntryId: spec.tipEntryId },
    });
  }
  if (spec.saleIds.length > 0) {
    await tx.sale.updateMany({
      where: { id: { in: spec.saleIds }, cashClosingId: null },
      data: { cashClosingId: closing.id },
    });
  }
  await tx.cashClosing.update({
    where: { id: closing.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date('2026-03-10T16:05:00-03:00'),
      closedById: spec.supervisorId,
    },
  });
  return closing.id;
}

function storeOf(body: SalesDashboard, storeId: string): StoreDashboard {
  const store = body.stores.find((item) => item.store.id === storeId);
  if (!store) throw new Error(`El local ${storeId} no está en la respuesta`);
  return store;
}

describe.skipIf(!databaseUrl)(
  'Consulta consolidada de ventas por local (SPRINT-4-T13 + SPRINT-4-T32)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    function get(query: string, user: AuthUser | null) {
      const req = request(app.getHttpServer()).get(`/sales-dashboard${query}`);
      if (user) req.set('Authorization', `Bearer ${token(user)}`);
      return req;
    }

    async function createStore(tx: Tx, label: string): Promise<string> {
      const store = await tx.store.create({
        data: {
          name: `Subway Consolidado ${label} ${randomUUID()}`,
          city: label === 'Calera' ? 'Calera' : 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      return store.id;
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      const closedStoreId = await createStore(tx, 'Centro');
      const openStoreId = await createStore(tx, 'Serrano');
      const emptyStoreId = await createStore(tx, 'Calera');
      return {
        tx,
        closedStoreId,
        openStoreId,
        emptyStoreId,
        supervisor: await createUser(tx, ROLE.SUPERVISOR, closedStoreId),
        admin: await createUser(tx, ROLE.ADMINISTRADOR, null),
        accountant: await createUser(tx, ROLE.CONTADOR, null),
        worker: await createUser(tx, ROLE.TRABAJADOR, openStoreId),
      };
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

    async function seedSale(
      f: Fixture,
      storeId: string,
      soldAt: string,
      paymentMethodCode: string,
      grossAmount: number,
      tipAmount = 0,
    ): Promise<string> {
      const paymentMethodId = await paymentMethodIdOf(f.tx, paymentMethodCode);
      const sale = await f.tx.sale.create({
        data: {
          soldAt: new Date(soldAt),
          paymentMethodId,
          grossAmount,
          tipAmount,
          storeId,
          registeredById: f.supervisor.id,
        },
      });
      return sale.id;
    }

    // Documento laboral pendiente de registrar en la DT con el plazo dado.
    async function seedDtDocument(
      f: Fixture,
      storeId: string,
      dueAt: string,
    ): Promise<void> {
      const type = await f.tx.documentType.upsert({
        where: { code: 'CONTRATO' },
        update: {},
        create: {
          code: 'CONTRATO',
          name: 'Contrato de trabajo',
          requiresDtRegistration: true,
          retentionYears: 5,
        },
      });
      const document = await f.tx.document.create({
        data: {
          title: `Contrato ${randomUUID()}`,
          retainUntil: day('2031-03-10'),
          dtRegistrationDueAt: day(dueAt),
          storeId,
          subjectUserId: f.worker.id,
          documentTypeId: type.id,
          createdById: f.admin.id,
        },
      });
      const version = await f.tx.documentVersion.create({
        data: {
          versionNumber: 1,
          fileName: 'contrato.pdf',
          filePath: `test/${document.id}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 10,
          sha256Hash: createHash('sha256').update(document.id).digest('hex'),
          documentId: document.id,
          uploadedById: f.admin.id,
        },
      });
      await f.tx.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
      });
    }

    // Local con cierre: 4 ventas dentro del corte (iguales a SPRINT-4-T09),
    // una venta posterior al corte y una a las 23:30 de Chile (ya es el día
    // siguiente en UTC), todas del mismo día de negocio. La venta de las 00:30
    // del día siguiente queda fuera. El cierre se crea directo en la
    // transacción: el POST se retiró en SPRINT-4R-T01 y el escenario replica
    // sus mismos totales (esperado = venta neta + fondo en la línea CASH).
    async function seedClosedStore(f: Fixture): Promise<void> {
      const store = f.closedStoreId;
      const noon = '2026-03-10T12:00:00-03:00';
      const inCutIds = [
        await seedSale(f, store, noon, 'CASH', 100000),
        await seedSale(f, store, noon, 'DEBIT_CARD', 521730, 10000),
        await seedSale(f, store, noon, 'CREDIT_CARD', 53800, 10000),
        await seedSale(f, store, noon, 'TRANSFER', 20000),
      ];
      await seedSale(f, store, '2026-03-10T18:00:00-03:00', 'CASH', 30000);
      await seedSale(
        f,
        store,
        '2026-03-10T23:30:00-03:00',
        'DEBIT_CARD',
        5500,
        500,
      );
      await seedSale(f, store, '2026-03-11T00:30:00-03:00', 'CASH', 777777);
      await seedSale(f, store, '2026-03-09T23:59:00-03:00', 'CASH', 666666);
      const debitId = await paymentMethodIdOf(f.tx, 'DEBIT_CARD');
      const tipEntry = await f.tx.tipEntry.create({
        data: {
          businessDate: day(BUSINESS_DATE),
          paymentMethodId: debitId,
          amount: 31602,
          storeId: store,
          responsibleId: f.supervisor.id,
        },
      });
      await createClosedClosing(f.tx, {
        storeId: store,
        supervisorId: f.supervisor.id,
        businessDate: BUSINESS_DATE,
        shift: 1,
        openingCash: 50000,
        lines: [
          { code: 'CASH', expected: 150000, counted: 149000 },
          { code: 'DEBIT_CARD', expected: 511730, counted: 511730 },
          { code: 'CREDIT_CARD', expected: 43800, counted: 43800 },
          { code: 'TRANSFER', expected: 20000, counted: 20000 },
        ],
        vouchers: [
          {
            source: 'MRCOMANDA',
            periodStart: START,
            periodEnd: END,
            amount: 555530,
            methodCode: 'DEBIT_CARD',
          },
          {
            source: 'MERCADO_PAGO',
            periodStart: START,
            periodEnd: END,
            amount: 588732,
            tipIncludedAmount: 31602,
          },
        ],
        mrcomandaNetSales: 555530,
        mercadoPagoGrossAmount: 588732,
        mercadoPagoTipAmount: 31602,
        tipEntryId: tipEntry.id,
        saleIds: inCutIds,
        differenceReason: 'Faltante de efectivo y descuadre de conciliación',
      });
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
      await ensureDefaultPaymentMethods(prisma);
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
    });

    it('consolida ventas netas, propinas, cierres y diferencias por local', async () => {
      await withinRollback(async (f) => {
        await seedClosedStore(f);
        await seedSale(
          f,
          f.openStoreId,
          '2026-03-10T10:00:00-03:00',
          'TRANSFER',
          20000,
        );

        const response = await get(`?date=${BUSINESS_DATE}`, f.admin).expect(
          200,
        );
        const body = response.body as SalesDashboard;

        expect(body).toMatchObject({
          businessDate: BUSINESS_DATE,
          timeZone: 'America/Santiago',
          periodStart: '2026-03-10T03:00:00.000Z',
          periodEnd: '2026-03-11T03:00:00.000Z',
        });

        const closed = storeOf(body, f.closedStoreId);
        // 675.530 conciliados + 30.000 + 5.000 netos sin cierre; nunca la
        // propina ni las ventas de otros días.
        expect(closed.sales).toMatchObject({
          salesCount: 6,
          netAmount: 710530,
          closedSalesCount: 4,
          closedNetAmount: 675530,
          unclosedSalesCount: 2,
          unclosedNetAmount: 35000,
        });
        // Desglose dinámico con código y nombre desde el catálogo. Otros
        // archivos de test pueden crear medios activos en la misma base;
        // aquí importan los cuatro medios del caso.
        expect(closed.sales.byPaymentMethod).toEqual(
          expect.arrayContaining([
            {
              paymentMethod: 'CASH',
              paymentMethodName: 'Efectivo',
              salesCount: 2,
              netAmount: 130000,
            },
            {
              paymentMethod: 'DEBIT_CARD',
              paymentMethodName: 'Tarjeta de débito',
              salesCount: 2,
              netAmount: 516730,
            },
            {
              paymentMethod: 'CREDIT_CARD',
              paymentMethodName: 'Tarjeta de crédito',
              salesCount: 1,
              netAmount: 43800,
            },
            {
              paymentMethod: 'TRANSFER',
              paymentMethodName: 'Transferencia',
              salesCount: 1,
              netAmount: 20000,
            },
          ]),
        );
        expect(closed.cardTips).toEqual({
          registeredAmount: 31602,
          closingsAmount: 31602,
        });
        // Otros tests pueden crear medios CASH activos: el fondo de caja se
        // suma a lo esperado de cada uno. El excedente se deriva de las líneas
        // guardadas del cierre (no de un conteo del catálogo en vivo, que
        // puede cambiar entre crear el cierre y afirmar).
        const closingRow = await f.tx.cashClosing.findFirstOrThrow({
          where: {
            storeId: f.closedStoreId,
            businessDate: day(BUSINESS_DATE),
            shift: 1,
          },
          select: { id: true },
        });
        const lineTotals = await f.tx.cashClosingLine.aggregate({
          where: { closingId: closingRow.id },
          _sum: { expectedAmount: true, countedAmount: true },
        });
        const expectedSum = Number(lineTotals._sum.expectedAmount ?? 0);
        const countedSum = Number(lineTotals._sum.countedAmount ?? 0);
        const expectedExtra = expectedSum - 725530;
        expect(closed.closings).toEqual({
          count: 1,
          shifts: [1],
          netSalesAmount: expectedSum - 50000,
          countedAmount: 724530 + expectedExtra,
          cashDifference: -1000,
          voucherDifference: 1600,
          mrcomandaNetSales: 555530,
          mercadoPagoNetSales: 557130,
        });
        expect(countedSum - 724530).toBe(expectedExtra);
        // Lo conciliado por el cierre coincide con las ventas vinculadas; el
        // fondo se contabiliza una sola vez (primera línea CASH), así que los
        // medios CASH ajenos sin ventas no agregan ni esperado ni contado.
        expect(closed.closings.netSalesAmount).toBe(
          closed.sales.closedNetAmount + expectedExtra,
        );
        expect(closed.pendingDifferences).toHaveLength(1);
        expect(closed.pendingDifferences[0]).toMatchObject({
          shift: 1,
          status: 'CLOSED',
          cashDifference: -1000,
          voucherDifference: 1600,
          hasDifferences: true,
          isBalanced: false,
          balanceStatus: 'NO_CUADRADO',
          differenceReason: 'Faltante de efectivo y descuadre de conciliación',
        });
        expect(closed.pendingDifferences[0].lineDifferences).toEqual([
          {
            paymentMethod: 'CASH',
            paymentMethodName: 'Efectivo',
            expectedAmount: 150000,
            countedAmount: 149000,
            difference: -1000,
          },
        ]);
        // El registro con débito sin reparto pagado genera una alerta legal.
        expect(closed.alerts.tipPayment.overdue).toBe(1);

        const open = storeOf(body, f.openStoreId);
        expect(open.sales).toMatchObject({
          salesCount: 1,
          netAmount: 20000,
          unclosedNetAmount: 20000,
        });
        expect(open.closings.count).toBe(0);
        expect(open.pendingDifferences).toEqual([]);

        const empty = storeOf(body, f.emptyStoreId);
        expect(empty.sales.netAmount).toBe(0);
        expect(empty.cardTips).toEqual({
          registeredAmount: 0,
          closingsAmount: 0,
        });
        expect(empty.closings.count).toBe(0);
      });
    });

    it('incluye medios históricos con movimientos y omite los inactivos sin ventas', async () => {
      await withinRollback(async (f) => {
        // Junaeb activo (no admite propinas, pero sí ventas) y un medio
        // histórico desactivado; ambos con ventas del día.
        const junaeb = await ensurePaymentMethod(f.tx, {
          code: `TIPSTEST_JUNAEB_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
          name: 'Junaeb',
          behavior: 'EXTERNAL_OTHER',
          isActive: true,
          availableForTips: false,
        });
        const legacy = await ensurePaymentMethod(f.tx, {
          code: `TIPSTEST_HIST_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
          name: 'Medio histórico',
          behavior: 'EXTERNAL_OTHER',
          isActive: false,
          availableForTips: true,
        });
        const inactiveQuiet = await ensurePaymentMethod(f.tx, {
          code: `TIPSTEST_QUIET_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
          name: 'Medio inactivo sin ventas',
          behavior: 'EXTERNAL_OTHER',
          isActive: false,
          availableForTips: true,
        });
        await f.tx.sale.create({
          data: {
            soldAt: new Date('2026-03-10T12:00:00-03:00'),
            paymentMethodId: junaeb.id,
            grossAmount: 12345,
            storeId: f.openStoreId,
            registeredById: f.supervisor.id,
          },
        });
        await f.tx.sale.create({
          data: {
            soldAt: new Date('2026-03-10T12:00:00-03:00'),
            paymentMethodId: legacy.id,
            grossAmount: 777,
            storeId: f.openStoreId,
            registeredById: f.supervisor.id,
          },
        });

        const response = await get(`?date=${BUSINESS_DATE}`, f.admin).expect(
          200,
        );
        const body = response.body as SalesDashboard;

        const open = storeOf(body, f.openStoreId);
        const codes = open.sales.byPaymentMethod.map(
          (method) => method.paymentMethod,
        );
        expect(codes).toContain(junaeb.code);
        expect(codes).toContain(legacy.code);
        expect(codes).not.toContain(inactiveQuiet.code);
        const junaebRow = open.sales.byPaymentMethod.find(
          (method) => method.paymentMethod === junaeb.code,
        );
        expect(junaebRow).toEqual({
          paymentMethod: junaeb.code,
          paymentMethodName: 'Junaeb',
          salesCount: 1,
          netAmount: 12345,
        });
        const legacyRow = open.sales.byPaymentMethod.find(
          (method) => method.paymentMethod === legacy.code,
        );
        expect(legacyRow).toMatchObject({
          paymentMethodName: 'Medio histórico',
          netAmount: 777,
        });
        // En el local sin ventas: Junaeb ACTIVO sí aparece (los activos se
        // incluyen siempre) y el inactivo sin movimientos sigue ausente.
        const empty = storeOf(body, f.emptyStoreId);
        const emptyCodes = empty.sales.byPaymentMethod.map(
          (method) => method.paymentMethod,
        );
        expect(emptyCodes).toContain(junaeb.code);
        expect(emptyCodes).not.toContain(legacy.code);
        expect(emptyCodes).not.toContain(inactiveQuiet.code);
      });
    });

    it('marca NO_CUADRADO un cierre compensado aunque la diferencia total sea 0', async () => {
      await withinRollback(async (f) => {
        // Dos ventas de 100.000: efectivo contado 99.500 (-500) y débito
        // contado 100.500 (+500). El total compensa a 0, pero cada línea
        // está descuadrada y el cierre queda NO_CUADRADO.
        const openSupervisor = await createUser(
          f.tx,
          ROLE.SUPERVISOR,
          f.openStoreId,
        );
        const noon = '2026-03-10T12:00:00-03:00';
        const saleIds = [
          await seedSale(f, f.openStoreId, noon, 'CASH', 100000),
          await seedSale(f, f.openStoreId, noon, 'DEBIT_CARD', 100000),
        ];
        const debitId = await paymentMethodIdOf(f.tx, 'DEBIT_CARD');
        const tipEntry = await f.tx.tipEntry.create({
          data: {
            businessDate: day(BUSINESS_DATE),
            paymentMethodId: debitId,
            amount: 0,
            storeId: f.openStoreId,
            responsibleId: openSupervisor.id,
          },
        });
        await createClosedClosing(f.tx, {
          storeId: f.openStoreId,
          supervisorId: openSupervisor.id,
          businessDate: BUSINESS_DATE,
          shift: 1,
          openingCash: 0,
          lines: [
            { code: 'CASH', expected: 100000, counted: 99500 },
            { code: 'DEBIT_CARD', expected: 100000, counted: 100500 },
          ],
          vouchers: [
            {
              source: 'MRCOMANDA',
              periodStart: START,
              periodEnd: END,
              amount: 100000,
              methodCode: 'DEBIT_CARD',
            },
            {
              source: 'MERCADO_PAGO',
              periodStart: START,
              periodEnd: END,
              amount: 100000,
            },
          ],
          mrcomandaNetSales: 100000,
          mercadoPagoGrossAmount: 100000,
          mercadoPagoTipAmount: 0,
          tipEntryId: tipEntry.id,
          saleIds,
          differenceReason: 'Compensación efectivo/débito',
        });

        const response = await get(`?date=${BUSINESS_DATE}`, f.admin).expect(
          200,
        );
        const open = storeOf(response.body as SalesDashboard, f.openStoreId);

        expect(open.closings.cashDifference).toBe(0);
        expect(open.pendingDifferences).toHaveLength(1);
        expect(open.pendingDifferences[0]).toMatchObject({
          cashDifference: 0,
          voucherDifference: 0,
          hasDifferences: true,
          isBalanced: false,
          balanceStatus: 'NO_CUADRADO',
        });
        expect(open.pendingDifferences[0].lineDifferences).toEqual([
          {
            paymentMethod: 'CASH',
            paymentMethodName: 'Efectivo',
            expectedAmount: 100000,
            countedAmount: 99500,
            difference: -500,
          },
          {
            paymentMethod: 'DEBIT_CARD',
            paymentMethodName: 'Tarjeta de débito',
            expectedAmount: 100000,
            countedAmount: 100500,
            difference: 500,
          },
        ]);
      });
    });

    it('cuenta las alertas DT vencidas y por vencer de cada local', async () => {
      await withinRollback(async (f) => {
        const today = businessDateOf(new Date());
        const past = formatDbDate(toDbDate({ ...today, year: today.year - 1 }));
        const future = formatDbDate(
          toDbDate({ ...today, year: today.year + 1 }),
        );
        await seedDtDocument(f, f.openStoreId, past);
        await seedDtDocument(f, f.openStoreId, future);
        await seedDtDocument(f, f.emptyStoreId, future);

        const response = await get(`?date=${BUSINESS_DATE}`, f.admin).expect(
          200,
        );
        const body = response.body as SalesDashboard;

        expect(storeOf(body, f.openStoreId).alerts.dtRegistration).toEqual({
          overdue: 1,
          upcoming: 1,
        });
        expect(storeOf(body, f.emptyStoreId).alerts.dtRegistration).toEqual({
          overdue: 0,
          upcoming: 1,
        });
        expect(storeOf(body, f.closedStoreId).alerts.dtRegistration).toEqual({
          overdue: 0,
          upcoming: 0,
        });
      });
    });

    it('los totales son la suma de los locales', async () => {
      await withinRollback(async (f) => {
        await seedClosedStore(f);
        const response = await get(`?date=${BUSINESS_DATE}`, f.admin).expect(
          200,
        );
        const body = response.body as SalesDashboard;
        const total = (pick: (store: StoreDashboard) => number): number =>
          body.stores.reduce((acc, store) => acc + pick(store), 0);

        expect(body.totals.netAmount).toBe(total((s) => s.sales.netAmount));
        expect(body.totals.closedNetAmount).toBe(
          total((s) => s.sales.closedNetAmount),
        );
        expect(body.totals.cashDifference).toBe(
          total((s) => s.closings.cashDifference),
        );
        expect(body.totals.voucherDifference).toBe(
          total((s) => s.closings.voucherDifference),
        );
        expect(body.totals.cardTipsRegisteredAmount).toBe(
          total((s) => s.cardTips.registeredAmount),
        );
        expect(body.totals.pendingDifferencesCount).toBe(
          total((s) => s.pendingDifferences.length),
        );
        expect(body.totals.tipPaymentAlerts.overdue).toBe(
          total((s) => s.alerts.tipPayment.overdue),
        );
      });
    });

    it('sin fecha consulta el día actual en hora de Chile', async () => {
      await withinRollback(async (f) => {
        const response = await get('', f.admin).expect(200);
        const body = response.body as SalesDashboard;

        expect(body.businessDate).toBe(
          formatDbDate(toDbDate(businessDateOf(new Date()))),
        );
      });
    });

    it('rechaza fechas inválidas y parámetros desconocidos', async () => {
      await withinRollback(async (f) => {
        await get('?date=2026-02-30', f.admin).expect(400);
        await get('?date=10-03-2026', f.admin).expect(400);
        await get(`?date=${BUSINESS_DATE}&storeId=x`, f.admin).expect(400);
      });
    });

    it('solo el administrador puede consultar el consolidado', async () => {
      await withinRollback(async (f) => {
        await get('', null).expect(401);
        await get('', f.supervisor).expect(403);
        await get('', f.accountant).expect(403);
        await get('', f.worker).expect(403);
      });
    });
  },
);
