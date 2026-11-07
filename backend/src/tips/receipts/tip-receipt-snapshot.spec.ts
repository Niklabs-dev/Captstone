import type { TipPoolResponse } from '../types/tip-pools.types.js';
import {
  buildTipPoolReceipts,
  parseReceiptDetail,
} from './tip-receipt-snapshot.js';

// Tests unitarios del armado de las constancias de pago (SPRINT-3-T13 y
// regla equitativa de SPRINT-4R-T04).

const POOL: TipPoolResponse = {
  id: 'pool-1',
  status: 'CONFIRMED',
  version: 3,
  store: { id: 'store-1', name: 'Melipilla Centro' },
  periodStart: '2026-10-01',
  periodEnd: '2026-10-15',
  rule: 'PROPORTIONAL_TO_HOURS',
  agreement: {
    id: 'agreement-1',
    name: 'Pacto proporcional',
    rule: 'PROPORTIONAL_TO_HOURS',
    validFrom: '2026-01-01',
    validTo: null,
  },
  totalAmount: 12000,
  totalHours: '60.00',
  lines: [
    { userId: 'u-1', workerName: 'Ana Pérez', hoursWorked: '20.00', amount: 0 },
    {
      userId: 'u-2',
      workerName: 'Beto Soto',
      hoursWorked: '40.00',
      amount: 12000,
    },
  ],
  sources: [],
  dailySources: [],
  reconciled: true,
  calculatedBy: { id: 'acc-1', name: 'Lucas Contador' },
  calculatedAt: new Date('2026-10-20T12:00:00Z'),
  notes: null,
  confirmedBy: { id: 'acc-1', name: 'Lucas Contador' },
  confirmedAt: new Date('2026-10-21T12:00:00Z'),
  paidBy: null,
  paidAt: null,
  paymentDate: null,
  receiptsCount: 0,
  updatedAt: new Date('2026-10-21T12:00:00Z'),
};

const PAID_BY = { id: 'acc-2', name: 'Carla Contadora' };

describe('buildTipPoolReceipts', () => {
  it('arma una constancia por línea, también con monto 0', () => {
    const receipts = buildTipPoolReceipts(POOL, '2026-10-27', PAID_BY);

    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toEqual({
      userId: 'u-1',
      workerName: 'Ana Pérez',
      storeId: 'store-1',
      storeName: 'Melipilla Centro',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-15',
      hoursWorked: '20.00',
      amount: 0,
      paymentDate: '2026-10-27',
      paidById: 'acc-2',
      paidByName: 'Carla Contadora',
      detail: {
        rule: 'PROPORTIONAL_TO_HOURS',
        agreementSnapshot: POOL.agreement,
        totalAmount: 12000,
        totalHours: '60.00',
        lines: POOL.lines,
      },
    });
    expect(receipts.reduce((sum, receipt) => sum + receipt.amount, 0)).toBe(
      POOL.totalAmount,
    );
  });

  it('el detalle es una copia: cambiar el reparto después no lo altera', () => {
    const pool = structuredClone(POOL);
    const [receipt] = buildTipPoolReceipts(pool, '2026-10-27', PAID_BY);
    pool.lines[0].amount = 999;

    expect(receipt.detail.lines[0].amount).toBe(0);
  });

  it('en el reparto equitativo copia la regla y deja las horas en null', () => {
    const equal: TipPoolResponse = {
      ...POOL,
      rule: 'EQUAL_SHARES',
      agreement: null,
      totalHours: null,
      lines: [
        {
          userId: 'u-1',
          workerName: 'Ana Pérez',
          hoursWorked: null,
          amount: 3334,
        },
        {
          userId: 'u-2',
          workerName: 'Beto Soto',
          hoursWorked: null,
          amount: 3333,
        },
      ],
    };
    const [receipt] = buildTipPoolReceipts(equal, '2026-10-27', PAID_BY);

    expect(receipt.hoursWorked).toBeNull();
    expect(receipt.amount).toBe(3334);
    expect(receipt.detail).toEqual({
      rule: 'EQUAL_SHARES',
      agreementSnapshot: null,
      totalAmount: 12000,
      totalHours: null,
      lines: equal.lines,
    });
    const stored: unknown = JSON.parse(JSON.stringify(receipt.detail));
    expect(parseReceiptDetail(stored)).toEqual(receipt.detail);
  });

  it('sin líneas no arma constancias', () => {
    expect(
      buildTipPoolReceipts({ ...POOL, lines: [] }, '2026-10-27', PAID_BY),
    ).toEqual([]);
  });
});

describe('parseReceiptDetail', () => {
  it('lee el detalle que guarda buildTipPoolReceipts', () => {
    const [receipt] = buildTipPoolReceipts(POOL, '2026-10-27', PAID_BY);
    const stored: unknown = JSON.parse(JSON.stringify(receipt.detail));

    expect(parseReceiptDetail(stored)).toEqual(receipt.detail);
  });

  it('acepta un pacto ausente (repartos históricos sin copia)', () => {
    expect(
      parseReceiptDetail({
        agreementSnapshot: null,
        totalAmount: 0,
        totalHours: '0.00',
        lines: [],
      }).agreementSnapshot,
    ).toBeNull();
  });

  it('una constancia anterior a la regla equitativa se lee como proporcional', () => {
    const legacy = parseReceiptDetail({
      agreementSnapshot: null,
      totalAmount: 100,
      totalHours: '10.00',
      lines: [
        { userId: 'u-1', workerName: 'Ana', hoursWorked: '10.00', amount: 100 },
      ],
    });
    expect(legacy.rule).toBe('PROPORTIONAL_TO_HOURS');
    expect(legacy.lines[0].hoursWorked).toBe('10.00');
  });

  it('rechaza un detalle corrupto', () => {
    expect(() => parseReceiptDetail(null)).toThrow();
    expect(() =>
      parseReceiptDetail({
        totalAmount: '12000',
        totalHours: '60.00',
        lines: [],
      }),
    ).toThrow('El detalle guardado de la constancia no es válido');
    expect(() =>
      parseReceiptDetail({
        totalAmount: 12000,
        totalHours: '60.00',
        lines: [{ userId: 'u-1' }],
      }),
    ).toThrow();
    expect(() =>
      parseReceiptDetail({
        rule: 'BY_SENIORITY',
        totalAmount: 12000,
        totalHours: null,
        lines: [],
      }),
    ).toThrow('El detalle guardado de la constancia no es válido');
  });
});
