import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import type { CashClosingResponse } from '../src/cash-closings/types/cash-closings.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ensureDefaultPaymentMethods } from './helpers/payment-methods.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración HTTP de la consulta histórica de cierres de caja
// (SPRINT-4-T09). Desde SPRINT-4R-T01 la confirmación de cierres (POST) se
// retiró: la operación diaria reemplaza el flujo. Estos tests cubren la
// lectura del histórico conservado y documentan la desactivación de la
// escritura. Todo corre dentro de withinRollback: la base se revierte.
const databaseUrl = process.env.TEST_DATABASE_URL;

const BUSINESS_DATE = '2026-03-10';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  storeId: string;
  otherStoreId: string;
  closingId: string;
  supervisor: AuthUser;
  otherSupervisor: AuthUser;
  admin: AuthUser;
  accountant: AuthUser;
  worker: AuthUser;
}

describe.skipIf(!databaseUrl)(
  'API de consulta histórica de cierres de caja (SPRINT-4-T09, lectura SPRINT-4R-T01)',
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

    function get(id: string, user: AuthUser | null) {
      const req = request(app.getHttpServer()).get(`/cash-closings/${id}`);
      if (user) req.set('Authorization', `Bearer ${token(user)}`);
      return req;
    }

    function post(user: AuthUser | null, body: object) {
      const req = request(app.getHttpServer()).post('/cash-closings');
      if (user) req.set('Authorization', `Bearer ${token(user)}`);
      return req.send(body);
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
      const email = `${id}@cash-closings-read-test.invalid`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: role,
          lastName: 'Cierre',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return { id, email, role, storeId };
    }

    // Crea en la transacción el mismo grafo que registraba la API cuando el
    // flujo estaba vigente: cierre OPEN con su línea, voucher y venta
    // vinculada, y cierre del ciclo (CLOSED con responsable y fecha). Sirve
    // de fixture para la lectura histórica.
    async function createClosedClosing(
      tx: Tx,
      storeId: string,
      supervisorId: string,
    ): Promise<string> {
      const cashMethod = await tx.paymentMethod.findUniqueOrThrow({
        where: { code: 'CASH' },
      });
      const sale = await tx.sale.create({
        data: {
          soldAt: new Date('2026-03-10T12:00:00-03:00'),
          paymentMethodId: cashMethod.id,
          grossAmount: 100000,
          tipAmount: 0,
          storeId,
          registeredById: supervisorId,
        },
      });
      const closing = await tx.cashClosing.create({
        data: {
          storeId,
          businessDate: new Date(`${BUSINESS_DATE}T00:00:00.000Z`),
          shift: 1,
          openingCash: 50000,
          status: 'OPEN',
          responsibleId: supervisorId,
          mrcomandaNetSales: 0,
          mercadoPagoGrossAmount: 0,
          mercadoPagoTipAmount: 0,
          reconciliationDifference: 0,
        },
      });
      await tx.cashClosingLine.create({
        data: {
          closingId: closing.id,
          paymentMethodId: cashMethod.id,
          expectedAmount: 150000,
          countedAmount: 150000,
          difference: 0,
        },
      });
      await tx.cashClosingVoucher.create({
        data: {
          closingId: closing.id,
          source: 'MERCADO_PAGO',
          periodStart: new Date('2026-03-10T08:00:00-03:00'),
          periodEnd: new Date('2026-03-10T16:00:00-03:00'),
          amount: 0,
          tipIncludedAmount: 0,
        },
      });
      await tx.sale.update({
        where: { id: sale.id },
        data: { cashClosingId: closing.id },
      });
      await tx.cashClosing.update({
        where: { id: closing.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date('2026-03-10T16:05:00-03:00'),
          closedById: supervisorId,
        },
      });
      return closing.id;
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      await ensureDefaultPaymentMethods(tx);
      const store = await tx.store.create({
        data: {
          name: `Subway Cierre Lectura ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      const otherStore = await tx.store.create({
        data: {
          name: `Subway Cierre Lectura Otro ${randomUUID()}`,
          city: 'Calera',
          address: 'Calle sintética 456',
        },
      });
      const supervisor = await createUser(tx, ROLE.SUPERVISOR, store.id);
      return {
        tx,
        storeId: store.id,
        otherStoreId: otherStore.id,
        closingId: await createClosedClosing(tx, store.id, supervisor.id),
        supervisor,
        otherSupervisor: await createUser(tx, ROLE.SUPERVISOR, otherStore.id),
        admin: await createUser(tx, ROLE.ADMINISTRADOR, null),
        accountant: await createUser(tx, ROLE.CONTADOR, null),
        worker: await createUser(tx, ROLE.TRABAJADOR, store.id),
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

    it('consulta el detalle inmutable del cierre histórico por su ID', async () => {
      await withinRollback(async (f) => {
        const response = await get(f.closingId, f.supervisor).expect(200);
        const body = response.body as CashClosingResponse;
        expect(body).toMatchObject({
          id: f.closingId,
          businessDate: BUSINESS_DATE,
          shift: 1,
          openingCash: 50000,
          status: 'CLOSED',
          store: { id: f.storeId },
          responsible: { id: f.supervisor.id },
          salesCount: 1,
          totalExpectedAmount: 150000,
          totalCountedAmount: 150000,
          totalDifference: 0,
          isBalanced: true,
          balanceStatus: 'CUADRADO',
        });
        expect(body.lines).toEqual([
          expect.objectContaining({
            paymentMethod: 'CASH',
            expectedAmount: 150000,
            countedAmount: 150000,
            difference: 0,
          }),
        ]);
        expect(body.vouchers).toHaveLength(1);
        expect(body.vouchers[0]).toMatchObject({
          source: 'MERCADO_PAGO',
          amount: 0,
        });
        expect(body.closedBy).toMatchObject({ id: f.supervisor.id });
        expect(body.closedAt).toBeDefined();
      });
    });

    it('aplica JWT, rol y aislamiento por local en la lectura', async () => {
      await withinRollback(async (f) => {
        await get(f.closingId, null).expect(401);
        await get(f.closingId, f.worker).expect(403);
        await get(f.closingId, f.otherSupervisor).expect(403);
        await get(f.closingId, f.admin).expect(200);
        await get(f.closingId, f.accountant).expect(200);
        await get(MISSING_ID, f.supervisor).expect(404);
        await get('no-es-uuid', f.supervisor).expect(400);
      });
    });

    it('retiró la confirmación de cierres sin borrar el histórico', async () => {
      await withinRollback(async (f) => {
        const response = await post(f.supervisor, {
          storeId: f.storeId,
          businessDate: BUSINESS_DATE,
          shift: 1,
          openingCash: 0,
          lines: [],
          vouchers: [],
        }).expect(404);

        // El cierre ya registrado sigue intacto y consultable.
        await get(f.closingId, f.supervisor).expect(200);
        const count = await f.tx.cashClosing.count({
          where: { storeId: f.storeId },
        });
        expect(count).toBe(1);
        expect(response.body).toMatchObject({ statusCode: 404 });
      });
    });
  },
);
