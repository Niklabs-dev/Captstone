import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/types/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DailyTipsService } from './daily-tips.service.js';
import { MyTipsService, currentMonthRange } from './my-tips.service.js';

// Consulta personal de propinas (SPRINT-4A-T09) con la base simulada: la
// identidad sale del JWT, el rango por defecto es el mes en curso en Chile y
// los totales pendiente y pagado cuadran con los días.
const STORE = { id: '1010021e-9bab-42d5-851c-417e9e2503bf', name: 'Local A' };
const WORKER: AuthUser = {
  id: 'a9000000-0000-4000-8000-000000000011',
  email: 'trabajador@my-tips-unit.invalid',
  role: 'TRABAJADOR',
  storeId: STORE.id,
};
const SUPERVISOR: AuthUser = {
  id: 'a9000000-0000-4000-8000-000000000012',
  email: 'supervisor@my-tips-unit.invalid',
  role: 'SUPERVISOR',
  storeId: STORE.id,
};
const NOW = new Date('2026-11-10T15:00:00.000Z');

function createService() {
  const prisma = { dailyTipAllocation: { findMany: vi.fn() } };
  prisma.dailyTipAllocation.findMany.mockResolvedValue([
    {
      id: 'tip-2',
      businessDate: new Date('2026-11-09T00:00:00.000Z'),
      amount: BigInt(7_500),
      status: 'UNPAID',
      paymentBatchId: null,
      store: STORE,
      paymentBatch: null,
    },
    {
      id: 'tip-1',
      businessDate: new Date('2026-11-03T00:00:00.000Z'),
      amount: BigInt(10_000),
      status: 'PAID',
      paymentBatchId: 'batch-1',
      store: STORE,
      paymentBatch: { paidAt: new Date('2026-11-06T15:00:00.000Z') },
    },
  ]);
  const dailyTips = new DailyTipsService(prisma as unknown as PrismaService);
  return { service: new MyTipsService(dailyTips), prisma };
}

describe('MyTipsService (SPRINT-4A-T09)', () => {
  it('el mes por defecto se calcula en hora de Chile', () => {
    expect(currentMonthRange(NOW)).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    // 1 de marzo 02:00 UTC aún es 28 de febrero en Chile.
    expect(currentMonthRange(new Date('2026-03-01T02:00:00.000Z'))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(currentMonthRange(new Date('2028-02-15T12:00:00.000Z'))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('consulta solo las propinas del usuario del JWT y arma los totales', async () => {
    const { service, prisma } = createService();
    const result = await service.list({}, WORKER, NOW);
    expect(prisma.dailyTipAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workerId: WORKER.id,
          businessDate: {
            gte: new Date('2026-11-01T00:00:00.000Z'),
            lte: new Date('2026-11-30T00:00:00.000Z'),
          },
        },
      }),
    );
    expect(result).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      days: [
        {
          id: 'tip-2',
          businessDate: '2026-11-09',
          store: STORE,
          amount: 7_500,
          status: 'UNPAID',
          paymentBatchId: null,
          paidAt: null,
        },
        {
          id: 'tip-1',
          businessDate: '2026-11-03',
          store: STORE,
          amount: 10_000,
          status: 'PAID',
          paymentBatchId: 'batch-1',
          paidAt: new Date('2026-11-06T15:00:00.000Z'),
        },
      ],
      totals: {
        totalAmount: 17_500,
        paidAmount: 10_000,
        unpaidAmount: 7_500,
        dayCount: 2,
      },
    });
  });

  it('el supervisor también consulta solo las suyas con el rango indicado', async () => {
    const { service, prisma } = createService();
    await service.list({ from: '2026-10-01', to: '2026-10-31' }, SUPERVISOR);
    expect(prisma.dailyTipAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workerId: SUPERVISOR.id }) as object,
      }),
    );
  });

  it('rechaza rangos incompletos, invertidos o mayores a 62 días', async () => {
    const { service, prisma } = createService();
    for (const query of [
      { from: '2026-11-01' },
      { to: '2026-11-30' },
      { from: '2026-11-30', to: '2026-11-01' },
      { from: '2026-11-01', to: '2027-01-02' },
    ]) {
      await expect(service.list(query, WORKER, NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(prisma.dailyTipAllocation.findMany).not.toHaveBeenCalled();
  });

  it('ADMINISTRADOR y CONTADOR reciben 403 sin consultar la base', async () => {
    const { service, prisma } = createService();
    for (const role of ['ADMINISTRADOR', 'CONTADOR']) {
      await expect(
        service.list({}, { ...WORKER, role, storeId: null }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(prisma.dailyTipAllocation.findMany).not.toHaveBeenCalled();
  });
});
