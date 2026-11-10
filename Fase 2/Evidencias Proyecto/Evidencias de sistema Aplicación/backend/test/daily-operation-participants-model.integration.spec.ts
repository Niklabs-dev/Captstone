import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Tests de integración del modelo de participantes de la operación diaria
// (SPRINT-4R-T02) contra PostgreSQL real: sin duplicados, solo trabajadores
// del mismo local con rol TRABAJADOR o SUPERVISOR (SPRINT-4A-T01) activos al
// insertar, bajas lógicas
// posteriores que no borran el historial y una única selección compartida por
// la propina de tarjeta y la de efectivo del mismo local/día. Se omiten si no
// se define TEST_DATABASE_URL. Cada rechazo esperado va en su propio
// withinRollback y es la última sentencia: un error de la base aborta la
// transacción.
const databaseUrl = process.env.TEST_DATABASE_URL;

const BUSINESS_DATE = new Date('2026-03-10T00:00:00.000Z');

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

describe.skipIf(!databaseUrl)(
  'Modelo de participantes de la operación diaria (SPRINT-4R-T02)',
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
      inactiveWorkerId: string;
    }

    async function crearBase(tx: Prisma.TransactionClient): Promise<Base> {
      const store = await tx.store.create({
        data: {
          name: 'Subway Participantes Modelo Test',
          city: 'Melipilla',
          address: 'Calle 123',
        },
      });
      const otherStore = await tx.store.create({
        data: {
          name: 'Subway Participantes Modelo Otro',
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
          email: 'trabajador-participante-modelo@test.invalid',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Ana',
          lastName: 'Participa',
          roleId: trabajador.id,
          storeId: store.id,
        },
      });
      const worker2 = await tx.user.create({
        data: {
          email: 'trabajador2-participante-modelo@test.invalid',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Beto',
          lastName: 'Participa',
          roleId: trabajador.id,
          storeId: store.id,
        },
      });
      const inactiveWorker = await tx.user.create({
        data: {
          email: 'inactivo-participante-modelo@test.invalid',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Cora',
          lastName: 'De Baja',
          isActive: false,
          roleId: trabajador.id,
          storeId: store.id,
        },
      });
      const supervisor = await tx.user.create({
        data: {
          email: 'supervisor-participante-modelo@test.invalid',
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
        inactiveWorkerId: inactiveWorker.id,
      };
    }

    async function crearOperacion(
      tx: Prisma.TransactionClient,
      base: Base,
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      // Propina de tarjeta y de efectivo en el mismo registro: con tarjeta > 0
      // el voucher fotográfico es obligatorio (regla de SPRINT-4R-T01).
      const voucher = await tx.dailyOperationVoucher.create({
        data: {
          fileName: 'voucher.jpg',
          filePath: `vouchers/2026/03/${base.storeId.slice(0, 8)}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: BigInt(10),
          sha256Hash: 'ab'.repeat(32),
        },
      });
      const operation = await tx.dailyOperation.create({
        data: {
          storeId: base.storeId,
          businessDate: BUSINESS_DATE,
          cardTipAmount: BigInt(31602),
          cashTipAmount: BigInt(4500),
          tipFundAmount: BigInt(36102),
          cashDifference: BigInt(0),
          responsibleId: base.supervisorId,
          voucherId: voucher.id,
          ...overrides,
        },
      });
      return operation.id;
    }

    it('guarda la selección y la recupera junto a ambas propinas del mismo registro', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const operationId = await crearOperacion(tx, base);
        await tx.dailyOperationParticipant.createMany({
          data: [
            { operationId, workerId: base.workerId },
            { operationId, workerId: base.worker2Id },
          ],
        });

        // La consulta recupera la misma selección que se guardó...
        const participants = await tx.dailyOperationParticipant.findMany({
          where: { operationId },
          orderBy: { workerId: 'asc' },
        });
        expect([...participants.map((row) => row.workerId)].sort()).toEqual(
          [base.workerId, base.worker2Id].sort(),
        );

        // ...y una sola operación (única por local/fecha) concentra la propina
        // de tarjeta y la de efectivo: ambas comparten esta selección.
        const operation = await tx.dailyOperation.findUniqueOrThrow({
          where: { id: operationId },
          include: { participants: true },
        });
        expect(operation.cardTipAmount).toBe(BigInt(31602));
        expect(operation.cashTipAmount).toBe(BigInt(4500));
        expect(operation.participants).toHaveLength(2);
      });
    });

    it('impide duplicar al mismo trabajador en la misma operación', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const operationId = await crearOperacion(tx, base);
        await tx.dailyOperationParticipant.create({
          data: { operationId, workerId: base.workerId },
        });
        await expect(
          tx.dailyOperationParticipant.create({
            data: { operationId, workerId: base.workerId },
          }),
        ).rejects.toThrow(/operation_id_worker_id/);
      });
    });

    it('rechaza al trabajador de otro local', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const operationId = await crearOperacion(tx, base);
        const foreignWorker = await tx.user.create({
          data: {
            email: 'foraneo-participante-modelo@test.invalid',
            passwordHash: '$2b$04$hash-de-prueba',
            firstName: 'For',
            lastName: 'Aneo',
            roleId: (
              await tx.role.findUniqueOrThrow({
                where: { code: 'TRABAJADOR' },
              })
            ).id,
            storeId: base.otherStoreId,
          },
        });
        await expect(
          tx.dailyOperationParticipant.create({
            data: { operationId, workerId: foreignWorker.id },
          }),
        ).rejects.toThrow(/trabajador activo del local/);
      });
    });

    // SPRINT-4A-T01: el supervisor también es trabajador del local y recibe
    // su parte (migración 20261110030000_participantes_incluyen_supervisor).
    it('acepta al supervisor activo del mismo local como participante', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const operationId = await crearOperacion(tx, base);
        await tx.dailyOperationParticipant.createMany({
          data: [
            { operationId, workerId: base.supervisorId },
            { operationId, workerId: base.workerId },
          ],
        });
        const participants = await tx.dailyOperationParticipant.findMany({
          where: { operationId },
          select: { workerId: true },
        });
        expect(participants.map((row) => row.workerId).sort()).toEqual(
          [base.supervisorId, base.workerId].sort(),
        );
      });
    });

    // Cada rechazo en su propio withinRollback: el error aborta la
    // transacción. ADMINISTRADOR y CONTADOR se crean con el local de la
    // operación para probar que el rol, y no solo el local, los excluye.
    it.each([
      {
        label: 'ADMINISTRADOR',
        role: 'ADMINISTRADOR',
        local: 'same',
        active: true,
      },
      { label: 'CONTADOR', role: 'CONTADOR', local: 'same', active: true },
      {
        label: 'supervisor inactivo',
        role: 'SUPERVISOR',
        local: 'same',
        active: false,
      },
      {
        label: 'supervisor de otro local',
        role: 'SUPERVISOR',
        local: 'other',
        active: true,
      },
    ] as const)(
      'rechaza al $label como participante',
      async ({ role, local, active }) => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const operationId = await crearOperacion(tx, base);
          const roleRecord = await tx.role.upsert({
            where: { code: role },
            update: {},
            create: { code: role, name: role },
          });
          const user = await tx.user.create({
            data: {
              email: `rechazado-${role.toLowerCase()}-${local}-${String(active)}@test.invalid`,
              passwordHash: '$2b$04$hash-de-prueba',
              firstName: 'No',
              lastName: 'Elegible',
              isActive: active,
              roleId: roleRecord.id,
              storeId: local === 'same' ? base.storeId : base.otherStoreId,
            },
          });
          await expect(
            tx.dailyOperationParticipant.create({
              data: { operationId, workerId: user.id },
            }),
          ).rejects.toThrow(/trabajador activo del local/);
        });
      },
    );

    it('rechaza al trabajador inactivo aunque sea del local', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const operationId = await crearOperacion(tx, base);
        await expect(
          tx.dailyOperationParticipant.create({
            data: { operationId, workerId: base.inactiveWorkerId },
          }),
        ).rejects.toThrow(/trabajador activo del local/);
      });
    });

    it('rechaza al trabajador sin local asignado (global)', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const operationId = await crearOperacion(tx, base);
        const globalWorker = await tx.user.create({
          data: {
            email: 'global-participante-modelo@test.invalid',
            passwordHash: '$2b$04$hash-de-prueba',
            firstName: 'Glo',
            lastName: 'Bal',
            roleId: (
              await tx.role.findUniqueOrThrow({
                where: { code: 'TRABAJADOR' },
              })
            ).id,
            storeId: null,
          },
        });
        await expect(
          tx.dailyOperationParticipant.create({
            data: { operationId, workerId: globalWorker.id },
          }),
        ).rejects.toThrow(/trabajador activo del local/);
      });
    });

    it('conserva la selección cuando el trabajador se desactiva después', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const operationId = await crearOperacion(tx, base);
        await tx.dailyOperationParticipant.create({
          data: { operationId, workerId: base.workerId },
        });

        // Baja lógica posterior: la participación no se borra ni se invalida.
        await tx.user.update({
          where: { id: base.workerId },
          data: { isActive: false },
        });
        const participants = await tx.dailyOperationParticipant.findMany({
          where: { operationId },
        });
        expect(participants).toHaveLength(1);
        expect(participants[0]?.workerId).toBe(base.workerId);
      });
    });

    it('conserva la selección cuando el trabajador cambia de rol o de local después', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const operationId = await crearOperacion(tx, base);
        await tx.dailyOperationParticipant.create({
          data: { operationId, workerId: base.workerId },
        });

        // Cambio de rol y de local posterior: la validación solo corre al
        // escribir la participación, así que el historial queda intacto.
        const supervisorRole = await tx.role.findUniqueOrThrow({
          where: { code: 'SUPERVISOR' },
        });
        await tx.user.update({
          where: { id: base.workerId },
          data: { roleId: supervisorRole.id, storeId: base.otherStoreId },
        });
        const participants = await tx.dailyOperationParticipant.findMany({
          where: { operationId },
        });
        expect(participants).toHaveLength(1);
      });
    });

    describe('con reparto alimentado por la operación', () => {
      interface LockedSetup {
        base: Base;
        operationId: string;
        participantId: string;
      }

      async function crearBaseConParticipante(
        tx: Prisma.TransactionClient,
      ): Promise<LockedSetup> {
        const base = await crearBase(tx);
        const operationId = await crearOperacion(tx, base);
        const participant = await tx.dailyOperationParticipant.create({
          data: { operationId, workerId: base.workerId },
        });
        return { base, operationId, participantId: participant.id };
      }

      // Reparto del día de la operación, alimentado por su fondo.
      async function crearRepartoAlimentado(
        tx: Prisma.TransactionClient,
        setup: LockedSetup,
      ): Promise<string> {
        const pool = await tx.tipPool.create({
          data: {
            storeId: setup.base.storeId,
            periodStart: BUSINESS_DATE,
            periodEnd: BUSINESS_DATE,
            totalAmount: new Prisma.Decimal(36102),
            calculatedById: setup.base.supervisorId,
          },
        });
        await tx.tipPoolDailyOperationSource.create({
          data: {
            poolId: pool.id,
            operationId: setup.operationId,
            amount: BigInt(36102),
          },
        });
        return pool.id;
      }

      function confirmar(
        tx: Prisma.TransactionClient,
        poolId: string,
        supervisorId: string,
      ) {
        return tx.tipPool.update({
          where: { id: poolId },
          data: {
            status: 'CONFIRMED',
            confirmedAt: new Date(),
            confirmedById: supervisorId,
          },
        });
      }

      async function pagar(
        tx: Prisma.TransactionClient,
        poolId: string,
        supervisorId: string,
      ) {
        const pool = await confirmar(tx, poolId, supervisorId);
        await tx.tipPool.update({
          where: { id: pool.id },
          data: {
            status: 'PAID',
            paidAt: new Date(),
            paidById: supervisorId,
            paymentDate: BUSINESS_DATE,
            version: { increment: 1 },
          },
        });
      }

      // Ejecuta fn con la operación alimentando un reparto ya cerrado (un
      // rechazo esperado aborta la transacción, así cada aserción va en la
      // suya propia).
      async function conRepartoCerrado(
        status: 'CONFIRMED' | 'PAID',
        fn: (tx: Prisma.TransactionClient, setup: LockedSetup) => Promise<void>,
      ): Promise<void> {
        await withinRollback(async (tx) => {
          const setup = await crearBaseConParticipante(tx);
          const poolId = await crearRepartoAlimentado(tx, setup);
          if (status === 'CONFIRMED') {
            await confirmar(tx, poolId, setup.base.supervisorId);
          } else {
            await pagar(tx, poolId, setup.base.supervisorId);
          }
          await fn(tx, setup);
        });
      }

      it('permite ajustar la selección y corregir montos con el reparto en DRAFT', async () => {
        await withinRollback(async (tx) => {
          const setup = await crearBaseConParticipante(tx);
          await crearRepartoAlimentado(tx, setup);

          await tx.dailyOperationParticipant.create({
            data: {
              operationId: setup.operationId,
              workerId: setup.base.worker2Id,
            },
          });
          await tx.dailyOperationParticipant.delete({
            where: { id: setup.participantId },
          });
          await tx.dailyOperation.update({
            where: { id: setup.operationId },
            data: {
              cashTipAmount: BigInt(5000),
              tipFundAmount: BigInt(36602),
            },
          });
        });
      });

      it('bloquea agregar participantes con el reparto CONFIRMED', async () => {
        await conRepartoCerrado('CONFIRMED', async (tx, setup) => {
          await expect(
            tx.dailyOperationParticipant.create({
              data: {
                operationId: setup.operationId,
                workerId: setup.base.worker2Id,
              },
            }),
          ).rejects.toThrow(/reparto confirmado o pagado/);
        });
      });

      it('bloquea eliminar participantes con el reparto CONFIRMED', async () => {
        await conRepartoCerrado('CONFIRMED', async (tx, setup) => {
          await expect(
            tx.dailyOperationParticipant.delete({
              where: { id: setup.participantId },
            }),
          ).rejects.toThrow(/reparto confirmado o pagado/);
        });
      });

      it('bloquea reasignar participantes con el reparto CONFIRMED', async () => {
        await conRepartoCerrado('CONFIRMED', async (tx, setup) => {
          await expect(
            tx.dailyOperationParticipant.update({
              where: { id: setup.participantId },
              data: { workerId: setup.base.worker2Id },
            }),
          ).rejects.toThrow(/reparto confirmado o pagado/);
        });
      });

      it('bloquea corregir los montos de la operación con el reparto CONFIRMED', async () => {
        await conRepartoCerrado('CONFIRMED', async (tx, setup) => {
          await expect(
            tx.dailyOperation.update({
              where: { id: setup.operationId },
              data: {
                cashTipAmount: BigInt(5000),
                tipFundAmount: BigInt(36602),
              },
            }),
          ).rejects.toThrow(/no se pueden corregir sus montos/);
        });
      });

      it('bloquea corregir los montos de la operación con el reparto PAID', async () => {
        await conRepartoCerrado('PAID', async (tx, setup) => {
          await expect(
            tx.dailyOperation.update({
              where: { id: setup.operationId },
              data: {
                cashTipAmount: BigInt(5000),
                tipFundAmount: BigInt(36602),
              },
            }),
          ).rejects.toThrow(/no se pueden corregir sus montos/);
        });
      });

      it('bloquea eliminar participantes con el reparto PAID', async () => {
        await conRepartoCerrado('PAID', async (tx, setup) => {
          await expect(
            tx.dailyOperationParticipant.delete({
              where: { id: setup.participantId },
            }),
          ).rejects.toThrow(/reparto confirmado o pagado/);
        });
      });

      it('sigue permitiendo corregir el motivo de la diferencia con el reparto PAID', async () => {
        await conRepartoCerrado('PAID', async (tx, setup) => {
          // El motivo de la diferencia y el voucher no afectan el reparto:
          // siguen siendo corregibles aunque el reparto esté cerrado.
          await tx.dailyOperation.update({
            where: { id: setup.operationId },
            data: {
              cashDifference: BigInt(-1000),
              differenceReason: 'faltante de prueba',
            },
          });
        });
      });

      it('no bloquea operaciones sin reparto: la corrección sigue libre', async () => {
        await withinRollback(async (tx) => {
          const setup = await crearBaseConParticipante(tx);
          await tx.dailyOperation.update({
            where: { id: setup.operationId },
            data: {
              cashTipAmount: BigInt(5000),
              tipFundAmount: BigInt(36602),
            },
          });
          await tx.dailyOperationParticipant.delete({
            where: { id: setup.participantId },
          });
        });
      });
    });
  },
);
