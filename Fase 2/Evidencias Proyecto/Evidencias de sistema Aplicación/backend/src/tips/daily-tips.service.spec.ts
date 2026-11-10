import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/types/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DailyTipsService } from './daily-tips.service.js';

// Servicio de consulta de propinas diarias (SPRINT-4A-T04) con la base
// simulada: validación del rango, alcance por local y armado de totales.
const STORE_ID = '1010021e-9bab-42d5-851c-417e9e2503bf';
const OTHER_STORE_ID = '2010021e-9bab-42d5-851c-417e9e2503bf';

const SUPERVISOR: AuthUser = {
  id: 'a9000000-0000-4000-8000-000000000001',
  email: 'supervisor@daily-tips-unit.invalid',
  role: 'SUPERVISOR',
  storeId: STORE_ID,
};
const ACCOUNTANT: AuthUser = {
  id: 'a9000000-0000-4000-8000-000000000002',
  email: 'contador@daily-tips-unit.invalid',
  role: 'CONTADOR',
  storeId: null,
};

function person(id: string, firstName: string) {
  return { id, firstName, lastName: 'Unit' };
}

function createService() {
  const prisma = {
    store: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: STORE_ID, name: 'Local Demo' }),
    },
    dailyOperation: { findMany: vi.fn(), findUnique: vi.fn() },
    dailyTipAllocation: { findMany: vi.fn() },
  };
  const service = new DailyTipsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('DailyTipsService (SPRINT-4A-T04)', () => {
  it('valida el rango: orden, fechas reales y máximo de 62 días', () => {
    const { service } = createService();
    expect(service.parseRange('2026-11-01', '2027-01-01')).toMatchObject({
      from: '2026-11-01',
      to: '2027-01-01',
      fromDate: new Date('2026-11-01T00:00:00.000Z'),
      toDate: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(() => service.parseRange('2026-11-02', '2026-11-01')).toThrow(
      BadRequestException,
    );
    expect(() => service.parseRange('2026-11-01', '2027-01-02')).toThrow(
      /62 días/,
    );
    expect(() => service.parseRange('2026-02-30', '2026-03-01')).toThrow(
      BadRequestException,
    );
  });

  it('el supervisor solo consulta su local y el contador cualquiera', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findMany.mockResolvedValue([]);
    const query = {
      storeId: OTHER_STORE_ID,
      from: '2026-11-01',
      to: '2026-11-30',
    };
    await expect(service.listDays(query, SUPERVISOR)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.dailyOperation.findMany).not.toHaveBeenCalled();
    await expect(service.listDays(query, ACCOUNTANT)).resolves.toMatchObject({
      days: [],
    });
  });

  it('arma el total por día con su estado y los totales del rango', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findMany.mockResolvedValue([
      {
        id: 'op-1',
        businessDate: new Date('2026-11-03T00:00:00.000Z'),
        tipFundAmount: BigInt(10_000),
        _count: { participants: 3 },
        tipAllocations: [
          { amount: BigInt(3_334), status: 'PAID' },
          { amount: BigInt(3_333), status: 'UNPAID' },
          { amount: BigInt(3_333), status: 'UNPAID' },
        ],
      },
    ]);
    const result = await service.listDays(
      { storeId: STORE_ID, from: '2026-11-01', to: '2026-11-30' },
      SUPERVISOR,
    );
    expect(result.days).toEqual([
      {
        operationId: 'op-1',
        businessDate: '2026-11-03',
        tipFundAmount: 10_000,
        participantCount: 3,
        totalAmount: 10_000,
        paidAmount: 3_334,
        unpaidAmount: 6_666,
        status: 'PARTIAL',
      },
    ]);
    expect(result.totals).toEqual({
      totalAmount: 10_000,
      paidAmount: 3_334,
      unpaidAmount: 6_666,
      dayCount: 1,
    });
  });

  it('el resumen aplica el filtro de estado en la consulta', async () => {
    const { service, prisma } = createService();
    prisma.dailyTipAllocation.findMany.mockResolvedValue([
      {
        id: 'tip-1',
        operationId: 'op-1',
        businessDate: new Date('2026-11-03T00:00:00.000Z'),
        amount: BigInt(5_000),
        status: 'UNPAID',
        paymentBatchId: null,
        worker: person('w-1', 'Ana'),
      },
    ]);
    const result = await service.summarize(
      {
        storeId: STORE_ID,
        from: '2026-11-01',
        to: '2026-11-30',
        status: 'UNPAID',
      },
      ACCOUNTANT,
    );
    expect(prisma.dailyTipAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: STORE_ID,
          businessDate: {
            gte: new Date('2026-11-01T00:00:00.000Z'),
            lte: new Date('2026-11-30T00:00:00.000Z'),
          },
          status: 'UNPAID',
        },
      }),
    );
    expect(result).toMatchObject({
      status: 'UNPAID',
      workers: [
        {
          worker: { id: 'w-1', name: 'Ana Unit' },
          dayCount: 1,
          totalAmount: 5_000,
          unpaidAmount: 5_000,
        },
      ],
      totals: { totalAmount: 5_000, workerCount: 1, dayCount: 1 },
    });
  });

  it('responde 404 si el local no existe o no hay operación ese día', async () => {
    const { service, prisma } = createService();
    prisma.dailyOperation.findUnique.mockResolvedValue(null);
    await expect(
      service.findDay(
        { storeId: STORE_ID, businessDate: '2026-11-03' },
        ACCOUNTANT,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    prisma.store.findUnique.mockResolvedValue(null);
    await expect(
      service.summarize(
        { storeId: STORE_ID, from: '2026-11-01', to: '2026-11-30' },
        ACCOUNTANT,
      ),
    ).rejects.toThrow(/Local no encontrado/);
  });
});
