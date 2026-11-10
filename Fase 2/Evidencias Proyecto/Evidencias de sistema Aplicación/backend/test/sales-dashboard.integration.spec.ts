import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type {
  SalesDashboard,
  StoreDashboard,
} from '../src/sales-dashboard/types/sales-dashboard.types.js';
import { createDailyOperation } from './helpers/daily-operations.js';
import {
  businessDaysAgo,
  businessToday,
  createTestImport,
  createTestMethod,
  createTestStore,
  createTestUser,
  dbDate,
  type TestMethod,
  type TestStore,
} from './helpers/sales-consolidation.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración HTTP del panel consolidado del administrador
// (SPRINT-4R-T13) contra PostgreSQL real: agrupa todos los locales con las
// ventas de la importación vigente, el estado de importación diaria, las
// propinas y la diferencia de efectivo de la operación diaria y las alertas
// legales DT/propinas, cada concepto por separado. Las fechas son relativas
// al día de negocio actual. Todo corre dentro de withinRollback.
const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  storeA: TestStore;
  storeB: TestStore;
  card: TestMethod;
  cash: TestMethod;
  admin: AuthUser;
  supervisor: AuthUser;
  accountant: AuthUser;
  worker: AuthUser;
}

const DAY = (): string => businessDaysAgo(2);

function storeOf(body: SalesDashboard, storeId: string): StoreDashboard {
  const store = body.stores.find((item) => item.store.id === storeId);
  if (!store) throw new Error(`Local ${storeId} ausente del panel`);
  return store;
}

// Día en que se espera Excel y operación diaria: ni CERRADO ni sin informar
// (sin calendario o antes del inicio del seguimiento).
function isExpectedDay(store: StoreDashboard): boolean {
  const { status } = store.importStatus;
  return status !== null && status !== 'CERRADO';
}

describe.skipIf(!databaseUrl)(
  'Panel consolidado con ventas importadas (SPRINT-4R-T13)',
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

    function get(query: string, user: AuthUser | null): request.Test {
      const req = request(app.getHttpServer()).get(`/sales-dashboard${query}`);
      return user ? req.set('Authorization', `Bearer ${token(user)}`) : req;
    }

    async function dashboard(
      f: Fixture,
      date = DAY(),
    ): Promise<SalesDashboard> {
      const response = await get(`?date=${date}`, f.admin).expect(200);
      return response.body as SalesDashboard;
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      const storeA = await createTestStore(tx, 'Panel A', 'Melipilla');
      return {
        tx,
        storeA,
        storeB: await createTestStore(tx, 'Panel B', 'Calera'),
        card: await createTestMethod(tx, 'Tarjeta Panel', 1),
        cash: await createTestMethod(tx, 'Efectivo Panel', 2, 'CASH'),
        admin: await createTestUser(tx, ROLE.ADMINISTRADOR, null),
        supervisor: await createTestUser(tx, ROLE.SUPERVISOR, storeA.id),
        accountant: await createTestUser(tx, ROLE.CONTADOR, null),
        worker: await createTestUser(tx, ROLE.TRABAJADOR, storeA.id),
      };
    }

    // Local A: Excel vigente (más una versión pendiente) y operación diaria
    // con faltante. Local B: Excel vigente sin operación diaria.
    async function seedDay(
      f: Fixture,
    ): Promise<{ importA: string; pendingA: string; operationA: string }> {
      const importA = await createTestImport(f.tx, {
        store: f.storeA,
        businessDate: DAY(),
        lines: [
          { method: f.card, amount: 410_000 },
          { method: f.cash, amount: 90_000 },
        ],
        status: 'ACTIVE',
        confirmedById: f.admin.id,
      });
      const pendingA = await createTestImport(f.tx, {
        store: f.storeA,
        businessDate: DAY(),
        lines: [{ method: f.card, amount: 1 }],
        status: 'PENDING',
        confirmedById: f.admin.id,
      });
      await createTestImport(f.tx, {
        store: f.storeB,
        businessDate: DAY(),
        lines: [{ method: f.cash, amount: 120_000 }],
        status: 'ACTIVE',
        confirmedById: f.admin.id,
      });
      const operationA = await createDailyOperation(f.tx, {
        storeId: f.storeA.id,
        responsibleId: f.supervisor.id,
        businessDate: DAY(),
        cardTipAmount: 15_000,
        cashTipAmount: 6_000,
        cashDifference: -3_000,
        differenceReason: 'Faltante en el arqueo',
      });
      return { importA, pendingA, operationA };
    }

    // Documento laboral pendiente de registrar en la DT con el plazo dado. El
    // tipo CONTRATO lo siembra la base: se lee, no se escribe.
    async function seedDtDocument(
      f: Fixture,
      storeId: string,
      dueAt: string,
    ): Promise<string> {
      const type = await f.tx.documentType.findUniqueOrThrow({
        where: { code: 'CONTRATO' },
        select: { id: true },
      });
      const document = await f.tx.document.create({
        data: {
          title: `Contrato ${randomUUID()}`,
          retainUntil: dbDate('2031-03-10'),
          dtRegistrationDueAt: dbDate(dueAt),
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
      return document.id;
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
      storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-panel-'));
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

    it('agrupa todos los locales activos y los inactivos solo con datos del día', async () => {
      await withinRollback(async (f) => {
        const inactiveEmpty = await createTestStore(
          f.tx,
          'Panel C',
          'Melipilla',
          false,
        );
        const inactiveWithData = await createTestStore(
          f.tx,
          'Panel D',
          'Calera',
          false,
        );
        await createDailyOperation(f.tx, {
          storeId: inactiveWithData.id,
          responsibleId: f.supervisor.id,
          businessDate: DAY(),
        });
        const activeIds = async (): Promise<Set<string>> =>
          new Set(
            (
              await f.tx.store.findMany({
                where: { isActive: true },
                select: { id: true },
              })
            ).map((store) => store.id),
          );
        // Otras suites en paralelo pueden confirmar o borrar locales propios
        // mientras corre la consulta (READ COMMITTED): se exigen los activos
        // presentes antes y después del panel.
        const before = await activeIds();
        const body = await dashboard(f);
        const after = await activeIds();
        const stable = [...before].filter((id) => after.has(id));

        // Los 3 locales de Moi-food sembrados más los del test.
        expect(stable.length).toBeGreaterThanOrEqual(5);
        expect(stable).toEqual(
          expect.arrayContaining([f.storeA.id, f.storeB.id]),
        );
        const ids = body.stores.map((store) => store.store.id);
        expect(ids).toEqual(
          expect.arrayContaining([...stable, inactiveWithData.id]),
        );
        expect(ids).not.toContain(inactiveEmpty.id);
        expect(body).toMatchObject({
          businessDate: DAY(),
          today: businessToday(),
          timeZone: 'America/Santiago',
        });
      });
    });

    it('muestra ventas importadas, estado diario, propinas y diferencia por separado', async () => {
      await withinRollback(async (f) => {
        const ids = await seedDay(f);
        const body = await dashboard(f);
        const storeA = storeOf(body, f.storeA.id);

        // Local sin calendario con Excel vigente: IMPORTADO, con la versión
        // pendiente informada aparte.
        expect(storeA.importStatus).toEqual({
          status: 'IMPORTADO',
          activeImportId: ids.importA,
          pendingImportId: ids.pendingA,
          closure: null,
        });
        // Ventas exclusivamente del Excel vigente (la pendiente de 1 no
        // suma) y sin propinas.
        expect(storeA.sales).toMatchObject({
          importId: ids.importA,
          version: 1,
          totalAmount: 500_000,
        });
        const byCode = new Map(
          storeA.sales?.byPaymentMethod.map((m) => [m.paymentMethod, m]),
        );
        expect(byCode.get(f.card.code)).toEqual({
          paymentMethod: f.card.code,
          paymentMethodName: 'Tarjeta Panel',
          isActive: true,
          amount: 410_000,
        });
        expect(byCode.get(f.cash.code)?.amount).toBe(90_000);
        expect(storeA.dailyOperation).toEqual({
          operationId: ids.operationA,
          cardTipAmount: 15_000,
          cashTipAmount: 6_000,
          tipFundAmount: 21_000,
          cashDifference: {
            amount: -3_000,
            type: 'FALTANTE',
            reason: 'Faltante en el arqueo',
          },
          hasVoucher: true,
        });

        // Local B: ventas sin operación diaria (ausencia de datos = null).
        const storeB = storeOf(body, f.storeB.id);
        expect(storeB.sales?.totalAmount).toBe(120_000);
        expect(storeB.dailyOperation).toBeNull();

        expect(body.cashDifferences).toEqual(
          expect.arrayContaining([
            {
              store: { id: f.storeA.id, name: f.storeA.name },
              businessDate: DAY(),
              operationId: ids.operationA,
              amount: -3_000,
              type: 'FALTANTE',
              reason: 'Faltante en el arqueo',
            },
          ]),
        );
        // Sin cierres ni conceptos del flujo antiguo.
        const raw = JSON.stringify(body);
        for (const key of [
          'mercadoPago',
          'voucherDifference',
          'mrcomandaNetSales',
          'closings',
          'pendingDifferences',
          'cardTips',
        ]) {
          expect(raw).not.toContain(key);
        }
      });
    });

    it('sin Excel ni operación del día informa ausencia de datos y el estado ATRASADO', async () => {
      await withinRollback(async (f) => {
        await f.tx.storeOperatingSchedule.create({
          data: {
            storeId: f.storeA.id,
            opensMonday: true,
            opensTuesday: true,
            opensWednesday: true,
            opensThursday: true,
            opensFriday: true,
            opensSaturday: true,
            opensSunday: true,
            trackingStartDate: dbDate(businessDaysAgo(10)),
            updatedById: f.admin.id,
          },
        });
        await f.tx.storeClosure.create({
          data: {
            storeId: f.storeA.id,
            closureDate: dbDate(businessDaysAgo(1)),
            reason: 'Feriado',
            createdById: f.admin.id,
          },
        });

        const late = storeOf(await dashboard(f), f.storeA.id);
        expect(late).toMatchObject({
          importStatus: { status: 'ATRASADO', activeImportId: null },
          sales: null,
          dailyOperation: null,
        });
        const closed = storeOf(
          await dashboard(f, businessDaysAgo(1)),
          f.storeA.id,
        );
        expect(closed.importStatus).toMatchObject({
          status: 'CERRADO',
          closure: { reason: 'Feriado' },
        });
        const today = storeOf(await dashboard(f, businessToday()), f.storeA.id);
        expect(today.importStatus.status).toBe('PENDIENTE');
        // Local sin calendario ni datos: el día no se informa.
        const storeB = storeOf(await dashboard(f), f.storeB.id);
        expect(storeB).toMatchObject({
          importStatus: { status: null },
          sales: null,
          dailyOperation: null,
        });
      });
    });

    it('informa la importación pendiente de un local inactivo con datos del día', async () => {
      await withinRollback(async (f) => {
        const inactive = await createTestStore(
          f.tx,
          'Panel pendiente',
          'Calera',
          false,
        );
        await createDailyOperation(f.tx, {
          storeId: inactive.id,
          responsibleId: f.supervisor.id,
          businessDate: DAY(),
        });
        const pending = await createTestImport(f.tx, {
          store: inactive,
          businessDate: DAY(),
          lines: [{ method: f.cash, amount: 50_000 }],
          status: 'PENDING',
          confirmedById: f.admin.id,
        });

        const store = storeOf(await dashboard(f), inactive.id);
        expect(store.importStatus).toEqual({
          status: null,
          activeImportId: null,
          pendingImportId: pending,
          closure: null,
        });
        expect(store.sales).toBeNull();
      });
    });

    it('no cuenta como faltantes los días CERRADO ni los anteriores al seguimiento', async () => {
      await withinRollback(async (f) => {
        const calendar = (
          storeId: string,
          trackingStartDate: string,
        ): Promise<unknown> =>
          f.tx.storeOperatingSchedule.create({
            data: {
              storeId,
              opensMonday: true,
              opensTuesday: true,
              opensWednesday: true,
              opensThursday: true,
              opensFriday: true,
              opensSaturday: true,
              opensSunday: true,
              trackingStartDate: dbDate(trackingStartDate),
              updatedById: f.admin.id,
            },
          });
        // A: abre todos los días, con excepción de cierre el día consultado.
        // B: su seguimiento empieza después del día consultado.
        // C: abre ese día y no tiene Excel ni operación (sí es faltante).
        const storeC = await createTestStore(f.tx, 'Panel C', 'Melipilla');
        await calendar(f.storeA.id, businessDaysAgo(10));
        await f.tx.storeClosure.create({
          data: {
            storeId: f.storeA.id,
            closureDate: dbDate(DAY()),
            reason: 'Feriado',
            createdById: f.admin.id,
          },
        });
        await calendar(f.storeB.id, businessDaysAgo(1));
        await calendar(storeC.id, businessDaysAgo(10));

        const body = await dashboard(f);
        expect(storeOf(body, f.storeA.id).importStatus.status).toBe('CERRADO');
        expect(storeOf(body, f.storeB.id).importStatus.status).toBeNull();
        expect(storeOf(body, storeC.id).importStatus.status).toBe('ATRASADO');

        const expected = body.stores.filter(isExpectedDay);
        expect(expected.map((s) => s.store.id)).toContain(storeC.id);
        expect(expected.map((s) => s.store.id)).not.toEqual(
          expect.arrayContaining([f.storeA.id]),
        );
        expect(expected.map((s) => s.store.id)).not.toEqual(
          expect.arrayContaining([f.storeB.id]),
        );
        expect(body.totals.storesWithoutImport).toBe(
          expected.filter((s) => s.sales === null).length,
        );
        expect(body.totals.storesWithoutDailyOperation).toBe(
          expected.filter((s) => s.dailyOperation === null).length,
        );
      });
    });

    it('cuenta las alertas DT y de propinas vigentes de cada local', async () => {
      await withinRollback(async (f) => {
        const today = businessToday();
        const past = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
        const future = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
        await seedDtDocument(f, f.storeA.id, past);
        await seedDtDocument(f, f.storeA.id, future);
        await seedDtDocument(f, f.storeB.id, future);
        // Propina con tarjeta histórica sin reparto pagado: alerta de
        // entrega (art. 64) en el local B.
        await f.tx.tipEntry.create({
          data: {
            businessDate: dbDate(DAY()),
            paymentMethodId: f.card.id,
            amount: 5_000,
            storeId: f.storeB.id,
            responsibleId: f.supervisor.id,
          },
        });

        const body = await dashboard(f);
        expect(storeOf(body, f.storeA.id).alerts.dtRegistration).toEqual({
          overdue: 1,
          upcoming: 1,
        });
        expect(storeOf(body, f.storeB.id).alerts.dtRegistration).toEqual({
          overdue: 0,
          upcoming: 1,
        });
        const tipB = storeOf(body, f.storeB.id).alerts.tipPayment;
        expect(tipB.overdue + tipB.upcoming).toBe(1);
        expect(storeOf(body, f.storeA.id).alerts.tipPayment).toEqual({
          overdue: 0,
          upcoming: 0,
        });
      });
    });

    it('no pierde las alertas de un local inactivo sin datos del día', async () => {
      await withinRollback(async (f) => {
        const today = businessToday();
        const past = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
        const inactive = await createTestStore(
          f.tx,
          'Panel inactivo',
          'Calera',
          false,
        );
        await seedDtDocument(f, inactive.id, past);
        await f.tx.tipEntry.create({
          data: {
            businessDate: dbDate(DAY()),
            paymentMethodId: f.card.id,
            amount: 4_000,
            storeId: inactive.id,
            responsibleId: f.supervisor.id,
          },
        });

        const body = await dashboard(f);
        // El local aparece con sus alertas aunque no tenga Excel ni operación.
        const store = storeOf(body, inactive.id);
        expect(store).toMatchObject({
          store: { id: inactive.id, isActive: false },
          sales: null,
          dailyOperation: null,
          alerts: { dtRegistration: { overdue: 1, upcoming: 0 } },
        });
        expect(
          store.alerts.tipPayment.overdue + store.alerts.tipPayment.upcoming,
        ).toBe(1);

        // Los totales cuentan todas las alertas vigentes: como todo local con
        // alertas aparece en el panel, cuadran con la suma por local de la
        // misma respuesta (otras suites pueden confirmar alertas en paralelo,
        // así que no se compara con una segunda consulta).
        const sum = (
          pick: (s: StoreDashboard) => { overdue: number; upcoming: number },
        ): { overdue: number; upcoming: number } => ({
          overdue: body.stores.reduce((acc, s) => acc + pick(s).overdue, 0),
          upcoming: body.stores.reduce((acc, s) => acc + pick(s).upcoming, 0),
        });
        expect(body.totals.dtRegistrationAlerts).toEqual(
          sum((s) => s.alerts.dtRegistration),
        );
        expect(body.totals.tipPaymentAlerts).toEqual(
          sum((s) => s.alerts.tipPayment),
        );
        expect(body.totals.dtRegistrationAlerts.overdue).toBeGreaterThanOrEqual(
          1,
        );
      });
    });

    it('los totales concilian con la suma de los locales, sin compensar diferencias', async () => {
      await withinRollback(async (f) => {
        await seedDay(f);
        await createDailyOperation(f.tx, {
          storeId: f.storeB.id,
          responsibleId: f.supervisor.id,
          businessDate: DAY(),
          cashDifference: 3_000,
          differenceReason: 'Sobrante en el arqueo',
        });
        const body = await dashboard(f);
        const sum = (pick: (store: StoreDashboard) => number): number =>
          body.stores.reduce((acc, store) => acc + pick(store), 0);
        const { totals } = body;

        expect(totals.sales.totalAmount).toBe(
          sum((s) => s.sales?.totalAmount ?? 0),
        );
        expect(totals.sales.importedDays).toBe(
          body.stores.filter((s) => s.sales !== null).length,
        );
        const expected = body.stores.filter(isExpectedDay);
        expect(totals.storesWithoutImport).toBe(
          expected.filter((s) => s.sales === null).length,
        );
        expect(totals.storesWithoutDailyOperation).toBe(
          expected.filter((s) => s.dailyOperation === null).length,
        );
        expect(
          totals.sales.byPaymentMethod.reduce((acc, m) => acc + m.amount, 0),
        ).toBe(totals.sales.totalAmount);
        expect(totals.tips.tipFundAmount).toBe(
          sum((s) => s.dailyOperation?.tipFundAmount ?? 0),
        );
        expect(totals.cashDifferences.surplusAmount).toBe(
          sum((s) => Math.max(s.dailyOperation?.cashDifference.amount ?? 0, 0)),
        );
        expect(totals.cashDifferences.shortageAmount).toBe(
          sum((s) => Math.min(s.dailyOperation?.cashDifference.amount ?? 0, 0)),
        );
        // +3.000 y -3.000 no se compensan a cero.
        expect(totals.cashDifferences.surplusAmount).toBeGreaterThanOrEqual(
          3_000,
        );
        expect(totals.cashDifferences.shortageAmount).toBeLessThanOrEqual(
          -3_000,
        );
        expect(totals.cashDifferences.count).toBe(body.cashDifferences.length);
        expect(totals.dtRegistrationAlerts.overdue).toBe(
          sum((s) => s.alerts.dtRegistration.overdue),
        );
        expect(totals.tipPaymentAlerts.upcoming).toBe(
          sum((s) => s.alerts.tipPayment.upcoming),
        );
        const statusTotal = Object.values(totals.importStatus).reduce(
          (acc, value) => acc + value,
          0,
        );
        expect(statusTotal).toBe(
          body.stores.filter((s) => s.importStatus.status !== null).length,
        );
      });
    });

    it('en una fecha pasada indica que las alertas son las vigentes de hoy', async () => {
      await withinRollback(async (f) => {
        const past = await dashboard(f);
        expect(past.businessDate).toBe(DAY());
        expect(past.alertsAsOf).toBe(businessToday());
        const current = await dashboard(f, businessToday());
        expect(current.alertsAsOf).toBe(current.businessDate);
      });
    });

    it('sin fecha consulta el día actual en hora de Chile', async () => {
      await withinRollback(async (f) => {
        const response = await get('', f.admin).expect(200);
        const body = response.body as SalesDashboard;
        expect(body.businessDate).toBe(businessToday());
        expect(body.today).toBe(businessToday());
      });
    });

    it('rechaza fechas inválidas, futuras y parámetros desconocidos', async () => {
      await withinRollback(async (f) => {
        await get('?date=2026-02-30', f.admin).expect(400);
        await get('?date=10-03-2026', f.admin).expect(400);
        const future = await get(
          `?date=${businessDaysAgo(-1)}`,
          f.admin,
        ).expect(400);
        // El error nombra el parámetro del panel, no el `to` de los reportes.
        expect((future.body as { message: string }).message).toBe(
          `date no puede ser posterior a hoy (${businessToday()}, hora de Chile)`,
        );
        await get(`?date=${DAY()}&storeId=x`, f.admin).expect(400);
      });
    });

    it('solo el administrador puede consultar el panel', async () => {
      await withinRollback(async (f) => {
        await get('', null).expect(401);
        await get('', f.supervisor).expect(403);
        await get('', f.accountant).expect(403);
        await get('', f.worker).expect(403);
      });
    });
  },
);
