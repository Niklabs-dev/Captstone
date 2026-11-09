import {
  cashDifferenceOf,
  consolidateSales,
  type CatalogMethod,
  type ConsolidationInput,
  type ImportInput,
  type OperationInput,
} from './sales-consolidation.js';

// Pruebas de la consolidación pura de ventas importadas, operación diaria y
// estado de importación (SPRINT-4R-T13).

const CASH: CatalogMethod = {
  id: 'm-cash',
  code: 'CASH',
  name: 'Efectivo',
  isActive: true,
  sortOrder: 10,
};
const DEBIT: CatalogMethod = {
  id: 'm-debit',
  code: 'DEBIT_CARD',
  name: 'Tarjeta de débito',
  isActive: true,
  sortOrder: 20,
};
const OLD: CatalogMethod = {
  id: 'm-old',
  code: 'OLD_VOUCHER',
  name: 'Vale antiguo',
  isActive: false,
  sortOrder: 5,
};
const GONE: CatalogMethod = {
  id: 'm-gone',
  code: 'GONE',
  name: 'Medio retirado',
  isActive: false,
  sortOrder: 1,
};

const STORE_A = {
  id: 'a',
  name: 'Melipilla Centro',
  city: 'Melipilla',
  isActive: true,
};
const STORE_B = { id: 'b', name: 'Calera', city: 'La Calera', isActive: true };

function importOf(
  storeId: string,
  businessDate: string,
  lines: [string, number][],
): ImportInput {
  return {
    importId: `imp-${storeId}-${businessDate}`,
    storeId,
    businessDate,
    version: 1,
    confirmedAt: new Date('2026-11-07T12:00:00.000Z'),
    totalAmount: lines.reduce((sum, [, amount]) => sum + amount, 0),
    lines: lines.map(([paymentMethodId, amount]) => ({
      paymentMethodId,
      amount,
    })),
  };
}

function operationOf(
  storeId: string,
  businessDate: string,
  cashDifference: number,
  tips: { card?: number; cash?: number } = {},
): OperationInput {
  const card = tips.card ?? 0;
  const cash = tips.cash ?? 0;
  return {
    operationId: `op-${storeId}-${businessDate}`,
    storeId,
    businessDate,
    cardTipAmount: card,
    cashTipAmount: cash,
    tipFundAmount: card + cash,
    cashDifference,
    differenceReason: cashDifference === 0 ? null : `motivo ${cashDifference}`,
  };
}

function input(overrides: Partial<ConsolidationInput>): ConsolidationInput {
  return {
    stores: [STORE_A, STORE_B],
    paymentMethods: [CASH, DEBIT, OLD, GONE],
    imports: [],
    operations: [],
    salesDays: [],
    pendingImports: [],
    ...overrides,
  };
}

describe('consolidateSales (SPRINT-4R-T13)', () => {
  it('clasifica la diferencia de efectivo por su signo sin perder el motivo', () => {
    expect(cashDifferenceOf(1500, 'sobra')).toEqual({
      amount: 1500,
      type: 'SOBRANTE',
      reason: 'sobra',
    });
    expect(cashDifferenceOf(-200, 'falta')).toEqual({
      amount: -200,
      type: 'FALTANTE',
      reason: 'falta',
    });
    expect(cashDifferenceOf(0, null)).toEqual({
      amount: 0,
      type: 'SIN_DIFERENCIA',
      reason: null,
    });
  });

  it('usa columnas del catálogo: activos más inactivos con historial, en su orden', () => {
    const result = consolidateSales(
      input({
        imports: [
          importOf('a', '2026-11-05', [
            ['m-debit', 1000],
            ['m-old', 300],
          ]),
        ],
      }),
    );
    expect(result.paymentMethods).toEqual([
      {
        paymentMethod: 'OLD_VOUCHER',
        paymentMethodName: 'Vale antiguo',
        isActive: false,
      },
      { paymentMethod: 'CASH', paymentMethodName: 'Efectivo', isActive: true },
      {
        paymentMethod: 'DEBIT_CARD',
        paymentMethodName: 'Tarjeta de débito',
        isActive: true,
      },
    ]);
    const day = result.stores[1].days[0];
    expect(
      day.sales?.byPaymentMethod.map((m) => [m.paymentMethod, m.amount]),
    ).toEqual([
      ['OLD_VOUCHER', 300],
      ['CASH', 0],
      ['DEBIT_CARD', 1000],
    ]);
  });

  it('suma varias etiquetas del mismo medio y concilia totales por local y generales', () => {
    const result = consolidateSales(
      input({
        imports: [
          importOf('a', '2026-11-05', [
            ['m-debit', 1000],
            ['m-debit', 500],
            ['m-cash', 200],
          ]),
          importOf('a', '2026-11-06', [['m-cash', -100]]),
          importOf('b', '2026-11-05', [['m-cash', 700]]),
        ],
      }),
    );
    const storeA = result.stores.find((s) => s.store.id === 'a');
    expect(storeA?.sales).toEqual({
      importedDays: 2,
      totalAmount: 1600,
      byPaymentMethod: [
        expect.objectContaining({ paymentMethod: 'CASH', amount: 100 }),
        expect.objectContaining({ paymentMethod: 'DEBIT_CARD', amount: 1500 }),
      ],
    });
    expect(result.totals.sales.totalAmount).toBe(2300);
    expect(result.totals.sales.importedDays).toBe(3);
    expect(
      result.totals.sales.byPaymentMethod.reduce((s, m) => s + m.amount, 0),
    ).toBe(result.totals.sales.totalAmount);
  });

  it('sin importación vigente las ventas son null, no cero', () => {
    const result = consolidateSales(
      input({ operations: [operationOf('a', '2026-11-05', 0)] }),
    );
    const storeA = result.stores.find((s) => s.store.id === 'a');
    expect(storeA?.days).toEqual([
      expect.objectContaining({ businessDate: '2026-11-05', sales: null }),
    ]);
    expect(storeA?.sales.importedDays).toBe(0);
    const storeB = result.stores.find((s) => s.store.id === 'b');
    expect(storeB?.days).toEqual([]);
  });

  it('mantiene propinas fuera de las ventas y no compensa diferencias', () => {
    const result = consolidateSales(
      input({
        imports: [importOf('a', '2026-11-05', [['m-debit', 10000]])],
        operations: [
          operationOf('a', '2026-11-05', -2500, { card: 3000, cash: 1000 }),
          operationOf('b', '2026-11-05', 2500, { cash: 500 }),
          operationOf('b', '2026-11-06', 0),
        ],
      }),
    );
    expect(result.totals.sales.totalAmount).toBe(10000);
    expect(result.totals.tips).toEqual({
      operationsCount: 3,
      cardTipAmount: 3000,
      cashTipAmount: 1500,
      tipFundAmount: 4500,
    });
    expect(result.totals.cashDifferences).toEqual({
      count: 2,
      surplusCount: 1,
      shortageCount: 1,
      surplusAmount: 2500,
      shortageAmount: -2500,
    });
    expect(result.cashDifferences).toEqual([
      {
        store: { id: 'b', name: 'Calera' },
        businessDate: '2026-11-05',
        operationId: 'op-b-2026-11-05',
        amount: 2500,
        type: 'SOBRANTE',
        reason: 'motivo 2500',
      },
      {
        store: { id: 'a', name: 'Melipilla Centro' },
        businessDate: '2026-11-05',
        operationId: 'op-a-2026-11-05',
        amount: -2500,
        type: 'FALTANTE',
        reason: 'motivo -2500',
      },
    ]);
  });

  it('toma el estado de /sales-days y deriva IMPORTADO si el día no se informa', () => {
    const result = consolidateSales(
      input({
        imports: [importOf('b', '2026-11-05', [['m-cash', 10]])],
        salesDays: [
          {
            storeId: 'a',
            businessDate: '2026-11-04',
            status: 'ATRASADO',
            activeImportId: null,
            pendingImportId: 'pend-1',
            closure: null,
          },
          {
            storeId: 'a',
            businessDate: '2026-11-05',
            status: 'CERRADO',
            activeImportId: null,
            pendingImportId: null,
            closure: { id: 'c1', reason: 'Feriado' },
          },
        ],
      }),
    );
    const storeA = result.stores.find((s) => s.store.id === 'a');
    expect(storeA?.days.map((d) => [d.businessDate, d.importStatus])).toEqual([
      [
        '2026-11-04',
        {
          status: 'ATRASADO',
          activeImportId: null,
          pendingImportId: 'pend-1',
          closure: null,
        },
      ],
      [
        '2026-11-05',
        {
          status: 'CERRADO',
          activeImportId: null,
          pendingImportId: null,
          closure: { id: 'c1', reason: 'Feriado' },
        },
      ],
    ]);
    const storeB = result.stores.find((s) => s.store.id === 'b');
    expect(storeB?.days[0].importStatus).toEqual({
      status: 'IMPORTADO',
      activeImportId: 'imp-b-2026-11-05',
      pendingImportId: null,
      closure: null,
    });
    expect(result.totals.importStatus).toEqual({
      IMPORTADO: 1,
      PENDIENTE: 0,
      ATRASADO: 1,
      CERRADO: 1,
    });
  });

  it('informa la importación pendiente aunque /sales-days no informe el día', () => {
    // Local inactivo (o sin calendario): /sales-days no lo informa, pero la
    // versión pendiente existe y no debe perderse. Prevalece la última
    // versión pendiente, como en /sales-days.
    const inactive = {
      id: 'c',
      name: 'Local cerrado',
      city: 'Melipilla',
      isActive: false,
    };
    const result = consolidateSales(
      input({
        stores: [inactive],
        imports: [importOf('c', '2026-11-05', [['m-cash', 10]])],
        operations: [operationOf('c', '2026-11-04', 0)],
        pendingImports: [
          {
            importId: 'pend-v3',
            storeId: 'c',
            businessDate: '2026-11-04',
            version: 3,
          },
          {
            importId: 'pend-v2',
            storeId: 'c',
            businessDate: '2026-11-04',
            version: 2,
          },
          {
            importId: 'pend-new',
            storeId: 'c',
            businessDate: '2026-11-05',
            version: 2,
          },
          {
            importId: 'pend-only',
            storeId: 'c',
            businessDate: '2026-11-06',
            version: 1,
          },
        ],
      }),
    );
    const days = result.stores[0]?.days ?? [];
    expect(days.map((d) => [d.businessDate, d.importStatus])).toEqual([
      [
        '2026-11-04',
        {
          status: null,
          activeImportId: null,
          pendingImportId: 'pend-v3',
          closure: null,
        },
      ],
      [
        '2026-11-05',
        {
          status: 'IMPORTADO',
          activeImportId: 'imp-c-2026-11-05',
          pendingImportId: 'pend-new',
          closure: null,
        },
      ],
      [
        '2026-11-06',
        {
          status: null,
          activeImportId: null,
          pendingImportId: 'pend-only',
          closure: null,
        },
      ],
    ]);
    // Una versión pendiente nunca es venta.
    expect(days[2]?.sales).toBeNull();
    expect(result.totals.sales.totalAmount).toBe(10);
  });

  it('ordena locales por nombre y días en forma ascendente', () => {
    const result = consolidateSales(
      input({
        operations: [
          operationOf('a', '2026-11-06', 0),
          operationOf('a', '2026-11-04', 0),
        ],
      }),
    );
    expect(result.stores.map((s) => s.store.id)).toEqual(['b', 'a']);
    expect(result.stores[1].days.map((d) => d.businessDate)).toEqual([
      '2026-11-04',
      '2026-11-06',
    ]);
  });

  it('rechaza líneas con medios fuera del catálogo', () => {
    expect(() =>
      consolidateSales(
        input({ imports: [importOf('a', '2026-11-05', [['m-x', 1]])] }),
      ),
    ).toThrow('fuera del catálogo');
  });
});
