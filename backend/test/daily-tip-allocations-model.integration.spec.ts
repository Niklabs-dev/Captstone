import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Tests de integración del modelo de propinas diarias por trabajador y lotes
// de pago (SPRINT-4A-T02) contra PostgreSQL real: CHECK de monto y estado,
// coherencia con la operación y sus participantes, conciliación diferida
// (suma = fondo, una por participante), lote inmutable con totales
// cuadrados, asignación PAID inmutable y bloqueo de la operación pagada.
// Cada caso corre en withinRollback (la base se revierte). Los constraint
// triggers diferidos se fuerzan con SET CONSTRAINTS ALL IMMEDIATE; cada
// rechazo esperado es la última sentencia: un error aborta la transacción.
const databaseUrl = process.env.TEST_DATABASE_URL;

const BUSINESS_DATE = new Date('2026-03-10T00:00:00.000Z');

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

type Tx = Prisma.TransactionClient;

interface Base {
  storeId: string;
  otherStoreId: string;
  supervisorId: string;
  workerId: string;
  worker2Id: string;
  accountantId: string;
}

interface Day {
  operationId: string;
  allocationIds: Record<string, string>;
}

describe.skipIf(!databaseUrl)(
  'Modelo de propinas diarias y lotes de pago (SPRINT-4A-T02)',
  { timeout: 60_000 },
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

    async function withinRollback(fn: (tx: Tx) => Promise<void>) {
      try {
        await prisma.$transaction(
          async (tx) => {
            await fn(tx);
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 60_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    }

    // Evalúa ahora los constraint triggers diferidos (conciliación y totales
    // del lote) en vez de esperar al commit, que en estos tests nunca llega.
    function checkDeferred(tx: Tx): Promise<number> {
      return tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
    }

    async function createUser(
      tx: Tx,
      role: string,
      storeId: string | null,
    ): Promise<string> {
      const roleRecord = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const user = await tx.user.create({
        data: {
          email: `${randomUUID()}@tip-allocations-model.invalid`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: role,
          lastName: 'Modelo',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return user.id;
    }

    async function createBase(tx: Tx): Promise<Base> {
      const store = await tx.store.create({
        data: {
          name: `Subway Propinas Diarias ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle 123',
        },
      });
      const otherStore = await tx.store.create({
        data: {
          name: `Subway Propinas Diarias Otro ${randomUUID()}`,
          city: 'Calera',
          address: 'Calle 456',
        },
      });
      return {
        storeId: store.id,
        otherStoreId: otherStore.id,
        supervisorId: await createUser(tx, 'SUPERVISOR', store.id),
        workerId: await createUser(tx, 'TRABAJADOR', store.id),
        worker2Id: await createUser(tx, 'TRABAJADOR', store.id),
        accountantId: await createUser(tx, 'CONTADOR', null),
      };
    }

    // Operación en efectivo (sin voucher) con su selección y, si se indican,
    // sus asignaciones UNPAID por trabajador.
    async function createDay(
      tx: Tx,
      base: Base,
      fund: number,
      shares: Record<string, number>,
      businessDate: Date = BUSINESS_DATE,
    ): Promise<Day> {
      const operation = await tx.dailyOperation.create({
        data: {
          storeId: base.storeId,
          businessDate,
          cardTipAmount: BigInt(0),
          cashTipAmount: BigInt(fund),
          tipFundAmount: BigInt(fund),
          cashDifference: BigInt(0),
          responsibleId: base.supervisorId,
        },
      });
      const workerIds = Object.keys(shares);
      await tx.dailyOperationParticipant.createMany({
        data: workerIds.map((workerId) => ({
          operationId: operation.id,
          workerId,
        })),
      });
      const allocationIds: Record<string, string> = {};
      for (const workerId of workerIds) {
        const allocation = await tx.dailyTipAllocation.create({
          data: {
            operationId: operation.id,
            storeId: base.storeId,
            businessDate,
            workerId,
            amount: BigInt(shares[workerId]),
          },
        });
        allocationIds[workerId] = allocation.id;
      }
      return { operationId: operation.id, allocationIds };
    }

    // Lote del local y período que marca como PAID las asignaciones dadas.
    async function pay(
      tx: Tx,
      base: Base,
      allocationIds: string[],
      totals: { total: number; count: number },
      period: { start: Date; end: Date } = {
        start: BUSINESS_DATE,
        end: BUSINESS_DATE,
      },
    ): Promise<string> {
      const batch = await tx.tipPaymentBatch.create({
        data: {
          storeId: base.storeId,
          periodStart: period.start,
          periodEnd: period.end,
          totalAmount: BigInt(totals.total),
          allocationCount: totals.count,
          paidById: base.accountantId,
          paidAt: new Date(),
        },
      });
      await tx.dailyTipAllocation.updateMany({
        where: { id: { in: allocationIds } },
        data: { status: 'PAID', paymentBatchId: batch.id },
      });
      return batch.id;
    }

    it('guarda una asignación UNPAID por trabajador que concilia con el fondo', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 10_001, {
          [base.workerId]: 5_001,
          [base.worker2Id]: 5_000,
        });
        await checkDeferred(tx);
        const rows = await tx.dailyTipAllocation.findMany({
          where: { operationId: day.operationId },
        });
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.status).toBe('UNPAID');
          expect(row.paymentBatchId).toBeNull();
          expect(row.storeId).toBe(base.storeId);
          expect(row.businessDate).toEqual(BUSINESS_DATE);
        }
        expect(rows.reduce((sum, row) => sum + row.amount, 0n)).toBe(10_001n);
      });
    });

    it('impide dos asignaciones del mismo trabajador en la misma operación', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 1_000, {
          [base.workerId]: 1_000,
        });
        await expect(
          tx.dailyTipAllocation.create({
            data: {
              operationId: day.operationId,
              storeId: base.storeId,
              businessDate: BUSINESS_DATE,
              workerId: base.workerId,
              amount: BigInt(0),
            },
          }),
        ).rejects.toThrow(/operation_id_worker_id/);
      });
    });

    it('rechaza montos negativos (CHECK)', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        await expect(
          createDay(tx, base, 0, { [base.workerId]: -1 }),
        ).rejects.toThrow(/daily_tip_allocations_amount_nonnegative/);
      });
    });

    it('rechaza nacer PAID: la propina se crea No pagada', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 1_000, {
          [base.workerId]: 1_000,
        });
        const batchId = await pay(tx, base, [], { total: 0, count: 1 });
        await expect(
          tx.dailyTipAllocation.create({
            data: {
              operationId: day.operationId,
              storeId: base.storeId,
              businessDate: BUSINESS_DATE,
              workerId: base.worker2Id,
              amount: BigInt(0),
              status: 'PAID',
              paymentBatchId: batchId,
            },
          }),
        ).rejects.toThrow(/nace No pagada/);
      });
    });

    it('PAID exige lote', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 1_000, {
          [base.workerId]: 1_000,
        });
        await expect(
          tx.dailyTipAllocation.update({
            where: { id: day.allocationIds[base.workerId] },
            data: { status: 'PAID' },
          }),
          // El trigger rechaza antes que el CHECK: sin lote no hay un lote
          // del local y período que respalde el pago.
        ).rejects.toThrow(/no corresponde al local ni al período/);
      });
    });

    it('UNPAID no admite lote (CHECK)', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 1_000, {
          [base.workerId]: 1_000,
        });
        const batchId = await pay(tx, base, [], { total: 0, count: 1 });
        await expect(
          tx.dailyTipAllocation.update({
            where: { id: day.allocationIds[base.workerId] },
            data: { paymentBatchId: batchId },
          }),
        ).rejects.toThrow(/daily_tip_allocations_paid_requires_batch/);
      });
    });

    it('exige copiar el local y la fecha de la operación', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 1_000, {
          [base.workerId]: 1_000,
        });
        await expect(
          tx.dailyTipAllocation.create({
            data: {
              operationId: day.operationId,
              storeId: base.storeId,
              businessDate: new Date('2026-03-11T00:00:00.000Z'),
              workerId: base.worker2Id,
              amount: BigInt(0),
            },
          }),
        ).rejects.toThrow(/copiar el local y la fecha/);
      });
    });

    it('rechaza la asignación de quien no participa de la operación', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 1_000, {
          [base.workerId]: 1_000,
        });
        await expect(
          tx.dailyTipAllocation.create({
            data: {
              operationId: day.operationId,
              storeId: base.storeId,
              businessDate: BUSINESS_DATE,
              workerId: base.worker2Id,
              amount: BigInt(0),
            },
          }),
        ).rejects.toThrow(/no participa de la operación/);
      });
    });

    it('la conciliación diferida rechaza asignaciones que no suman el fondo', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        await createDay(tx, base, 10_000, {
          [base.workerId]: 5_000,
          [base.worker2Id]: 4_999,
        });
        await expect(checkDeferred(tx)).rejects.toThrow(
          /suman 9999 y su fondo es 10000/,
        );
      });
    });

    it('la conciliación diferida exige una asignación por participante', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 10_000, {
          [base.workerId]: 10_000,
        });
        // Un segundo participante sin asignación descuadra la selección.
        await tx.dailyOperationParticipant.create({
          data: { operationId: day.operationId, workerId: base.worker2Id },
        });
        await expect(checkDeferred(tx)).rejects.toThrow(/una por participante/);
      });
    });

    it('la conciliación diferida detecta un fondo corregido sin recalcular', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 10_000, {
          [base.workerId]: 10_000,
        });
        await tx.dailyOperation.update({
          where: { id: day.operationId },
          data: {
            cashTipAmount: BigInt(12_000),
            tipFundAmount: BigInt(12_000),
          },
        });
        await expect(checkDeferred(tx)).rejects.toThrow(/deben ser iguales/);
      });
    });

    // SPRINT-4A-T03 (migración 20261110050000_reparto_diario_automatico):
    // el reparto es obligatorio cuando hay fondo y participantes.
    it('exige el reparto de una operación con fondo y participantes', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 10_000, {});
        await tx.dailyOperationParticipant.create({
          data: { operationId: day.operationId, workerId: base.workerId },
        });
        await expect(checkDeferred(tx)).rejects.toThrow(
          /no tiene su reparto de propinas diarias/,
        );
      });
    });

    it('acepta sin reparto el fondo 0 y el fondo sin participantes (histórico)', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        await createDay(tx, base, 0, {});
        await createDay(
          tx,
          base,
          9_000,
          {},
          new Date('2026-03-11T00:00:00.000Z'),
        );
        await expect(checkDeferred(tx)).resolves.toBe(0);
      });
    });

    it('recalcular dentro de la transacción (borrar y crear UNPAID) concilia al final', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const day = await createDay(tx, base, 10_000, {
          [base.workerId]: 10_000,
        });
        await tx.dailyOperation.update({
          where: { id: day.operationId },
          data: { cashTipAmount: BigInt(9_001), tipFundAmount: BigInt(9_001) },
        });
        await tx.dailyTipAllocation.deleteMany({
          where: { operationId: day.operationId },
        });
        await tx.dailyOperationParticipant.create({
          data: { operationId: day.operationId, workerId: base.worker2Id },
        });
        await tx.dailyTipAllocation.createMany({
          data: [
            { amount: BigInt(4_501), workerId: base.workerId },
            { amount: BigInt(4_500), workerId: base.worker2Id },
          ].map((row) => ({
            ...row,
            operationId: day.operationId,
            storeId: base.storeId,
            businessDate: BUSINESS_DATE,
          })),
        });
        await expect(checkDeferred(tx)).resolves.toBe(0);
      });
    });

    describe('lotes de pago', () => {
      it('marca PAID las asignaciones del período con totales cuadrados', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const day = await createDay(tx, base, 10_001, {
            [base.workerId]: 5_001,
            [base.worker2Id]: 5_000,
          });
          const batchId = await pay(
            tx,
            base,
            Object.values(day.allocationIds),
            { total: 10_001, count: 2 },
          );
          await checkDeferred(tx);
          const paid = await tx.dailyTipAllocation.findMany({
            where: { paymentBatchId: batchId },
          });
          expect(paid.map((row) => row.status)).toEqual(['PAID', 'PAID']);
          const batch = await tx.tipPaymentBatch.findUniqueOrThrow({
            where: { id: batchId },
            include: { paidBy: { select: { id: true } } },
          });
          expect(batch.paidBy.id).toBe(base.accountantId);
          expect(batch.legacyPoolId).toBeNull();
        });
      });

      it('rechaza totales del lote que no cuadran con lo marcado', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const day = await createDay(tx, base, 10_001, {
            [base.workerId]: 5_001,
            [base.worker2Id]: 5_000,
          });
          await pay(tx, base, [day.allocationIds[base.workerId]], {
            total: 10_001,
            count: 2,
          });
          await expect(checkDeferred(tx)).rejects.toThrow(
            /declara 2 asignaciones por 10001 y marcó 1 por 5001/,
          );
        });
      });

      it('rechaza un lote de otro local', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const day = await createDay(tx, base, 1_000, {
            [base.workerId]: 1_000,
          });
          const batch = await tx.tipPaymentBatch.create({
            data: {
              storeId: base.otherStoreId,
              periodStart: BUSINESS_DATE,
              periodEnd: BUSINESS_DATE,
              totalAmount: BigInt(1_000),
              allocationCount: 1,
              paidById: base.accountantId,
              paidAt: new Date(),
            },
          });
          await expect(
            tx.dailyTipAllocation.update({
              where: { id: day.allocationIds[base.workerId] },
              data: { status: 'PAID', paymentBatchId: batch.id },
            }),
          ).rejects.toThrow(/no corresponde al local ni al período/);
        });
      });

      it('rechaza un lote cuyo período no cubre la fecha', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const day = await createDay(tx, base, 1_000, {
            [base.workerId]: 1_000,
          });
          await expect(
            pay(
              tx,
              base,
              [day.allocationIds[base.workerId]],
              {
                total: 1_000,
                count: 1,
              },
              {
                start: new Date('2026-03-11T00:00:00.000Z'),
                end: new Date('2026-03-31T00:00:00.000Z'),
              },
            ),
          ).rejects.toThrow(/no corresponde al local ni al período/);
        });
      });

      it('valida el período, el total y la cantidad del lote (CHECK)', async () => {
        for (const [data, constraint] of [
          [
            {
              periodStart: new Date('2026-03-31T00:00:00.000Z'),
              periodEnd: BUSINESS_DATE,
            },
            'tip_payment_batches_period_valid',
          ],
          [
            { totalAmount: BigInt(-1) },
            'tip_payment_batches_total_nonnegative',
          ],
          [{ allocationCount: 0 }, 'tip_payment_batches_count_positive'],
        ] as const) {
          await withinRollback(async (tx) => {
            const base = await createBase(tx);
            await expect(
              tx.tipPaymentBatch.create({
                data: {
                  storeId: base.storeId,
                  periodStart: BUSINESS_DATE,
                  periodEnd: BUSINESS_DATE,
                  totalAmount: BigInt(0),
                  allocationCount: 1,
                  paidById: base.accountantId,
                  paidAt: new Date(),
                  ...data,
                },
              }),
            ).rejects.toThrow(new RegExp(constraint));
          });
        }
      });

      it('el lote es inmutable: no se modifica ni se elimina', async () => {
        for (const action of ['update', 'delete'] as const) {
          await withinRollback(async (tx) => {
            const base = await createBase(tx);
            const day = await createDay(tx, base, 1_000, {
              [base.workerId]: 1_000,
            });
            const batchId = await pay(
              tx,
              base,
              [day.allocationIds[base.workerId]],
              { total: 1_000, count: 1 },
            );
            const attempt =
              action === 'update'
                ? tx.tipPaymentBatch.update({
                    where: { id: batchId },
                    data: { paidAt: new Date('2026-01-01T00:00:00.000Z') },
                  })
                : tx.tipPaymentBatch.delete({ where: { id: batchId } });
            await expect(attempt).rejects.toThrow(/son inmutables/);
          });
        }
      });

      it('la asignación PAID es inmutable y no se borra', async () => {
        for (const action of ['amount', 'unpay', 'delete'] as const) {
          await withinRollback(async (tx) => {
            const base = await createBase(tx);
            const day = await createDay(tx, base, 1_000, {
              [base.workerId]: 1_000,
            });
            const allocationId = day.allocationIds[base.workerId];
            await pay(tx, base, [allocationId], { total: 1_000, count: 1 });
            const attempt =
              action === 'delete'
                ? tx.dailyTipAllocation.delete({ where: { id: allocationId } })
                : tx.dailyTipAllocation.update({
                    where: { id: allocationId },
                    data:
                      action === 'amount'
                        ? { amount: BigInt(999) }
                        : { status: 'UNPAID', paymentBatchId: null },
                  });
            await expect(attempt).rejects.toThrow(/ya está pagada/);
          });
        }
      });

      it('no permite cambiar el monto al pagar', async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const day = await createDay(tx, base, 1_000, {
            [base.workerId]: 1_000,
          });
          const batch = await tx.tipPaymentBatch.create({
            data: {
              storeId: base.storeId,
              periodStart: BUSINESS_DATE,
              periodEnd: BUSINESS_DATE,
              totalAmount: BigInt(900),
              allocationCount: 1,
              paidById: base.accountantId,
              paidAt: new Date(),
            },
          });
          await expect(
            tx.dailyTipAllocation.update({
              where: { id: day.allocationIds[base.workerId] },
              data: {
                status: 'PAID',
                paymentBatchId: batch.id,
                amount: BigInt(900),
              },
            }),
          ).rejects.toThrow(/no puede cambiar su monto al pagarse/);
        });
      });

      it('con propinas pagadas bloquea corregir montos y participantes, no el motivo', async () => {
        for (const action of [
          'amount',
          'addParticipant',
          'removeParticipant',
          'reason',
        ] as const) {
          await withinRollback(async (tx) => {
            const base = await createBase(tx);
            const day = await createDay(tx, base, 1_000, {
              [base.workerId]: 1_000,
            });
            await pay(tx, base, [day.allocationIds[base.workerId]], {
              total: 1_000,
              count: 1,
            });
            if (action === 'reason') {
              await tx.dailyOperation.update({
                where: { id: day.operationId },
                data: {
                  cashDifference: BigInt(-100),
                  differenceReason: 'Corrección del motivo',
                },
              });
              await expect(checkDeferred(tx)).resolves.toBe(0);
              return;
            }
            const attempt =
              action === 'amount'
                ? tx.dailyOperation.update({
                    where: { id: day.operationId },
                    data: {
                      cashTipAmount: BigInt(2_000),
                      tipFundAmount: BigInt(2_000),
                    },
                  })
                : action === 'addParticipant'
                  ? tx.dailyOperationParticipant.create({
                      data: {
                        operationId: day.operationId,
                        workerId: base.worker2Id,
                      },
                    })
                  : tx.dailyOperationParticipant.deleteMany({
                      where: { operationId: day.operationId },
                    });
            await expect(attempt).rejects.toThrow(/tiene propinas pagadas/);
          });
        }
      });
    });

    it('crea los índices por (local, fecha) y por (trabajador, fecha)', async () => {
      const rows = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'daily_tip_allocations'
        ORDER BY indexname`;
      expect(rows.map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          'daily_tip_allocations_store_id_business_date_idx',
          'daily_tip_allocations_worker_id_business_date_idx',
          'daily_tip_allocations_operation_id_worker_id_key',
        ]),
      );
    });
  },
);
