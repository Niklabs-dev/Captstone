import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/types/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DailyTipsService } from './daily-tips.service.js';
import {
  NO_PENDING_TIPS_MESSAGE,
  TipPaymentBatchesService,
} from './tip-payment-batches.service.js';

// Servicio de pago por período (SPRINT-4A-T06) con la base simulada: sin
// pendientes no crea el lote, marca solo las No pagadas leídas bajo bloqueo
// y arma la respuesta con total, cantidades y responsable. La carrera real
// está en test/tip-payment-batches-concurrency.integration.spec.ts.
const STORE_ID = '1010021e-9bab-42d5-851c-417e9e2503bf';
const BATCH_ID = '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ACCOUNTANT: AuthUser = {
  id: 'a9000000-0000-4000-8000-000000000002',
  email: 'contador@tip-payment-unit.invalid',
  role: 'CONTADOR',
  storeId: null,
};
const PAID_AT = new Date('2026-11-16T15:30:00.000Z');
const PERIOD = { storeId: STORE_ID, from: '2026-11-01', to: '2026-11-15' };

function allocation(id: string, workerId: string, amount: number) {
  return {
    id,
    operationId: `op-${id}`,
    businessDate: new Date('2026-11-03T00:00:00.000Z'),
    amount: BigInt(amount),
    status: 'UNPAID',
    paymentBatchId: null,
    worker: { id: workerId, firstName: 'Ficticio', lastName: workerId },
  };
}

function batchRecord(totalAmount: number, allocationCount: number) {
  return {
    id: BATCH_ID,
    periodStart: new Date('2026-11-01T00:00:00.000Z'),
    periodEnd: new Date('2026-11-15T00:00:00.000Z'),
    totalAmount: BigInt(totalAmount),
    allocationCount,
    paidAt: PAID_AT,
    store: { id: STORE_ID, name: 'Local Demo' },
    paidBy: { id: ACCOUNTANT.id, firstName: 'Contador', lastName: 'Demo' },
  };
}

function createService() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    dailyTipAllocation: { findMany: vi.fn(), updateMany: vi.fn() },
    tipPaymentBatch: {
      create: vi.fn().mockResolvedValue({ id: BATCH_ID }),
      findUniqueOrThrow: vi.fn(),
    },
  };
  const prisma = {
    store: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: STORE_ID, name: 'Local Demo' }),
    },
    tipPaymentBatch: { findMany: vi.fn() },
    dailyTipAllocation: { groupBy: vi.fn() },
    $transaction: vi.fn(
      (work: (client: typeof tx) => Promise<unknown>): Promise<unknown> =>
        work(tx),
    ),
  };
  const client = prisma as unknown as PrismaService;
  const service = new TipPaymentBatchesService(
    client,
    new DailyTipsService(client),
  );
  return { service, prisma, tx };
}

describe('TipPaymentBatchesService (SPRINT-4A-T06)', () => {
  it('sin propinas pendientes responde 409 sin crear el lote', async () => {
    const { service, tx } = createService();
    tx.dailyTipAllocation.findMany.mockResolvedValue([]);
    const attempt = service.pay(PERIOD, ACCOUNTANT);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(NO_PENDING_TIPS_MESSAGE);
    // Bloquea el local y las operaciones del período antes de leer.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.tipPaymentBatch.create).not.toHaveBeenCalled();
    expect(tx.dailyTipAllocation.updateMany).not.toHaveBeenCalled();
  });

  it('marca solo las No pagadas leídas y responde total, cantidades y responsable', async () => {
    const { service, tx } = createService();
    tx.dailyTipAllocation.findMany.mockResolvedValue([
      allocation('t1', 'w1', 3_334),
      allocation('t2', 'w2', 3_333),
      allocation('t3', 'w1', 5_000),
    ]);
    tx.dailyTipAllocation.updateMany.mockResolvedValue({ count: 3 });
    tx.tipPaymentBatch.findUniqueOrThrow.mockResolvedValue(
      batchRecord(11_667, 3),
    );

    await expect(service.pay(PERIOD, ACCOUNTANT)).resolves.toEqual({
      id: BATCH_ID,
      store: { id: STORE_ID, name: 'Local Demo' },
      periodStart: '2026-11-01',
      periodEnd: '2026-11-15',
      totalAmount: 11_667,
      allocationCount: 3,
      workerCount: 2,
      paidBy: { id: ACCOUNTANT.id, name: 'Contador Demo' },
      paidAt: PAID_AT,
    });
    expect(tx.dailyTipAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: STORE_ID,
          status: 'UNPAID',
        }) as unknown,
      }),
    );
    expect(tx.tipPaymentBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: STORE_ID,
          totalAmount: 11_667n,
          allocationCount: 3,
          paidById: ACCOUNTANT.id,
        }) as unknown,
      }),
    );
    expect(tx.dailyTipAllocation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['t1', 't2', 't3'] }, status: 'UNPAID' },
      data: { status: 'PAID', paymentBatchId: BATCH_ID },
    });
  });

  it('si las propinas cambiaron bajo el pago responde 409', async () => {
    const { service, tx } = createService();
    tx.dailyTipAllocation.findMany.mockResolvedValue([
      allocation('t1', 'w1', 1_000),
      allocation('t2', 'w2', 1_000),
    ]);
    tx.dailyTipAllocation.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.pay(PERIOD, ACCOUNTANT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.tipPaymentBatch.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('valida rango y local antes de abrir la transacción', async () => {
    const { service, prisma } = createService();
    await expect(
      service.pay({ ...PERIOD, to: '2027-01-15' }, ACCOUNTANT),
    ).rejects.toThrow(/62 días/);
    prisma.store.findUnique.mockResolvedValue(null);
    await expect(service.pay(PERIOD, ACCOUNTANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lista el historial con la cantidad de trabajadores de cada lote', async () => {
    const { service, prisma } = createService();
    prisma.tipPaymentBatch.findMany.mockResolvedValue([batchRecord(11_667, 3)]);
    prisma.dailyTipAllocation.groupBy.mockResolvedValue([
      { paymentBatchId: BATCH_ID, workerId: 'w1' },
      { paymentBatchId: BATCH_ID, workerId: 'w2' },
    ]);
    const body = await service.list(PERIOD);
    expect(body.batches).toHaveLength(1);
    expect(body.batches[0]).toMatchObject({ id: BATCH_ID, workerCount: 2 });
    expect(prisma.tipPaymentBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: STORE_ID,
          periodStart: { lte: new Date('2026-11-15T00:00:00.000Z') },
          periodEnd: { gte: new Date('2026-11-01T00:00:00.000Z') },
        },
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });
});
