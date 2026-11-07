import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Tests de integración del modelo de operación diaria (SPRINT-4R-T01) contra
// PostgreSQL real: las reglas de integridad viven en la base (CHECK, índices
// únicos y FK), así se escriba por Prisma, SQL directo o cualquier otro rol.
// Se omiten si no se define TEST_DATABASE_URL. Cada rechazo esperado va en su
// propio withinRollback y es la última sentencia: un error de la base aborta
// la transacción.
const databaseUrl = process.env.TEST_DATABASE_URL;

const BUSINESS_DATE = new Date('2026-03-10T00:00:00.000Z');

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

describe.skipIf(!databaseUrl)(
  'Modelo de operación diaria (SPRINT-4R-T01)',
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
      supervisorId: string;
    }

    async function crearBase(tx: Prisma.TransactionClient): Promise<Base> {
      const store = await tx.store.create({
        data: {
          name: 'Subway Operación Modelo Test',
          city: 'Melipilla',
          address: 'Calle 123',
        },
      });
      const role = await tx.role.upsert({
        where: { code: 'SUPERVISOR' },
        update: {},
        create: { code: 'SUPERVISOR', name: 'Supervisor' },
      });
      const supervisor = await tx.user.create({
        data: {
          email: 'supervisor-op-modelo@test.invalid',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Supervisor',
          lastName: 'Modelo',
          roleId: role.id,
          storeId: store.id,
        },
      });
      return { storeId: store.id, supervisorId: supervisor.id };
    }

    async function crearVoucher(
      tx: Prisma.TransactionClient,
      sha256: string,
    ): Promise<string> {
      const voucher = await tx.dailyOperationVoucher.create({
        data: {
          fileName: 'voucher.jpg',
          filePath: `vouchers/2026/03/${sha256.slice(0, 8)}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: 10,
          sha256Hash: sha256,
        },
      });
      return voucher.id;
    }

    async function crearOperacion(
      tx: Prisma.TransactionClient,
      base: Base,
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const voucherId = await crearVoucher(tx, 'ab'.repeat(32));
      const operation = await tx.dailyOperation.create({
        data: {
          storeId: base.storeId,
          businessDate: BUSINESS_DATE,
          cardTipAmount: BigInt(31602),
          cashTipAmount: BigInt(4500),
          tipFundAmount: BigInt(36102),
          cashDifference: BigInt(0),
          responsibleId: base.supervisorId,
          voucherId,
          ...overrides,
        },
      });
      return operation.id;
    }

    it('guarda la operación válida con voucher y fondo consistente', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const id = await crearOperacion(tx, base);
        const row = await tx.dailyOperation.findUniqueOrThrow({
          where: { id },
        });
        expect(row.cardTipAmount).toBe(BigInt(31602));
        expect(row.tipFundAmount).toBe(BigInt(36102));
        expect(row.voucherId).not.toBeNull();
      });
    });

    it('rechaza el fondo de propinas distinto de la suma de montos', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        await expect(
          crearOperacion(tx, base, { tipFundAmount: BigInt(99999) }),
        ).rejects.toThrow(/tip_fund_consistent/);
      });
    });

    it('rechaza propinas negativas', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        await expect(
          crearOperacion(tx, base, {
            cardTipAmount: BigInt(-1),
            tipFundAmount: BigInt(4499),
          }),
        ).rejects.toThrow(/card_tip_non_negative/);
      });
    });

    it('rechaza la diferencia de efectivo distinta de cero sin motivo', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        await expect(
          crearOperacion(tx, base, { cashDifference: BigInt(-1000) }),
        ).rejects.toThrow(/difference_reason_required/);
      });
    });

    it('rechaza el motivo vacío o de solo espacios con diferencia', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        await expect(
          crearOperacion(tx, base, {
            cashDifference: BigInt(-1000),
            differenceReason: '   ',
          }),
        ).rejects.toThrow(/difference_reason_required/);
      });
    });

    it('exige el voucher cuando hay propina de tarjeta', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        await expect(
          tx.dailyOperation.create({
            data: {
              storeId: base.storeId,
              businessDate: BUSINESS_DATE,
              cardTipAmount: BigInt(31602),
              cashTipAmount: BigInt(0),
              tipFundAmount: BigInt(31602),
              cashDifference: BigInt(0),
              responsibleId: base.supervisorId,
            },
          }),
        ).rejects.toThrow(/voucher_required/);
      });
    });

    it('permite la operación sin voucher cuando no hay propina de tarjeta', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const operation = await tx.dailyOperation.create({
          data: {
            storeId: base.storeId,
            businessDate: BUSINESS_DATE,
            cardTipAmount: BigInt(0),
            cashTipAmount: BigInt(4500),
            tipFundAmount: BigInt(4500),
            cashDifference: BigInt(0),
            responsibleId: base.supervisorId,
          },
        });
        expect(operation.voucherId).toBeNull();
      });
    });

    it('impide dos operaciones del mismo local y fecha', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        await crearOperacion(tx, base);
        await expect(crearOperacion(tx, base)).rejects.toThrow(
          /store_id_business_date/,
        );
      });
    });

    it('impide compartir un voucher entre dos operaciones', async () => {
      await withinRollback(async (tx) => {
        const base = await crearBase(tx);
        const voucherId = await crearVoucher(tx, 'cd'.repeat(32));
        await crearOperacion(tx, base, { voucherId });
        const otherStore = await tx.store.create({
          data: {
            name: 'Subway Operación Modelo Otro',
            city: 'Calera',
            address: 'Calle 456',
          },
        });
        await expect(
          tx.dailyOperation.create({
            data: {
              storeId: otherStore.id,
              businessDate: new Date('2026-03-11T00:00:00.000Z'),
              cardTipAmount: BigInt(100),
              cashTipAmount: BigInt(0),
              tipFundAmount: BigInt(100),
              cashDifference: BigInt(0),
              responsibleId: base.supervisorId,
              voucherId,
            },
          }),
        ).rejects.toThrow(/voucher_id/);
      });
    });
  },
);
