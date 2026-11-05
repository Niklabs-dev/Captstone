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
import {
  PaymentMethod,
  Prisma,
  PrismaClient,
} from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type {
  SalesDashboard,
  StoreDashboard,
} from '../src/sales-dashboard/types/sales-dashboard.types.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

// Tests de integración de la consulta consolidada de ventas, alertas y
// diferencias por local (SPRINT-4-T13) por HTTP contra PostgreSQL real. Todo
// corre dentro de withinRollback: no deja datos residuales.

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

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

// Mismo caso de aceptación del cierre de SPRINT-4-T09: faltante de efectivo
// de 1.000 y descuadre de vouchers de 1.600.
function closingPayload(storeId: string, tipEntryId: string): object {
  return {
    storeId,
    businessDate: BUSINESS_DATE,
    shift: 1,
    openingCash: 50000,
    lines: [
      { paymentMethod: PaymentMethod.CASH, countedAmount: 149000 },
      { paymentMethod: PaymentMethod.DEBIT_CARD, countedAmount: 511730 },
      { paymentMethod: PaymentMethod.CREDIT_CARD, countedAmount: 43800 },
      { paymentMethod: PaymentMethod.TRANSFER, countedAmount: 20000 },
    ],
    vouchers: [
      {
        source: 'MRCOMANDA',
        periodStart: START,
        periodEnd: END,
        amount: 555530,
      },
      {
        source: 'MERCADO_PAGO',
        periodStart: START,
        periodEnd: END,
        amount: 588732,
        tipIncludedAmount: 31602,
      },
    ],
    tipEntryIds: [tipEntryId],
    differenceReason: 'Faltante de efectivo y descuadre de conciliación',
  };
}

function storeOf(body: SalesDashboard, storeId: string): StoreDashboard {
  const store = body.stores.find((item) => item.store.id === storeId);
  if (!store) throw new Error(`El local ${storeId} no está en la respuesta`);
  return store;
}

describe.skipIf(!databaseUrl)(
  'Consulta consolidada de ventas por local (SPRINT-4-T13)',
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
      paymentMethod: PaymentMethod,
      grossAmount: number,
      tipAmount = 0,
    ): Promise<void> {
      await f.tx.sale.create({
        data: {
          soldAt: new Date(soldAt),
          paymentMethod,
          grossAmount,
          tipAmount,
          storeId,
          registeredById: f.supervisor.id,
        },
      });
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
    // del día siguiente queda fuera.
    async function seedClosedStore(f: Fixture): Promise<void> {
      const store = f.closedStoreId;
      const noon = '2026-03-10T12:00:00-03:00';
      await seedSale(f, store, noon, PaymentMethod.CASH, 100000);
      await seedSale(f, store, noon, PaymentMethod.DEBIT_CARD, 521730, 10000);
      await seedSale(f, store, noon, PaymentMethod.CREDIT_CARD, 53800, 10000);
      await seedSale(f, store, noon, PaymentMethod.TRANSFER, 20000);
      await seedSale(
        f,
        store,
        '2026-03-10T18:00:00-03:00',
        PaymentMethod.CASH,
        30000,
      );
      await seedSale(
        f,
        store,
        '2026-03-10T23:30:00-03:00',
        PaymentMethod.DEBIT_CARD,
        5500,
        500,
      );
      await seedSale(
        f,
        store,
        '2026-03-11T00:30:00-03:00',
        PaymentMethod.CASH,
        777777,
      );
      await seedSale(
        f,
        store,
        '2026-03-09T23:59:00-03:00',
        PaymentMethod.CASH,
        666666,
      );
      const tipEntry = await f.tx.tipEntry.create({
        data: {
          businessDate: day(BUSINESS_DATE),
          paymentMethod: PaymentMethod.DEBIT_CARD,
          amount: 31602,
          storeId: store,
          responsibleId: f.supervisor.id,
        },
      });
      await request(app.getHttpServer())
        .post('/cash-closings')
        .set('Authorization', `Bearer ${token(f.supervisor)}`)
        .send(closingPayload(store, tipEntry.id))
        .expect(201);
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

    it('consolida ventas netas, propinas, cierres y diferencias por local', async () => {
      await withinRollback(async (f) => {
        await seedClosedStore(f);
        await seedSale(
          f,
          f.openStoreId,
          '2026-03-10T10:00:00-03:00',
          PaymentMethod.TRANSFER,
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
        expect(closed.sales.byPaymentMethod).toEqual([
          { paymentMethod: 'CASH', salesCount: 2, netAmount: 130000 },
          { paymentMethod: 'DEBIT_CARD', salesCount: 2, netAmount: 516730 },
          { paymentMethod: 'CREDIT_CARD', salesCount: 1, netAmount: 43800 },
          { paymentMethod: 'TRANSFER', salesCount: 1, netAmount: 20000 },
        ]);
        expect(closed.cardTips).toEqual({
          registeredAmount: 31602,
          closingsAmount: 31602,
        });
        expect(closed.closings).toEqual({
          count: 1,
          shifts: [1],
          netSalesAmount: 675530,
          countedAmount: 724530,
          cashDifference: -1000,
          voucherDifference: 1600,
          mrcomandaNetSales: 555530,
          mercadoPagoNetSales: 557130,
        });
        // Lo conciliado por el cierre coincide con las ventas vinculadas.
        expect(closed.closings.netSalesAmount).toBe(
          closed.sales.closedNetAmount,
        );
        expect(closed.pendingDifferences).toHaveLength(1);
        expect(closed.pendingDifferences[0]).toMatchObject({
          shift: 1,
          status: 'CLOSED',
          cashDifference: -1000,
          voucherDifference: 1600,
          differenceReason: 'Faltante de efectivo y descuadre de conciliación',
        });
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
