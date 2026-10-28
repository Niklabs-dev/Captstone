import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  seedDatabase,
  TIP_DEMO_AGREEMENT,
  TIP_DEMO_ENTRIES,
  TIP_DEMO_IDS,
  TIP_DEMO_PERIOD,
  TIP_DEMO_POOL,
  TIP_DEMO_STORE,
  TIP_DEMO_WORKER_PERIODS,
} from '../prisma/seed.js';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import {
  PaymentMethod,
  Prisma,
  PrismaClient,
} from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { StoresService } from '../src/stores/stores.service.js';
import { TipPoolsService } from '../src/tips/tip-pools.service.js';
import { TipsService } from '../src/tips/tips.service.js';
import {
  TIP_POOL_ISSUE_CODE,
  type TipPoolIssueCode,
  type TipPoolResponse,
  type TipPoolValidationErrorBody,
} from '../src/tips/types/tip-pools.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de integración del cálculo y vista previa del reparto de propinas
// (SPRINT-3-T12) contra PostgreSQL real. Se omiten si no se define
// TEST_DATABASE_URL.
//
// - El servicio se prueba dentro de withinRollback: TipPoolsService,
//   StoresService y TipsService reciben la transacción del test en lugar de
//   PrismaService, así todo lo que crean se revierte.
// - Roles, auditoría y concurrencia necesitan el pipeline HTTP completo y dos
//   conexiones reales, que no caben en una transacción: esos tests usan un
//   local propio ("Subway Tip Pools API Test") y correos
//   @tip-pools-api-test.invalid, y se eliminan al finalizar.
const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

const PERIOD = { start: '2026-10-01', end: '2026-10-15' } as const;

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

// PrismaService que ejecuta todo en la transacción del test: su $transaction
// reutiliza la misma transacción en vez de abrir otra.
function transactionAsPrismaService(
  tx: Prisma.TransactionClient,
): PrismaService {
  const proxy = new Proxy(tx, {
    get(target, property): unknown {
      if (property === '$transaction') {
        return <T>(
          callback: (client: Prisma.TransactionClient) => Promise<T>,
        ): Promise<T> => callback(tx);
      }
      return Reflect.get(target, property) as unknown;
    },
  });
  return proxy as unknown as PrismaService;
}

interface Fixture {
  tx: Prisma.TransactionClient;
  service: TipPoolsService;
  tips: TipsService;
  storeId: string;
  accountant: AuthUser;
  supervisor: AuthUser;
  workers: string[];
}

async function roleId(
  tx: Prisma.TransactionClient,
  code: RoleCode,
): Promise<string> {
  const role = await tx.role.upsert({
    where: { code },
    update: {},
    create: { code, name: code },
  });
  return role.id;
}

async function createStore(tx: Prisma.TransactionClient): Promise<string> {
  const store = await tx.store.create({
    data: {
      name: `Subway Reparto ${randomUUID()}`,
      city: 'Melipilla',
      address: 'Calle 123',
    },
  });
  return store.id;
}

async function createUser(
  tx: Prisma.TransactionClient,
  role: RoleCode,
  storeId: string | null,
  overrides: { firstName?: string; isActive?: boolean } = {},
): Promise<AuthUser> {
  const email = `${randomUUID()}@tip-pools-test.invalid`;
  const user = await tx.user.create({
    data: {
      email,
      passwordHash: '$2b$04$hash-de-prueba',
      firstName: overrides.firstName ?? role,
      lastName: 'Reparto',
      isActive: overrides.isActive ?? true,
      roleId: await roleId(tx, role),
      storeId,
    },
  });
  return { id: user.id, email, role, storeId };
}

async function createFixture(tx: Prisma.TransactionClient): Promise<Fixture> {
  const prisma = transactionAsPrismaService(tx);
  const stores = new StoresService(prisma);
  const storeId = await createStore(tx);
  const accountant = await createUser(tx, ROLE.CONTADOR, null);
  const supervisor = await createUser(tx, ROLE.SUPERVISOR, storeId);
  const workers: string[] = [];
  for (const name of ['Ana', 'Beto', 'Carla']) {
    workers.push(
      (await createUser(tx, ROLE.TRABAJADOR, storeId, { firstName: name })).id,
    );
  }
  return {
    tx,
    service: new TipPoolsService(prisma, stores),
    tips: new TipsService(prisma, stores),
    storeId,
    accountant,
    supervisor,
    workers,
  };
}

async function addAgreement(
  f: Fixture,
  validFrom = '2026-01-01',
  validTo: string | null = null,
): Promise<string> {
  const agreement = await f.tx.tipAgreement.create({
    data: {
      name: `Pacto desde ${validFrom}`,
      rule: 'PROPORTIONAL_TO_HOURS',
      validFrom: day(validFrom),
      validTo: validTo ? day(validTo) : null,
      storeId: f.storeId,
      createdById: f.supervisor.id,
    },
  });
  return agreement.id;
}

async function addEntry(
  f: Fixture,
  businessDate: string,
  paymentMethod: PaymentMethod,
  amount: number,
): Promise<string> {
  const entry = await f.tx.tipEntry.create({
    data: {
      businessDate: day(businessDate),
      paymentMethod,
      amount,
      storeId: f.storeId,
      responsibleId: f.supervisor.id,
    },
  });
  return entry.id;
}

async function addHours(
  f: Fixture,
  workerId: string,
  hoursWorked: number,
  period: { start: string; end: string } = PERIOD,
): Promise<string> {
  const record = await f.tx.workHoursRecord.create({
    data: {
      periodStart: day(period.start),
      periodEnd: day(period.end),
      hoursWorked,
      storeId: f.storeId,
      workerId,
      recordedById: f.supervisor.id,
    },
  });
  return record.id;
}

// Pacto vigente, dos registros dentro del período (12.000) y uno fuera, y
// 10/20/30 horas: el reparto esperado es 2.000/4.000/6.000.
async function seedHappyPath(f: Fixture): Promise<void> {
  await addAgreement(f);
  await addEntry(f, '2026-10-02', 'CASH', 8000);
  await addEntry(f, '2026-10-15', 'DEBIT_CARD', 4000);
  await addEntry(f, '2026-10-16', 'CASH', 99999);
  await addHours(f, f.workers[0], 10);
  await addHours(f, f.workers[1], 20);
  await addHours(f, f.workers[2], 30);
}

function preview(
  f: Fixture,
  period: { start: string; end: string } = PERIOD,
  storeId = f.storeId,
) {
  return f.service.preview(
    { storeId, periodStart: period.start, periodEnd: period.end },
    f.accountant,
  );
}

async function issueCodesOf(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    const body = (
      error as UnprocessableEntityException
    ).getResponse() as TipPoolValidationErrorBody;
    expect(body.statusCode).toBe(422);
    return body.issues.map((issue) => issue.code);
  }
  throw new Error('Se esperaba una respuesta 422');
}

async function expectIssues(
  f: Fixture,
  expected: TipPoolIssueCode[],
): Promise<void> {
  expect(await issueCodesOf(preview(f))).toEqual(expected);
  expect(await f.tx.tipPool.count({ where: { storeId: f.storeId } })).toBe(0);
}

function sumAmounts(items: { amount: number }[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

describe.skipIf(!databaseUrl)(
  'Cálculo del reparto de propinas (SPRINT-3-T12)',
  () => {
    let prisma: PrismaClient;

    beforeAll(() => {
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function withinRollback(
      fn: (f: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            await fn(await createFixture(tx));
            throw new Rollback();
          },
          { timeout: 30_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    }

    it('guarda pool, líneas y fuentes del período y concilia con el total', async () => {
      await withinRollback(async (f) => {
        await seedHappyPath(f);
        const result = await preview(f);

        expect(result.created).toBe(true);
        const pool = result.pool;
        expect(pool).toMatchObject({
          status: 'DRAFT',
          store: { id: f.storeId },
          periodStart: PERIOD.start,
          periodEnd: PERIOD.end,
          agreement: {
            rule: 'PROPORTIONAL_TO_HOURS',
            validFrom: '2026-01-01',
            validTo: null,
          },
          totalAmount: 12000,
          totalHours: '60.00',
          reconciled: true,
          calculatedBy: { id: f.accountant.id },
        });
        expect(pool.lines).toEqual(
          [
            { userId: f.workers[0], hoursWorked: '10.00', amount: 2000 },
            { userId: f.workers[1], hoursWorked: '20.00', amount: 4000 },
            { userId: f.workers[2], hoursWorked: '30.00', amount: 6000 },
          ]
            .sort((a, b) => (a.userId < b.userId ? -1 : 1))
            .map((line): unknown => expect.objectContaining(line)),
        );
        expect(pool.lines.map((line) => line.workerName)).toEqual(
          expect.arrayContaining(['Ana Reparto', 'Beto Reparto']),
        );
        expect(pool.sources).toEqual([
          expect.objectContaining({
            businessDate: '2026-10-02',
            paymentMethod: 'CASH',
            amount: 8000,
          }),
          expect.objectContaining({
            businessDate: '2026-10-15',
            paymentMethod: 'DEBIT_CARD',
            amount: 4000,
          }),
        ]);
        expect(sumAmounts(pool.lines)).toBe(pool.totalAmount);

        const stored = await f.tx.tipPool.findUniqueOrThrow({
          where: { id: pool.id },
          include: { lines: true, sources: true },
        });
        expect(stored.status).toBe('DRAFT');
        expect(stored.notes).toBeNull();
        expect(stored.calculatedById).toBe(f.accountant.id);
        expect(stored.lines).toHaveLength(3);
        expect(stored.sources).toHaveLength(2);
        expect(
          stored.lines.every((line) => line.workHoursRecordId !== null),
        ).toBe(true);
        expect(
          stored.lines.reduce(
            (sum, line) => sum.plus(line.amount),
            new Prisma.Decimal(0),
          ),
        ).toEqual(stored.totalAmount);
        // Mismas claves que el snapshot del seed demo (SPRINT-3-T09).
        expect(stored.agreementSnapshot).toEqual(
          expect.objectContaining({
            id: stored.agreementId,
            name: 'Pacto desde 2026-01-01',
            rule: 'PROPORTIONAL_TO_HOURS',
            validFrom: '2026-01-01',
            validTo: null,
          }),
        );
        expect(Object.keys(stored.agreementSnapshot ?? {})).toEqual(
          expect.arrayContaining(Object.keys(TIP_DEMO_POOL.agreementSnapshot)),
        );
      });
    });

    it('rechaza un período invertido sin guardar nada', async () => {
      await withinRollback(async (f) => {
        await seedHappyPath(f);
        await expect(
          preview(f, { start: '2026-10-15', end: '2026-10-01' }),
        ).rejects.toThrow('periodEnd no puede ser anterior a periodStart');
      });
    });

    describe('responde 422 con cada causa y no guarda nada', () => {
      it('AGREEMENT_MISSING', async () => {
        await withinRollback(async (f) => {
          await addEntry(f, '2026-10-02', 'CASH', 1000);
          await addHours(f, f.workers[0], 10);
          await addAgreement(f, '2026-01-01', '2026-09-30');
          await expectIssues(f, [TIP_POOL_ISSUE_CODE.AGREEMENT_MISSING]);
        });
      });

      it('AGREEMENT_CHANGES_IN_PERIOD', async () => {
        await withinRollback(async (f) => {
          await addAgreement(f, '2026-01-01', '2026-10-07');
          await addAgreement(f, '2026-10-08');
          await addEntry(f, '2026-10-02', 'CASH', 1000);
          await addHours(f, f.workers[0], 10);
          await expectIssues(f, [
            TIP_POOL_ISSUE_CODE.AGREEMENT_CHANGES_IN_PERIOD,
          ]);
        });
      });

      // AGREEMENT_RULE_UNSUPPORTED no se puede producir en la base: el enum
      // TipAgreementRule solo tiene PROPORTIONAL_TO_HOURS. Lo cubre el test
      // unitario de tip-pool-validation.spec.ts.

      it('TIP_ENTRIES_MISSING', async () => {
        await withinRollback(async (f) => {
          await addAgreement(f);
          await addEntry(f, '2026-10-20', 'CASH', 1000);
          await addHours(f, f.workers[0], 10);
          await expectIssues(f, [TIP_POOL_ISSUE_CODE.TIP_ENTRIES_MISSING]);
        });
      });

      it('TIP_ENTRY_ALREADY_USED', async () => {
        await withinRollback(async (f) => {
          await seedHappyPath(f);
          // Otro reparto (período solapado) ya usa el registro del 2 de octubre.
          const entry = await f.tx.tipEntry.findFirstOrThrow({
            where: { storeId: f.storeId, businessDate: day('2026-10-02') },
          });
          const other = await f.tx.tipPool.create({
            data: {
              storeId: f.storeId,
              periodStart: day('2026-09-28'),
              periodEnd: day('2026-10-04'),
              totalAmount: 8000,
              calculatedById: f.accountant.id,
            },
          });
          await f.tx.tipPoolSource.create({
            data: { poolId: other.id, tipEntryId: entry.id, amount: 8000 },
          });

          const codes = await issueCodesOf(preview(f));
          expect(codes).toEqual([TIP_POOL_ISSUE_CODE.TIP_ENTRY_ALREADY_USED]);
          expect(
            await f.tx.tipPool.count({ where: { storeId: f.storeId } }),
          ).toBe(1);
        });
      });

      it('WORK_HOURS_MISSING', async () => {
        await withinRollback(async (f) => {
          await addAgreement(f);
          await addEntry(f, '2026-10-02', 'CASH', 1000);
          await expectIssues(f, [TIP_POOL_ISSUE_CODE.WORK_HOURS_MISSING]);
        });
      });

      it('WORK_HOURS_PERIOD_MISMATCH', async () => {
        await withinRollback(async (f) => {
          await addAgreement(f);
          await addEntry(f, '2026-10-02', 'CASH', 1000);
          await addHours(f, f.workers[0], 10);
          await addHours(f, f.workers[1], 10, {
            start: '2026-10-01',
            end: '2026-10-14',
          });
          await expectIssues(f, [
            TIP_POOL_ISSUE_CODE.WORK_HOURS_PERIOD_MISMATCH,
          ]);
        });
      });

      it('WORK_HOURS_TOTAL_ZERO', async () => {
        await withinRollback(async (f) => {
          await addAgreement(f);
          await addEntry(f, '2026-10-02', 'CASH', 1000);
          await addHours(f, f.workers[0], 0);
          await addHours(f, f.workers[1], 0);
          await expectIssues(f, [TIP_POOL_ISSUE_CODE.WORK_HOURS_TOTAL_ZERO]);
        });
      });

      it('WORKER_NOT_IN_STORE por otro local y por usuario inactivo', async () => {
        await withinRollback(async (f) => {
          await addAgreement(f);
          await addEntry(f, '2026-10-02', 'CASH', 1000);
          await addHours(f, f.workers[0], 10);
          const otherStore = await createStore(f.tx);
          const outsider = await createUser(f.tx, ROLE.TRABAJADOR, otherStore);
          const inactive = await createUser(f.tx, ROLE.TRABAJADOR, f.storeId, {
            isActive: false,
          });
          await addHours(f, outsider.id, 5);
          await addHours(f, inactive.id, 5);

          try {
            await preview(f);
            throw new Error('Se esperaba una respuesta 422');
          } catch (error) {
            const body = (
              error as UnprocessableEntityException
            ).getResponse() as TipPoolValidationErrorBody;
            expect(body.issues).toEqual([
              expect.objectContaining({
                code: TIP_POOL_ISSUE_CODE.WORKER_NOT_IN_STORE,
                details: {
                  workers: expect.arrayContaining([
                    expect.objectContaining({
                      userId: outsider.id,
                      reason: 'OTHER_STORE',
                    }),
                    expect.objectContaining({
                      userId: inactive.id,
                      reason: 'INACTIVE',
                    }),
                  ]) as unknown,
                },
              }),
            ]);
          }
          expect(
            await f.tx.tipPool.count({ where: { storeId: f.storeId } }),
          ).toBe(0);
        });
      });

      it('devuelve todas las causas a la vez', async () => {
        await withinRollback(async (f) => {
          await addHours(f, f.workers[0], 10);
          await expectIssues(f, [
            TIP_POOL_ISSUE_CODE.AGREEMENT_MISSING,
            TIP_POOL_ISSUE_CODE.TIP_ENTRIES_MISSING,
          ]);
        });
      });
    });

    it('regenerar un DRAFT reemplaza líneas y fuentes y conserva el id', async () => {
      await withinRollback(async (f) => {
        await seedHappyPath(f);
        const first = (await preview(f)).pool;
        const oldLineIds = (
          await f.tx.tipPoolLine.findMany({ where: { poolId: first.id } })
        ).map((line) => line.id);

        await addEntry(f, '2026-10-03', 'TRANSFER', 3000);
        await f.tx.workHoursRecord.updateMany({
          where: { workerId: f.workers[2] },
          data: { hoursWorked: 0 },
        });
        const second = await preview(f);

        expect(second.created).toBe(false);
        expect(second.pool.id).toBe(first.id);
        expect(second.pool.totalAmount).toBe(15000);
        expect(second.pool.sources).toHaveLength(3);
        const byUser = Object.fromEntries(
          second.pool.lines.map((line) => [line.userId, line.amount]),
        );
        expect(byUser).toEqual({
          [f.workers[0]]: 5000,
          [f.workers[1]]: 10000,
          [f.workers[2]]: 0,
        });
        expect(
          await f.tx.tipPool.count({ where: { storeId: f.storeId } }),
        ).toBe(1);
        expect(
          await f.tx.tipPoolLine.count({ where: { id: { in: oldLineIds } } }),
        ).toBe(0);
        expect(
          await f.tx.tipPoolSource.count({ where: { poolId: first.id } }),
        ).toBe(3);
      });
    });

    it.each(['CONFIRMED', 'PAID'] as const)(
      'responde 409 y no toca un reparto %s',
      async (status) => {
        await withinRollback(async (f) => {
          await seedHappyPath(f);
          const pool = (await preview(f)).pool;
          await f.tx.tipPool.update({
            where: { id: pool.id },
            data: {
              status: 'CONFIRMED',
              confirmedAt: new Date(),
              confirmedById: f.accountant.id,
            },
          });
          // Desde SPRINT-3-T13 PAID exige pasar por CONFIRMED y los datos del
          // pago (CHECK y triggers de tip_pools).
          if (status === 'PAID') {
            await f.tx.tipPool.update({
              where: { id: pool.id },
              data: {
                status,
                paidAt: new Date(),
                paidById: f.accountant.id,
                paymentDate: day(PERIOD.end),
                version: { increment: 1 },
              },
            });
          }
          await addEntry(f, '2026-10-03', 'TRANSFER', 3000);

          await expect(preview(f)).rejects.toBeInstanceOf(ConflictException);
          const stored = await f.service.findOne(pool.id, f.accountant);
          expect(stored.status).toBe(status);
          expect(stored.totalAmount).toBe(12000);
          expect(stored.sources).toHaveLength(2);
        });
      },
    );

    it('la foto guardada no cambia si después cambian el pacto o las horas', async () => {
      await withinRollback(async (f) => {
        await seedHappyPath(f);
        const original = (await preview(f)).pool;

        await f.tx.tipAgreement.updateMany({
          where: { storeId: f.storeId },
          data: { name: 'Pacto renombrado', validTo: day('2026-12-31') },
        });
        await f.tx.workHoursRecord.updateMany({
          where: { storeId: f.storeId },
          data: { hoursWorked: 99 },
        });

        const stored = await f.service.findOne(original.id, f.accountant);
        expect(stored.agreement).toEqual(original.agreement);
        expect(stored.agreement?.name).toBe('Pacto desde 2026-01-01');
        expect(stored.agreement?.validTo).toBeNull();
        expect(stored.lines).toEqual(original.lines);
        expect(stored.totalHours).toBe('60.00');
        expect(stored.reconciled).toBe(true);
      });
    });

    it('bloquea editar o borrar un registro diario usado por la vista previa', async () => {
      await withinRollback(async (f) => {
        await seedHappyPath(f);
        const pool = (await preview(f)).pool;
        const entryId = pool.sources[0].tipEntryId;

        await expect(
          f.tips.update(entryId, { amount: 1 }, f.supervisor),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
          f.tips.remove(entryId, f.supervisor),
        ).rejects.toBeInstanceOf(ConflictException);
        const entry = await f.tx.tipEntry.findUniqueOrThrow({
          where: { id: entryId },
        });
        expect(Number(entry.amount)).toBe(8000);
      });
    });

    it('consulta por ID responde 404 si no existe o el usuario no accede al local', async () => {
      await withinRollback(async (f) => {
        await seedHappyPath(f);
        const pool = (await preview(f)).pool;
        const otherStore = await createStore(f.tx);
        const foreignSupervisor: AuthUser = {
          ...f.supervisor,
          storeId: otherStore,
        };

        await expect(
          f.service.findOne(pool.id, foreignSupervisor),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          f.service.findOne(randomUUID(), f.accountant),
        ).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    it('reemplaza el DRAFT del seed demo y obtiene 10.000 / 15.000 (total 25.000)', async () => {
      await withinRollback(async (f) => {
        // Recrea las fixtures demo dentro de la transacción (upsert por UUID
        // fijo), sin depender de que el seed se haya ejecutado antes.
        await seedDatabase(f.tx, {
          adminEmail: 'admin-tip-pools@moi-food.invalid',
          adminPassword: 'clave-de-prueba-reparto',
          adminFirstName: 'Admin',
          adminLastName: 'Reparto',
          includeDemoData: true,
        });

        const result = await preview(
          f,
          {
            start: TIP_DEMO_PERIOD.start.toISOString().slice(0, 10),
            end: TIP_DEMO_PERIOD.end.toISOString().slice(0, 10),
          },
          TIP_DEMO_STORE.id,
        );

        expect(result.created).toBe(false);
        expect(result.pool.id).toBe(TIP_DEMO_POOL.id);
        expect(result.pool.totalAmount).toBe(TIP_DEMO_POOL.totalAmount);
        expect(result.pool.agreement).toMatchObject(
          TIP_DEMO_POOL.agreementSnapshot,
        );
        expect(
          Object.fromEntries(
            result.pool.lines.map((line) => [line.userId, line.amount]),
          ),
        ).toEqual(
          Object.fromEntries(
            TIP_DEMO_WORKER_PERIODS.map((worker) => [
              worker.workerId,
              worker.lineAmount,
            ]),
          ),
        );
        expect(
          result.pool.sources.map((source) => source.tipEntryId).sort(),
        ).toEqual(TIP_DEMO_ENTRIES.map((entry) => entry.id).sort());
        expect(sumAmounts(result.pool.lines)).toBe(25000);
        expect(result.pool.agreement?.id).toBe(TIP_DEMO_AGREEMENT.id);
        expect(result.pool.lines.map((line) => line.userId)).toEqual(
          [TIP_DEMO_IDS.workerOne, TIP_DEMO_IDS.workerTwo].sort(),
        );
      });
    });
  },
);

// -------------------------------------------------------------
// Pipeline HTTP: roles, auditoría, formato de errores y concurrencia.
// -------------------------------------------------------------
const DOMAIN = '@tip-pools-api-test.invalid';
const STORE_NAME = 'Subway Tip Pools API Test';
const HTTP_PERIOD = { start: '2026-03-01', end: '2026-03-15' } as const;
const CONCURRENT_PERIOD = { start: '2026-04-01', end: '2026-04-15' } as const;

describe.skipIf(!databaseUrl)(
  'API de vista previa del reparto (SPRINT-3-T12)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storeId: string;
    const ids: Record<string, string> = {};
    const tokens: Record<string, string> = {};

    async function cleanup(): Promise<void> {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        const storeWhere = { name: { startsWith: STORE_NAME } };
        await tx.tipPoolSource.deleteMany({
          where: { pool: { store: storeWhere } },
        });
        await tx.tipPoolLine.deleteMany({
          where: { pool: { store: storeWhere } },
        });
        await tx.tipPool.deleteMany({ where: { store: storeWhere } });
        await tx.tipAgreement.deleteMany({ where: { store: storeWhere } });
        await tx.workHoursRecord.deleteMany({ where: { store: storeWhere } });
        await tx.tipEntry.deleteMany({ where: { store: storeWhere } });
      });
      await purgeTestAuditLogs(prisma, {
        OR: [
          { user: { email: { endsWith: DOMAIN } } },
          { store: { name: { startsWith: STORE_NAME } } },
        ],
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({
        where: { name: { startsWith: STORE_NAME } },
      });
    }

    async function createApiUser(
      name: string,
      roleCode: RoleCode,
      userStoreId: string | null,
    ): Promise<void> {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: roleCode },
      });
      const user = await prisma.user.create({
        data: {
          email: `${name}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: name,
          lastName: 'Reparto',
          roleId: role.id,
          storeId: userStoreId,
        },
      });
      ids[name] = user.id;
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: roleCode,
        storeId: userStoreId,
      };
      tokens[name] = await jwt.signAsync(payload);
    }

    async function seedPeriod(period: {
      start: string;
      end: string;
    }): Promise<void> {
      await prisma.tipEntry.createMany({
        data: [
          {
            businessDate: day(period.start),
            paymentMethod: 'CASH',
            amount: 7000,
            storeId,
            responsibleId: ids.supervisor,
          },
          {
            businessDate: day(period.end),
            paymentMethod: 'CREDIT_CARD',
            amount: 3001,
            storeId,
            responsibleId: ids.supervisor,
          },
        ],
      });
      await prisma.workHoursRecord.createMany({
        data: [
          { worker: 'workerOne', hours: 12.5 },
          { worker: 'workerTwo', hours: 37.5 },
        ].map(({ worker, hours }) => ({
          periodStart: day(period.start),
          periodEnd: day(period.end),
          hoursWorked: hours,
          storeId,
          workerId: ids[worker],
          recordedById: ids.supervisor,
        })),
      });
    }

    function postPreview(
      token: string,
      period: { start: string; end: string } = HTTP_PERIOD,
    ) {
      return request(app.getHttpServer())
        .post('/tip-pools/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({
          storeId,
          periodStart: period.start,
          periodEnd: period.end,
        });
    }

    function getPool(id: string, token: string) {
      return request(app.getHttpServer())
        .get(`/tip-pools/${id}`)
        .set('Authorization', `Bearer ${token}`);
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
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
      await cleanup();

      for (const code of Object.values(ROLE)) {
        await prisma.role.upsert({
          where: { code },
          update: {},
          create: { code, name: code },
        });
      }
      const store = await prisma.store.create({
        data: { name: STORE_NAME, city: 'Melipilla', address: 'Calle 123' },
      });
      storeId = store.id;

      await createApiUser('accountant', ROLE.CONTADOR, null);
      await createApiUser('admin', ROLE.ADMINISTRADOR, null);
      await createApiUser('supervisor', ROLE.SUPERVISOR, storeId);
      await createApiUser('workerOne', ROLE.TRABAJADOR, storeId);
      await createApiUser('workerTwo', ROLE.TRABAJADOR, storeId);

      await prisma.tipAgreement.create({
        data: {
          name: 'Pacto API Test',
          rule: 'PROPORTIONAL_TO_HOURS',
          validFrom: day('2026-01-01'),
          storeId,
          createdById: ids.supervisor,
        },
      });
      await seedPeriod(HTTP_PERIOD);
      await seedPeriod(CONCURRENT_PERIOD);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
    });

    it('solo el contador genera la vista previa', async () => {
      for (const name of ['admin', 'supervisor', 'workerOne']) {
        await postPreview(tokens[name]).expect(403);
      }
      expect(await prisma.tipPool.count({ where: { storeId } })).toBe(0);
    });

    it('calcula, recalcula y audita cada operación', async () => {
      const created = (await postPreview(tokens.accountant).expect(201))
        .body as TipPoolResponse;
      // 10.001 × 12,5 / 50 = 2.500,25 y 10.001 × 37,5 / 50 = 7.500,75: el CLP
      // sobrante va al mayor resto (0,75).
      expect(created).toMatchObject({
        status: 'DRAFT',
        totalAmount: 10001,
        totalHours: '50.00',
        reconciled: true,
      });
      expect(
        Object.fromEntries(
          created.lines.map((line) => [line.userId, line.amount]),
        ),
      ).toEqual({ [ids.workerOne]: 2500, [ids.workerTwo]: 7501 });

      const again = (await postPreview(tokens.accountant).expect(200))
        .body as TipPoolResponse;
      expect(again.id).toBe(created.id);

      const audits = await prisma.auditLog.findMany({
        where: { entityType: 'tip_pools', entityId: created.id },
        orderBy: { id: 'asc' },
      });
      expect(audits.map((audit) => audit.action)).toEqual([
        AUDIT_ACTION.TIP_POOL_CALCULATED,
        AUDIT_ACTION.TIP_POOL_RECALCULATED,
      ]);
      expect(audits[0]).toMatchObject({
        userId: ids.accountant,
        storeId,
        detail: expect.objectContaining({
          storeId,
          periodStart: HTTP_PERIOD.start,
          periodEnd: HTTP_PERIOD.end,
          totalAmount: 10001,
          recalculated: false,
          workers: 2,
          sources: 2,
        }) as unknown,
      });
      // El primer cálculo no descarta observaciones; el recálculo de un
      // borrador sin observar deja previousNotes en null (SPRINT-3-T13).
      expect(audits[0].detail).not.toHaveProperty('previousNotes');
      expect(audits[1].detail).toMatchObject({
        recalculated: true,
        previousNotes: null,
      });
    });

    it('consulta por ID: contador y administrador sí, supervisor no', async () => {
      const pool = await prisma.tipPool.findFirstOrThrow({
        where: { storeId, periodStart: day(HTTP_PERIOD.start) },
      });
      for (const name of ['accountant', 'admin']) {
        const body = (await getPool(pool.id, tokens[name]).expect(200))
          .body as TipPoolResponse;
        expect(body).toMatchObject({ id: pool.id, totalAmount: 10001 });
      }
      await getPool(pool.id, tokens.supervisor).expect(403);
      await getPool(randomUUID(), tokens.accountant).expect(404);
    });

    it('responde 422 con statusCode, message e issues', async () => {
      const response = await postPreview(tokens.accountant, {
        start: '2026-05-01',
        end: '2026-05-15',
      }).expect(422);
      expect(response.body).toEqual({
        statusCode: 422,
        message: 'No se puede calcular el reparto del período',
        issues: [
          expect.objectContaining({
            code: TIP_POOL_ISSUE_CODE.TIP_ENTRIES_MISSING,
          }),
          expect.objectContaining({
            code: TIP_POOL_ISSUE_CODE.WORK_HOURS_MISSING,
          }),
        ],
      });
    });

    it('responde 400 con un período invertido', async () => {
      await postPreview(tokens.accountant, {
        start: '2026-03-15',
        end: '2026-03-01',
      }).expect(400);
    });

    it('dos vistas previas simultáneas dejan un solo pool consistente', async () => {
      const responses = await Promise.all([
        postPreview(tokens.accountant, CONCURRENT_PERIOD),
        postPreview(tokens.accountant, CONCURRENT_PERIOD),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 201,
      ]);

      const pools = await prisma.tipPool.findMany({
        where: { storeId, periodStart: day(CONCURRENT_PERIOD.start) },
        include: { lines: true, sources: true },
      });
      expect(pools).toHaveLength(1);
      expect(pools[0].lines).toHaveLength(2);
      expect(pools[0].sources).toHaveLength(2);
      expect(
        pools[0].lines.reduce(
          (sum, line) => sum.plus(line.amount),
          new Prisma.Decimal(0),
        ),
      ).toEqual(pools[0].totalAmount);
      for (const response of responses) {
        expect((response.body as TipPoolResponse).id).toBe(pools[0].id);
      }
    });
  },
);
