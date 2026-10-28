import { PrismaPg } from '@prisma/adapter-pg';
import {
  PaymentMethod,
  Prisma,
  PrismaClient,
  SaleChannel,
  TipAgreementRule,
  TipPoolStatus,
} from '../src/generated/prisma/client.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

describe.skipIf(!databaseUrl)('Modelo de propinas (SPRINT-3-T09)', () => {
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
      await prisma.$transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  async function createBase(tx: Prisma.TransactionClient) {
    const store = await tx.store.create({
      data: {
        name: 'Subway Tips Model Test',
        city: 'Melipilla',
        address: 'Calle sintética 123',
      },
    });
    const supervisorRole = await tx.role.upsert({
      where: { code: 'SUPERVISOR' },
      update: {},
      create: { code: 'SUPERVISOR', name: 'Supervisor' },
    });
    const workerRole = await tx.role.upsert({
      where: { code: 'TRABAJADOR' },
      update: {},
      create: { code: 'TRABAJADOR', name: 'Trabajador' },
    });
    const supervisor = await tx.user.create({
      data: {
        email: 'supervisor@tips-model-test.invalid',
        passwordHash: 'hash-sintetico',
        firstName: 'Supervisor',
        lastName: 'Demo',
        roleId: supervisorRole.id,
        storeId: store.id,
      },
    });
    const worker = await tx.user.create({
      data: {
        email: 'worker@tips-model-test.invalid',
        passwordHash: 'hash-sintetico',
        firstName: 'Trabajador',
        lastName: 'Demo',
        roleId: workerRole.id,
        storeId: store.id,
      },
    });
    return { store, supervisor, worker };
  }

  async function createPoolGraph(tx: Prisma.TransactionClient) {
    const base = await createBase(tx);
    const agreement = await tx.tipAgreement.create({
      data: {
        name: 'Pacto demo proporcional',
        rule: TipAgreementRule.PROPORTIONAL_TO_HOURS,
        validFrom: new Date('2026-01-01'),
        validTo: new Date('2026-12-31'),
        storeId: base.store.id,
        createdById: base.supervisor.id,
      },
    });
    const tipEntry = await tx.tipEntry.create({
      data: {
        businessDate: new Date('2026-01-05'),
        paymentMethod: PaymentMethod.CASH,
        amount: 10000,
        storeId: base.store.id,
        responsibleId: base.supervisor.id,
      },
    });
    const workHours = await tx.workHoursRecord.create({
      data: {
        periodStart: new Date('2026-01-05'),
        periodEnd: new Date('2026-01-11'),
        hoursWorked: 40,
        storeId: base.store.id,
        workerId: base.worker.id,
        recordedById: base.supervisor.id,
      },
    });
    // Se crea en DRAFT y se confirma después de agregar líneas y fuentes: desde
    // SPRINT-3-T13 los triggers solo permiten cambiar la foto de un borrador.
    const draft = await tx.tipPool.create({
      data: {
        periodStart: new Date('2026-01-05'),
        periodEnd: new Date('2026-01-11'),
        totalAmount: 10000,
        status: TipPoolStatus.DRAFT,
        agreementSnapshot: {
          id: agreement.id,
          name: agreement.name,
          rule: agreement.rule,
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
        },
        storeId: base.store.id,
        calculatedById: base.supervisor.id,
        agreementId: agreement.id,
      },
    });
    const line = await tx.tipPoolLine.create({
      data: {
        poolId: draft.id,
        userId: base.worker.id,
        workHoursRecordId: workHours.id,
        hoursWorked: 40,
        amount: 10000,
      },
    });
    const source = await tx.tipPoolSource.create({
      data: {
        poolId: draft.id,
        tipEntryId: tipEntry.id,
        amount: 10000,
      },
    });
    const pool = await tx.tipPool.update({
      where: { id: draft.id },
      data: {
        status: TipPoolStatus.CONFIRMED,
        confirmedAt: new Date('2026-01-12T12:00:00Z'),
        confirmedById: base.supervisor.id,
      },
    });
    return { ...base, agreement, tipEntry, workHours, pool, line, source };
  }

  it('conserva snapshots del pacto, horas y monto fuente de un reparto confirmado', async () => {
    await withinRollback(async (tx) => {
      const graph = await createPoolGraph(tx);

      await tx.tipAgreement.update({
        where: { id: graph.agreement.id },
        data: { name: 'Pacto modificado', validTo: new Date('2027-12-31') },
      });
      await tx.workHoursRecord.update({
        where: { id: graph.workHours.id },
        data: { hoursWorked: 90 },
      });
      await tx.tipEntry.update({
        where: { id: graph.tipEntry.id },
        data: { amount: 12000 },
      });

      const pool = await tx.tipPool.findUniqueOrThrow({
        where: { id: graph.pool.id },
        include: { lines: true, sources: true },
      });
      expect(pool.agreementSnapshot).toMatchObject({
        id: graph.agreement.id,
        name: 'Pacto demo proporcional',
        rule: TipAgreementRule.PROPORTIONAL_TO_HOURS,
      });
      expect(Number(pool.totalAmount)).toBe(10000);
      expect(Number(pool.lines[0].hoursWorked)).toBe(40);
      expect(Number(pool.sources[0].amount)).toBe(10000);
      expect(pool.lines[0].workHoursRecordId).toBe(graph.workHours.id);
      expect(pool.sources[0].tipEntryId).toBe(graph.tipEntry.id);
    });
  });

  it('permite un solo registro diario por local, fecha y medio, y rechaza montos negativos', async () => {
    await withinRollback(async (tx) => {
      const { store, supervisor } = await createBase(tx);
      const data = {
        businessDate: new Date('2026-02-03'),
        paymentMethod: PaymentMethod.DEBIT_CARD,
        storeId: store.id,
        responsibleId: supervisor.id,
      };
      await tx.tipEntry.create({ data: { ...data, amount: 5000 } });

      await expect(
        tx.tipEntry.create({ data: { ...data, amount: 7000 } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    await withinRollback(async (tx) => {
      const { store, supervisor } = await createBase(tx);
      await expect(
        tx.tipEntry.create({
          data: {
            businessDate: new Date('2026-02-04'),
            paymentMethod: PaymentMethod.DEBIT_CARD,
            amount: -1,
            storeId: store.id,
            responsibleId: supervisor.id,
          },
        }),
      ).rejects.toThrow('tip_entries_amount_nonnegative');
    });
  });

  it('reconcilia una venta solo con un registro del mismo local, día y medio', async () => {
    await withinRollback(async (tx) => {
      const graph = await createPoolGraph(tx);
      const sale = await tx.sale.create({
        data: {
          soldAt: new Date('2026-01-05T15:00:00-03:00'),
          paymentMethod: PaymentMethod.CASH,
          channel: SaleChannel.IN_STORE,
          grossAmount: 20000,
          tipAmount: 1000,
          storeId: graph.store.id,
          registeredById: graph.supervisor.id,
          tipEntryId: graph.tipEntry.id,
        },
      });

      expect(sale.tipEntryId).toBe(graph.tipEntry.id);
      await expect(
        tx.sale.create({
          data: {
            soldAt: new Date('2026-01-05T16:00:00-03:00'),
            paymentMethod: PaymentMethod.DEBIT_CARD,
            channel: SaleChannel.IN_STORE,
            grossAmount: 30000,
            tipAmount: 2000,
            storeId: graph.store.id,
            registeredById: graph.supervisor.id,
            tipEntryId: graph.tipEntry.id,
          },
        }),
      ).rejects.toThrow(
        'La venta y su registro de propinas deben coincidir en local, fecha y medio de pago',
      );
    });
  });

  it('impide usar un registro en dos repartos o fuera del período fuente', async () => {
    await withinRollback(async (tx) => {
      const graph = await createPoolGraph(tx);
      const otherPool = await tx.tipPool.create({
        data: {
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-01-31'),
          totalAmount: 10000,
          storeId: graph.store.id,
          calculatedById: graph.supervisor.id,
        },
      });

      await expect(
        tx.tipPoolSource.create({
          data: {
            poolId: otherPool.id,
            tipEntryId: graph.tipEntry.id,
            amount: 10000,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    await withinRollback(async (tx) => {
      const graph = await createPoolGraph(tx);
      const outsidePool = await tx.tipPool.create({
        data: {
          periodStart: new Date('2026-02-01'),
          periodEnd: new Date('2026-02-28'),
          totalAmount: 10000,
          storeId: graph.store.id,
          calculatedById: graph.supervisor.id,
        },
      });
      const otherEntry = await tx.tipEntry.create({
        data: {
          businessDate: new Date('2026-01-06'),
          paymentMethod: PaymentMethod.CASH,
          amount: 10000,
          storeId: graph.store.id,
          responsibleId: graph.supervisor.id,
        },
      });
      await expect(
        tx.tipPoolSource.create({
          data: {
            poolId: outsidePool.id,
            tipEntryId: otherEntry.id,
            amount: 10000,
          },
        }),
      ).rejects.toThrow(
        'La fuente de propinas debe coincidir con el local y el período del reparto',
      );
    });
  });

  it('valida vigencias, horas y unicidad de pactos y registros de horas', async () => {
    await withinRollback(async (tx) => {
      const { store, supervisor } = await createBase(tx);
      const data = {
        name: 'Pacto demo',
        rule: TipAgreementRule.PROPORTIONAL_TO_HOURS,
        validFrom: new Date('2026-03-01'),
        storeId: store.id,
        createdById: supervisor.id,
      };
      await tx.tipAgreement.create({ data });
      await expect(tx.tipAgreement.create({ data })).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    await withinRollback(async (tx) => {
      const { store, supervisor } = await createBase(tx);
      await expect(
        tx.tipAgreement.create({
          data: {
            name: 'Pacto inválido',
            rule: TipAgreementRule.PROPORTIONAL_TO_HOURS,
            validFrom: new Date('2026-04-01'),
            validTo: new Date('2026-03-31'),
            storeId: store.id,
            createdById: supervisor.id,
          },
        }),
      ).rejects.toThrow('tip_agreements_valid_range');
    });

    await withinRollback(async (tx) => {
      const { store, supervisor, worker } = await createBase(tx);
      const data = {
        periodStart: new Date('2026-03-01'),
        periodEnd: new Date('2026-03-15'),
        storeId: store.id,
        workerId: worker.id,
        recordedById: supervisor.id,
      };
      await tx.workHoursRecord.create({
        data: { ...data, hoursWorked: 20 },
      });
      await expect(
        tx.workHoursRecord.create({
          data: { ...data, hoursWorked: 30 },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    await withinRollback(async (tx) => {
      const { store, supervisor, worker } = await createBase(tx);
      await expect(
        tx.workHoursRecord.create({
          data: {
            periodStart: new Date('2026-04-01'),
            periodEnd: new Date('2026-04-15'),
            hoursWorked: -1,
            storeId: store.id,
            workerId: worker.id,
            recordedById: supervisor.id,
          },
        }),
      ).rejects.toThrow('work_hours_records_hours_nonnegative');
    });

    await withinRollback(async (tx) => {
      const { store, supervisor, worker } = await createBase(tx);
      await expect(
        tx.workHoursRecord.create({
          data: {
            periodStart: new Date('2026-05-01'),
            periodEnd: new Date('2026-04-30'),
            hoursWorked: 10,
            storeId: store.id,
            workerId: worker.id,
            recordedById: supervisor.id,
          },
        }),
      ).rejects.toThrow('work_hours_records_valid_period');
    });
  });

  it('impide pactos y horas solapadas aunque cambie la fecha de inicio', async () => {
    await withinRollback(async (tx) => {
      const { store, supervisor } = await createBase(tx);
      await tx.tipAgreement.create({
        data: {
          name: 'Pacto inicial',
          rule: TipAgreementRule.PROPORTIONAL_TO_HOURS,
          validFrom: new Date('2026-01-01'),
          validTo: new Date('2026-06-30'),
          storeId: store.id,
          createdById: supervisor.id,
        },
      });
      await expect(
        tx.tipAgreement.create({
          data: {
            name: 'Pacto solapado',
            rule: TipAgreementRule.PROPORTIONAL_TO_HOURS,
            validFrom: new Date('2026-02-01'),
            validTo: new Date('2026-07-31'),
            storeId: store.id,
            createdById: supervisor.id,
          },
        }),
      ).rejects.toThrow('tip_agreements_no_overlap');
    });

    await withinRollback(async (tx) => {
      const { store, supervisor, worker } = await createBase(tx);
      await tx.workHoursRecord.create({
        data: {
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-01-31'),
          hoursWorked: 40,
          storeId: store.id,
          workerId: worker.id,
          recordedById: supervisor.id,
        },
      });
      await expect(
        tx.workHoursRecord.create({
          data: {
            periodStart: new Date('2026-01-15'),
            periodEnd: new Date('2026-02-15'),
            hoursWorked: 20,
            storeId: store.id,
            workerId: worker.id,
            recordedById: supervisor.id,
          },
        }),
      ).rejects.toThrow('work_hours_records_no_overlap');
    });
  });
});
