import type { DailyTipAllocationFact } from '../types/daily-tips.types.js';
import {
  settlementStatus,
  sumTipAmounts,
  summarizeByWorker,
} from './daily-tips-aggregation.js';

// Agregación de las propinas diarias por trabajador (SPRINT-4A-T04).
function fact(
  overrides: Partial<DailyTipAllocationFact> & {
    workerId: string;
    workerName: string;
  },
): DailyTipAllocationFact {
  const { workerId, workerName, ...rest } = overrides;
  return {
    id: `${workerId}-${rest.operationId ?? 'op-1'}`,
    operationId: 'op-1',
    businessDate: '2026-11-03',
    worker: { id: workerId, name: workerName },
    amount: 10_000,
    status: 'UNPAID',
    paymentBatchId: null,
    ...rest,
  };
}

describe('Agregación de propinas diarias (SPRINT-4A-T04)', () => {
  it('suma total, pagado y pendiente y siempre cuadran', () => {
    expect(
      sumTipAmounts([
        { amount: 3_334, status: 'PAID' },
        { amount: 3_333, status: 'UNPAID' },
        { amount: 3_333, status: 'UNPAID' },
      ]),
    ).toEqual({ totalAmount: 10_000, paidAmount: 3_334, unpaidAmount: 6_666 });
    expect(sumTipAmounts([])).toEqual({
      totalAmount: 0,
      paidAmount: 0,
      unpaidAmount: 0,
    });
  });

  it('el estado del día es No pagado, Pagado o Parcial', () => {
    expect(settlementStatus([])).toBe('UNPAID');
    expect(settlementStatus([{ status: 'UNPAID' }])).toBe('UNPAID');
    expect(settlementStatus([{ status: 'PAID' }, { status: 'PAID' }])).toBe(
      'PAID',
    );
    expect(settlementStatus([{ status: 'PAID' }, { status: 'UNPAID' }])).toBe(
      'PARTIAL',
    );
  });

  it('acumula por trabajador con días distintos, ordenado por nombre e ID', () => {
    const summary = summarizeByWorker([
      fact({ workerId: 'w-2', workerName: 'Beto', amount: 5_000 }),
      fact({ workerId: 'w-1', workerName: 'Ana', amount: 5_000 }),
      fact({
        workerId: 'w-1',
        workerName: 'Ana',
        operationId: 'op-2',
        businessDate: '2026-11-04',
        amount: 7_001,
        status: 'PAID',
        paymentBatchId: 'batch-1',
      }),
      fact({ workerId: 'w-0', workerName: 'Ana', amount: 1 }),
    ]);
    expect(summary).toEqual([
      {
        worker: { id: 'w-0', name: 'Ana' },
        dayCount: 1,
        totalAmount: 1,
        paidAmount: 0,
        unpaidAmount: 1,
      },
      {
        worker: { id: 'w-1', name: 'Ana' },
        dayCount: 2,
        totalAmount: 12_001,
        paidAmount: 7_001,
        unpaidAmount: 5_000,
      },
      {
        worker: { id: 'w-2', name: 'Beto' },
        dayCount: 1,
        totalAmount: 5_000,
        paidAmount: 0,
        unpaidAmount: 5_000,
      },
    ]);
  });
});
