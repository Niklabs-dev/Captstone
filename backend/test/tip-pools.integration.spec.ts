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
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { StoresService } from '../src/stores/stores.service.js';
import { epochDay } from '../src/tips/calculation/equal-daily-distribution.calculator.js';
import {
  TipPoolsService,
  VERSION_CONFLICT_MESSAGE,
} from '../src/tips/tip-pools.service.js';
import {
  EQUAL_SHARES_RULE_NAME,
  TIP_POOL_ISSUE_CODE,
  type TipPoolConflictBody,
  type TipPoolIssueCode,
  type TipPoolResponse,
  type TipPoolValidationErrorBody,
} from '../src/tips/types/tip-pools.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';
import { createDailyOperation } from './helpers/daily-operations.js';
import {
  ensureDefaultPaymentMethods,
  paymentMethodIdOf,
} from './helpers/payment-methods.js';

type App = Parameters<typeof request>[0];

// Tests de integración del cálculo y vista previa del reparto de propinas
// (SPRINT-3-T12, regla equitativa de SPRINT-4R-T04) contra PostgreSQL real.
// Se omiten si no se define TEST_DATABASE_URL.
//
// Todo cálculo nuevo es equitativo: el fondo de cada operación diaria
// (tarjeta + efectivo) se divide una sola vez entre sus participantes y cada
// trabajador recibe la suma de sus asignaciones diarias. Los repartos
// proporcionales históricos (seed demo) se conservan tal cual.
//
// - El servicio se prueba dentro de withinRollback: TipPoolsService y
//   StoresService reciben la transacción del test en lugar de PrismaService,
//   así todo lo que crean se revierte.
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
  storeId: string;
  accountant: AuthUser;
  supervisor: AuthUser;
  // Ana, Beto y Carla, TRABAJADOR activos del local.
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
  overrides: { firstName?: string } = {},
): Promise<AuthUser> {
  const email = `${randomUUID()}@tip-pools-test.invalid`;
  const user = await tx.user.create({
    data: {
      email,
      passwordHash: '$2b$04$hash-de-prueba',
      firstName: overrides.firstName ?? role,
      lastName: 'Reparto',
      roleId: await roleId(tx, role),
      storeId,
    },
  });
  return { id: user.id, email, role, storeId };
}

async function createFixture(tx: Prisma.TransactionClient): Promise<Fixture> {
  const prisma = transactionAsPrismaService(tx);
  await ensureDefaultPaymentMethods(tx);
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
    service: new TipPoolsService(prisma, new StoresService(prisma)),
    storeId,
    accountant,
    supervisor,
    workers,
  };
}

function addOperation(
  f: Fixture,
  businessDate: string,
  amounts: { card?: number; cash?: number },
  participantIds: readonly string[],
): Promise<string> {
  return createDailyOperation(f.tx, {
    storeId: f.storeId,
    responsibleId: f.supervisor.id,
    businessDate,
    cardTipAmount: amounts.card ?? 0,
    cashTipAmount: amounts.cash ?? 0,
    participantIds,
  });
}

// Monto esperado de un día por participante: base para todos y el peso extra
// en la posición (díaDesdeEpoch mod n) del orden por ID, como documenta el
// calculador (aquí con residuo 1).
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

// Dos operaciones dentro del período (16.000) y una fuera: el 02-10 hay
// $10.000 (tarjeta 7.000 + efectivo 3.000) entre los tres y el 08-10 $6.000
// en efectivo entre Beto y Carla.
async function seedHappyPath(f: Fixture): Promise<Record<string, number>> {
  const [ana, beto, carla] = f.workers;
  await addOperation(f, '2026-10-02', { card: 7000, cash: 3000 }, [
    ana,
    beto,
    carla,
  ]);
  await addOperation(f, '2026-10-08', { cash: 6000 }, [beto, carla]);
  await addOperation(f, '2026-10-16', { cash: 99999 }, [ana]);
  return addAmounts(
    expectedSplit('2026-10-02', 10000, [ana, beto, carla]),
    expectedSplit('2026-10-08', 6000, [beto, carla]),
  );
}

function preview(
  f: Fixture,
  period: { start: string; end: string } = PERIOD,
  storeId = f.storeId,
  expectedVersion?: number,
) {
  return f.service.preview(
    {
      storeId,
      periodStart: period.start,
      periodEnd: period.end,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    },
    f.accountant,
  );
}

async function issuesOf(
  promise: Promise<unknown>,
): Promise<TipPoolValidationErrorBody['issues']> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    const body = (
      error as UnprocessableEntityException
    ).getResponse() as TipPoolValidationErrorBody;
    expect(body.statusCode).toBe(422);
    return body.issues;
  }
  throw new Error('Se esperaba una respuesta 422');
}

async function expectIssues(
  f: Fixture,
  expected: TipPoolIssueCode[],
): Promise<void> {
  const issues = await issuesOf(preview(f));
  expect(issues.map((issue) => issue.code)).toEqual(expected);
  expect(await f.tx.tipPool.count({ where: { storeId: f.storeId } })).toBe(0);
}

function sumAmounts(items: { amount: number }[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

describe.skipIf(!databaseUrl)(
  'Cálculo del reparto equitativo de propinas (SPRINT-4R-T04)',
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

    it('guarda pool, líneas y fuentes diarias del período y concilia con el total', async () => {
      await withinRollback(async (f) => {
        const expected = await seedHappyPath(f);
        const result = await preview(f);

        expect(result.created).toBe(true);
        const pool = result.pool;
        expect(pool).toMatchObject({
          status: 'DRAFT',
          version: 1,
          store: { id: f.storeId },
          periodStart: PERIOD.start,
          periodEnd: PERIOD.end,
          rule: 'EQUAL_SHARES',
          agreement: null,
          totalAmount: 16000,
          totalHours: null,
          reconciled: true,
          sources: [],
          calculatedBy: { id: f.accountant.id },
        });
        expect(amountsByUser(pool)).toEqual(expected);
        expect(pool.lines.every((line) => line.hoursWorked === null)).toBe(
          true,
        );
        expect(pool.lines.map((line) => line.workerName).sort()).toEqual([
          'Ana Reparto',
          'Beto Reparto',
          'Carla Reparto',
        ]);
        expect(pool.lines.map((line) => line.userId)).toEqual(
          [...f.workers].sort(),
        );
        expect(pool.dailySources).toEqual([
          expect.objectContaining({
            businessDate: '2026-10-02',
            cardTipAmount: 7000,
            cashTipAmount: 3000,
            amount: 10000,
          }),
          expect.objectContaining({
            businessDate: '2026-10-08',
            cardTipAmount: 0,
            cashTipAmount: 6000,
            amount: 6000,
          }),
        ]);
        expect(sumAmounts(pool.lines)).toBe(pool.totalAmount);

        const stored = await f.tx.tipPool.findUniqueOrThrow({
          where: { id: pool.id },
          include: { lines: true, sources: true, dailyOperationSources: true },
        });
        expect(stored.status).toBe('DRAFT');
        expect(stored.agreementId).toBeNull();
        expect(stored.agreementSnapshot).toEqual({
          rule: 'EQUAL_SHARES',
          name: EQUAL_SHARES_RULE_NAME,
          capturedAt: expect.any(String) as string,
        });
        expect(stored.calculatedById).toBe(f.accountant.id);
        expect(stored.sources).toHaveLength(0);
        expect(stored.dailyOperationSources).toHaveLength(2);
        // Sin horas inventadas: la base las guarda NULL (trigger T02).
        expect(
          stored.lines.every(
            (line) =>
              line.hoursWorked === null && line.workHoursRecordId === null,
          ),
        ).toBe(true);
        expect(
          stored.lines.reduce(
            (sum, line) => sum.plus(line.amount),
            new Prisma.Decimal(0),
          ),
        ).toEqual(stored.totalAmount);
      });
    });

    it('$10.000 entre 3 asigna $3.334, $3.333 y $3.333 con la regla documentada', async () => {
      await withinRollback(async (f) => {
        await addOperation(f, '2026-10-05', { cash: 10000 }, f.workers);
        const pool = (await preview(f)).pool;

        expect(pool.lines.map((line) => line.amount).sort()).toEqual([
          3333, 3333, 3334,
        ]);
        // El peso extra va a la posición (díaDesdeEpoch mod 3) por ID.
        expect(amountsByUser(pool)).toEqual(
          expectedSplit('2026-10-05', 10000, f.workers),
        );
        expect(sumAmounts(pool.lines)).toBe(10000);
      });
    });

    it('en varios días cada uno recibe la suma de sus asignaciones, no una división entre la unión', async () => {
      await withinRollback(async (f) => {
        const [ana, beto, carla] = f.workers;
        await addOperation(f, '2026-10-01', { card: 10000 }, [ana, beto]);
        await addOperation(f, '2026-10-02', { cash: 6000 }, [carla]);
        const pool = (await preview(f)).pool;

        // Dividir 16.000 entre la unión daría 5.333 a cada uno.
        expect(amountsByUser(pool)).toEqual({
          [ana]: 5000,
          [beto]: 5000,
          [carla]: 6000,
        });
      });
    });

    it('un no seleccionado no recibe línea ni monto', async () => {
      await withinRollback(async (f) => {
        const [ana, beto, carla] = f.workers;
        await addOperation(f, '2026-10-03', { cash: 9000 }, [ana, carla]);
        const pool = (await preview(f)).pool;

        expect(pool.lines.map((line) => line.userId)).toEqual(
          [ana, carla].sort(),
        );
        expect(pool.lines.some((line) => line.userId === beto)).toBe(false);
        expect(amountsByUser(pool)).toEqual({ [ana]: 4500, [carla]: 4500 });
      });
    });

    it('un día sin propinas no exige participantes y no genera líneas', async () => {
      await withinRollback(async (f) => {
        await addOperation(f, '2026-10-03', {}, []);
        await addOperation(f, '2026-10-04', { cash: 3000 }, [f.workers[0]]);
        const pool = (await preview(f)).pool;

        expect(pool.totalAmount).toBe(3000);
        expect(pool.lines).toHaveLength(1);
        expect(pool.dailySources.map((source) => source.amount)).toEqual([
          0, 3000,
        ]);
      });
    });

    it('un trabajador desactivado después conserva su asignación del día', async () => {
      await withinRollback(async (f) => {
        const [ana, beto] = f.workers;
        await addOperation(f, '2026-10-03', { cash: 8000 }, [ana, beto]);
        // La baja lógica posterior no borra la selección (T02): lo trabajado
        // ese día se le reparte igual.
        await f.tx.user.update({
          where: { id: beto },
          data: { isActive: false },
        });
        const pool = (await preview(f)).pool;

        expect(amountsByUser(pool)).toEqual({ [ana]: 4000, [beto]: 4000 });
      });
    });

    it('no usa pactos, horas ni registros históricos: la regla siempre es equitativa', async () => {
      await withinRollback(async (f) => {
        const [ana, beto, carla] = f.workers;
        // Un pacto proporcional vigente, horas y propinas del flujo antiguo
        // no cambian la regla ni el fondo.
        await f.tx.tipAgreement.create({
          data: {
            name: 'Pacto proporcional antiguo',
            rule: 'PROPORTIONAL_TO_HOURS',
            validFrom: day('2026-01-01'),
            storeId: f.storeId,
            createdById: f.supervisor.id,
          },
        });
        await f.tx.workHoursRecord.create({
          data: {
            periodStart: day(PERIOD.start),
            periodEnd: day(PERIOD.end),
            hoursWorked: 99,
            storeId: f.storeId,
            workerId: ana,
            recordedById: f.supervisor.id,
          },
        });
        await f.tx.tipEntry.create({
          data: {
            businessDate: day('2026-10-02'),
            paymentMethodId: await paymentMethodIdOf(f.tx, 'CASH'),
            amount: 50000,
            storeId: f.storeId,
            responsibleId: f.supervisor.id,
          },
        });
        await addOperation(f, '2026-10-02', { cash: 6000 }, [beto, carla]);

        const pool = (await preview(f)).pool;
        expect(pool.rule).toBe('EQUAL_SHARES');
        expect(pool.agreement).toBeNull();
        expect(pool.totalAmount).toBe(6000);
        expect(pool.sources).toEqual([]);
        expect(amountsByUser(pool)).toEqual({ [beto]: 3000, [carla]: 3000 });
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
      it('DAILY_OPERATIONS_MISSING', async () => {
        await withinRollback(async (f) => {
          await addOperation(f, '2026-10-20', { cash: 1000 }, [f.workers[0]]);
          await expectIssues(f, [TIP_POOL_ISSUE_CODE.DAILY_OPERATIONS_MISSING]);
        });
      });

      it('DAILY_PARTICIPANTS_MISSING: un fondo positivo sin participantes impide calcular', async () => {
        await withinRollback(async (f) => {
          await addOperation(f, '2026-10-02', { cash: 5000 }, [f.workers[0]]);
          const orphanId = await addOperation(
            f,
            '2026-10-03',
            { cash: 4500 },
            [],
          );
          const issues = await issuesOf(preview(f));

          expect(issues).toEqual([
            {
              code: TIP_POOL_ISSUE_CODE.DAILY_PARTICIPANTS_MISSING,
              message: expect.stringContaining(
                'ningún trabajador participante',
              ) as string,
              details: {
                operations: [
                  {
                    operationId: orphanId,
                    businessDate: '2026-10-03',
                    tipFundAmount: 4500,
                  },
                ],
              },
            },
          ]);
          expect(
            await f.tx.tipPool.count({ where: { storeId: f.storeId } }),
          ).toBe(0);
        });
      });

      it('DAILY_OPERATION_ALREADY_USED por un reparto de período solapado', async () => {
        await withinRollback(async (f) => {
          await seedHappyPath(f);
          const other = (
            await preview(f, { start: '2026-09-28', end: '2026-10-04' })
          ).pool;
          expect(other.dailySources).toHaveLength(1);

          const issues = await issuesOf(preview(f));
          expect(issues).toEqual([
            expect.objectContaining({
              code: TIP_POOL_ISSUE_CODE.DAILY_OPERATION_ALREADY_USED,
              details: {
                operations: [
                  {
                    operationId: other.dailySources[0].operationId,
                    businessDate: '2026-10-02',
                    poolId: other.id,
                  },
                ],
              },
            }),
          ]);
          expect(
            await f.tx.tipPool.count({ where: { storeId: f.storeId } }),
          ).toBe(1);
        });
      });

      it('devuelve todas las causas a la vez', async () => {
        await withinRollback(async (f) => {
          await seedHappyPath(f);
          await preview(f, { start: '2026-10-02', end: '2026-10-02' });
          await addOperation(f, '2026-10-09', { cash: 100 }, []);
          const issues = await issuesOf(preview(f));
          expect(issues.map((issue) => issue.code)).toEqual([
            TIP_POOL_ISSUE_CODE.DAILY_OPERATION_ALREADY_USED,
            TIP_POOL_ISSUE_CODE.DAILY_PARTICIPANTS_MISSING,
          ]);
        });
      });
    });

    it('recalcular un DRAFT reemplaza líneas y fuentes, conserva el id y sube la versión', async () => {
      await withinRollback(async (f) => {
        const [ana, beto, carla] = f.workers;
        await addOperation(f, '2026-10-02', { cash: 9000 }, [ana, beto, carla]);
        const first = (await preview(f)).pool;
        const oldLineIds = (
          await f.tx.tipPoolLine.findMany({ where: { poolId: first.id } })
        ).map((line) => line.id);

        // Se agrega otro día y se corrige la selección del primero (el
        // borrador lo permite): el recálculo toma el estado vigente.
        await addOperation(f, '2026-10-03', { card: 3000 }, [carla]);
        const firstOperation = first.dailySources[0].operationId;
        await f.tx.dailyOperationParticipant.deleteMany({
          where: { operationId: firstOperation, workerId: ana },
        });
        const second = await preview(f, PERIOD, f.storeId, first.version);

        expect(second.created).toBe(false);
        expect(second.pool.id).toBe(first.id);
        expect(second.pool.version).toBe(first.version + 1);
        expect(second.pool.totalAmount).toBe(12000);
        expect(second.pool.dailySources).toHaveLength(2);
        expect(amountsByUser(second.pool)).toEqual({
          [beto]: 4500,
          [carla]: 7500,
        });
        expect(
          await f.tx.tipPool.count({ where: { storeId: f.storeId } }),
        ).toBe(1);
        expect(
          await f.tx.tipPoolLine.count({ where: { id: { in: oldLineIds } } }),
        ).toBe(0);
        expect(
          await f.tx.tipPoolDailyOperationSource.count({
            where: { poolId: first.id },
          }),
        ).toBe(2);
      });
    });

    it('recalcular con expectedVersion desactualizado responde 409 y no toca la foto', async () => {
      await withinRollback(async (f) => {
        await seedHappyPath(f);
        const first = (await preview(f)).pool;
        const observed = await f.service.observe(
          first.id,
          { expectedVersion: first.version, notes: 'Revisar el 08-10' },
          f.accountant,
        );

        let body: TipPoolConflictBody | null = null;
        try {
          await preview(f, PERIOD, f.storeId, first.version);
        } catch (error) {
          expect(error).toBeInstanceOf(ConflictException);
          body = (
            error as ConflictException
          ).getResponse() as TipPoolConflictBody;
        }
        expect(body).toEqual({
          statusCode: 409,
          message: VERSION_CONFLICT_MESSAGE,
          currentStatus: 'DRAFT',
          currentVersion: observed.version,
        });
        const stored = await f.service.findOne(first.id, f.accountant);
        expect(stored.version).toBe(observed.version);
        expect(stored.notes).toBe('Revisar el 08-10');
        expect(stored.lines).toEqual(first.lines);

        // Con la versión vigente el recálculo procede y limpia la observación.
        const again = await preview(f, PERIOD, f.storeId, observed.version);
        expect(again.previousNotes).toBe('Revisar el 08-10');
        expect(again.pool.version).toBe(observed.version + 1);
        expect(again.pool.notes).toBeNull();
      });
    });

    it.each(['CONFIRMED', 'PAID'] as const)(
      'responde 409 y no toca un reparto %s',
      async (status) => {
        await withinRollback(async (f) => {
          await seedHappyPath(f);
          const pool = (await preview(f)).pool;
          const confirmed = await f.service.confirm(
            pool.id,
            { expectedVersion: pool.version },
            f.accountant,
          );
          if (status === 'PAID') {
            await f.service.pay(
              pool.id,
              { expectedVersion: confirmed.version, paymentDate: '2026-10-20' },
              f.accountant,
            );
          }
          await addOperation(f, '2026-10-03', { cash: 3000 }, [f.workers[0]]);

          await expect(preview(f)).rejects.toBeInstanceOf(ConflictException);
          const stored = await f.service.findOne(pool.id, f.accountant);
          expect(stored.status).toBe(status);
          expect(stored.totalAmount).toBe(16000);
          expect(stored.lines).toEqual(pool.lines);
          expect(stored.dailySources).toEqual(pool.dailySources);
        });
      },
    );

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

    it('conserva el DRAFT proporcional histórico del seed demo y su recálculo usa la regla equitativa', async () => {
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
        const demoPeriod = {
          start: TIP_DEMO_PERIOD.start.toISOString().slice(0, 10),
          end: TIP_DEMO_PERIOD.end.toISOString().slice(0, 10),
        };

        // Compatibilidad: la foto proporcional se lee igual que antes.
        const legacy = await f.service.findOne(TIP_DEMO_POOL.id, f.accountant);
        expect(legacy).toMatchObject({
          rule: 'PROPORTIONAL_TO_HOURS',
          totalAmount: TIP_DEMO_POOL.totalAmount,
          totalHours: '100.00',
          dailySources: [],
          reconciled: true,
        });
        expect(legacy.agreement).toMatchObject(TIP_DEMO_POOL.agreementSnapshot);
        expect(
          Object.fromEntries(
            legacy.lines.map((line) => [
              line.userId,
              [line.hoursWorked, line.amount],
            ]),
          ),
        ).toEqual(
          Object.fromEntries(
            TIP_DEMO_WORKER_PERIODS.map((worker) => [
              worker.workerId,
              [worker.hoursWorked.toFixed(2), worker.lineAmount],
            ]),
          ),
        );
        expect(
          legacy.sources.map((source) => source.tipEntryId).sort(),
        ).toEqual(TIP_DEMO_ENTRIES.map((entry) => entry.id).sort());

        // Sin operaciones diarias en el período el recálculo no procede y la
        // foto histórica queda intacta.
        const issues = await issuesOf(
          preview(f, demoPeriod, TIP_DEMO_STORE.id),
        );
        expect(issues.map((issue) => issue.code)).toEqual([
          TIP_POOL_ISSUE_CODE.DAILY_OPERATIONS_MISSING,
        ]);
        expect(await f.service.findOne(TIP_DEMO_POOL.id, f.accountant)).toEqual(
          legacy,
        );

        // Con operaciones diarias, recalcular reemplaza la foto por la
        // equitativa y libera los registros históricos.
        await createDailyOperation(f.tx, {
          storeId: TIP_DEMO_STORE.id,
          responsibleId: TIP_DEMO_IDS.supervisor,
          businessDate: demoPeriod.start,
          cashTipAmount: 20000,
          participantIds: [TIP_DEMO_IDS.workerOne, TIP_DEMO_IDS.workerTwo],
        });
        const result = await preview(f, demoPeriod, TIP_DEMO_STORE.id);
        expect(result.created).toBe(false);
        expect(result.pool).toMatchObject({
          id: TIP_DEMO_POOL.id,
          rule: 'EQUAL_SHARES',
          agreement: null,
          totalAmount: 20000,
          totalHours: null,
          sources: [],
        });
        expect(amountsByUser(result.pool)).toEqual({
          [TIP_DEMO_IDS.workerOne]: 10000,
          [TIP_DEMO_IDS.workerTwo]: 10000,
        });
        expect(
          await f.tx.tipPoolSource.count({
            where: { poolId: TIP_DEMO_POOL.id },
          }),
        ).toBe(0);
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
  'API de vista previa del reparto equitativo (SPRINT-4R-T04)',
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
        await tx.tipPoolDailyOperationSource.deleteMany({
          where: { pool: { store: storeWhere } },
        });
        await tx.tipPoolLine.deleteMany({
          where: { pool: { store: storeWhere } },
        });
        await tx.tipPool.deleteMany({ where: { store: storeWhere } });
        const operations = await tx.dailyOperation.findMany({
          where: { store: storeWhere },
          select: { voucherId: true },
        });
        // En modo replica las cascadas (triggers de FK) no corren: los
        // participantes se borran explícitamente antes que su operación.
        await tx.dailyOperationParticipant.deleteMany({
          where: {
            OR: [
              { operation: { store: storeWhere } },
              { worker: { email: { endsWith: DOMAIN } } },
            ],
          },
        });
        await tx.dailyOperation.deleteMany({ where: { store: storeWhere } });
        await tx.dailyOperationVoucher.deleteMany({
          where: {
            id: {
              in: operations.flatMap((operation) =>
                operation.voucherId ? [operation.voucherId] : [],
              ),
            },
          },
        });
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

    // Dos operaciones por período: tarjeta 7.000 el primer día y efectivo
    // 3.001 el último, ambas entre los dos trabajadores (fondo 10.001).
    async function seedPeriod(period: {
      start: string;
      end: string;
    }): Promise<void> {
      const participantIds = [ids.workerOne, ids.workerTwo];
      await createDailyOperation(prisma, {
        storeId,
        responsibleId: ids.supervisor,
        businessDate: period.start,
        cardTipAmount: 7000,
        participantIds,
      });
      await createDailyOperation(prisma, {
        storeId,
        responsibleId: ids.supervisor,
        businessDate: period.end,
        cashTipAmount: 3001,
        participantIds,
      });
    }

    function postPreview(
      token: string,
      period: { start: string; end: string } = HTTP_PERIOD,
      extra: Record<string, unknown> = {},
    ) {
      return request(app.getHttpServer())
        .post('/tip-pools/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({
          storeId,
          periodStart: period.start,
          periodEnd: period.end,
          ...extra,
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
      await ensureDefaultPaymentMethods(prisma);
      const store = await prisma.store.create({
        data: { name: STORE_NAME, city: 'Melipilla', address: 'Calle 123' },
      });
      storeId = store.id;

      await createApiUser('accountant', ROLE.CONTADOR, null);
      await createApiUser('admin', ROLE.ADMINISTRADOR, null);
      await createApiUser('supervisor', ROLE.SUPERVISOR, storeId);
      await createApiUser('workerOne', ROLE.TRABAJADOR, storeId);
      await createApiUser('workerTwo', ROLE.TRABAJADOR, storeId);

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
      expect(created).toMatchObject({
        status: 'DRAFT',
        rule: 'EQUAL_SHARES',
        agreement: null,
        totalAmount: 10001,
        totalHours: null,
        reconciled: true,
      });
      // 7.000 en partes iguales y 3.001 con el peso extra rotado al día.
      expect(
        Object.fromEntries(
          created.lines.map((line) => [line.userId, line.amount]),
        ),
      ).toEqual(
        addAmounts(
          expectedSplit(HTTP_PERIOD.start, 7000, [
            ids.workerOne,
            ids.workerTwo,
          ]),
          expectedSplit(HTTP_PERIOD.end, 3001, [ids.workerOne, ids.workerTwo]),
        ),
      );
      expect(created.lines.every((line) => line.hoursWorked === null)).toBe(
        true,
      );
      expect(created.dailySources.map((source) => source.amount)).toEqual([
        7000, 3001,
      ]);

      const again = (
        await postPreview(tokens.accountant, HTTP_PERIOD, {
          expectedVersion: created.version,
        }).expect(200)
      ).body as TipPoolResponse;
      expect(again.id).toBe(created.id);
      expect(again.version).toBe(created.version + 1);

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
          rule: 'EQUAL_SHARES',
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

    it('recalcular con expectedVersion desactualizado responde 409 con la versión actual', async () => {
      const pool = await prisma.tipPool.findFirstOrThrow({
        where: { storeId, periodStart: day(HTTP_PERIOD.start) },
      });
      const response = await postPreview(tokens.accountant, HTTP_PERIOD, {
        expectedVersion: pool.version - 1,
      }).expect(409);
      expect(response.body).toEqual({
        statusCode: 409,
        message: VERSION_CONFLICT_MESSAGE,
        currentStatus: 'DRAFT',
        currentVersion: pool.version,
      });
      const after = await prisma.tipPool.findUniqueOrThrow({
        where: { id: pool.id },
      });
      expect(after.version).toBe(pool.version);
    });

    it('valida expectedVersion con 400', async () => {
      for (const expectedVersion of [0, 1.5, 'dos']) {
        await postPreview(tokens.accountant, HTTP_PERIOD, {
          expectedVersion,
        }).expect(400);
      }
    });

    it('consulta por ID: contador y administrador sí, supervisor no', async () => {
      const pool = await prisma.tipPool.findFirstOrThrow({
        where: { storeId, periodStart: day(HTTP_PERIOD.start) },
      });
      for (const name of ['accountant', 'admin']) {
        const body = (await getPool(pool.id, tokens[name]).expect(200))
          .body as TipPoolResponse;
        expect(body).toMatchObject({
          id: pool.id,
          rule: 'EQUAL_SHARES',
          totalAmount: 10001,
        });
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
            code: TIP_POOL_ISSUE_CODE.DAILY_OPERATIONS_MISSING,
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
        include: { lines: true, dailyOperationSources: true },
      });
      expect(pools).toHaveLength(1);
      expect(pools[0].lines).toHaveLength(2);
      expect(pools[0].dailyOperationSources).toHaveLength(2);
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
