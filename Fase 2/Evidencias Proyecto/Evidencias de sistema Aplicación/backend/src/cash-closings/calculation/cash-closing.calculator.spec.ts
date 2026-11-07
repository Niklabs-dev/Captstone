import {
  CashClosingVoucherSource,
  PaymentMethodBehavior,
  Prisma,
} from '../../generated/prisma/client.js';
import {
  calculateClosingLines,
  hasClosingDifferences,
  summarizeVouchers,
  type CatalogPaymentMethod,
  type ClosingSale,
  type ClosingVoucherInput,
  type CountedLineInput,
} from './cash-closing.calculator.js';

const START = '2026-03-10T08:00:00-03:00';
const END = '2026-03-10T16:00:00-03:00';

const METHODS: CatalogPaymentMethod[] = [
  {
    id: 'medio-efectivo',
    code: 'CASH',
    name: 'Efectivo',
    behavior: PaymentMethodBehavior.CASH,
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 'medio-debito',
    code: 'DEBIT_CARD',
    name: 'Tarjeta de débito',
    behavior: PaymentMethodBehavior.RECONCILABLE_CARD,
    sortOrder: 2,
    isActive: true,
  },
  {
    id: 'medio-credito',
    code: 'CREDIT_CARD',
    name: 'Tarjeta de crédito',
    behavior: PaymentMethodBehavior.RECONCILABLE_CARD,
    sortOrder: 3,
    isActive: true,
  },
  {
    id: 'medio-transferencia',
    code: 'TRANSFER',
    name: 'Transferencia',
    behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
    sortOrder: 4,
    isActive: true,
  },
  {
    id: 'medio-junaeb',
    code: 'JUNEB',
    name: 'Junaeb',
    behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
    sortOrder: 5,
    isActive: false,
  },
  {
    id: 'medio-mercado-pago',
    code: 'MERCADO_PAGO',
    name: 'Mercado Pago',
    behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
    sortOrder: 6,
    isActive: false,
  },
];

const CUT = {
  start: new Date('2026-03-10T08:00:00-03:00'),
  end: new Date('2026-03-10T16:00:00-03:00'),
};

function voucher(
  source: CashClosingVoucherSource,
  amount: number,
  tipIncludedAmount = 0,
  overrides: Partial<ClosingVoucherInput> = {},
): ClosingVoucherInput {
  return {
    source,
    amount,
    tipIncludedAmount,
    periodStart: START,
    periodEnd: END,
    ...overrides,
  };
}

function mrcomanda(
  amount: number,
  paymentMethod: string,
  overrides: Partial<ClosingVoucherInput> = {},
): ClosingVoucherInput {
  return voucher(CashClosingVoucherSource.MRCOMANDA, amount, 0, {
    paymentMethod,
    ...overrides,
  });
}

function counted(amounts: number[]): CountedLineInput[] {
  return ['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER'].map(
    (paymentMethod, index) => ({
      paymentMethod,
      countedAmount: amounts[index],
    }),
  );
}

function sale(
  paymentMethod: string,
  grossAmount: number,
  tipAmount: number,
): ClosingSale {
  return {
    paymentMethod,
    grossAmount: new Prisma.Decimal(grossAmount),
    tipAmount: new Prisma.Decimal(tipAmount),
  };
}

describe('Cálculo de cierres de caja (SPRINT-4-T09)', () => {
  it('concilia el ejemplo 588.732/31.602/557.130/555.530 = 1.600 sin convertir diferencias brutas en propinas', () => {
    const summary = summarizeVouchers(
      [
        mrcomanda(511730, 'DEBIT_CARD'),
        mrcomanda(43800, 'CREDIT_CARD'),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 588732, 31602),
      ],
      METHODS,
    );

    expect(summary).toMatchObject({
      mrcomandaNetSales: 555530,
      mercadoPagoGrossAmount: 588732,
      mercadoPagoTipAmount: 31602,
      mercadoPagoNetSales: 557130,
      reconciliationDifference: 1600,
    });
    expect(summary.periodStart.toISOString()).toBe('2026-03-10T11:00:00.000Z');
    expect(summary.periodEnd.toISOString()).toBe('2026-03-10T19:00:00.000Z');
  });

  it('conserva Junaeb y la línea Mercado Pago de MrComanda sin sumarlas dos veces', () => {
    const summary = summarizeVouchers(
      [
        mrcomanda(511730, 'DEBIT_CARD'),
        mrcomanda(43800, 'CREDIT_CARD'),
        mrcomanda(20000, 'JUNEB'),
        mrcomanda(557130, 'MERCADO_PAGO'),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 588732, 31602),
      ],
      METHODS,
    );

    // Solo las tarjetas conciliables entran; Junaeb y la línea Mercado Pago
    // del reporte MrComanda quedan como respaldo fuera de la conciliación.
    expect(summary.mrcomandaNetSales).toBe(555530);
    expect(summary.mercadoPagoNetSales).toBe(557130);
    expect(summary.reconciliationDifference).toBe(1600);
  });

  it('suma cortes parciales y exige la misma envolvente de período', () => {
    const summary = summarizeVouchers(
      [
        mrcomanda(1000, 'DEBIT_CARD', {
          periodEnd: '2026-03-10T12:00:00-03:00',
        }),
        mrcomanda(2000, 'DEBIT_CARD', {
          periodStart: '2026-03-10T12:00:00-03:00',
        }),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 4000, 1000),
      ],
      METHODS,
    );
    expect(summary.mrcomandaNetSales).toBe(3000);
    expect(summary.reconciliationDifference).toBe(0);

    expect(() =>
      summarizeVouchers(
        [
          mrcomanda(1000, 'DEBIT_CARD'),
          voucher(CashClosingVoucherSource.MERCADO_PAGO, 1000, 0, {
            periodEnd: '2026-03-10T17:00:00-03:00',
          }),
        ],
        METHODS,
      ),
    ).toThrow('mismo período de corte');
  });

  it.each([
    [
      'falta una fuente',
      [mrcomanda(1000, 'DEBIT_CARD')],
      'al menos un voucher',
    ],
    [
      'período invertido',
      [
        mrcomanda(1000, 'DEBIT_CARD'),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 1000, 0, {
          periodEnd: START,
        }),
      ],
      'debe terminar después',
    ],
    [
      'propina mayor al bruto',
      [
        mrcomanda(1000, 'DEBIT_CARD'),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 1000, 1001),
      ],
      'no puede superar',
    ],
    [
      'propina atribuida a MrComanda',
      [
        mrcomanda(1000, 'DEBIT_CARD', { tipIncludedAmount: 1 }),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 1000),
      ],
      'MrComanda no pueden incluir propinas',
    ],
    [
      'voucher MrComanda sin medio de pago',
      [
        voucher(CashClosingVoucherSource.MRCOMANDA, 1000),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 1000),
      ],
      'deben indicar su medio de pago',
    ],
    [
      'voucher con medio inexistente',
      [
        mrcomanda(1000, 'NO_EXISTE'),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 1000),
      ],
      'no existe en el catálogo',
    ],
  ])('rechaza %s', (_label, vouchers, message) => {
    expect(() => summarizeVouchers(vouchers, METHODS)).toThrow(message);
  });

  it('calcula ventas netas por medio y suma el fondo solo al efectivo', () => {
    const lines = calculateClosingLines(
      [
        sale('CASH', 100000, 0),
        sale('DEBIT_CARD', 521730, 10000),
        sale('DEBIT_CARD', 10000, 0),
        sale('CREDIT_CARD', 53800, 10000),
        sale('TRANSFER', 20000, 0),
      ],
      counted([149000, 521730, 43800, 20000]),
      50000,
      METHODS,
      CUT,
    );

    expect(lines).toEqual([
      {
        paymentMethodId: 'medio-efectivo',
        paymentMethod: 'CASH',
        paymentMethodName: 'Efectivo',
        expectedAmount: 150000,
        countedAmount: 149000,
        difference: -1000,
      },
      {
        paymentMethodId: 'medio-debito',
        paymentMethod: 'DEBIT_CARD',
        paymentMethodName: 'Tarjeta de débito',
        expectedAmount: 521730,
        countedAmount: 521730,
        difference: 0,
      },
      {
        paymentMethodId: 'medio-credito',
        paymentMethod: 'CREDIT_CARD',
        paymentMethodName: 'Tarjeta de crédito',
        expectedAmount: 43800,
        countedAmount: 43800,
        difference: 0,
      },
      {
        paymentMethodId: 'medio-transferencia',
        paymentMethod: 'TRANSFER',
        paymentMethodName: 'Transferencia',
        expectedAmount: 20000,
        countedAmount: 20000,
        difference: 0,
      },
    ]);
    expect(hasClosingDifferences(lines, 0)).toBe(true);
    expect(hasClosingDifferences(lines.slice(1), 0)).toBe(false);
    expect(hasClosingDifferences(lines.slice(1), 1600)).toBe(true);
  });

  it('suma el fondo una sola vez cuando el catálogo tiene más de un medio CASH', () => {
    // El fondo es un monto físico único: con dos medios CASH (ej. uno
    // temporal de otro escenario) solo la primera línea CASH del orden del
    // catálogo lo recibe; la otra espera solo sus ventas. Sumarlo en cada
    // línea inflaría lo esperado una vez por medio extra.
    const extraCash: CatalogPaymentMethod = {
      id: 'medio-efectivo-auxiliar',
      code: 'CASH_AUX',
      name: 'Efectivo auxiliar',
      behavior: PaymentMethodBehavior.CASH,
      sortOrder: 0,
      isActive: true,
    };
    const lines = calculateClosingLines(
      [
        sale('CASH', 100000, 0),
        sale('CASH_AUX', 5000, 0),
        sale('DEBIT_CARD', 521730, 10000),
      ],
      [
        { paymentMethod: 'CASH_AUX', countedAmount: 5000 },
        { paymentMethod: 'CASH', countedAmount: 150000 },
        { paymentMethod: 'DEBIT_CARD', countedAmount: 511730 },
        { paymentMethod: 'CREDIT_CARD', countedAmount: 0 },
        { paymentMethod: 'TRANSFER', countedAmount: 0 },
      ],
      50000,
      [extraCash, ...METHODS],
      CUT,
    );

    expect(lines).toEqual([
      expect.objectContaining({
        paymentMethod: 'CASH_AUX',
        expectedAmount: 55000,
        countedAmount: 5000,
        difference: -50000,
      }),
      expect.objectContaining({
        paymentMethod: 'CASH',
        expectedAmount: 100000,
        countedAmount: 150000,
        difference: 50000,
      }),
      expect.objectContaining({
        paymentMethod: 'DEBIT_CARD',
        expectedAmount: 511730,
        difference: 0,
      }),
      expect.objectContaining({
        paymentMethod: 'CREDIT_CARD',
        expectedAmount: 0,
        countedAmount: 0,
        difference: 0,
      }),
      expect.objectContaining({
        paymentMethod: 'TRANSFER',
        expectedAmount: 0,
        countedAmount: 0,
        difference: 0,
      }),
    ]);
  });

  it('rechaza un fondo positivo cuando el cierre no tiene una línea de efectivo', () => {
    const withoutCash = METHODS.map((method) =>
      method.code === 'CASH' ? { ...method, isActive: false } : method,
    );
    const lines = counted([0, 0, 0, 0]).slice(1);

    expect(() =>
      calculateClosingLines([], lines, 50000, withoutCash, CUT),
    ).toThrow('fondo de caja sin una línea de efectivo');
    expect(calculateClosingLines([], lines, 0, withoutCash, CUT)).toHaveLength(
      3,
    );
  });

  it('exige línea de un medio inactivo con ventas del período y lo ordena por el catálogo', () => {
    const lines = calculateClosingLines(
      [sale('JUNEB', 20000, 0), sale('CASH', 5000, 0)],
      [
        { paymentMethod: 'CASH', countedAmount: 55000 },
        { paymentMethod: 'DEBIT_CARD', countedAmount: 0 },
        { paymentMethod: 'CREDIT_CARD', countedAmount: 0 },
        { paymentMethod: 'TRANSFER', countedAmount: 0 },
        { paymentMethod: 'JUNEB', countedAmount: 20000 },
      ],
      50000,
      METHODS,
      CUT,
    );

    expect(lines.map((line) => line.paymentMethod)).toEqual([
      'CASH',
      'DEBIT_CARD',
      'CREDIT_CARD',
      'TRANSFER',
      'JUNEB',
    ]);
    expect(lines.find((line) => line.paymentMethod === 'JUNEB')).toMatchObject({
      paymentMethodName: 'Junaeb',
      expectedAmount: 20000,
      countedAmount: 20000,
      difference: 0,
    });
  });

  it('marca No cuadrado ante compensación −500/+500 aunque el total cuadre', () => {
    const lines = calculateClosingLines(
      [sale('CASH', 100000, 0), sale('DEBIT_CARD', 521730, 0)],
      [
        { paymentMethod: 'CASH', countedAmount: 99500 },
        { paymentMethod: 'DEBIT_CARD', countedAmount: 522230 },
        { paymentMethod: 'CREDIT_CARD', countedAmount: 0 },
        { paymentMethod: 'TRANSFER', countedAmount: 0 },
      ],
      0,
      METHODS,
      CUT,
    );

    const cash = lines.find((line) => line.paymentMethod === 'CASH');
    const debit = lines.find((line) => line.paymentMethod === 'DEBIT_CARD');
    expect(cash?.difference).toBe(-500);
    expect(debit?.difference).toBe(500);
    expect(lines.reduce((total, line) => total + line.difference, 0)).toBe(0);
    expect(hasClosingDifferences(lines, 0)).toBe(true);
  });

  it('rechaza medios duplicados, incompletos, no permitidos y desconocidos', () => {
    expect(() =>
      calculateClosingLines(
        [],
        [...counted([0, 0, 0, 0]), counted([0, 0, 0, 0])[0]],
        0,
        METHODS,
        CUT,
      ),
    ).toThrow('aparece más de una vez');
    expect(() =>
      calculateClosingLines(
        [],
        counted([0, 0, 0, 0]).slice(1),
        0,
        METHODS,
        CUT,
      ),
    ).toThrow('todos los medios');
    expect(() =>
      calculateClosingLines(
        [],
        [
          ...counted([0, 0, 0, 0]),
          { paymentMethod: 'JUNEB', countedAmount: 0 },
        ],
        0,
        METHODS,
        CUT,
      ),
    ).toThrow('no admite línea de cierre');
    expect(() =>
      calculateClosingLines(
        [],
        [...counted([0, 0, 0, 0]), { paymentMethod: 'OTRO', countedAmount: 0 }],
        0,
        METHODS,
        CUT,
      ),
    ).toThrow('no existe en el catálogo');
  });

  it('rechaza ventas netas negativas y ventas agregadas parcialmente fuera del corte', () => {
    expect(() =>
      calculateClosingLines(
        [sale('CASH', 100, 101)],
        counted([0, 0, 0, 0]),
        0,
        METHODS,
        CUT,
      ),
    ).toThrow('propina supera su monto bruto');

    const aggregated: ClosingSale = {
      ...sale('DEBIT_CARD', 10000, 0),
      periodStart: new Date('2026-03-10T07:00:00-03:00'),
      periodEnd: new Date('2026-03-10T15:00:00-03:00'),
    };
    expect(() =>
      calculateClosingLines(
        [aggregated],
        counted([0, 10000, 0, 0]),
        0,
        METHODS,
        CUT,
      ),
    ).toThrow('parcialmente fuera del corte');

    const contained: ClosingSale = {
      ...sale('DEBIT_CARD', 10000, 0),
      periodStart: new Date('2026-03-10T09:00:00-03:00'),
      periodEnd: new Date('2026-03-10T15:00:00-03:00'),
    };
    const lines = calculateClosingLines(
      [contained],
      counted([0, 10000, 0, 0]),
      0,
      METHODS,
      CUT,
    );
    expect(
      lines.find((line) => line.paymentMethod === 'DEBIT_CARD'),
    ).toMatchObject({ expectedAmount: 10000, difference: 0 });
  });
});
