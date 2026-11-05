import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { MrComandaSalesResponse } from '../src/sales/types/sales.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de integración HTTP del ingreso de ventas MrComanda (SPRINT-4-T32).
// Requieren TEST_DATABASE_URL (PostgreSQL real); sin él se omiten.
const databaseUrl = process.env.TEST_DATABASE_URL;
const DOMAIN = '@sales-mrcomanda-test.moi-food.cl';
const STORE_A_NAME = 'Subway SalesTest Local A';
const STORE_B_NAME = 'Subway SalesTest Local B';
const METHOD_CODES = [
  'SALE_CASH',
  'SALE_DEBIT',
  'SALE_CREDIT',
  'SALE_GIFT',
] as const;

const DAY = '2026-03-10';
const PERIOD_MORNING = {
  periodStart: `${DAY}T08:00:00-03:00`,
  periodEnd: `${DAY}T14:00:00-03:00`,
};

describe.skipIf(!databaseUrl)(
  'Ingreso de ventas MrComanda (SPRINT-4-T32)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let adminToken: string;
    let adminId: string;
    let supervisorToken: string;
    let supervisorId: string;
    let workerToken: string;
    let storeAId: string;
    let storeBId: string;

    async function cleanup(): Promise<void> {
      await purgeTestAuditLogs(prisma, {
        user: { email: { endsWith: DOMAIN } },
      });
      const stores = await prisma.store.findMany({
        where: {
          name: { contains: 'SalesTest', mode: 'insensitive' },
        },
        select: { id: true },
      });
      const storeIds = stores.map((store) => store.id);
      await prisma.sale.deleteMany({ where: { storeId: { in: storeIds } } });
      await prisma.cashClosing.deleteMany({
        where: { storeId: { in: storeIds } },
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      // Solo se eliminan los medios sin líneas de cierre ni ventas
      // referenciándolos: otros archivos (concurrencia de cierres) crean
      // líneas comprometidas con todos los medios activos, incluidos estos,
      // y esas filas inmutables los retienen hasta su propia limpieza.
      await prisma.paymentMethod.deleteMany({
        where: {
          code: { in: [...METHOD_CODES] },
          cashClosingLines: { none: {} },
          sales: { none: {} },
        },
      });
      await prisma.store.deleteMany({
        where: { id: { in: storeIds } },
      });
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';

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
      const [adminRole, supervisorRole, workerRole] = await Promise.all(
        [ROLE.ADMINISTRADOR, ROLE.SUPERVISOR, ROLE.TRABAJADOR].map((code) =>
          prisma.role.findUniqueOrThrow({ where: { code } }),
        ),
      );
      const storeA = await prisma.store.create({
        data: {
          name: STORE_A_NAME,
          city: 'Melipilla',
          address: 'Calle de prueba 123',
        },
      });
      storeAId = storeA.id;
      const storeB = await prisma.store.create({
        data: {
          name: STORE_B_NAME,
          city: 'Calera de Tango',
          address: 'Calle de prueba 456',
        },
      });
      storeBId = storeB.id;

      const admin = await prisma.user.create({
        data: {
          email: `admin${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Admin',
          lastName: 'SalesTest',
          roleId: adminRole.id,
        },
      });
      adminId = admin.id;
      adminToken = await tokenFor(adminId, ROLE.ADMINISTRADOR, null);

      const supervisor = await prisma.user.create({
        data: {
          email: `supervisor${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Supervisor',
          lastName: 'SalesTest',
          roleId: supervisorRole.id,
          storeId: storeA.id,
        },
      });
      supervisorId = supervisor.id;
      supervisorToken = await tokenFor(
        supervisorId,
        ROLE.SUPERVISOR,
        storeA.id,
      );

      const worker = await prisma.user.create({
        data: {
          email: `worker${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Trabajador',
          lastName: 'SalesTest',
          roleId: workerRole.id,
          storeId: storeA.id,
        },
      });
      workerToken = await tokenFor(worker.id, ROLE.TRABAJADOR, storeA.id);

      // Catálogo de prueba: dos medios activos y uno inactivo. skipDuplicates
      // tolera restos de una corrida anterior cuyo borrado quedó bloqueado
      // por líneas de cierre ajenas (FK Restrict) mientras corría la suite.
      await prisma.paymentMethod.createMany({
        skipDuplicates: true,
        data: [
          {
            code: 'SALE_CASH',
            name: 'Efectivo venta',
            sortOrder: 10,
            behavior: 'CASH',
            availableForTips: true,
          },
          {
            code: 'SALE_DEBIT',
            name: 'Débito venta',
            sortOrder: 20,
            behavior: 'RECONCILABLE_CARD',
            availableForTips: true,
          },
          {
            code: 'SALE_CREDIT',
            name: 'Crédito venta',
            sortOrder: 25,
            behavior: 'RECONCILABLE_CARD',
            availableForTips: true,
          },
          {
            code: 'SALE_GIFT',
            name: 'Gift card inactiva',
            sortOrder: 30,
            behavior: 'EXTERNAL_OTHER',
            availableForTips: false,
            isActive: false,
          },
        ],
      });
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
    });

    function tokenFor(
      sub: string,
      role: RoleCode,
      tokenStoreId: string | null,
    ): Promise<string> {
      const payload: JwtPayload = {
        sub,
        email: `token${DOMAIN}`,
        role,
        storeId: tokenStoreId,
      };
      return jwt.signAsync(payload);
    }

    function importMrComanda(
      body: object,
      token: string = supervisorToken,
      storeId: string = storeAId,
    ) {
      return request(app.getHttpServer())
        .post('/sales/mrcomanda')
        .set('Authorization', `Bearer ${token}`)
        .send({ storeId, ...body });
    }

    function mrcomandaSalesCount(storeId: string): Promise<number> {
      return prisma.sale.count({
        where: { storeId, source: 'MRCOMANDA' },
      });
    }

    it('registra totales netos por medio y audita el ingreso', async () => {
      const response = await importMrComanda({
        ...PERIOD_MORNING,
        totals: [
          { paymentMethod: 'SALE_DEBIT', netAmount: 100000 },
          { paymentMethod: 'sale_cash', netAmount: 50000 },
        ],
      }).expect(201);
      const body = response.body as MrComandaSalesResponse;

      expect(body).toMatchObject({
        storeId: storeAId,
        created: true,
        totalNetAmount: 150000,
      });
      expect(body.totals).toHaveLength(2);
      // Orden estable por código, con nombre del catálogo y neto entero.
      expect(body.totals.map((total) => total.paymentMethod)).toEqual([
        'SALE_CASH',
        'SALE_DEBIT',
      ]);
      expect(body.totals[0]).toMatchObject({
        paymentMethodName: 'Efectivo venta',
        netAmount: 50000,
      });

      const stored = await prisma.sale.findMany({
        where: { storeId: storeAId, source: 'MRCOMANDA' },
        include: { paymentMethod: true },
      });
      expect(stored).toHaveLength(2);
      for (const sale of stored) {
        expect(sale.tipAmount.toNumber()).toBe(0);
        expect(sale.registeredById).toBe(supervisorId);
        expect(sale.soldAt.toISOString()).toBe('2026-03-10T11:00:00.000Z');
        expect(['SALE_CASH', 'SALE_DEBIT']).toContain(sale.paymentMethod.code);
      }

      const audits = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTION.MRCOMANDA_SALES_IMPORTED,
          user: { email: `supervisor${DOMAIN}` },
        },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].storeId).toBe(storeAId);
      expect(audits[0].detail).toMatchObject({
        created: true,
        totalNetAmount: 150000,
      });
    });

    it('no duplica un reintento idéntico y no vuelve a auditar', async () => {
      const response = await importMrComanda({
        ...PERIOD_MORNING,
        totals: [
          { paymentMethod: 'SALE_DEBIT', netAmount: 100000 },
          { paymentMethod: 'SALE_CASH', netAmount: 50000 },
        ],
      }).expect(201);
      const retryBody = response.body as MrComandaSalesResponse;
      expect(retryBody.created).toBe(false);
      expect(await mrcomandaSalesCount(storeAId)).toBe(2);

      const audits = await prisma.auditLog.findMany({
        where: {
          action: AUDIT_ACTION.MRCOMANDA_SALES_IMPORTED,
          user: { email: `supervisor${DOMAIN}` },
        },
      });
      expect(audits).toHaveLength(1);
    });

    it('serializa los ingresos concurrentes por local sin duplicar', async () => {
      const body = {
        periodStart: `${DAY}T14:00:00-03:00`,
        periodEnd: `${DAY}T16:00:00-03:00`,
        totals: [{ paymentMethod: 'SALE_DEBIT', netAmount: 75000 }],
      };
      const [first, second] = await Promise.all([
        importMrComanda(body),
        importMrComanda(body),
      ]);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstBody = first.body as MrComandaSalesResponse;
      const secondBody = second.body as MrComandaSalesResponse;
      expect([firstBody.created, secondBody.created].sort()).toEqual([
        false,
        true,
      ]);
      expect(await mrcomandaSalesCount(storeAId)).toBe(3);
    });

    it('rechaza con conflicto un mismo período con contenido distinto', async () => {
      await importMrComanda({
        ...PERIOD_MORNING,
        totals: [{ paymentMethod: 'SALE_DEBIT', netAmount: 99999 }],
      }).expect(409);
    });

    it('rechaza con conflicto un período solapado con otro medio', async () => {
      await importMrComanda({
        periodStart: `${DAY}T09:00:00-03:00`,
        periodEnd: `${DAY}T12:00:00-03:00`,
        totals: [{ paymentMethod: 'SALE_DEBIT', netAmount: 100000 }],
      }).expect(409);

      // El solape de un medio no bloquea a otro medio en el mismo período.
      await importMrComanda({
        periodStart: `${DAY}T09:00:00-03:00`,
        periodEnd: `${DAY}T12:00:00-03:00`,
        totals: [{ paymentMethod: 'SALE_CREDIT', netAmount: 20000 }],
      }).expect(201);
    });

    it('permite un segundo período del mismo medio sin solapamiento', async () => {
      const response = await importMrComanda({
        periodStart: `${DAY}T16:00:00-03:00`,
        periodEnd: `${DAY}T18:00:00-03:00`,
        totals: [{ paymentMethod: 'SALE_CASH', netAmount: 30000 }],
      }).expect(201);
      const afternoonBody = response.body as MrComandaSalesResponse;
      expect(afternoonBody.created).toBe(true);
    });

    it('rechaza medios duplicados, inexistentes o inactivos', async () => {
      await importMrComanda({
        ...PERIOD_MORNING,
        totals: [
          { paymentMethod: 'SALE_CASH', netAmount: 1000 },
          { paymentMethod: 'sale_cash', netAmount: 1000 },
        ],
      }).expect(400);

      await importMrComanda({
        ...PERIOD_MORNING,
        totals: [{ paymentMethod: 'MEDIO_FALSO', netAmount: 1000 }],
      }).expect(400);

      await importMrComanda({
        ...PERIOD_MORNING,
        totals: [{ paymentMethod: 'SALE_GIFT', netAmount: 1000 }],
      }).expect(400);
    });

    it('valida períodos, montos y zona horaria en el lote', async () => {
      await importMrComanda({
        periodStart: `${DAY}T08:00:00`,
        periodEnd: `${DAY}T14:00:00`,
        totals: [{ paymentMethod: 'SALE_CASH', netAmount: 1000 }],
      }).expect(400);

      await importMrComanda({
        periodStart: `${DAY}T23:00:00-03:00`,
        periodEnd: '2026-03-11T01:00:00-03:00',
        totals: [{ paymentMethod: 'SALE_CASH', netAmount: 1000 }],
      }).expect(400);

      await importMrComanda({
        ...PERIOD_MORNING,
        totals: [{ paymentMethod: 'SALE_CASH', netAmount: -5 }],
      }).expect(400);

      await importMrComanda({
        ...PERIOD_MORNING,
        totals: [{ paymentMethod: 'SALE_CASH', netAmount: 10.5 }],
      }).expect(400);

      await importMrComanda({
        ...PERIOD_MORNING,
        totals: [],
      }).expect(400);
    });

    it('restringe por rol y por local', async () => {
      await importMrComanda(
        {
          periodStart: '2026-03-11T08:00:00-03:00',
          periodEnd: '2026-03-11T10:00:00-03:00',
          totals: [{ paymentMethod: 'SALE_CASH', netAmount: 1000 }],
        },
        workerToken,
      ).expect(403);

      // El supervisor de A no puede cargar en el local B.
      await importMrComanda(
        {
          periodStart: '2026-03-11T08:00:00-03:00',
          periodEnd: '2026-03-11T10:00:00-03:00',
          totals: [{ paymentMethod: 'SALE_CASH', netAmount: 1000 }],
        },
        supervisorToken,
        storeBId,
      ).expect(403);

      // El administrador global sí puede cargar en cualquier local.
      await importMrComanda(
        {
          periodStart: '2026-03-11T08:00:00-03:00',
          periodEnd: '2026-03-11T10:00:00-03:00',
          totals: [{ paymentMethod: 'SALE_CASH', netAmount: 1000 }],
        },
        adminToken,
        storeBId,
      ).expect(201);

      // El ingreso del administrador queda a su nombre.
      const stored = await prisma.sale.findFirstOrThrow({
        where: { storeId: storeBId, source: 'MRCOMANDA' },
      });
      expect(stored.registeredById).toBe(adminId);
    });

    it('un cierre cerrado no bloquea otros turnos del día: rechaza solo lo solapado con lo cerrado', async () => {
      // Escenario en un local dedicado con su propio administrador: los
      // cierres CLOSED y sus ventas son inmutables por diseño (triggers), así
      // que sus filas —y el usuario que las registró— quedan en la base al
      // terminar el test, igual que un cierre real en producción.
      const closedStore = await prisma.store.create({
        data: {
          name: `Subway CierreInmutableTest ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle de cierre 789',
        },
      });
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { code: ROLE.ADMINISTRADOR },
      });
      const closedAdmin = await prisma.user.create({
        data: {
          email: `cierre-inmutable-${randomUUID()}@cierre-inmutable-test.invalid`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Admin',
          lastName: 'CierreInmutableTest',
          roleId: adminRole.id,
        },
      });
      const closedAdminToken = await tokenFor(
        closedAdmin.id,
        ROLE.ADMINISTRADOR,
        null,
      );
      // Medios dedicados al escenario: las ventas inmutables del cierre
      // cerrado los referencian, así que no deben ser los que limpia el
      // archivo (son Restrict y tampoco se podrían eliminar).
      const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
      const closedCash = await prisma.paymentMethod.create({
        data: {
          code: `CLOSED_CASH_${suffix}`,
          name: 'Efectivo cierre inmutable',
          sortOrder: 10,
          behavior: 'CASH',
          availableForTips: true,
        },
      });
      const closedDebit = await prisma.paymentMethod.create({
        data: {
          code: `CLOSED_DEBIT_${suffix}`,
          name: 'Débito cierre inmutable',
          sortOrder: 20,
          behavior: 'RECONCILABLE_CARD',
          availableForTips: true,
        },
      });

      // Turno 1 del día: dos medios cargados y conciliados en un cierre que
      // luego queda CLOSED.
      await importMrComanda(
        {
          ...PERIOD_MORNING,
          totals: [
            { paymentMethod: closedDebit.code, netAmount: 100000 },
            { paymentMethod: closedCash.code, netAmount: 50000 },
          ],
        },
        closedAdminToken,
        closedStore.id,
      ).expect(201);
      const shiftSales = await prisma.sale.findMany({
        where: { storeId: closedStore.id, source: 'MRCOMANDA' },
        select: { id: true },
      });
      const shift1 = await prisma.cashClosing.create({
        data: {
          storeId: closedStore.id,
          businessDate: new Date(`${DAY}T00:00:00.000Z`),
          shift: 1,
          openingCash: 0,
          status: 'OPEN',
          responsibleId: closedAdmin.id,
        },
      });
      // El trigger exige asociar las ventas con el cierre aún OPEN y cerrarlo
      // después; las ventas de un cierre CLOSED quedan inmutables.
      await prisma.sale.updateMany({
        where: { id: { in: shiftSales.map((sale) => sale.id) } },
        data: { cashClosingId: shift1.id },
      });
      await prisma.cashClosing.update({
        where: { id: shift1.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date('2026-03-10T21:00:00.000Z'),
          closedById: closedAdmin.id,
        },
      });

      // Un turno no solapado del mismo día con cierre cerrado se carga igual.
      const secondShift = await importMrComanda(
        {
          periodStart: `${DAY}T18:00:00-03:00`,
          periodEnd: `${DAY}T20:00:00-03:00`,
          totals: [{ paymentMethod: closedCash.code, netAmount: 8000 }],
        },
        closedAdminToken,
        closedStore.id,
      ).expect(201);
      expect((secondShift.body as MrComandaSalesResponse).created).toBe(true);

      // El reintento idéntico de una venta ya cerrada sigue siendo
      // idempotente: no escribe ni se audita de nuevo.
      const retry = await importMrComanda(
        {
          ...PERIOD_MORNING,
          totals: [{ paymentMethod: closedDebit.code, netAmount: 100000 }],
        },
        closedAdminToken,
        closedStore.id,
      ).expect(201);
      expect((retry.body as MrComandaSalesResponse).created).toBe(false);

      // Lo que se solapa con lo ya conciliado en el cierre cerrado se
      // rechaza, y un contenido distinto para el período cerrado también.
      await importMrComanda(
        {
          periodStart: `${DAY}T09:00:00-03:00`,
          periodEnd: `${DAY}T12:00:00-03:00`,
          totals: [{ paymentMethod: closedDebit.code, netAmount: 100000 }],
        },
        closedAdminToken,
        closedStore.id,
      ).expect(409);
      await importMrComanda(
        {
          ...PERIOD_MORNING,
          totals: [{ paymentMethod: closedDebit.code, netAmount: 99999 }],
        },
        closedAdminToken,
        closedStore.id,
      ).expect(409);

      // El día siguiente sigue abierto: el medio inactivo se rechaza por
      // catálogo (400), no por el cierre.
      await importMrComanda(
        {
          periodStart: '2026-03-11T08:00:00-03:00',
          periodEnd: '2026-03-11T10:00:00-03:00',
          totals: [{ paymentMethod: 'SALE_GIFT', netAmount: 5000 }],
        },
        closedAdminToken,
        closedStore.id,
      ).expect(400);
    });

    it('un cierre cerrado sin ventas bloquea solo lo solapado y ordena ingreso vs cierre', async () => {
      // Escenario dedicado: un cierre CLOSED del turno 1 (08:00–16:00) sin
      // ninguna venta conciliada. Sus filas quedan en la base al terminar
      // (inmutabilidad por triggers), igual que un cierre real.
      const supervisorRole = await prisma.role.findUniqueOrThrow({
        where: { code: ROLE.SUPERVISOR },
      });
      const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
      const emptyStore = await prisma.store.create({
        data: {
          name: `Subway CierreVacioTest ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle de cierre vacío 321',
        },
      });
      const emptySupervisor = await prisma.user.create({
        data: {
          email: `cierre-vacio-${randomUUID()}@cierre-vacio-test.invalid`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Supervisor',
          lastName: 'CierreVacioTest',
          roleId: supervisorRole.id,
          storeId: emptyStore.id,
        },
      });
      const emptySupervisorToken = await tokenFor(
        emptySupervisor.id,
        ROLE.SUPERVISOR,
        emptyStore.id,
      );
      const emptyMethod = await prisma.paymentMethod.create({
        data: {
          code: `EMPTY_SALE_${suffix}`,
          name: 'Venta cierre vacío',
          sortOrder: 60,
          behavior: 'RECONCILABLE_CARD',
          availableForTips: true,
        },
      });

      function postClosing(body: object, token: string) {
        return request(app.getHttpServer())
          .post('/cash-closings')
          .set('Authorization', `Bearer ${token}`)
          .send(body);
      }

      // Líneas contadas (0) para todos los medios activos: el cierre las
      // exige aunque no haya movimientos.
      async function zeroLines(): Promise<
        { paymentMethod: string; countedAmount: number }[]
      > {
        const active = await prisma.paymentMethod.findMany({
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        });
        return active.map((method) => ({
          paymentMethod: method.code,
          countedAmount: 0,
        }));
      }

      // Cierra el turno 1 sin ventas vía HTTP (misma ruta real de
      // concurrencia que producción), con reintento ante la carrera del
      // catálogo compartido de la suite.
      async function closeEmptyShift(
        storeId: string,
        token: string,
        shift: number,
      ): Promise<request.Response> {
        for (let attempt = 0; ; attempt += 1) {
          const response = await postClosing(
            {
              storeId,
              businessDate: DAY,
              shift,
              openingCash: 0,
              // Si el ingreso gana la carrera, el cierre ve su venta con lo
              // contado en cero: el descuadre exige motivo.
              differenceReason: 'Cierre de turno de prueba',
              lines: await zeroLines(),
              vouchers: [
                {
                  source: 'MRCOMANDA',
                  periodStart: `${DAY}T08:00:00-03:00`,
                  periodEnd: `${DAY}T16:00:00-03:00`,
                  amount: 0,
                  paymentMethod: 'DEBIT_CARD',
                },
                {
                  source: 'MERCADO_PAGO',
                  periodStart: `${DAY}T08:00:00-03:00`,
                  periodEnd: `${DAY}T16:00:00-03:00`,
                  amount: 0,
                },
              ],
            },
            token,
          );
          const message = JSON.stringify(response.body);
          const race =
            response.status === 400 &&
            (message.includes('Debes informar lo contado') ||
              message.includes('no existe en el catálogo'));
          if (!race || attempt >= 2) return response;
        }
      }

      const emptyClosing = await closeEmptyShift(
        emptyStore.id,
        emptySupervisorToken,
        1,
      );
      expect(emptyClosing.status).toBe(201);
      const emptyClosingBody = emptyClosing.body as { id: string };
      expect(emptyClosingBody.id).toEqual(expect.any(String));

      // Lo que se solapa con el cierre sin ventas se rechaza...
      await importMrComanda(
        {
          periodStart: `${DAY}T10:00:00-03:00`,
          periodEnd: `${DAY}T12:00:00-03:00`,
          totals: [{ paymentMethod: emptyMethod.code, netAmount: 50000 }],
        },
        emptySupervisorToken,
        emptyStore.id,
      ).expect(409);

      // ...y el turno no solapado del mismo día se carga igual.
      const evening = await importMrComanda(
        {
          periodStart: `${DAY}T16:00:00-03:00`,
          periodEnd: `${DAY}T18:00:00-03:00`,
          totals: [{ paymentMethod: emptyMethod.code, netAmount: 50000 }],
        },
        emptySupervisorToken,
        emptyStore.id,
      ).expect(201);
      expect((evening.body as MrComandaSalesResponse).created).toBe(true);

      // Concurrencia ingreso vs cierre: con el mismo bloqueo de la fila del
      // local nunca queda una venta huérfana. Si el ingreso gana, el cierre
      // lo concilia; si el cierre gana, el ingreso se rechaza.
      const raceStore = await prisma.store.create({
        data: {
          name: `Subway CarreraIngresoCierre ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle de carrera 654',
        },
      });
      const raceSupervisor = await prisma.user.create({
        data: {
          email: `carrera-${randomUUID()}@carrera-ingreso-cierre-test.invalid`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Supervisor',
          lastName: 'Carrera',
          roleId: supervisorRole.id,
          storeId: raceStore.id,
        },
      });
      const raceSupervisorToken = await tokenFor(
        raceSupervisor.id,
        ROLE.SUPERVISOR,
        raceStore.id,
      );
      const raceMethod = await prisma.paymentMethod.create({
        data: {
          code: `RACE_SALE_${suffix}`,
          name: 'Venta carrera',
          sortOrder: 70,
          behavior: 'RECONCILABLE_CARD',
          availableForTips: true,
        },
      });
      const [importResponse, closingResponse] = await Promise.all([
        importMrComanda(
          {
            periodStart: `${DAY}T10:00:00-03:00`,
            periodEnd: `${DAY}T12:00:00-03:00`,
            totals: [{ paymentMethod: raceMethod.code, netAmount: 50000 }],
          },
          raceSupervisorToken,
          raceStore.id,
        ),
        closeEmptyShift(raceStore.id, raceSupervisorToken, 1),
      ]);
      const closingBody = closingResponse.body as {
        id: string;
        salesCount: number;
      };
      if (importResponse.status === 201) {
        // El ingreso se confirmó primero: el cierre lo vio y lo concilió.
        expect((importResponse.body as MrComandaSalesResponse).created).toBe(
          true,
        );
        expect(closingResponse.status).toBe(201);
        expect(closingBody.salesCount).toBe(1);
      } else {
        // El cierre se confirmó primero: el ingreso solapado se rechaza y
        // el cierre queda sin ventas (ninguna huérfana).
        expect(importResponse.status).toBe(409);
        expect(closingResponse.status).toBe(201);
        expect(closingBody.salesCount).toBe(0);
      }
      // Estado final consistente: ninguna venta del período queda sin el
      // cierre que la siguió, ni dentro del cierre que la precedió.
      const raceSales = await prisma.sale.findMany({
        where: { storeId: raceStore.id, source: 'MRCOMANDA' },
        select: { cashClosingId: true },
      });
      if (importResponse.status === 201) {
        expect(raceSales).toHaveLength(1);
        expect(raceSales[0].cashClosingId).toBe(closingBody.id);
      } else {
        expect(raceSales).toHaveLength(0);
      }
    });
  },
);
