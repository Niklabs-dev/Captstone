import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import {
  PaymentMethod,
  Prisma,
  PrismaClient,
} from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { CashClosingResponse } from '../src/cash-closings/types/cash-closings.types.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

const BUSINESS_DATE = '2026-03-10';
const START = '2026-03-10T08:00:00-03:00';
const END = '2026-03-10T16:00:00-03:00';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const databaseUrl = process.env.TEST_DATABASE_URL;

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
  supervisor: AuthUser;
  otherSupervisor: AuthUser;
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
  const email = `${id}@cash-closings-api-test.invalid`;
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

function allCounted(amounts: [number, number, number, number]) {
  return [
    PaymentMethod.CASH,
    PaymentMethod.DEBIT_CARD,
    PaymentMethod.CREDIT_CARD,
    PaymentMethod.TRANSFER,
  ].map((paymentMethod, index) => ({
    paymentMethod,
    countedAmount: amounts[index],
  }));
}

function basePayload(storeId: string): Record<string, unknown> {
  return {
    storeId,
    businessDate: BUSINESS_DATE,
    shift: 1,
    openingCash: 50000,
    lines: allCounted([149000, 511730, 43800, 20000]),
    vouchers: [
      {
        source: 'MRCOMANDA',
        periodStart: START,
        periodEnd: END,
        amount: 511730,
        tipIncludedAmount: 0,
        reference: 'T. DÉBITO',
      },
      {
        source: 'MRCOMANDA',
        periodStart: START,
        periodEnd: END,
        amount: 43800,
        tipIncludedAmount: 0,
        reference: 'T. CRÉDITO',
      },
      {
        source: 'MERCADO_PAGO',
        periodStart: START,
        periodEnd: END,
        amount: 588732,
        tipIncludedAmount: 31602,
        reference: 'RESUMEN DE VENTAS Y PROPINAS',
      },
    ],
    differenceReason: 'Faltante de efectivo y descuadre de conciliación',
    notes: 'Datos ficticios de aceptación',
  };
}

function zeroPayload(storeId: string): Record<string, unknown> {
  return {
    storeId,
    businessDate: BUSINESS_DATE,
    shift: 1,
    openingCash: 0,
    lines: allCounted([0, 0, 0, 0]),
    vouchers: [
      {
        source: 'MRCOMANDA',
        periodStart: START,
        periodEnd: END,
        amount: 0,
      },
      {
        source: 'MERCADO_PAGO',
        periodStart: START,
        periodEnd: END,
        amount: 0,
      },
    ],
  };
}

describe.skipIf(!databaseUrl)(
  'API de cierres de caja (SPRINT-4-T09)',
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

    function post(body: object, user: AuthUser | null) {
      const req = request(app.getHttpServer())
        .post('/cash-closings')
        .send(body);
      if (user) req.set('Authorization', `Bearer ${token(user)}`);
      return req;
    }

    function get(id: string, user: AuthUser | null) {
      const req = request(app.getHttpServer()).get(`/cash-closings/${id}`);
      if (user) req.set('Authorization', `Bearer ${token(user)}`);
      return req;
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      const store = await tx.store.create({
        data: {
          name: `Subway Cierre API ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      const otherStore = await tx.store.create({
        data: {
          name: `Subway Cierre API Otro ${randomUUID()}`,
          city: 'Calera',
          address: 'Calle sintética 456',
        },
      });
      return {
        tx,
        storeId: store.id,
        otherStoreId: otherStore.id,
        supervisor: await createUser(tx, ROLE.SUPERVISOR, store.id),
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

    async function seedSales(f: Fixture): Promise<void> {
      const sales = [
        {
          paymentMethod: PaymentMethod.CASH,
          grossAmount: 100000,
          tipAmount: 0,
        },
        {
          paymentMethod: PaymentMethod.DEBIT_CARD,
          grossAmount: 521730,
          tipAmount: 10000,
        },
        {
          paymentMethod: PaymentMethod.CREDIT_CARD,
          grossAmount: 53800,
          tipAmount: 10000,
        },
        {
          paymentMethod: PaymentMethod.TRANSFER,
          grossAmount: 20000,
          tipAmount: 0,
        },
      ];
      await f.tx.sale.createMany({
        data: sales.map((sale) => ({
          ...sale,
          soldAt: new Date('2026-03-10T12:00:00-03:00'),
          storeId: f.storeId,
          registeredById: f.supervisor.id,
        })),
      });
      await f.tx.sale.create({
        data: {
          soldAt: new Date('2026-03-10T18:00:00-03:00'),
          paymentMethod: PaymentMethod.CASH,
          grossAmount: 999999,
          storeId: f.storeId,
          registeredById: f.supervisor.id,
        },
      });
      await f.tx.sale.create({
        data: {
          soldAt: new Date('2026-03-10T12:00:00-03:00'),
          paymentMethod: PaymentMethod.CASH,
          grossAmount: 888888,
          storeId: f.otherStoreId,
          registeredById: f.otherSupervisor.id,
        },
      });
    }

    async function seedTipEntry(
      f: Fixture,
      amount = 31602,
      storeId = f.storeId,
      businessDate = BUSINESS_DATE,
      responsibleId = f.supervisor.id,
    ) {
      return f.tx.tipEntry.create({
        data: {
          businessDate: day(businessDate),
          paymentMethod: PaymentMethod.DEBIT_CARD,
          amount,
          storeId,
          responsibleId,
        },
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
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
    });

    it('confirma, calcula, vincula y audita el caso de aceptación', async () => {
      await withinRollback(async (f) => {
        await seedSales(f);
        const tipEntry = await seedTipEntry(f);
        const response = await post(
          { ...basePayload(f.storeId), tipEntryIds: [tipEntry.id] },
          f.supervisor,
        ).expect(201);
        const closing = response.body as CashClosingResponse;

        expect(closing).toMatchObject({
          businessDate: BUSINESS_DATE,
          shift: 1,
          openingCash: 50000,
          status: 'CLOSED',
          mrcomandaNetSales: 555530,
          mercadoPagoGrossAmount: 588732,
          mercadoPagoTipAmount: 31602,
          mercadoPagoNetSales: 557130,
          reconciliationDifference: 1600,
          totalExpectedAmount: 725530,
          totalCountedAmount: 724530,
          totalDifference: -1000,
          tipFundAmount: 31602,
          salesCount: 4,
        });
        expect(closing.store.id).toBe(f.storeId);
        expect(closing.responsible).toEqual({
          id: f.supervisor.id,
          name: 'SUPERVISOR Cierre',
        });
        expect(closing.closedBy?.id).toBe(f.supervisor.id);
        expect(closing.closedAt).toEqual(expect.any(String));
        expect(closing.lines).toHaveLength(4);
        expect(
          closing.lines.find((line) => line.paymentMethod === 'CASH'),
        ).toMatchObject({
          expectedAmount: 150000,
          countedAmount: 149000,
          difference: -1000,
        });
        expect(
          closing.lines.find((line) => line.paymentMethod === 'DEBIT_CARD'),
        ).toMatchObject({ expectedAmount: 511730, difference: 0 });
        expect(closing.tipEntries).toEqual([
          { id: tipEntry.id, paymentMethod: 'DEBIT_CARD', amount: 31602 },
        ]);

        expect(
          await f.tx.sale.count({ where: { cashClosingId: closing.id } }),
        ).toBe(4);
        expect(
          await f.tx.sale.count({
            where: {
              storeId: { in: [f.storeId, f.otherStoreId] },
              cashClosingId: null,
            },
          }),
        ).toBe(2);
        expect(
          await f.tx.tipEntry.count({ where: { storeId: f.storeId } }),
        ).toBe(1);
        expect(
          await f.tx.cashClosingTipEntry.count({
            where: { closingId: closing.id, tipEntryId: tipEntry.id },
          }),
        ).toBe(1);
        const storedVouchers = await f.tx.cashClosingVoucher.findMany({
          where: { closingId: closing.id },
          orderBy: { amount: 'asc' },
        });
        expect(storedVouchers.map((voucher) => Number(voucher.amount))).toEqual(
          [43800, 511730, 588732],
        );
        expect(Number(storedVouchers[2].tipIncludedAmount)).toBe(31602);

        const audits = await f.tx.auditLog.findMany({
          where: { entityType: 'cash_closings', entityId: closing.id },
        });
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          action: AUDIT_ACTION.CASH_CLOSING_CREATED,
          userId: f.supervisor.id,
          storeId: f.storeId,
        });
        const detail = audits[0].detail as Record<string, unknown>;
        expect(Object.keys(detail).sort()).toEqual(
          [
            'businessDate',
            'closedAt',
            'differenceReason',
            'reconciliationDifference',
            'responsibleId',
            'shift',
            'storeId',
            'tipFundAmount',
            'totalDifference',
          ].sort(),
        );
        expect(detail).toMatchObject({
          storeId: f.storeId,
          responsibleId: f.supervisor.id,
          reconciliationDifference: 1600,
          tipFundAmount: 31602,
          totalDifference: -1000,
        });
        expect(JSON.stringify(detail)).not.toContain(f.supervisor.email);

        const found = (await get(closing.id, f.supervisor).expect(200))
          .body as CashClosingResponse;
        expect(found.id).toBe(closing.id);
        expect(found.reconciliationDifference).toBe(1600);
      });
    });

    it('aplica JWT, rol y aislamiento por local en escritura y lectura', async () => {
      await withinRollback(async (f) => {
        await post(zeroPayload(f.storeId), null).expect(401);
        for (const user of [f.admin, f.accountant, f.worker]) {
          await post(zeroPayload(f.storeId), user).expect(403);
        }
        await post(zeroPayload(f.storeId), f.otherSupervisor).expect(403);
        await post(
          { ...zeroPayload(f.storeId), responsibleId: f.admin.id },
          f.supervisor,
        ).expect(400);

        const created = (
          await post(zeroPayload(f.storeId), f.supervisor).expect(201)
        ).body as CashClosingResponse;
        expect(created.status).toBe('CLOSED');
        expect(created.differenceReason).toBeNull();
        expect(created.tipFundAmount).toBe(0);
        await get(created.id, null).expect(401);
        await get(created.id, f.worker).expect(403);
        await get(created.id, f.otherSupervisor).expect(403);
        await get(created.id, f.admin).expect(200);
        await get(created.id, f.accountant).expect(200);
        await get(MISSING_ID, f.supervisor).expect(404);
        await get('no-es-uuid', f.supervisor).expect(400);
      });
    });

    it('exige motivo y conserva los descuadres sin forzarlos', async () => {
      await withinRollback(async (f) => {
        await seedSales(f);
        const withoutReason = basePayload(f.storeId);
        delete withoutReason.differenceReason;
        const response = await post(withoutReason, f.supervisor).expect(400);
        expect(JSON.stringify(response.body)).toContain(
          'differenceReason es obligatorio',
        );
        expect(
          await f.tx.cashClosing.count({ where: { storeId: f.storeId } }),
        ).toBe(0);
        expect(
          await f.tx.sale.count({
            where: { storeId: f.storeId, cashClosingId: { not: null } },
          }),
        ).toBe(0);

        const blankReason = await post(
          { ...basePayload(f.storeId), differenceReason: '   ' },
          f.supervisor,
        ).expect(400);
        expect(JSON.stringify(blankReason.body)).toContain(
          'differenceReason no puede estar vacío',
        );
      });
    });

    it('rechaza cortes distintos o fuera del día de negocio chileno', async () => {
      await withinRollback(async (f) => {
        const mismatched = basePayload(f.storeId);
        const vouchers = mismatched.vouchers as Record<string, unknown>[];
        vouchers[2].periodEnd = '2026-03-10T17:00:00-03:00';
        const response = await post(mismatched, f.supervisor).expect(400);
        expect(JSON.stringify(response.body)).toContain(
          'mismo período de corte',
        );

        const otherDay = basePayload(f.storeId);
        for (const voucher of otherDay.vouchers as Record<string, unknown>[]) {
          voucher.periodStart = '2026-03-11T08:00:00-03:00';
          voucher.periodEnd = '2026-03-11T16:00:00-03:00';
        }
        const wrongDay = await post(otherDay, f.supervisor).expect(400);
        expect(JSON.stringify(wrongDay.body)).toContain(
          'día de negocio en Chile',
        );
        expect(
          await f.tx.cashClosing.count({ where: { storeId: f.storeId } }),
        ).toBe(0);
      });
    });

    it('vincula solo propinas existentes del local/día y del total oficial', async () => {
      await withinRollback(async (f) => {
        const tipEntry = await seedTipEntry(f);
        const otherStoreTip = await seedTipEntry(
          f,
          31602,
          f.otherStoreId,
          BUSINESS_DATE,
          f.otherSupervisor.id,
        );
        const otherDayTip = await seedTipEntry(
          f,
          31602,
          f.storeId,
          '2026-03-11',
        );
        const attempts: Record<string, unknown>[] = [
          {},
          { tipEntryIds: [MISSING_ID] },
          { tipEntryIds: [otherStoreTip.id] },
          { tipEntryIds: [otherDayTip.id] },
          { tipEntryIds: [tipEntry.id, tipEntry.id] },
        ];
        for (const override of attempts) {
          const response = await post(
            { ...basePayload(f.storeId), ...override },
            f.supervisor,
          ).expect(400);
          expect(JSON.stringify(response.body)).toMatch(
            /propinas|tipEntryIds/i,
          );
        }
        expect(
          await f.tx.cashClosing.count({ where: { storeId: f.storeId } }),
        ).toBe(0);

        const before = await f.tx.tipEntry.findUniqueOrThrow({
          where: { id: tipEntry.id },
        });
        const created = (
          await post(
            { ...basePayload(f.storeId), tipEntryIds: [tipEntry.id] },
            f.supervisor,
          ).expect(201)
        ).body as CashClosingResponse;
        expect(created.tipFundAmount).toBe(31602);
        const after = await f.tx.tipEntry.findUniqueOrThrow({
          where: { id: tipEntry.id },
        });
        expect(after.amount).toEqual(before.amount);
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(
          await f.tx.tipEntry.count({
            where: { storeId: { in: [f.storeId, f.otherStoreId] } },
          }),
        ).toBe(3);
      });
    });

    it('valida líneas, montos, vouchers y campos calculados', async () => {
      await withinRollback(async (f) => {
        const attempts: Record<string, unknown>[] = [
          {
            ...basePayload(f.storeId),
            lines: allCounted([0, 0, 0, 0]).slice(1),
          },
          {
            ...basePayload(f.storeId),
            lines: [
              ...allCounted([149000, 511730, 43800, 20000]),
              { paymentMethod: 'CASH', countedAmount: 149000 },
            ],
          },
          { ...basePayload(f.storeId), openingCash: -1 },
          { ...basePayload(f.storeId), shift: 0 },
          { ...basePayload(f.storeId), businessDate: '2026-02-30' },
          {
            ...basePayload(f.storeId),
            lines: allCounted([149000.5, 511730, 43800, 20000]),
          },
          { ...basePayload(f.storeId), status: 'OPEN' },
          { ...basePayload(f.storeId), totalDifference: 0 },
        ];
        for (const body of attempts) {
          await post(body, f.supervisor).expect(400);
        }
        const invalidTip = basePayload(f.storeId);
        const vouchers = invalidTip.vouchers as Record<string, unknown>[];
        vouchers[2].tipIncludedAmount = 588733;
        await post(invalidTip, f.supervisor).expect(400);
        expect(
          await f.tx.cashClosing.count({ where: { storeId: f.storeId } }),
        ).toBe(0);
      });
    });
  },
);
