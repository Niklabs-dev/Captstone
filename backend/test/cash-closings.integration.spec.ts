import { PrismaPg } from '@prisma/adapter-pg';
import {
  CashClosingStatus,
  CashClosingVoucherSource,
  PaymentMethodBehavior,
  Prisma,
  PrismaClient,
  SaleChannel,
} from '../src/generated/prisma/client.js';

// Tests de integración del modelo de cierres de caja por turno (SPRINT-4-T08)
// contra PostgreSQL real. Se omiten si no se define TEST_DATABASE_URL. Cada
// caso corre en una transacción que se revierte al terminar. Un error de la
// base aborta la transacción, por eso cada rechazo esperado va en su propio
// withinRollback y es la última sentencia.
const databaseUrl = process.env.TEST_DATABASE_URL;

// Los casos que recorren varias transacciones superan los 5 s por defecto.
const LONG_TEST_TIMEOUT_MS = 30_000;

const BUSINESS_DATE = new Date('2026-03-10');

const CLOSED_HEADER = 'está cerrado y es inmutable';
const CLOSED_CHILD = 'está cerrado: no se permite';
const CLOSED_SALE = 'pertenece al cierre de caja cerrado';
const REASON_REQUIRED = 'el motivo es obligatorio para cerrarlo';

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface PaymentMethodRefs {
  cashId: string;
  debitId: string;
  creditId: string;
  transferId: string;
}

interface Base extends PaymentMethodRefs {
  storeId: string;
  otherStoreId: string;
  supervisorId: string;
  tipEntryId: string;
}

interface ClosedGraph extends Base {
  closingId: string;
  lineId: string;
  voucherId: string;
  saleId: string;
}

type Tx = Prisma.TransactionClient;

describe.skipIf(!databaseUrl)(
  'Cierres de caja por turno (SPRINT-4-T08)',
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
      fn: (tx: Tx) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            await fn(tx);
            throw new Rollback();
          },
          { timeout: 15_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    }

    async function createPaymentMethods(tx: Tx): Promise<PaymentMethodRefs> {
      // La migración ya siembra los medios base: se reutilizan por código.
      const cash = await tx.paymentMethod.upsert({
        where: { code: 'CASH' },
        update: {},
        create: {
          code: 'CASH',
          name: 'Efectivo',
          sortOrder: 1,
          isActive: true,
          behavior: PaymentMethodBehavior.CASH,
          availableForTips: true,
        },
      });
      const debit = await tx.paymentMethod.upsert({
        where: { code: 'DEBIT_CARD' },
        update: {},
        create: {
          code: 'DEBIT_CARD',
          name: 'Tarjeta de débito',
          sortOrder: 2,
          isActive: true,
          behavior: PaymentMethodBehavior.RECONCILABLE_CARD,
          availableForTips: true,
        },
      });
      const credit = await tx.paymentMethod.upsert({
        where: { code: 'CREDIT_CARD' },
        update: {},
        create: {
          code: 'CREDIT_CARD',
          name: 'Tarjeta de crédito',
          sortOrder: 3,
          isActive: true,
          behavior: PaymentMethodBehavior.RECONCILABLE_CARD,
          availableForTips: true,
        },
      });
      const transfer = await tx.paymentMethod.upsert({
        where: { code: 'TRANSFER' },
        update: {},
        create: {
          code: 'TRANSFER',
          name: 'Transferencia',
          sortOrder: 4,
          isActive: true,
          behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
          availableForTips: true,
        },
      });
      return {
        cashId: cash.id,
        debitId: debit.id,
        creditId: credit.id,
        transferId: transfer.id,
      };
    }

    async function createBase(tx: Tx): Promise<Base> {
      const methods = await createPaymentMethods(tx);
      const store = await tx.store.create({
        data: {
          name: 'Subway Cierres Test',
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      const otherStore = await tx.store.create({
        data: {
          name: 'Subway Cierres Test Calera',
          city: 'Calera',
          address: 'Calle sintética 456',
        },
      });
      const role = await tx.role.upsert({
        where: { code: 'SUPERVISOR' },
        update: {},
        create: { code: 'SUPERVISOR', name: 'Supervisor' },
      });
      const supervisor = await tx.user.create({
        data: {
          email: 'supervisor@cash-closings-test.invalid',
          passwordHash: 'hash-sintetico',
          firstName: 'Supervisor',
          lastName: 'Demo',
          roleId: role.id,
          storeId: store.id,
        },
      });
      const tipEntry = await tx.tipEntry.create({
        data: {
          businessDate: BUSINESS_DATE,
          paymentMethodId: methods.debitId,
          amount: 5000,
          storeId: store.id,
          responsibleId: supervisor.id,
        },
      });
      return {
        ...methods,
        storeId: store.id,
        otherStoreId: otherStore.id,
        supervisorId: supervisor.id,
        tipEntryId: tipEntry.id,
      };
    }

    function openClosing(
      tx: Tx,
      base: Base,
      data: Partial<Prisma.CashClosingUncheckedCreateInput> = {},
    ) {
      return tx.cashClosing.create({
        data: {
          storeId: base.storeId,
          businessDate: BUSINESS_DATE,
          shift: 1,
          openingCash: 50000,
          responsibleId: base.supervisorId,
          ...data,
        },
      });
    }

    function close(
      tx: Tx,
      closingId: string,
      base: Base,
      data: Partial<Prisma.CashClosingUncheckedUpdateInput> = {},
    ) {
      return tx.cashClosing.update({
        where: { id: closingId },
        data: {
          status: CashClosingStatus.CLOSED,
          closedAt: new Date('2026-03-10T23:30:00-03:00'),
          closedById: base.supervisorId,
          ...data,
        },
      });
    }

    function addLine(
      tx: Tx,
      closingId: string,
      expectedAmount: number,
      countedAmount: number,
      paymentMethodId: string,
    ) {
      return tx.cashClosingLine.create({
        data: {
          closingId,
          paymentMethodId,
          expectedAmount,
          countedAmount,
          difference: countedAmount - expectedAmount,
        },
      });
    }

    function addVoucher(
      tx: Tx,
      closingId: string,
      data: Partial<Prisma.CashClosingVoucherUncheckedCreateInput> = {},
    ) {
      return tx.cashClosingVoucher.create({
        data: {
          closingId,
          source: CashClosingVoucherSource.MERCADO_PAGO,
          periodStart: new Date('2026-03-10T08:00:00-03:00'),
          periodEnd: new Date('2026-03-10T16:00:00-03:00'),
          amount: 105000,
          tipIncludedAmount: 5000,
          ...data,
        },
      });
    }

    // Cierre completo y cuadrado: venta neta MrComanda $100.000, cobro bruto
    // Mercado Pago $105.000 con $5.000 de propina incluida (diferencia 0), una
    // línea de débito sin diferencia, una venta y el vínculo a las propinas.
    async function createClosedGraph(tx: Tx): Promise<ClosedGraph> {
      const base = await createBase(tx);
      const closing = await openClosing(tx, base, {
        mrcomandaNetSales: 100000,
        mercadoPagoGrossAmount: 105000,
        mercadoPagoTipAmount: 5000,
        reconciliationDifference: 0,
      });
      const line = await addLine(tx, closing.id, 100000, 100000, base.debitId);
      const voucher = await addVoucher(tx, closing.id);
      await addVoucher(tx, closing.id, {
        source: CashClosingVoucherSource.MRCOMANDA,
        amount: 100000,
        tipIncludedAmount: 0,
        reference: 'Z-0001',
        paymentMethodId: base.debitId,
      });
      await tx.cashClosingTipEntry.create({
        data: { closingId: closing.id, tipEntryId: base.tipEntryId },
      });
      const sale = await tx.sale.create({
        data: {
          soldAt: new Date('2026-03-10T13:00:00-03:00'),
          paymentMethodId: base.debitId,
          channel: SaleChannel.IN_STORE,
          grossAmount: 100000,
          storeId: base.storeId,
          registeredById: base.supervisorId,
          cashClosingId: closing.id,
        },
      });
      await close(tx, closing.id, base);
      return {
        ...base,
        closingId: closing.id,
        lineId: line.id,
        voucherId: voucher.id,
        saleId: sale.id,
      };
    }

    it('permite un solo cierre por local, día y turno, y acepta otro turno', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        await openClosing(tx, base, { shift: 1 });
        const second = await openClosing(tx, base, { shift: 2 });
        const otherStore = await openClosing(tx, base, {
          shift: 1,
          storeId: base.otherStoreId,
        });
        expect(second.shift).toBe(2);
        expect(otherStore.shift).toBe(1);

        await expect(openClosing(tx, base, { shift: 1 })).rejects.toMatchObject(
          {
            code: 'P2002',
          },
        );
      });

      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        await expect(openClosing(tx, base, { shift: 0 })).rejects.toThrow(
          'cash_closings_shift_positive',
        );
      });
    });

    it('rechaza una diferencia de línea mal calculada', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const closing = await openClosing(tx, base);
        await expect(
          tx.cashClosingLine.create({
            data: {
              closingId: closing.id,
              paymentMethodId: base.cashId,
              expectedAmount: 150000,
              countedAmount: 149000,
              difference: 1000,
            },
          }),
        ).rejects.toThrow('cash_closing_lines_difference_consistent');
      });
    });

    it(
      'rechaza montos negativos en líneas, fondo de caja, conciliación y vouchers',
      async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await expect(
            addLine(tx, closing.id, 0, -500, base.debitId),
          ).rejects.toThrow('cash_closing_lines_amounts_nonnegative');
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          await expect(
            openClosing(tx, base, { openingCash: -1 }),
          ).rejects.toThrow('cash_closings_opening_cash_nonnegative');
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          await expect(
            openClosing(tx, base, {
              mercadoPagoGrossAmount: 1000,
              mercadoPagoTipAmount: 2000,
              reconciliationDifference: -1000,
            }),
          ).rejects.toThrow('cash_closings_reconciliation_amounts_nonnegative');
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await expect(
            addVoucher(tx, closing.id, { amount: -1, tipIncludedAmount: 0 }),
          ).rejects.toThrow('cash_closing_vouchers_amounts_nonnegative');
        });
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it('fuerza la fórmula de conciliación: bruto MP − propina MP − venta neta MrComanda', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const closing = await openClosing(tx, base, {
          mrcomandaNetSales: 100000,
          mercadoPagoGrossAmount: 104000,
          mercadoPagoTipAmount: 5000,
          reconciliationDifference: -1000,
        });
        expect(Number(closing.reconciliationDifference)).toBe(-1000);

        await expect(
          openClosing(tx, base, {
            shift: 2,
            mrcomandaNetSales: 100000,
            mercadoPagoGrossAmount: 104000,
            mercadoPagoTipAmount: 5000,
            // Mal: suma la propina en vez de descontarla.
            reconciliationDifference: 9000,
          }),
        ).rejects.toThrow('cash_closings_reconciliation_difference_consistent');
      });
    });

    it(
      'exige closed_at y closed_by en CLOSED y que el cierre se cree en OPEN',
      async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await expect(
            tx.cashClosing.update({
              where: { id: closing.id },
              data: { status: CashClosingStatus.CLOSED },
            }),
          ).rejects.toThrow('cash_closings_status_consistency');
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await expect(
            close(tx, closing.id, base, { closedById: null }),
          ).rejects.toThrow('cash_closings_status_consistency');
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          await expect(
            openClosing(tx, base, { closedAt: new Date() }),
          ).rejects.toThrow('cash_closings_status_consistency');
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          await expect(
            openClosing(tx, base, {
              status: CashClosingStatus.CLOSED,
              closedAt: new Date(),
              closedById: base.supervisorId,
            }),
          ).rejects.toThrow('debe crearse en estado OPEN');
        });
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it(
      'exige motivo para cerrar con diferencia en una línea o en la conciliación',
      async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await addLine(tx, closing.id, 150000, 149000, base.cashId);
          await expect(close(tx, closing.id, base)).rejects.toThrow(
            REASON_REQUIRED,
          );
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base, {
            mrcomandaNetSales: 100000,
            mercadoPagoGrossAmount: 104000,
            mercadoPagoTipAmount: 5000,
            reconciliationDifference: -1000,
          });
          await addVoucher(tx, closing.id, { amount: 104000 });
          await addVoucher(tx, closing.id, {
            source: CashClosingVoucherSource.MRCOMANDA,
            amount: 100000,
            tipIncludedAmount: 0,
            paymentMethodId: base.debitId,
          });
          await expect(close(tx, closing.id, base)).rejects.toThrow(
            REASON_REQUIRED,
          );
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await addLine(tx, closing.id, 150000, 149000, base.cashId);
          await expect(
            close(tx, closing.id, base, { differenceReason: '   ' }),
          ).rejects.toThrow('cash_closings_difference_reason_not_blank');
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await addLine(tx, closing.id, 150000, 149000, base.cashId);
          const closed = await close(tx, closing.id, base, {
            differenceReason: 'Faltante de $1.000 por vuelto mal entregado',
          });
          expect(closed.status).toBe(CashClosingStatus.CLOSED);
        });
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it('exige que los totales de conciliación coincidan con la suma de los vouchers al cerrar', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const closing = await openClosing(tx, base, {
          mrcomandaNetSales: 100000,
          mercadoPagoGrossAmount: 105000,
          mercadoPagoTipAmount: 5000,
          reconciliationDifference: 0,
        });
        // Varios vouchers por fuente: dos cortes de Mercado Pago que suman el
        // bruto, pero falta el reporte de MrComanda.
        await addVoucher(tx, closing.id, {
          amount: 60000,
          tipIncludedAmount: 3000,
        });
        await addVoucher(tx, closing.id, {
          periodStart: new Date('2026-03-10T16:00:00-03:00'),
          periodEnd: new Date('2026-03-10T23:00:00-03:00'),
          amount: 45000,
          tipIncludedAmount: 2000,
        });
        await expect(close(tx, closing.id, base)).rejects.toThrow(
          'no coinciden con la suma de sus vouchers',
        );
      });
    });

    it(
      'valida el período de corte y la propina de los vouchers',
      async () => {
        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await expect(
            addVoucher(tx, closing.id, {
              periodStart: new Date('2026-03-10T16:00:00-03:00'),
              periodEnd: new Date('2026-03-10T16:00:00-03:00'),
            }),
          ).rejects.toThrow('cash_closing_vouchers_valid_period');
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await expect(
            addVoucher(tx, closing.id, {
              source: CashClosingVoucherSource.MRCOMANDA,
              amount: 100000,
              tipIncludedAmount: 1000,
              paymentMethodId: base.debitId,
            }),
          ).rejects.toThrow('cash_closing_vouchers_tip_only_mercado_pago');
        });

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await expect(
            addVoucher(tx, closing.id, {
              amount: 1000,
              tipIncludedAmount: 2000,
            }),
          ).rejects.toThrow('cash_closing_vouchers_amounts_nonnegative');
        });
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it('vincula propinas del mismo local y día solo como referencia', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const morning = await openClosing(tx, base, { shift: 1 });
        const evening = await openClosing(tx, base, { shift: 2 });
        // El registro diario se puede vincular a varios turnos del mismo día.
        for (const closing of [morning, evening]) {
          await tx.cashClosingTipEntry.create({
            data: { closingId: closing.id, tipEntryId: base.tipEntryId },
          });
        }
        const linked = await tx.cashClosing.findUniqueOrThrow({
          where: { id: morning.id },
          include: { tipEntries: { include: { tipEntry: true } } },
        });
        expect(linked.tipEntries).toHaveLength(1);
        // El cierre no copia la propina: la conciliación queda en 0.
        expect(Number(linked.mercadoPagoTipAmount)).toBe(0);
        expect(Number(linked.tipEntries[0].tipEntry.amount)).toBe(5000);

        const otherDay = await openClosing(tx, base, {
          businessDate: new Date('2026-03-11'),
        });
        await expect(
          tx.cashClosingTipEntry.create({
            data: { closingId: otherDay.id, tipEntryId: base.tipEntryId },
          }),
        ).rejects.toThrow('mismo local y día que el cierre de caja');
      });
    });

    it('cierra un cierre OPEN cuadrado y no permite cambiar su local, día ni turno', async () => {
      await withinRollback(async (tx) => {
        const graph = await createClosedGraph(tx);
        const closed = await tx.cashClosing.findUniqueOrThrow({
          where: { id: graph.closingId },
          include: { lines: true, vouchers: true },
        });
        expect(closed.status).toBe(CashClosingStatus.CLOSED);
        expect(closed.closedAt).not.toBeNull();
        expect(closed.closedById).toBe(graph.supervisorId);
        expect(closed.differenceReason).toBeNull();
        expect(closed.lines).toHaveLength(1);
        expect(closed.vouchers).toHaveLength(2);
      });

      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const closing = await openClosing(tx, base);
        await expect(
          tx.cashClosing.update({
            where: { id: closing.id },
            data: { shift: 2 },
          }),
        ).rejects.toThrow('No se puede cambiar el local, el día ni el turno');
      });
    });

    it(
      'hace inmutable un cierre CLOSED: cabecera, líneas, vouchers y vínculos',
      async () => {
        const attempts: Array<
          [string, string, (tx: Tx, graph: ClosedGraph) => Promise<unknown>]
        > = [
          [
            'editar la cabecera',
            CLOSED_HEADER,
            (tx, g) =>
              tx.cashClosing.update({
                where: { id: g.closingId },
                data: { notes: 'cambio posterior' },
              }),
          ],
          [
            'reabrir el cierre',
            CLOSED_HEADER,
            (tx, g) =>
              tx.cashClosing.update({
                where: { id: g.closingId },
                data: {
                  status: CashClosingStatus.OPEN,
                  closedAt: null,
                  closedById: null,
                },
              }),
          ],
          [
            'eliminar el cierre',
            CLOSED_HEADER,
            (tx, g) => tx.cashClosing.delete({ where: { id: g.closingId } }),
          ],
          [
            'agregar una línea',
            CLOSED_CHILD,
            (tx, g) => addLine(tx, g.closingId, 0, 0, g.cashId),
          ],
          [
            'editar una línea',
            CLOSED_CHILD,
            (tx, g) =>
              tx.cashClosingLine.update({
                where: { id: g.lineId },
                data: { countedAmount: 0, difference: -100000 },
              }),
          ],
          [
            'eliminar una línea',
            CLOSED_CHILD,
            (tx, g) => tx.cashClosingLine.delete({ where: { id: g.lineId } }),
          ],
          [
            'agregar un voucher',
            CLOSED_CHILD,
            (tx, g) => addVoucher(tx, g.closingId),
          ],
          [
            'editar un voucher',
            CLOSED_CHILD,
            (tx, g) =>
              tx.cashClosingVoucher.update({
                where: { id: g.voucherId },
                data: { reference: 'cambio' },
              }),
          ],
          [
            'eliminar un voucher',
            CLOSED_CHILD,
            (tx, g) =>
              tx.cashClosingVoucher.delete({ where: { id: g.voucherId } }),
          ],
          [
            'eliminar el vínculo a propinas',
            CLOSED_CHILD,
            (tx, g) =>
              tx.cashClosingTipEntry.delete({
                where: {
                  closingId_tipEntryId: {
                    closingId: g.closingId,
                    tipEntryId: g.tipEntryId,
                  },
                },
              }),
          ],
        ];

        for (const [label, message, attempt] of attempts) {
          await withinRollback(async (tx) => {
            const graph = await createClosedGraph(tx);
            await expect(attempt(tx, graph), label).rejects.toThrow(message);
          });
        }
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it(
      'protege las ventas de un cierre CLOSED y exige el mismo local que el cierre',
      async () => {
        const attempts: Array<
          [string, string, (tx: Tx, graph: ClosedGraph) => Promise<unknown>]
        > = [
          [
            'asociar una venta nueva',
            'no se permite asociarle ventas',
            (tx, g) =>
              tx.sale.create({
                data: {
                  soldAt: new Date('2026-03-10T14:00:00-03:00'),
                  paymentMethodId: g.cashId,
                  grossAmount: 5000,
                  storeId: g.storeId,
                  registeredById: g.supervisorId,
                  cashClosingId: g.closingId,
                },
              }),
          ],
          [
            'editar una venta asociada',
            CLOSED_SALE,
            (tx, g) =>
              tx.sale.update({
                where: { id: g.saleId },
                data: { grossAmount: 1 },
              }),
          ],
          [
            'desligar una venta',
            CLOSED_SALE,
            (tx, g) =>
              tx.sale.update({
                where: { id: g.saleId },
                data: { cashClosingId: null },
              }),
          ],
          [
            'eliminar una venta asociada',
            CLOSED_SALE,
            (tx, g) => tx.sale.delete({ where: { id: g.saleId } }),
          ],
        ];

        for (const [label, message, attempt] of attempts) {
          await withinRollback(async (tx) => {
            const graph = await createClosedGraph(tx);
            await expect(attempt(tx, graph), label).rejects.toThrow(message);
          });
        }

        await withinRollback(async (tx) => {
          const base = await createBase(tx);
          const closing = await openClosing(tx, base);
          await expect(
            tx.sale.create({
              data: {
                soldAt: new Date('2026-03-10T14:00:00-03:00'),
                paymentMethodId: base.cashId,
                grossAmount: 5000,
                storeId: base.otherStoreId,
                registeredById: base.supervisorId,
                cashClosingId: closing.id,
              },
            }),
          ).rejects.toThrow(
            'La venta y su cierre de caja deben ser del mismo local',
          );
        });
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it('elimina un cierre OPEN con líneas, vouchers y vínculos en cascada', async () => {
      await withinRollback(async (tx) => {
        const base = await createBase(tx);
        const closing = await openClosing(tx, base);
        await addLine(tx, closing.id, 100000, 100000, base.debitId);
        await addVoucher(tx, closing.id);
        await tx.cashClosingTipEntry.create({
          data: { closingId: closing.id, tipEntryId: base.tipEntryId },
        });

        await tx.cashClosing.delete({ where: { id: closing.id } });

        const where = { closingId: closing.id };
        expect(await tx.cashClosingLine.count({ where })).toBe(0);
        expect(await tx.cashClosingVoucher.count({ where })).toBe(0);
        expect(await tx.cashClosingTipEntry.count({ where })).toBe(0);
        // El registro de propinas se conserva: el vínculo era solo referencia.
        expect(
          await tx.tipEntry.count({ where: { id: base.tipEntryId } }),
        ).toBe(1);
      });
    });
  },
);
