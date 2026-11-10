import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { createDailyOperation } from './helpers/daily-operations.js';
import {
  createLegacyTipPool,
  type LegacyTipPool,
} from './helpers/legacy-tip-pools.js';
import { ensureDefaultPaymentMethods } from './helpers/payment-methods.js';

// Reglas de la base sobre los repartos por período (SPRINT-3-T13 y
// SPRINT-4R-T04) contra PostgreSQL real. Desde SPRINT-4A-T08 la API ya no
// calcula, confirma ni paga repartos: los existentes son históricos y la
// base los protege igual (un CONFIRMED o PAID no cambia, las constancias son
// inmutables y las operaciones fuente quedan congeladas). Los repartos se
// construyen con el helper de repartos históricos dentro de withinRollback;
// un intento rechazado aborta esa transacción, así que cada uno va al final
// de su propio withinRollback o dentro de un SAVEPOINT. Se omiten si no se
// define TEST_DATABASE_URL.
const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

const PERIOD = { start: '2026-10-01', end: '2026-10-15' } as const;

const CONFIRMED_IMMUTABLE = /No se pueden cambiar los montos/;
const NOT_DRAFT = /ya no está en DRAFT/;
const PAID_IMMUTABLE = /El reparto pagado .* es inmutable/;
const RECEIPTS_IMMUTABLE = /Las constancias de pago son inmutables/;
const SOURCE_FEEDS_CLOSED_POOL = /alimenta un reparto confirmado o pagado/;

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

interface Fixture {
  tx: Prisma.TransactionClient;
  storeId: string;
  accountantId: string;
  supervisorId: string;
  workers: string[];
}

async function createUser(
  tx: Prisma.TransactionClient,
  role: RoleCode,
  storeId: string | null,
  firstName: string,
): Promise<string> {
  const roleRecord = await tx.role.upsert({
    where: { code: role },
    update: {},
    create: { code: role, name: role },
  });
  const user = await tx.user.create({
    data: {
      email: `${randomUUID()}@tip-pools-immutability-test.invalid`,
      passwordHash: '$2b$04$hash-de-prueba',
      firstName,
      lastName: 'Historico',
      roleId: roleRecord.id,
      storeId,
    },
  });
  return user.id;
}

async function createFixture(tx: Prisma.TransactionClient): Promise<Fixture> {
  await ensureDefaultPaymentMethods(tx);
  const store = await tx.store.create({
    data: {
      name: `Subway Reparto Historico ${randomUUID()}`,
      city: 'Melipilla',
      address: 'Calle 123',
    },
  });
  const workers: string[] = [];
  for (const name of ['Ana', 'Beto', 'Carla']) {
    workers.push(await createUser(tx, ROLE.TRABAJADOR, store.id, name));
  }
  return {
    tx,
    storeId: store.id,
    accountantId: await createUser(tx, ROLE.CONTADOR, null, 'Lucas'),
    supervisorId: await createUser(tx, ROLE.SUPERVISOR, store.id, 'Sofia'),
    workers,
  };
}

// Tres operaciones del período (fondo 12.000) que alimentan el reparto: el
// 02 se reparten 6.000 entre Ana, Beto y Carla; el 08, 4.000 entre Beto y
// Carla, y el 15, 2.000 solo para Carla (2.000/4.000/6.000).
async function legacyPool(
  f: Fixture,
  status: 'DRAFT' | 'CONFIRMED' | 'PAID',
): Promise<LegacyTipPool> {
  const [ana, beto, carla] = f.workers;
  const specs = [
    { date: '2026-10-02', card: 4000, cash: 2000, people: [ana, beto, carla] },
    { date: '2026-10-08', card: 4000, cash: 0, people: [beto, carla] },
    { date: '2026-10-15', card: 0, cash: 2000, people: [carla] },
  ];
  const days = [];
  for (const spec of specs) {
    days.push({
      operationId: await createDailyOperation(f.tx, {
        storeId: f.storeId,
        responsibleId: f.supervisorId,
        businessDate: spec.date,
        cardTipAmount: spec.card,
        cashTipAmount: spec.cash,
        participantIds: spec.people,
      }),
      businessDate: spec.date,
      fundAmount: spec.card + spec.cash,
      participantIds: spec.people,
    });
  }
  return createLegacyTipPool(f.tx, {
    storeId: f.storeId,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    accountantId: f.accountantId,
    days,
    status,
    paymentDate: '2026-10-20',
  });
}

describe.skipIf(!databaseUrl)(
  'Inmutabilidad de los repartos históricos (SPRINT-3-T13 y SPRINT-4A-T08)',
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

    it('desde CONFIRMED la base congela montos y selección de las operaciones fuente', async () => {
      await withinRollback(async (f) => {
        await legacyPool(f, 'CONFIRMED');
        const operation = await f.tx.dailyOperation.findFirstOrThrow({
          where: { storeId: f.storeId, businessDate: day('2026-10-02') },
          select: { id: true },
        });
        // Cada intento rechazado aborta la transacción: se aísla con un
        // savepoint para seguir usándola en el resto del test.
        async function rejected(attempt: () => Promise<unknown>) {
          await f.tx.$executeRaw`SAVEPOINT intento`;
          try {
            await attempt();
          } catch (error) {
            await f.tx.$executeRaw`ROLLBACK TO SAVEPOINT intento`;
            return error;
          }
          throw new Error('Se esperaba un rechazo de la base');
        }
        expect(
          await rejected(
            () =>
              f.tx
                .$executeRaw`DELETE FROM daily_operation_participants WHERE operation_id = ${operation.id}::uuid AND worker_id = ${f.workers[0]}::uuid`,
          ),
        ).toMatchObject({
          message: expect.stringMatching(SOURCE_FEEDS_CLOSED_POOL) as unknown,
        });
        expect(
          await rejected(
            () =>
              f.tx
                .$executeRaw`UPDATE daily_operations SET cash_tip_amount = 9000, tip_fund_amount = 13000 WHERE id = ${operation.id}::uuid`,
          ),
        ).toMatchObject({
          message: expect.stringMatching(SOURCE_FEEDS_CLOSED_POOL) as unknown,
        });
        expect(
          await f.tx.dailyOperationParticipant.count({
            where: { operationId: operation.id },
          }),
        ).toBe(3);
      });
    });

    it('un DRAFT no congela sus operaciones fuente', async () => {
      await withinRollback(async (f) => {
        const draft = await legacyPool(f, 'DRAFT');
        const operation = await f.tx.dailyOperation.findFirstOrThrow({
          where: { storeId: f.storeId, businessDate: day('2026-10-08') },
          select: { id: true },
        });
        await f.tx
          .$executeRaw`DELETE FROM daily_operation_participants WHERE operation_id = ${operation.id}::uuid AND worker_id = ${f.workers[1]}::uuid`;
        expect(
          await f.tx.dailyOperationParticipant.count({
            where: { operationId: operation.id },
          }),
        ).toBe(1);
        // La foto del borrador no cambia: queda como histórico sin efecto.
        expect(
          await f.tx.tipPoolLine.count({ where: { poolId: draft.id } }),
        ).toBe(3);
      });
    });

    it('no se puede cambiar el total de un reparto CONFIRMED', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'CONFIRMED');
        await expect(
          f.tx
            .$executeRaw`UPDATE tip_pools SET total_amount = 1 WHERE id = ${pool.id}::uuid`,
        ).rejects.toThrow(CONFIRMED_IMMUTABLE);
      });
    });

    it('no se puede cambiar la fecha de cálculo de un reparto CONFIRMED', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'CONFIRMED');
        await expect(
          f.tx
            .$executeRaw`UPDATE tip_pools SET calculated_at = now() - interval '1 day' WHERE id = ${pool.id}::uuid`,
        ).rejects.toThrow(CONFIRMED_IMMUTABLE);
      });
    });

    it('no se pueden cambiar las observaciones de un reparto CONFIRMED', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'CONFIRMED');
        await expect(
          f.tx
            .$executeRaw`UPDATE tip_pools SET notes = 'cambio' WHERE id = ${pool.id}::uuid`,
        ).rejects.toThrow(CONFIRMED_IMMUTABLE);
      });
    });

    it('no se puede cambiar una línea de un reparto CONFIRMED', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'CONFIRMED');
        await expect(
          f.tx
            .$executeRaw`UPDATE tip_pool_lines SET amount = 1 WHERE pool_id = ${pool.id}::uuid`,
        ).rejects.toThrow(NOT_DRAFT);
      });
    });

    it('no se pueden agregar ni quitar fuentes de un reparto CONFIRMED', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'CONFIRMED');
        await expect(
          f.tx
            .$executeRaw`DELETE FROM tip_pool_daily_operation_sources WHERE pool_id = ${pool.id}::uuid`,
        ).rejects.toThrow(NOT_DRAFT);
      });
    });

    it('un CONFIRMED no vuelve a DRAFT', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'CONFIRMED');
        await expect(
          f.tx.$executeRaw`
              UPDATE tip_pools
              SET status = 'DRAFT', confirmed_at = NULL, confirmed_by_id = NULL,
                  version = version + 1
              WHERE id = ${pool.id}::uuid`,
        ).rejects.toThrow(/no puede volver a DRAFT/);
      });
    });

    it('un CONFIRMED solo cambia para pasar a PAID', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'CONFIRMED');
        await expect(
          f.tx
            .$executeRaw`UPDATE tip_pools SET version = version + 1 WHERE id = ${pool.id}::uuid`,
        ).rejects.toThrow(/solo puede pasar a PAID/);
      });
    });

    it('un DRAFT no pasa directo a PAID', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'DRAFT');
        await expect(
          f.tx.$executeRaw`
              UPDATE tip_pools
              SET status = 'PAID', confirmed_at = now(),
                  confirmed_by_id = ${f.accountantId}::uuid, paid_at = now(),
                  paid_by_id = ${f.accountantId}::uuid,
                  payment_date = '2026-10-20'
              WHERE id = ${pool.id}::uuid`,
        ).rejects.toThrow(/debe confirmarse antes/);
      });
    });

    it('se rechaza cualquier UPDATE sobre un reparto PAID', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'PAID');
        await expect(
          f.tx
            .$executeRaw`UPDATE tip_pools SET version = version WHERE id = ${pool.id}::uuid`,
        ).rejects.toThrow(PAID_IMMUTABLE);
      });
    });

    it.each(['CONFIRMED', 'PAID'] as const)(
      'no se puede eliminar un reparto %s',
      async (status) => {
        await withinRollback(async (f) => {
          const pool = await legacyPool(f, status);
          // En PAID las constancias (FK Restrict) se eliminan primero en
          // la cascada; el trigger del reparto rechaza antes de llegar ahí.
          await expect(
            f.tx.$executeRaw`DELETE FROM tip_pools WHERE id = ${pool.id}::uuid`,
          ).rejects.toThrow(/no se puede eliminar/);
        });
      },
    );

    it('un DRAFT sí se puede eliminar con sus líneas y fuentes', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'DRAFT');
        await f.tx
          .$executeRaw`DELETE FROM tip_pools WHERE id = ${pool.id}::uuid`;
        expect(
          await f.tx.tipPoolLine.count({ where: { poolId: pool.id } }),
        ).toBe(0);
      });
    });

    it('no se puede modificar una constancia', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'PAID');
        await expect(
          f.tx
            .$executeRaw`UPDATE tip_pool_receipts SET amount = 1 WHERE pool_id = ${pool.id}::uuid`,
        ).rejects.toThrow(RECEIPTS_IMMUTABLE);
      });
    });

    it('no se puede eliminar una constancia', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'PAID');
        await expect(
          f.tx
            .$executeRaw`DELETE FROM tip_pool_receipts WHERE pool_id = ${pool.id}::uuid`,
        ).rejects.toThrow(RECEIPTS_IMMUTABLE);
      });
    });

    it('no se puede vaciar la tabla de constancias', async () => {
      await withinRollback(async (f) => {
        await expect(
          f.tx.$executeRaw`TRUNCATE tip_pool_receipts`,
        ).rejects.toThrow(RECEIPTS_IMMUTABLE);
      });
    });

    it('no se puede insertar una constancia de un reparto que no está PAID', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'CONFIRMED');
        const line = pool.lines[0];
        await expect(
          f.tx.tipPoolReceipt.create({
            data: {
              poolId: pool.id,
              userId: line.userId,
              workerName: 'Ana Historico',
              storeId: f.storeId,
              storeName: 'Subway Reparto Historico',
              periodStart: day(PERIOD.start),
              periodEnd: day(PERIOD.end),
              hoursWorked: null,
              amount: line.amount,
              paymentDate: day('2026-10-20'),
              paidById: f.accountantId,
              paidByName: 'Lucas Pago',
              detail: {},
            },
          }),
        ).rejects.toThrow(/Solo se emiten constancias de un reparto pagado/);
      });
    });

    it('no se puede insertar una constancia que no coincide con su línea', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'PAID');
        // Una segunda constancia del mismo reparto para alguien sin línea.
        await expect(
          f.tx.tipPoolReceipt.create({
            data: {
              poolId: pool.id,
              userId: f.supervisorId,
              workerName: 'Intruso',
              storeId: f.storeId,
              storeName: 'Subway Reparto Historico',
              periodStart: day(PERIOD.start),
              periodEnd: day(PERIOD.end),
              hoursWorked: null,
              amount: 1,
              paymentDate: day('2026-10-20'),
              paidById: f.accountantId,
              paidByName: 'Lucas Pago',
              detail: {},
            },
          }),
        ).rejects.toThrow(/no coincide con el reparto/);
      });
    });

    it('el CHECK exige fecha de pago desde el término del período', async () => {
      await withinRollback(async (f) => {
        const pool = await legacyPool(f, 'CONFIRMED');
        await expect(
          f.tx.$executeRaw`
              UPDATE tip_pools
              SET status = 'PAID', paid_at = now(),
                  paid_by_id = ${f.accountantId}::uuid,
                  payment_date = '2026-10-14', version = version + 1
              WHERE id = ${pool.id}::uuid`,
        ).rejects.toThrow(/tip_pools_status_consistency/);
      });
    });
  },
);
