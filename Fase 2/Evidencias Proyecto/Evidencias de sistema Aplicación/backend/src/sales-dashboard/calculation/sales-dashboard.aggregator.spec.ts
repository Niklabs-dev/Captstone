import { Prisma } from '../../generated/prisma/client.js';
import {
  buildSalesDashboard,
  type ClosingInput,
  type PaymentMethodInput,
  type SaleGroupInput,
  type SalesDashboardInput,
} from './sales-dashboard.aggregator.js';

// Reglas de consolidación de la consulta de ventas por local (SPRINT-4-T13),
// con catálogo dinámico de medios de pago (SPRINT-4-T32).

const d = (value: number): Prisma.Decimal => new Prisma.Decimal(value);

const MELIPILLA = {
  id: 'store-melipilla',
  name: 'Melipilla Centro',
  city: 'Melipilla',
  isActive: true,
};
const SERRANO = {
  id: 'store-serrano',
  name: 'Melipilla Serrano',
  city: 'Melipilla',
  isActive: true,
};
const CALERA = {
  id: 'store-calera',
  name: 'Calera',
  city: 'Calera',
  isActive: true,
};

// Catálogo de prueba: los cuatro medios habituales activos y un Junaeb
// histórico desactivado (EXTERNAL_OTHER en la base; aquí basta su estado).
const CASH: PaymentMethodInput = {
  id: 'pm-cash',
  code: 'CASH',
  name: 'Efectivo',
  isActive: true,
  sortOrder: 1,
};
const DEBIT: PaymentMethodInput = {
  id: 'pm-debit',
  code: 'DEBIT_CARD',
  name: 'Tarjeta de débito',
  isActive: true,
  sortOrder: 2,
};
const CREDIT: PaymentMethodInput = {
  id: 'pm-credit',
  code: 'CREDIT_CARD',
  name: 'Tarjeta de crédito',
  isActive: true,
  sortOrder: 3,
};
const TRANSFER: PaymentMethodInput = {
  id: 'pm-transfer',
  code: 'TRANSFER',
  name: 'Transferencia',
  isActive: true,
  sortOrder: 4,
};
const JUNAEB: PaymentMethodInput = {
  id: 'pm-junaeb',
  code: 'JUNAEB',
  name: 'Junaeb',
  isActive: false,
  sortOrder: 5,
};

function sale(
  storeId: string,
  paymentMethod: PaymentMethodInput,
  closed: boolean,
  gross: number,
  tip = 0,
  salesCount = 1,
): SaleGroupInput {
  return {
    storeId,
    paymentMethodId: paymentMethod.id,
    closed,
    salesCount,
    grossAmount: d(gross),
    tipAmount: d(tip),
  };
}

function closing(overrides: Partial<ClosingInput> = {}): ClosingInput {
  return {
    id: 'closing-1',
    storeId: MELIPILLA.id,
    shift: 1,
    status: 'CLOSED',
    openingCash: d(50000),
    mrcomandaNetSales: d(555530),
    mercadoPagoGrossAmount: d(588732),
    mercadoPagoTipAmount: d(31602),
    reconciliationDifference: d(1600),
    differenceReason: 'Faltante de efectivo',
    closedAt: new Date('2026-03-10T19:00:00.000Z'),
    lines: [
      // CASH: 100.000 de ventas + 50.000 de fondo; se contaron 149.000.
      {
        paymentMethodId: CASH.id,
        expectedAmount: d(150000),
        countedAmount: d(149000),
        difference: d(-1000),
      },
      {
        paymentMethodId: DEBIT.id,
        expectedAmount: d(511730),
        countedAmount: d(511730),
        difference: d(0),
      },
      {
        paymentMethodId: CREDIT.id,
        expectedAmount: d(43800),
        countedAmount: d(43800),
        difference: d(0),
      },
      {
        paymentMethodId: TRANSFER.id,
        expectedAmount: d(20000),
        countedAmount: d(20000),
        difference: d(0),
      },
    ],
    ...overrides,
  };
}

function input(
  overrides: Partial<SalesDashboardInput> = {},
): SalesDashboardInput {
  return {
    stores: [CALERA, MELIPILLA, SERRANO],
    paymentMethods: [CASH, DEBIT, CREDIT, TRANSFER, JUNAEB],
    sales: [],
    cardTips: [],
    closings: [],
    dtAlerts: [],
    tipAlerts: [],
    ...overrides,
  };
}

describe('buildSalesDashboard (SPRINT-4-T13 + SPRINT-4-T32)', () => {
  it('incluye cada local recibido, en su orden, aunque no tenga movimientos', () => {
    const result = buildSalesDashboard(input());

    expect(result.stores.map((store) => store.store.id)).toEqual([
      CALERA.id,
      MELIPILLA.id,
      SERRANO.id,
    ]);
    for (const store of result.stores) {
      expect(store.sales.netAmount).toBe(0);
      // Solo los medios activos: Junaeb histórico sin movimientos no aparece.
      expect(store.sales.byPaymentMethod).toEqual([
        {
          paymentMethod: 'CASH',
          paymentMethodName: 'Efectivo',
          salesCount: 0,
          netAmount: 0,
        },
        {
          paymentMethod: 'DEBIT_CARD',
          paymentMethodName: 'Tarjeta de débito',
          salesCount: 0,
          netAmount: 0,
        },
        {
          paymentMethod: 'CREDIT_CARD',
          paymentMethodName: 'Tarjeta de crédito',
          salesCount: 0,
          netAmount: 0,
        },
        {
          paymentMethod: 'TRANSFER',
          paymentMethodName: 'Transferencia',
          salesCount: 0,
          netAmount: 0,
        },
      ]);
      expect(store.closings.count).toBe(0);
      expect(store.pendingDifferences).toEqual([]);
      expect(store.alerts).toEqual({
        dtRegistration: { overdue: 0, upcoming: 0 },
        tipPayment: { overdue: 0, upcoming: 0 },
      });
    }
    expect(result.totals.netAmount).toBe(0);
  });

  it('consolida las ventas en montos netos, sin la propina, con código y nombre', () => {
    const result = buildSalesDashboard(
      input({
        sales: [
          sale(MELIPILLA.id, CASH, true, 100000, 0, 3),
          sale(MELIPILLA.id, DEBIT, true, 521730, 10000, 5),
          sale(MELIPILLA.id, CREDIT, false, 53800, 10000, 2),
          sale(CALERA.id, TRANSFER, false, 20000, 0, 1),
        ],
      }),
    );
    const melipilla = result.stores[1];

    expect(melipilla.sales).toMatchObject({
      salesCount: 10,
      netAmount: 100000 + 511730 + 43800,
      closedSalesCount: 8,
      closedNetAmount: 611730,
      unclosedSalesCount: 2,
      unclosedNetAmount: 43800,
    });
    expect(melipilla.sales.byPaymentMethod).toEqual([
      {
        paymentMethod: 'CASH',
        paymentMethodName: 'Efectivo',
        salesCount: 3,
        netAmount: 100000,
      },
      {
        paymentMethod: 'DEBIT_CARD',
        paymentMethodName: 'Tarjeta de débito',
        salesCount: 5,
        netAmount: 511730,
      },
      {
        paymentMethod: 'CREDIT_CARD',
        paymentMethodName: 'Tarjeta de crédito',
        salesCount: 2,
        netAmount: 43800,
      },
      {
        paymentMethod: 'TRANSFER',
        paymentMethodName: 'Transferencia',
        salesCount: 0,
        netAmount: 0,
      },
    ]);
    expect(result.stores[0].sales.netAmount).toBe(20000);
    expect(result.totals).toMatchObject({
      salesCount: 11,
      netAmount: 675530,
      closedNetAmount: 611730,
      unclosedNetAmount: 63800,
    });
  });

  it('incluye un medio histórico desactivado con movimientos, con su nombre', () => {
    const result = buildSalesDashboard(
      input({
        sales: [
          sale(MELIPILLA.id, JUNAEB, false, 15000),
          sale(CALERA.id, JUNAEB, false, 5000),
        ],
      }),
    );

    const melipilla = result.stores[1];
    const junaeb = melipilla.sales.byPaymentMethod.find(
      (method) => method.paymentMethod === 'JUNAEB',
    );
    expect(junaeb).toEqual({
      paymentMethod: 'JUNAEB',
      paymentMethodName: 'Junaeb',
      salesCount: 1,
      netAmount: 15000,
    });
    // Junaeb va después de los activos, en el orden del catálogo.
    expect(
      melipilla.sales.byPaymentMethod.map((method) => method.paymentMethod),
    ).toEqual(['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'JUNAEB']);
    // En el local sin ventas Junaeb sigue sin aparecer.
    expect(
      result.stores[2].sales.byPaymentMethod.map(
        (method) => method.paymentMethod,
      ),
    ).not.toContain('JUNAEB');
  });

  it('presenta la propina con tarjeta aparte, desde el registro y los vouchers', () => {
    const result = buildSalesDashboard(
      input({
        sales: [sale(MELIPILLA.id, DEBIT, true, 110000, 10000)],
        cardTips: [
          { storeId: MELIPILLA.id, amount: d(20000) },
          { storeId: MELIPILLA.id, amount: d(11602) },
        ],
        closings: [closing()],
      }),
    );
    const melipilla = result.stores[1];

    expect(melipilla.cardTips).toEqual({
      registeredAmount: 31602,
      closingsAmount: 31602,
    });
    // La propina no se suma a la venta neta ni a lo conciliado por el cierre.
    expect(melipilla.sales.netAmount).toBe(100000);
    expect(melipilla.closings.mercadoPagoNetSales).toBe(588732 - 31602);
    expect(result.totals.cardTipsRegisteredAmount).toBe(31602);
    expect(result.totals.cardTipsClosingsAmount).toBe(31602);
  });

  it('separa la diferencia de caja del descuadre de vouchers', () => {
    const result = buildSalesDashboard(input({ closings: [closing()] }));
    const melipilla = result.stores[1];

    expect(melipilla.closings).toEqual({
      count: 1,
      shifts: [1],
      // Lo esperado (725.530) menos el fondo de caja (50.000).
      netSalesAmount: 675530,
      countedAmount: 724530,
      cashDifference: -1000,
      voucherDifference: 1600,
      mrcomandaNetSales: 555530,
      mercadoPagoNetSales: 557130,
    });
    expect(melipilla.pendingDifferences).toHaveLength(1);
    expect(melipilla.pendingDifferences[0]).toEqual({
      closingId: 'closing-1',
      shift: 1,
      status: 'CLOSED',
      cashDifference: -1000,
      voucherDifference: 1600,
      lineDifferences: [
        {
          paymentMethod: 'CASH',
          paymentMethodName: 'Efectivo',
          expectedAmount: 150000,
          countedAmount: 149000,
          difference: -1000,
        },
      ],
      hasDifferences: true,
      isBalanced: false,
      balanceStatus: 'NO_CUADRADO',
      differenceReason: 'Faltante de efectivo',
      closedAt: new Date('2026-03-10T19:00:00.000Z'),
    });
    expect(result.totals).toMatchObject({
      closingsCount: 1,
      cashDifference: -1000,
      voucherDifference: 1600,
      pendingDifferencesCount: 1,
    });
  });

  it('no deja pendientes los cierres cuadrados y ordena por turno', () => {
    const balanced = closing({
      id: 'closing-2',
      shift: 2,
      reconciliationDifference: d(0),
      differenceReason: null,
      lines: [
        {
          paymentMethodId: CASH.id,
          expectedAmount: d(50000),
          countedAmount: d(50000),
          difference: d(0),
        },
      ],
    });
    const voucherOnly = closing({
      id: 'closing-3',
      shift: 3,
      reconciliationDifference: d(-500),
      lines: [
        {
          paymentMethodId: CASH.id,
          expectedAmount: d(50000),
          countedAmount: d(50000),
          difference: d(0),
        },
      ],
    });
    const result = buildSalesDashboard(
      input({ closings: [voucherOnly, balanced, closing()] }),
    );
    const melipilla = result.stores[1];

    expect(melipilla.closings.shifts).toEqual([1, 2, 3]);
    expect(
      melipilla.pendingDifferences.map((pending) => pending.closingId),
    ).toEqual(['closing-1', 'closing-3']);
    expect(melipilla.pendingDifferences[1]).toMatchObject({
      cashDifference: 0,
      voucherDifference: -500,
      lineDifferences: [],
      hasDifferences: true,
      isBalanced: false,
      balanceStatus: 'NO_CUADRADO',
    });
  });

  it('marca NO_CUADRADO un cierre con líneas que se compensan, sin informar -0', () => {
    const offsetting = closing({
      reconciliationDifference: d(0),
      lines: [
        {
          paymentMethodId: CASH.id,
          expectedAmount: d(1000),
          countedAmount: d(500),
          difference: d(-500),
        },
        {
          paymentMethodId: DEBIT.id,
          expectedAmount: d(1000),
          countedAmount: d(1500),
          difference: d(500),
        },
      ],
    });
    const result = buildSalesDashboard(input({ closings: [offsetting] }));

    expect(Object.is(result.stores[1].closings.cashDifference, 0)).toBe(true);
    // La compensación a 0 no cuadra el cierre: ambas líneas van al detalle.
    expect(result.stores[1].pendingDifferences).toHaveLength(1);
    expect(result.stores[1].pendingDifferences[0]).toMatchObject({
      cashDifference: 0,
      voucherDifference: 0,
      hasDifferences: true,
      isBalanced: false,
      balanceStatus: 'NO_CUADRADO',
    });
    expect(result.stores[1].pendingDifferences[0].lineDifferences).toEqual([
      {
        paymentMethod: 'CASH',
        paymentMethodName: 'Efectivo',
        expectedAmount: 1000,
        countedAmount: 500,
        difference: -500,
      },
      {
        paymentMethod: 'DEBIT_CARD',
        paymentMethodName: 'Tarjeta de débito',
        expectedAmount: 1000,
        countedAmount: 1500,
        difference: 500,
      },
    ]);
  });

  it('cuenta las alertas DT y de propinas por local y en el total', () => {
    const result = buildSalesDashboard(
      input({
        dtAlerts: [
          { storeId: MELIPILLA.id, status: 'OVERDUE' },
          { storeId: MELIPILLA.id, status: 'UPCOMING' },
          { storeId: CALERA.id, status: 'UPCOMING' },
        ],
        tipAlerts: [
          { storeId: SERRANO.id, status: 'OVERDUE' },
          { storeId: SERRANO.id, status: 'OVERDUE' },
        ],
      }),
    );

    expect(result.stores[1].alerts.dtRegistration).toEqual({
      overdue: 1,
      upcoming: 1,
    });
    expect(result.stores[0].alerts.dtRegistration).toEqual({
      overdue: 0,
      upcoming: 1,
    });
    expect(result.stores[2].alerts.tipPayment).toEqual({
      overdue: 2,
      upcoming: 0,
    });
    expect(result.totals.dtRegistrationAlerts).toEqual({
      overdue: 1,
      upcoming: 2,
    });
    expect(result.totals.tipPaymentAlerts).toEqual({ overdue: 2, upcoming: 0 });
  });

  it('ignora datos de locales que no están en la lista', () => {
    const result = buildSalesDashboard(
      input({
        stores: [MELIPILLA],
        sales: [sale('otro-local', CASH, false, 99999)],
        closings: [closing({ storeId: 'otro-local' })],
        tipAlerts: [{ storeId: 'otro-local', status: 'OVERDUE' }],
      }),
    );

    expect(result.totals.netAmount).toBe(0);
    expect(result.totals.closingsCount).toBe(0);
    expect(result.totals.tipPaymentAlerts.overdue).toBe(0);
  });
});
