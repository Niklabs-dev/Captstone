import type { TipPoolResponse } from '../types/tip-pools.types.js';
import {
  buildTipPoolReceipts,
  parseReceiptDetail,
} from './tip-receipt-snapshot.js';

// Tests unitarios del armado de las constancias de pago (SPRINT-3-T13).

const POOL: TipPoolResponse = {
  id: 'pool-1',
  status: 'CONFIRMED',
  version: 3,
  store: { id: 'store-1', name: 'Melipilla Centro' },
  periodStart: '2026-10-01',
  periodEnd: '2026-10-15',
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
  });
});
