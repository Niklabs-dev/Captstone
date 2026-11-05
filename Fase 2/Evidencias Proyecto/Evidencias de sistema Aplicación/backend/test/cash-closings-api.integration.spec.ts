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
  PaymentMethodBehavior,
  Prisma,
  PrismaClient,
  SaleSource,
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

interface CountedLine {
  paymentMethod: string;
  countedAmount: number;
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
  methodIdByCode: Map<string, string>;
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

const METHODS = [
  {
    code: 'CASH',
    name: 'Efectivo',
    sortOrder: 1,
    behavior: PaymentMethodBehavior.CASH,
    isActive: true,
  },
  {
    code: 'DEBIT_CARD',
    name: 'Tarjeta de débito',
    sortOrder: 2,
    behavior: PaymentMethodBehavior.RECONCILABLE_CARD,
    isActive: true,
  },
  {
    code: 'CREDIT_CARD',
    name: 'Tarjeta de crédito',
    sortOrder: 3,
    behavior: PaymentMethodBehavior.RECONCILABLE_CARD,
    isActive: true,
  },
  {
    code: 'TRANSFER',
    name: 'Transferencia',
    sortOrder: 4,
    behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
    isActive: true,
  },
  {
    code: 'JUNEB',
    name: 'Junaeb',
    sortOrder: 5,
    behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
    isActive: false,
  },
  {
    code: 'MERCADO_PAGO',
    name: 'Mercado Pago',
    sortOrder: 6,
    behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
    isActive: false,
  },
] as const;

async function upsertPaymentMethods(tx: Tx): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const method of METHODS) {
    // Se fijan los atributos del escenario para que el orden y el estado no
    // dependan de filas sembradas por la migración u otros casos.
    const record = await tx.paymentMethod.upsert({
      where: { code: method.code },
      update: { ...method, availableForTips: true },
      create: { ...method, availableForTips: true },
    });
    ids.set(method.code, record.id);
  }
  return ids;
}

/// Líneas contadas para todos los medios activos del catálogo (0 por
/// defecto), tolerando medios extra que otros escenarios dejen activos.
/// Antes de leer se desactivan dentro de la transacción los medios ajenos al
/// escenario: el catálogo es global y otros archivos que corren en paralelo
/// activan/desactivan/eliminan medios con prefijos propios (PM_*,
/// TIPSTEST_*, SALE_*...), y el payload y el servicio deben ver el mismo
/// conjunto requerido aunque READ COMMITTed no lo garantice entre dos
/// consultas (todo se revierte al terminar el test).
async function countedForActive(
  f: Fixture,
  amounts: Record<string, number>,
  extra: CountedLine[] = [],
): Promise<CountedLine[]> {
  await f.tx.paymentMethod.updateMany({
    where: { isActive: true, code: { notIn: METHODS.map((m) => m.code) } },
    data: { isActive: false },
  });
  const active = await f.tx.paymentMethod.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return [
    ...active.map((method) => ({
      paymentMethod: method.code,
      countedAmount: amounts[method.code] ?? 0,
    })),
    ...extra,
  ];
}

function baseVouchers(): Record<string, unknown>[] {
  return [
    {
      source: 'MRCOMANDA',
      periodStart: START,
      periodEnd: END,
      amount: 511730,
      tipIncludedAmount: 0,
      reference: 'T. DÉBITO',
      paymentMethod: 'DEBIT_CARD',
    },
    {
      source: 'MRCOMANDA',
      periodStart: START,
      periodEnd: END,
      amount: 43800,
      tipIncludedAmount: 0,
      reference: 'T. CRÉDITO',
      paymentMethod: 'CREDIT_CARD',
    },
    {
      source: 'MERCADO_PAGO',
      periodStart: START,
      periodEnd: END,
      amount: 588732,
      tipIncludedAmount: 31602,
      reference: 'RESUMEN DE VENTAS Y PROPINAS',
    },
  ];
}

async function basePayload(f: Fixture): Promise<Record<string, unknown>> {
  return {
    storeId: f.storeId,
    businessDate: BUSINESS_DATE,
    shift: 1,
    openingCash: 50000,
    lines: await countedForActive(f, {
      CASH: 149000,
      DEBIT_CARD: 511730,
      CREDIT_CARD: 43800,
      TRANSFER: 20000,
    }),
    vouchers: baseVouchers(),
    differenceReason: 'Faltante de efectivo y descuadre de conciliación',
    notes: 'Datos ficticios de aceptación',
  };
}

async function zeroPayload(f: Fixture): Promise<Record<string, unknown>> {
  return {
    storeId: f.storeId,
    businessDate: BUSINESS_DATE,
    shift: 1,
    openingCash: 0,
    lines: await countedForActive(f, {}),
    vouchers: [
      {
        source: 'MRCOMANDA',
        periodStart: START,
        periodEnd: END,
        amount: 0,
        paymentMethod: 'DEBIT_CARD',
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

    // Envía el POST y, cuando el único problema es que el catálogo compartido
    // cambió entre el armado del payload y la lectura que hace el servicio
    // (otros archivos de test activan, desactivan o eliminan medios en
    // paralelo y la vista de READ COMMITTED no se congela entre ambas
    // consultas), reconstruye el payload y reintenta una sola vez. Cualquier
    // otro resultado se devuelve tal cual.
    async function postClosing(
      build: () => Promise<Record<string, unknown>>,
      user: AuthUser | null,
    ): Promise<request.Response> {
      let response = await post(await build(), user);
      if (response.status === 400) {
        const message = JSON.stringify(response.body);
        if (
          message.includes('Debes informar lo contado para todos los medios') ||
          message.includes('no existe en el catálogo')
        ) {
          response = await post(await build(), user);
        }
      }
      return response;
    }

    function get(id: string, user: AuthUser | null) {
      const req = request(app.getHttpServer()).get(`/cash-closings/${id}`);
      if (user) req.set('Authorization', `Bearer ${token(user)}`);
      return req;
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      const methodIdByCode = await upsertPaymentMethods(tx);
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
        methodIdByCode,
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
        { code: 'CASH', grossAmount: 100000, tipAmount: 0 },
        { code: 'DEBIT_CARD', grossAmount: 521730, tipAmount: 10000 },
        { code: 'CREDIT_CARD', grossAmount: 53800, tipAmount: 10000 },
        { code: 'TRANSFER', grossAmount: 20000, tipAmount: 0 },
      ];
      await f.tx.sale.createMany({
        data: sales.map((sale) => ({
          soldAt: new Date('2026-03-10T12:00:00-03:00'),
          paymentMethodId: f.methodIdByCode.get(sale.code) as string,
          grossAmount: sale.grossAmount,
          tipAmount: sale.tipAmount,
          storeId: f.storeId,
          registeredById: f.supervisor.id,
        })),
      });
      await f.tx.sale.create({
        data: {
          soldAt: new Date('2026-03-10T18:00:00-03:00'),
          paymentMethodId: f.methodIdByCode.get('CASH') as string,
          grossAmount: 999999,
          storeId: f.storeId,
          registeredById: f.supervisor.id,
        },
      });
      await f.tx.sale.create({
        data: {
          soldAt: new Date('2026-03-10T12:00:00-03:00'),
          paymentMethodId: f.methodIdByCode.get('CASH') as string,
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
          paymentMethodId: f.methodIdByCode.get('DEBIT_CARD') as string,
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
        const response = await postClosing(
          async () => ({
            ...(await basePayload(f)),
            tipEntryIds: [tipEntry.id],
          }),
          f.supervisor,
        );
        expect(response.status).toBe(201);
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
          hasDifferences: true,
          isBalanced: false,
          balanceStatus: 'NO_CUADRADO',
        });
        expect(closing.store.id).toBe(f.storeId);
        expect(closing.responsible).toEqual({
          id: f.supervisor.id,
          name: 'SUPERVISOR Cierre',
        });
        expect(closing.closedBy?.id).toBe(f.supervisor.id);
        expect(closing.closedAt).toEqual(expect.any(String));
        // Las líneas siguen el orden del catálogo aunque existan medios extra.
        const codes = closing.lines.map((line) => line.paymentMethod);
        const positions = ['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER'].map(
          (code) => codes.indexOf(code),
        );
        expect(positions.every((position) => position >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(
          closing.lines.find((line) => line.paymentMethod === 'CASH'),
        ).toMatchObject({
          paymentMethodName: 'Efectivo',
          expectedAmount: 150000,
          countedAmount: 149000,
          difference: -1000,
        });
        expect(
          closing.lines.find((line) => line.paymentMethod === 'DEBIT_CARD'),
        ).toMatchObject({
          paymentMethodName: 'Tarjeta de débito',
          expectedAmount: 511730,
          difference: 0,
        });
        expect(closing.tipEntries).toEqual([
          {
            id: tipEntry.id,
            paymentMethod: 'DEBIT_CARD',
            paymentMethodName: 'Tarjeta de débito',
            amount: 31602,
          },
        ]);
        expect(
          closing.vouchers.find((voucher) => voucher.reference === 'T. DÉBITO'),
        ).toMatchObject({
          paymentMethod: 'DEBIT_CARD',
          paymentMethodName: 'Tarjeta de débito',
        });

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
        expect(storedVouchers[0].paymentMethodId).toBe(
          f.methodIdByCode.get('CREDIT_CARD'),
        );

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
        expect(found.balanceStatus).toBe('NO_CUADRADO');
      });
    });

    it('resuelve el reintento idéntico de un cierre pre-T32 sin clasificación de vouchers', async () => {
      await withinRollback(async (f) => {
        // Cierre histórico (pre-T32): sus vouchers MrComanda no tienen medio
        // de pago (NULL) y no hay forma de crearlos así por la API actual,
        // así que se inserta como quedó en su momento: totales y líneas en
        // cero, sin diferencias.
        const historical = await f.tx.cashClosing.create({
          data: {
            storeId: f.storeId,
            businessDate: day(BUSINESS_DATE),
            shift: 7,
            openingCash: 0,
            status: 'OPEN',
            responsibleId: f.supervisor.id,
            lines: {
              create: {
                paymentMethodId: f.methodIdByCode.get('CASH') as string,
                expectedAmount: 0,
                countedAmount: 0,
                difference: 0,
              },
            },
            vouchers: {
              create: [
                {
                  source: 'MRCOMANDA',
                  periodStart: new Date(START),
                  periodEnd: new Date(END),
                  amount: 0,
                  tipIncludedAmount: 0,
                },
                {
                  source: 'MERCADO_PAGO',
                  periodStart: new Date(START),
                  periodEnd: new Date(END),
                  amount: 0,
                  tipIncludedAmount: 0,
                },
              ],
            },
          },
        });
        await f.tx.cashClosing.update({
          where: { id: historical.id },
          data: {
            status: 'CLOSED',
            closedAt: new Date('2026-03-10T22:00:00.000Z'),
            closedById: f.supervisor.id,
          },
        });

        // El mismo cierre reenviado como se hacía antes de SPRINT-4-T32: los
        // vouchers MrComanda no traen medio de pago. El duplicado natural se
        // resuelve antes de exigir la clasificación nueva, así que recibe el
        // existente (200) y no un 400 por la regla actual. La clave de
        // comparación trata undefined y null por igual.
        const legacyRetry = await postClosing(
          () =>
            Promise.resolve({
              storeId: f.storeId,
              businessDate: BUSINESS_DATE,
              shift: 7,
              openingCash: 0,
              lines: [{ paymentMethod: 'CASH', countedAmount: 0 }],
              vouchers: [
                {
                  source: 'MRCOMANDA',
                  periodStart: START,
                  periodEnd: END,
                  amount: 0,
                  tipIncludedAmount: 0,
                },
                {
                  source: 'MERCADO_PAGO',
                  periodStart: START,
                  periodEnd: END,
                  amount: 0,
                  tipIncludedAmount: 0,
                },
              ],
            }),
          f.supervisor,
        );
        expect(legacyRetry.status).toBe(200);
        const retried = legacyRetry.body as CashClosingResponse;
        expect(retried.id).toBe(historical.id);

        // Solo una fila y una auditoría: el reintento no duplica nada.
        expect(
          await f.tx.cashClosing.count({ where: { storeId: f.storeId } }),
        ).toBe(1);
        const audits = await f.tx.auditLog.findMany({
          where: { entityType: 'cash_closings', entityId: historical.id },
        });
        expect(audits).toHaveLength(0);
      });
    });

    it('aplica JWT, rol y aislamiento por local en escritura y lectura', async () => {
      await withinRollback(async (f) => {
        expect(
          (await postClosing(async () => await zeroPayload(f), null)).status,
        ).toBe(401);
        for (const user of [f.admin, f.accountant, f.worker]) {
          expect(
            (await postClosing(async () => await zeroPayload(f), user)).status,
          ).toBe(403);
        }
        expect(
          (
            await postClosing(
              async () => await zeroPayload(f),
              f.otherSupervisor,
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await postClosing(
              async () => ({
                ...(await zeroPayload(f)),
                responsibleId: f.admin.id,
              }),
              f.supervisor,
            )
          ).status,
        ).toBe(400);

        const createdResponse = await postClosing(
          async () => await zeroPayload(f),
          f.supervisor,
        );
        expect(createdResponse.status).toBe(201);
        const created = createdResponse.body as CashClosingResponse;
        expect(created.status).toBe('CLOSED');
        expect(created.differenceReason).toBeNull();
        expect(created.tipFundAmount).toBe(0);
        expect(created.hasDifferences).toBe(false);
        expect(created.isBalanced).toBe(true);
        expect(created.balanceStatus).toBe('CUADRADO');
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
        const response = await postClosing(async () => {
          const payload = await basePayload(f);
          delete payload.differenceReason;
          return payload;
        }, f.supervisor);
        expect(response.status).toBe(400);
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

        const blankReason = await postClosing(
          async () => ({ ...(await basePayload(f)), differenceReason: '   ' }),
          f.supervisor,
        );
        expect(blankReason.status).toBe(400);
        expect(JSON.stringify(blankReason.body)).toContain(
          'differenceReason no puede estar vacío',
        );
      });
    });

    it('rechaza cortes distintos o fuera del día de negocio chileno', async () => {
      await withinRollback(async (f) => {
        const response = await postClosing(async () => {
          const payload = await basePayload(f);
          const vouchers = payload.vouchers as Record<string, unknown>[];
          vouchers[2].periodEnd = '2026-03-10T17:00:00-03:00';
          return payload;
        }, f.supervisor);
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain(
          'mismo período de corte',
        );

        const wrongDay = await postClosing(async () => {
          const payload = await basePayload(f);
          for (const voucher of payload.vouchers as Record<string, unknown>[]) {
            voucher.periodStart = '2026-03-11T08:00:00-03:00';
            voucher.periodEnd = '2026-03-11T16:00:00-03:00';
          }
          return payload;
        }, f.supervisor);
        expect(wrongDay.status).toBe(400);
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
        const overrides: Record<string, unknown>[] = [
          {},
          { tipEntryIds: [MISSING_ID] },
          { tipEntryIds: [otherStoreTip.id] },
          { tipEntryIds: [otherDayTip.id] },
          { tipEntryIds: [tipEntry.id, tipEntry.id] },
        ];
        for (const override of overrides) {
          // El payload se reconstruye en cada intento: si el catálogo
          // compartido cambió entre el armado y la lectura del servicio,
          // postClosing lo vuelve a armar y reenvía.
          const response = await postClosing(
            async () => ({ ...(await basePayload(f)), ...override }),
            f.supervisor,
          );
          expect(response.status).toBe(400);
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
        const createdResponse = await postClosing(
          async () => ({
            ...(await basePayload(f)),
            tipEntryIds: [tipEntry.id],
          }),
          f.supervisor,
        );
        expect(createdResponse.status).toBe(201);
        const created = createdResponse.body as CashClosingResponse;
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
        await seedSales(f);
        // Cada intento es una función del payload: así el reintento de
        // postClosing reconstruye el cuerpo desde el catálogo vigente en la
        // transacción en vez de reenviar una copia ya armada.
        const attempts: ((
          base: Record<string, unknown>,
          lines: CountedLine[],
        ) => Record<string, unknown>)[] = [
          (base, lines) => ({ ...base, lines: lines.slice(1) }),
          (base, lines) => ({ ...base, lines: [...lines, lines[0]] }),
          (base) => ({ ...base, openingCash: -1 }),
          (base) => ({ ...base, shift: 0 }),
          (base) => ({ ...base, businessDate: '2026-02-30' }),
          (base, lines) => ({
            ...base,
            lines: lines.map((line, index) =>
              index === 0 ? { ...line, countedAmount: 149000.5 } : line,
            ),
          }),
          (base) => ({ ...base, status: 'OPEN' }),
          (base) => ({ ...base, totalDifference: 0 }),
          (base, lines) => ({
            ...base,
            lines: [...lines, { paymentMethod: 'JUNEB', countedAmount: 0 }],
          }),
          (base, lines) => ({
            ...base,
            lines: [
              ...lines,
              { paymentMethod: 'OTRO_MEDIO', countedAmount: 0 },
            ],
          }),
        ];
        for (const attempt of attempts) {
          expect(
            (
              await postClosing(async () => {
                const payload = await basePayload(f);
                const lines = payload.lines as CountedLine[];
                return attempt(payload, lines);
              }, f.supervisor)
            ).status,
          ).toBe(400);
        }
        expect(
          (
            await postClosing(async () => {
              const payload = await basePayload(f);
              const vouchers = payload.vouchers as Record<string, unknown>[];
              vouchers[2].tipIncludedAmount = 588733;
              return payload;
            }, f.supervisor)
          ).status,
        ).toBe(400);
        expect(
          await f.tx.cashClosing.count({ where: { storeId: f.storeId } }),
        ).toBe(0);
      });
    });

    it('exige medio de pago en los vouchers MrComanda nuevos', async () => {
      await withinRollback(async (f) => {
        const response = await postClosing(async () => {
          const payload = await basePayload(f);
          const vouchers = payload.vouchers as Record<string, unknown>[];
          delete vouchers[0].paymentMethod;
          return payload;
        }, f.supervisor);
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain(
          'deben indicar su medio de pago',
        );
        expect(
          await f.tx.cashClosing.count({ where: { storeId: f.storeId } }),
        ).toBe(0);

        const unknown = await postClosing(async () => {
          const payload = await basePayload(f);
          const unknownVouchers = payload.vouchers as Record<string, unknown>[];
          unknownVouchers[0].paymentMethod = 'NO_EXISTE';
          return payload;
        }, f.supervisor);
        expect(unknown.status).toBe(400);
        expect(JSON.stringify(unknown.body)).toContain(
          'no existe en el catálogo',
        );
      });
    });

    it('rechaza un fondo positivo si no hay una línea de efectivo', async () => {
      await withinRollback(async (f) => {
        await f.tx.paymentMethod.update({
          where: { id: f.methodIdByCode.get('CASH') as string },
          data: { isActive: false },
        });

        const response = await postClosing(
          async () => await basePayload(f),
          f.supervisor,
        );
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain(
          'fondo de caja sin una línea de efectivo',
        );
        expect(
          await f.tx.cashClosing.count({ where: { storeId: f.storeId } }),
        ).toBe(0);
      });
    });

    it('exige línea de un medio inactivo con ventas y ordena por el catálogo', async () => {
      await withinRollback(async (f) => {
        await f.tx.sale.create({
          data: {
            soldAt: new Date('2026-03-10T12:00:00-03:00'),
            paymentMethodId: f.methodIdByCode.get('JUNEB') as string,
            grossAmount: 20000,
            storeId: f.storeId,
            registeredById: f.supervisor.id,
          },
        });
        const response = await postClosing(
          async () => await zeroPayload(f),
          f.supervisor,
        );
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('todos los medios');

        const createdResponse = await postClosing(
          async () => ({
            ...(await zeroPayload(f)),
            lines: await countedForActive(f, {}, [
              { paymentMethod: 'JUNEB', countedAmount: 20000 },
            ]),
          }),
          f.supervisor,
        );
        expect(createdResponse.status).toBe(201);
        const created = createdResponse.body as CashClosingResponse;
        const codes = created.lines.map((line) => line.paymentMethod);
        const positions = ['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER'].map(
          (code) => codes.indexOf(code),
        );
        expect(positions.every((position) => position >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(codes.indexOf('JUNEB')).toBeGreaterThan(Math.max(...positions));
        expect(
          created.lines.find((line) => line.paymentMethod === 'JUNEB'),
        ).toMatchObject({
          paymentMethodName: 'Junaeb',
          expectedAmount: 20000,
          countedAmount: 20000,
          difference: 0,
        });
        expect(created.balanceStatus).toBe('CUADRADO');
      });
    });

    it('conserva Junaeb y la línea Mercado Pago de MrComanda sin doble conteo', async () => {
      await withinRollback(async (f) => {
        const tipEntry = await seedTipEntry(f);
        const vouchers = [
          ...baseVouchers().slice(0, 2),
          {
            source: 'MRCOMANDA',
            periodStart: START,
            periodEnd: END,
            amount: 20000,
            tipIncludedAmount: 0,
            reference: 'JUNEB',
            paymentMethod: 'JUNEB',
          },
          {
            source: 'MRCOMANDA',
            periodStart: START,
            periodEnd: END,
            amount: 557130,
            tipIncludedAmount: 0,
            reference: 'MERCADO PAGO',
            paymentMethod: 'MERCADO_PAGO',
          },
          baseVouchers()[2],
        ];
        const createdResponse = await postClosing(
          async () => ({
            ...(await zeroPayload(f)),
            vouchers,
            tipEntryIds: [tipEntry.id],
            differenceReason: 'Diferencia de conciliación respaldada',
          }),
          f.supervisor,
        );
        expect(createdResponse.status).toBe(201);
        const created = createdResponse.body as CashClosingResponse;

        // Solo las tarjetas conciliables entran a la conciliación; Junaeb y la
        // línea Mercado Pago del reporte MrComanda se conservan como respaldo.
        expect(created.mrcomandaNetSales).toBe(555530);
        expect(created.mercadoPagoNetSales).toBe(557130);
        expect(created.reconciliationDifference).toBe(1600);
        expect(created.hasDifferences).toBe(true);
        expect(created.balanceStatus).toBe('NO_CUADRADO');
        expect(created.vouchers).toHaveLength(5);
        expect(
          created.vouchers.find((voucher) => voucher.paymentMethod === 'JUNEB'),
        ).toMatchObject({ paymentMethodName: 'Junaeb', amount: 20000 });
        expect(
          created.vouchers.find(
            (voucher) => voucher.paymentMethod === 'MERCADO_PAGO',
          ),
        ).toMatchObject({ paymentMethodName: 'Mercado Pago', amount: 557130 });

        const stored = await f.tx.cashClosingVoucher.findMany({
          where: { closingId: created.id },
        });
        expect(stored).toHaveLength(5);
        // Las líneas MrComanda quedan clasificadas; la liquidación Mercado
        // Pago se conserva sin clasificar, como los vouchers históricos.
        expect(stored.map((voucher) => voucher.paymentMethodId).sort()).toEqual(
          [
            f.methodIdByCode.get('CREDIT_CARD'),
            f.methodIdByCode.get('DEBIT_CARD'),
            f.methodIdByCode.get('JUNEB'),
            f.methodIdByCode.get('MERCADO_PAGO'),
            null,
          ].sort(),
        );
      });
    });

    it('rechaza ventas agregadas parcialmente fuera del corte', async () => {
      await withinRollback(async (f) => {
        await f.tx.sale.create({
          data: {
            soldAt: new Date('2026-03-10T12:00:00-03:00'),
            source: SaleSource.MRCOMANDA,
            periodStart: new Date('2026-03-10T07:00:00-03:00'),
            periodEnd: new Date('2026-03-10T15:00:00-03:00'),
            paymentMethodId: f.methodIdByCode.get('DEBIT_CARD') as string,
            grossAmount: 10000,
            storeId: f.storeId,
            registeredById: f.supervisor.id,
          },
        });
        const response = await postClosing(
          async () => ({
            ...(await zeroPayload(f)),
            lines: await countedForActive(f, { DEBIT_CARD: 10000 }),
          }),
          f.supervisor,
        );
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain(
          'parcialmente fuera del corte',
        );
        expect(
          await f.tx.cashClosing.count({ where: { storeId: f.storeId } }),
        ).toBe(0);
        expect(
          await f.tx.sale.count({
            where: { storeId: f.storeId, cashClosingId: { not: null } },
          }),
        ).toBe(0);
      });
    });

    it('marca No cuadrado ante la compensación −500/+500 aunque el total cuadre', async () => {
      await withinRollback(async (f) => {
        await f.tx.sale.createMany({
          data: [
            {
              soldAt: new Date('2026-03-10T12:00:00-03:00'),
              paymentMethodId: f.methodIdByCode.get('CASH') as string,
              grossAmount: 100000,
              storeId: f.storeId,
              registeredById: f.supervisor.id,
            },
            {
              soldAt: new Date('2026-03-10T12:30:00-03:00'),
              paymentMethodId: f.methodIdByCode.get('DEBIT_CARD') as string,
              grossAmount: 521730,
              storeId: f.storeId,
              registeredById: f.supervisor.id,
            },
          ],
        });
        const createdResponse = await postClosing(
          async () => ({
            storeId: f.storeId,
            businessDate: BUSINESS_DATE,
            shift: 1,
            openingCash: 0,
            lines: await countedForActive(f, {
              CASH: 99500,
              DEBIT_CARD: 522230,
            }),
            vouchers: [
              {
                source: 'MRCOMANDA',
                periodStart: START,
                periodEnd: END,
                amount: 521730,
                paymentMethod: 'DEBIT_CARD',
              },
              {
                source: 'MERCADO_PAGO',
                periodStart: START,
                periodEnd: END,
                amount: 521730,
              },
            ],
            differenceReason: 'Compensación de vuelto entre medios',
          }),
          f.supervisor,
        );
        expect(createdResponse.status).toBe(201);
        const created = createdResponse.body as CashClosingResponse;

        expect(created.totalDifference).toBe(0);
        expect(created.reconciliationDifference).toBe(0);
        expect(
          created.lines.find((line) => line.paymentMethod === 'CASH'),
        ).toMatchObject({ difference: -500 });
        expect(
          created.lines.find((line) => line.paymentMethod === 'DEBIT_CARD'),
        ).toMatchObject({ difference: 500 });
        expect(created.hasDifferences).toBe(true);
        expect(created.isBalanced).toBe(false);
        expect(created.balanceStatus).toBe('NO_CUADRADO');
      });
    });
  },
);
