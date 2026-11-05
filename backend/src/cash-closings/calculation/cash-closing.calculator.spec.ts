import {
  CashClosingVoucherSource,
  PaymentMethod,
  Prisma,
} from '../../generated/prisma/client.js';
import {
  calculateClosingLines,
  hasClosingDifferences,
  summarizeVouchers,
  type ClosingVoucherInput,
  type CountedLineInput,
} from './cash-closing.calculator.js';

const START = '2026-03-10T08:00:00-03:00';
const END = '2026-03-10T16:00:00-03:00';

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

function counted(amounts: number[]): CountedLineInput[] {
  return [
    PaymentMethod.CASH,
    PaymentMethod.DEBIT_CARD,
    PaymentMethod.CREDIT_CARD,
    PaymentMethod.TRANSFER,
  ].map((paymentMethod, index) => ({
    paymentMethod,
    countedAmount: amounts[index],
  }));
}

describe('Cálculo de cierres de caja (SPRINT-4-T09)', () => {
  it('concilia el caso de vouchers sin convertir las diferencias brutas en propinas', () => {
    const summary = summarizeVouchers([
      voucher(CashClosingVoucherSource.MRCOMANDA, 511730),
      voucher(CashClosingVoucherSource.MRCOMANDA, 43800),
      voucher(CashClosingVoucherSource.MERCADO_PAGO, 588732, 31602),
    ]);

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

  it('suma cortes parciales y exige la misma envolvente de período', () => {
    const summary = summarizeVouchers([
      voucher(CashClosingVoucherSource.MRCOMANDA, 1000, 0, {
        periodEnd: '2026-03-10T12:00:00-03:00',
      }),
      voucher(CashClosingVoucherSource.MRCOMANDA, 2000, 0, {
        periodStart: '2026-03-10T12:00:00-03:00',
      }),
      voucher(CashClosingVoucherSource.MERCADO_PAGO, 4000, 1000),
    ]);
    expect(summary.mrcomandaNetSales).toBe(3000);
    expect(summary.reconciliationDifference).toBe(0);

    expect(() =>
      summarizeVouchers([
        voucher(CashClosingVoucherSource.MRCOMANDA, 1000),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 1000, 0, {
          periodEnd: '2026-03-10T17:00:00-03:00',
        }),
      ]),
    ).toThrow('mismo período de corte');
  });

  it.each([
    [
      'falta una fuente',
      [voucher(CashClosingVoucherSource.MRCOMANDA, 1000)],
      'al menos un voucher',
    ],
    [
      'período invertido',
      [
        voucher(CashClosingVoucherSource.MRCOMANDA, 1000),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 1000, 0, {
          periodEnd: START,
        }),
      ],
      'debe terminar después',
    ],
    [
      'propina mayor al bruto',
      [
        voucher(CashClosingVoucherSource.MRCOMANDA, 1000),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 1000, 1001),
      ],
      'no puede superar',
    ],
    [
      'propina atribuida a MrComanda',
      [
        voucher(CashClosingVoucherSource.MRCOMANDA, 1000, 1),
        voucher(CashClosingVoucherSource.MERCADO_PAGO, 1000),
      ],
      'MrComanda no pueden incluir propinas',
    ],
  ])('rechaza %s', (_label, vouchers, message) => {
    expect(() => summarizeVouchers(vouchers)).toThrow(message);
  });

  it('calcula ventas netas por medio y suma el fondo solo al efectivo', () => {
    const lines = calculateClosingLines(
      [
        {
          paymentMethod: PaymentMethod.CASH,
          grossAmount: new Prisma.Decimal(100000),
          tipAmount: new Prisma.Decimal(0),
        },
        {
          paymentMethod: PaymentMethod.DEBIT_CARD,
          grossAmount: new Prisma.Decimal(521730),
          tipAmount: new Prisma.Decimal(10000),
        },
        {
          paymentMethod: PaymentMethod.DEBIT_CARD,
          grossAmount: new Prisma.Decimal(10000),
          tipAmount: new Prisma.Decimal(0),
        },
        {
          paymentMethod: PaymentMethod.CREDIT_CARD,
          grossAmount: new Prisma.Decimal(53800),
          tipAmount: new Prisma.Decimal(10000),
        },
        {
          paymentMethod: PaymentMethod.TRANSFER,
          grossAmount: new Prisma.Decimal(20000),
          tipAmount: new Prisma.Decimal(0),
        },
      ],
      counted([149000, 521730, 43800, 20000]),
      50000,
    );

    expect(lines).toEqual([
      {
        paymentMethod: PaymentMethod.CASH,
        expectedAmount: 150000,
        countedAmount: 149000,
        difference: -1000,
      },
      {
        paymentMethod: PaymentMethod.DEBIT_CARD,
        expectedAmount: 521730,
        countedAmount: 521730,
        difference: 0,
      },
      {
        paymentMethod: PaymentMethod.CREDIT_CARD,
        expectedAmount: 43800,
        countedAmount: 43800,
        difference: 0,
      },
      {
        paymentMethod: PaymentMethod.TRANSFER,
        expectedAmount: 20000,
        countedAmount: 20000,
        difference: 0,
      },
    ]);
    expect(hasClosingDifferences(lines, 0)).toBe(true);
    expect(hasClosingDifferences(lines.slice(1), 0)).toBe(false);
    expect(hasClosingDifferences(lines.slice(1), 1600)).toBe(true);
  });

  it('rechaza medios duplicados, incompletos y ventas netas negativas', () => {
    expect(() =>
      calculateClosingLines(
        [],
        [...counted([0, 0, 0, 0]), counted([0, 0, 0, 0])[0]],
        0,
      ),
    ).toThrow('aparece más de una vez');
    expect(() =>
      calculateClosingLines([], counted([0, 0, 0, 0]).slice(1), 0),
    ).toThrow('todos los medios');
    expect(() =>
      calculateClosingLines(
        [
          {
            paymentMethod: PaymentMethod.CASH,
            grossAmount: new Prisma.Decimal(100),
            tipAmount: new Prisma.Decimal(101),
          },
        ],
        counted([0, 0, 0, 0]),
        0,
      ),
    ).toThrow('propina supera su monto bruto');
  });
});
