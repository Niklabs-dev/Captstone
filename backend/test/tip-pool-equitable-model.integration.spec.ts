import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Tests de integración de la regla equitativa y la fuente diaria del reparto
// (SPRINT-4R-T02) contra PostgreSQL real: EQUAL_SHARES convive con la regla
// proporcional sin reinterpretarla; las líneas y constancias equitativas no
// llevan horas inventadas (NULL validado por triggers) y la fuente alimentada
// por la operación diaria concilia su monto CLP entero con el fondo, del mismo
// local y una sola vez. Se omiten si no se define TEST_DATABASE_URL. Cada
// rechazo esperado va en su propio withinRollback y es la última sentencia.
const databaseUrl = process.env.TEST_DATABASE_URL;

const BUSINESS_DATE = new Date('2026-03-10T00:00:00.000Z');
const OTRO_DIA = new Date('2026-03-11T00:00:00.000Z');

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

describe.skipIf(!databaseUrl)(
  'Modelo de reparto equitativo y fuente diaria (SPRINT-4R-T02)',
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

    async function withinRollback(
      fn: (tx: Prisma.TransactionClient) => Promise<void>,
    ): Promise<void> {
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

    interface Base {
      storeId: string;
      otherStoreId: string;
      supervisorId: string;
      workerId: string;
      worker2Id: string;
    }

    async function crearBase(tx: Prisma.TransactionClient): Promise<Base> {
      const store = await tx.store.create({
        data: {
          name: 'Subway Equitativo Modelo Test',
          city: 'Melipilla',
          address: 'Calle 123',
        },
      });
      const otherStore = await tx.store.create({
        data: {
          name: 'Subway Equitativo Modelo Otro',
          city: 'Calera',
          address: 'Calle 456',
        },
      });
      const trabajador = await tx.role.upsert({
        where: { code: 'TRABAJADOR' },
        update: {},
        create: { code: 'TRABAJADOR', name: 'Trabajador' },
      });
      const supervisorRole = await tx.role.upsert({
        where: { code: 'SUPERVISOR' },
        update: {},
        create: { code: 'SUPERVISOR', name: 'Supervisor' },
      });
      const worker = await tx.user.create({
        data: {
          email: 'trabajador-equitativo-modelo@test.invalid',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Ana',
          lastName: 'Equitativa',
          roleId: trabajador.id,
          storeId: store.id,
        },
      });
      const worker2 = await tx.user.create({
        data: {
          email: 'trabajador2-equitativo-modelo@test.invalid',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Beto',
          lastName: 'Equitativo',
          roleId: trabajador.id,
          storeId: store.id,
        },
      });
      const supervisor = await tx.user.create({
        data: {
          email: 'supervisor-equitativo-modelo@test.invalid',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Sup',
          lastName: 'Ervisor',
          roleId: supervisorRole.id,
          storeId: store.id,
        },
      });
      return {
        storeId: store.id,
        otherStoreId: otherStore.id,
        supervisorId: supervisor.id,
        workerId: worker.id,
        worker2Id: worker2.id,
      };
    }

    async function crearOperacion(
      tx: Prisma.TransactionClient,
      storeId: string,
      supervisorId: string,
      fund: bigint,
      businessDate: Date = BUSINESS_DATE,
    ): Promise<string> {
      const operation = await tx.dailyOperation.create({
        data: {
          storeId,
          businessDate,
          cardTipAmount: BigInt(0),
          cashTipAmount: fund,
          tipFundAmount: fund,
          cashDifference: BigInt(0),
          responsibleId: supervisorId,
        },
      });
      return operation.id;
    }

    interface RepartoOptions {
      fecha?: Date;
      // false deja el reparto histórico: sin pacto ni snapshot.
      conPacto?: boolean;
    }

    // Reparto DRAFT de un día con la regla indicada; el snapshot copia el
    // pacto como hace el cálculo real. El pacto se reutiliza por local/regla
    // porque su clave natural es (store_id, valid_from).
    async function crearReparto(
      tx: Prisma.TransactionClient,
      base: Base,
      rule: 'EQUAL_SHARES' | 'PROPORTIONAL_TO_HOURS',
      options: RepartoOptions = {},
    ): Promise<string> {
      const { fecha = BUSINESS_DATE, conPacto = true } = options;
      let agreementId: string | null = null;
      let snapshot: Prisma.InputJsonValue | null = null;
      if (conPacto) {
        let agreement = await tx.tipAgreement.findFirst({
          where: { storeId: base.storeId, rule },
        });
        if (!agreement) {
          agreement = await tx.tipAgreement.create({
            data: {
              name: `Pacto ${rule}`,
              rule,
              validFrom: new Date('2026-01-01T00:00:00.000Z'),
              storeId: base.storeId,
              createdById: base.supervisorId,
            },
          });
        }
        agreementId = agreement.id;
        snapshot = { id: agreement.id, name: agreement.name, rule };
      }
      const pool = await tx.tipPool.create({
        data: {
          storeId: base.storeId,
          periodStart: fecha,
          periodEnd: fecha,
          totalAmount: new Prisma.Decimal(1500),
          calculatedById: base.supervisorId,
          agreementId,
          agreementSnapshot: snapshot,
        },
      });
      return pool.id;
    }

    // Las líneas equitativas se insertan por SQL: el cliente de Prisma aún
    // exige hoursWorked (se vuelve opcional en SPRINT-4R-T04) y aquí se
    // demuestra la regla para cualquier vía de escritura.
    function insertarLineaSinHoras(
      tx: Prisma.TransactionClient,
      poolId: string,
      workerId: string,
      amount: string,
    ): Promise<number> {
      return tx.$executeRaw(
        Prisma.sql`INSERT INTO "tip_pool_lines" ("pool_id", "user_id", "hours_worked", "amount") VALUES (${poolId}, ${workerId}, NULL, ${amount})`,
      );
    }

    it('guarda el pacto con la regla equitativa explícita', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const agreement = await tx.tipAgreement.create({
          data: {
            name: 'Reparto equitativo',
            rule: 'EQUAL_SHARES',
            validFrom: new Date('2026-01-01T00:00:00.000Z'),
            storeId: base.storeId,
            createdById: base.supervisorId,
          },
        });
        expect(agreement.rule).toBe('EQUAL_SHARES');
      });
    });

    it('guarda la línea equitativa sin horas y conserva su monto final', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const poolId = await crearReparto(tx, base, 'EQUAL_SHARES');
        await insertarLineaSinHoras(tx, poolId, base.workerId, '750');

        const line = await tx.tipPoolLine.findFirstOrThrow({
          where: { poolId, userId: base.workerId },
        });
        // El monto final vive en tip_pool_lines; las horas no se inventan.
        expect(line.amount.toString()).toBe('750');
        expect(line.hoursWorked).toBeNull();
        expect(line.workHoursRecordId).toBeNull();
      });
    });

    it('rechaza la línea equitativa con horas trabajadas', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const poolId = await crearReparto(tx, base, 'EQUAL_SHARES');
        await expect(
          tx.tipPoolLine.create({
            data: {
              poolId,
              userId: base.workerId,
              hoursWorked: new Prisma.Decimal(8),
              amount: new Prisma.Decimal(750),
            },
          }),
        ).rejects.toThrow(/no lleva horas trabajadas/);
      });
    });

    it('sigue exigiendo horas en la línea proporcional y acepta la histórica', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const poolId = await crearReparto(tx, base, 'PROPORTIONAL_TO_HOURS');
        const line = await tx.tipPoolLine.create({
          data: {
            poolId,
            userId: base.workerId,
            hoursWorked: new Prisma.Decimal(8),
            amount: new Prisma.Decimal(750),
          },
        });
        expect(line.hoursWorked.toString()).toBe('8');

        await expect(
          insertarLineaSinHoras(tx, poolId, base.worker2Id, '750'),
        ).rejects.toThrow(/requiere horas trabajadas/);
      });
    });

    it('sigue exigiendo horas en los repartos históricos sin pacto ni snapshot', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const poolId = await crearReparto(tx, base, 'PROPORTIONAL_TO_HOURS', {
          conPacto: false,
        });
        await expect(
          insertarLineaSinHoras(tx, poolId, base.workerId, '750'),
        ).rejects.toThrow(/requiere horas trabajadas/);
      });
    });

    it('resuelve la regla desde el snapshot: cambiar el pacto vigente no reinterpreta el reparto equitativo', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const poolId = await crearReparto(tx, base, 'EQUAL_SHARES');
        await insertarLineaSinHoras(tx, poolId, base.workerId, '750');

        // Si el pacto vigente cambia (aquí su regla), la foto del reparto
        // (agreement_snapshot) sigue mandando: la línea equitativa sigue sin
        // horas y no se reinterpreta como proporcional.
        const agreement = await tx.tipAgreement.findFirstOrThrow({
          where: { storeId: base.storeId, rule: 'EQUAL_SHARES' },
        });
        await tx.tipAgreement.update({
          where: { id: agreement.id },
          data: { rule: 'PROPORTIONAL_TO_HOURS' },
        });
        await insertarLineaSinHoras(tx, poolId, base.worker2Id, '750');

        const lines = await tx.tipPoolLine.findMany({ where: { poolId } });
        expect(lines).toHaveLength(2);
        expect(lines.every((line) => line.hoursWorked === null)).toBe(true);
      });
    });

    it('emite la constancia equitativa sin horas y rechaza la que las inventa', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const poolId = await crearReparto(tx, base, 'EQUAL_SHARES');
        const operationId = await crearOperacion(
          tx,
          base.storeId,
          base.supervisorId,
          BigInt(1500),
        );
        await tx.tipPoolDailyOperationSource.create({
          data: { poolId, operationId, amount: BigInt(1500) },
        });
        await insertarLineaSinHoras(tx, poolId, base.workerId, '1500');
        await tx.tipPool.update({
          where: { id: poolId },
          data: {
            status: 'CONFIRMED',
            confirmedAt: new Date(),
            confirmedById: base.supervisorId,
          },
        });
        await tx.tipPool.update({
          where: { id: poolId },
          data: {
            status: 'PAID',
            paidAt: new Date(),
            paidById: base.supervisorId,
            paymentDate: BUSINESS_DATE,
            version: { increment: 1 },
          },
        });

        // La constancia copia la línea: horas NULL en ambas, monto exacto.
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "tip_pool_receipts" (
            "worker_name", "store_name", "period_start", "period_end",
            "hours_worked", "amount", "payment_date", "paid_by_name",
            "detail", "pool_id", "user_id", "store_id", "paid_by_id"
          ) VALUES (
            'Ana Equitativa', 'Subway Equitativo Modelo Test',
            ${BUSINESS_DATE}, ${BUSINESS_DATE},
            NULL, 1500, ${BUSINESS_DATE}, 'Sup Ervisor',
            '{}', ${poolId}, ${base.workerId}, ${base.storeId}, ${base.supervisorId}
          )`,
        );
        const receipt = await tx.tipPoolReceipt.findFirstOrThrow({
          where: { poolId },
        });
        expect(receipt.amount.toString()).toBe('1500');
        expect(receipt.hoursWorked).toBeNull();

        // La constancia equitativa con horas no cuadra con su línea.
        await expect(
          tx.$executeRaw(
            Prisma.sql`INSERT INTO "tip_pool_receipts" (
              "worker_name", "store_name", "period_start", "period_end",
              "hours_worked", "amount", "payment_date", "paid_by_name",
              "detail", "pool_id", "user_id", "store_id", "paid_by_id"
            ) VALUES (
              'Ana Equitativa', 'Subway Equitativo Modelo Test',
              ${BUSINESS_DATE}, ${BUSINESS_DATE},
              8, 1500, ${BUSINESS_DATE}, 'Sup Ervisor',
              '{}', ${poolId}, ${base.workerId}, ${base.storeId}, ${base.supervisorId}
            )`,
          ),
        ).rejects.toThrow(/no lleva horas trabajadas/);
      });
    });

    describe('fuente del reparto alimentada por la operación diaria', () => {
      it('concilia el monto exacto del fondo y lo conserva aunque se corrija la operación', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const poolId = await crearReparto(tx, base, 'EQUAL_SHARES');
          const operationId = await crearOperacion(
            tx,
            base.storeId,
            base.supervisorId,
            BigInt(36102),
          );
          const source = await tx.tipPoolDailyOperationSource.create({
            data: { poolId, operationId, amount: BigInt(36102) },
          });
          expect(source.amount).toBe(BigInt(36102));

          // Corrección del DRAFT: la fuente conserva el monto aplicado.
          await tx.dailyOperation.update({
            where: { id: operationId },
            data: {
              cashTipAmount: BigInt(40000),
              tipFundAmount: BigInt(40000),
            },
          });
          const unchanged =
            await tx.tipPoolDailyOperationSource.findUniqueOrThrow({
              where: { id: source.id },
            });
          expect(unchanged.amount).toBe(BigInt(36102));
        });
      });

      it('rechaza el monto distinto del fondo de la operación', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const poolId = await crearReparto(tx, base, 'EQUAL_SHARES');
          const operationId = await crearOperacion(
            tx,
            base.storeId,
            base.supervisorId,
            BigInt(36102),
          );
          await expect(
            tx.tipPoolDailyOperationSource.create({
              data: { poolId, operationId, amount: BigInt(36000) },
            }),
          ).rejects.toThrow(/no concilia/);
        });
      });

      it('rechaza la fuente que mezcla locales', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const poolId = await crearReparto(tx, base, 'EQUAL_SHARES');
          const foreignOperation = await crearOperacion(
            tx,
            base.otherStoreId,
            base.supervisorId,
            BigInt(36102),
          );
          await expect(
            tx.tipPoolDailyOperationSource.create({
              data: {
                poolId,
                operationId: foreignOperation,
                amount: BigInt(36102),
              },
            }),
          ).rejects.toThrow(/no concilia/);
        });
      });

      it('permite usar la operación en una sola fuente', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const poolId = await crearReparto(tx, base, 'EQUAL_SHARES');
          const otroPoolId = await crearReparto(tx, base, 'EQUAL_SHARES', {
            fecha: OTRO_DIA,
          });
          const operationId = await crearOperacion(
            tx,
            base.storeId,
            base.supervisorId,
            BigInt(36102),
          );
          await tx.tipPoolDailyOperationSource.create({
            data: { poolId, operationId, amount: BigInt(36102) },
          });
          await expect(
            tx.tipPoolDailyOperationSource.create({
              data: {
                poolId: otroPoolId,
                operationId,
                amount: BigInt(36102),
              },
            }),
          ).rejects.toThrow(/operation_id/);
        });
      });

      it('solo cambia en DRAFT: insertar y eliminar con reparto cerrado falla', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const poolId = await crearReparto(tx, base, 'EQUAL_SHARES');
          const operationId = await crearOperacion(
            tx,
            base.storeId,
            base.supervisorId,
            BigInt(36102),
          );
          const source = await tx.tipPoolDailyOperationSource.create({
            data: { poolId, operationId, amount: BigInt(36102) },
          });
          await tx.tipPool.update({
            where: { id: poolId },
            data: {
              status: 'CONFIRMED',
              confirmedAt: new Date(),
              confirmedById: base.supervisorId,
            },
          });

          const otraOperation = await crearOperacion(
            tx,
            base.storeId,
            base.supervisorId,
            BigInt(1000),
            OTRO_DIA,
          );
          const otroPoolId = await crearReparto(tx, base, 'EQUAL_SHARES', {
            fecha: OTRO_DIA,
          });
          await expect(
            tx.tipPoolDailyOperationSource.create({
              data: {
                poolId,
                operationId: otraOperation,
                amount: BigInt(1000),
              },
            }),
          ).rejects.toThrow(/ya no está en DRAFT/);
          await expect(
            tx.tipPoolDailyOperationSource.create({
              data: {
                poolId: otroPoolId,
                operationId: otraOperation,
                amount: BigInt(1000),
              },
            }),
          ).rejects.toThrow(/ya no está en DRAFT/);
          await expect(
            tx.tipPoolDailyOperationSource.delete({
              where: { id: source.id },
            }),
          ).rejects.toThrow(/ya no está en DRAFT/);
        });
      });
    });
  },
);
