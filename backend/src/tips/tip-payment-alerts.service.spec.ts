import type { ConfigService } from '@nestjs/config';
import { ROLE } from '../auth/constants/roles.constants.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TipPaymentAlertsService } from './tip-payment-alerts.service.js';

// Alerta de propinas diarias No pagadas (SPRINT-4A-T22) con la base simulada:
// el plazo sale de TIP_LEGAL_PAYMENT_DAYS, la consulta filtra por la última
// fecha vencida y cada grupo local-trabajador se proyecta con monto, días,
// fecha límite y atraso. El cálculo contra PostgreSQL real está en
// test/tip-payment-alerts.integration.spec.ts.

// 15:00 UTC del miércoles 14 de octubre = 12:00 del mismo día en Chile.
const NOW = new Date('2026-10-14T15:00:00.000Z');
const STORE_A = '00000000-0000-4000-8000-00000000000a';
const STORE_B = '00000000-0000-4000-8000-00000000000b';
const ANA = '00000000-0000-4000-8000-0000000000a1';
const BETO = '00000000-0000-4000-8000-0000000000b1';

const ACCOUNTANT: AuthUser = {
  id: 'accountant',
  email: 'contador@moi-food.cl',
  role: ROLE.CONTADOR,
  storeId: null,
};

function dbDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

interface Group {
  storeId: string;
  workerId: string;
  _count: { _all: number };
  _sum: { amount: bigint | null };
  _min: { businessDate: Date | null };
  _max: { businessDate: Date | null };
}

function group(
  storeId: string,
  workerId: string,
  count: number,
  amount: number,
  oldest: string,
  newest: string,
): Group {
  return {
    storeId,
    workerId,
    _count: { _all: count },
    _sum: { amount: BigInt(amount) },
    _min: { businessDate: dbDate(oldest) },
    _max: { businessDate: dbDate(newest) },
  };
}

function createService(env: Record<string, string>, groups: Group[] = []) {
  const groupBy = vi.fn(() => Promise.resolve(groups));
  const prisma = {
    dailyTipAllocation: { groupBy },
    store: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { id: STORE_A, name: 'Melipilla Centro' },
          { id: STORE_B, name: 'Calera' },
        ]),
      ),
    },
    user: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { id: ANA, firstName: 'Ana', lastName: 'Pérez' },
          { id: BETO, firstName: 'Beto', lastName: 'Soto' },
        ]),
      ),
    },
  };
  const config = {
    get: (key: string): string | undefined => env[key],
  } as unknown as ConfigService;
  const service = new TipPaymentAlertsService(
    prisma as unknown as PrismaService,
    config,
  );
  return { service, groupBy };
}

function whereOf(groupBy: ReturnType<typeof vi.fn>): unknown {
  const [args] = groupBy.mock.calls[0] as [{ where: unknown }];
  return args.where;
}

describe('TipPaymentAlertsService (SPRINT-4A-T22)', () => {
  it('por defecto alerta lo No pagado con más de siete días hábiles', async () => {
    const { service, groupBy } = createService({});
    const result = await service.list(ACCOUNTANT, NOW);
    // El 14 ya venció lo del viernes 2 (límite martes 13), y también lo del
    // fin de semana 3 y 4, que tiene el mismo límite.
    expect(whereOf(groupBy)).toEqual({
      status: 'UNPAID',
      businessDate: { lte: dbDate('2026-10-04') },
    });
    expect(result).toMatchObject({
      legalPaymentDays: 7,
      asOf: '2026-10-14',
      overdueThrough: '2026-10-04',
      items: [],
      totals: { alertCount: 0, amount: 0, oldestBusinessDate: null },
      calculatedAt: NOW,
    });
  });

  it('usa el plazo pactado en TIP_LEGAL_PAYMENT_DAYS y los feriados', async () => {
    const tenDays = createService({ TIP_LEGAL_PAYMENT_DAYS: '10' });
    const result = await tenDays.service.list(ACCOUNTANT, NOW);
    expect(result.legalPaymentDays).toBe(10);
    // Diez días hábiles hasta el 14: vence lo del martes 29 de septiembre.
    expect(result.overdueThrough).toBe('2026-09-29');

    const withHoliday = createService({ TIP_ALERT_HOLIDAYS: '2026-10-12' });
    expect(
      (await withHoliday.service.list(ACCOUNTANT, NOW)).overdueThrough,
    ).toBe('2026-10-01');
  });

  it('rechaza al iniciar un plazo que no es entero positivo', () => {
    for (const value of ['0', '-1', '1.5', 'siete']) {
      expect(() => createService({ TIP_LEGAL_PAYMENT_DAYS: value })).toThrow(
        /TIP_LEGAL_PAYMENT_DAYS/,
      );
    }
  });

  it('proyecta cada local y trabajador con monto, días, límite y atraso', async () => {
    const { service } = createService({}, [
      group(STORE_A, ANA, 1, 4_000, '2026-10-02', '2026-10-02'),
      group(STORE_B, BETO, 3, 9_000, '2026-09-21', '2026-10-01'),
    ]);
    const result = await service.list(ACCOUNTANT, NOW);
    expect(result.items).toEqual([
      {
        store: { id: STORE_B, name: 'Calera' },
        worker: { id: BETO, name: 'Beto Soto' },
        allocationCount: 3,
        amount: 9_000,
        oldestBusinessDate: '2026-09-21',
        newestBusinessDate: '2026-10-01',
        deadline: '2026-09-30',
        daysOverdue: 14,
      },
      {
        store: { id: STORE_A, name: 'Melipilla Centro' },
        worker: { id: ANA, name: 'Ana Pérez' },
        allocationCount: 1,
        amount: 4_000,
        oldestBusinessDate: '2026-10-02',
        newestBusinessDate: '2026-10-02',
        deadline: '2026-10-13',
        daysOverdue: 1,
      },
    ]);
    expect(result.totals).toEqual({
      alertCount: 2,
      allocationCount: 4,
      amount: 13_000,
      oldestBusinessDate: '2026-09-21',
      newestBusinessDate: '2026-10-02',
      maxDaysOverdue: 14,
    });
  });

  it('un rol de local solo vería las alertas de su local', async () => {
    const { service } = createService({}, [
      group(STORE_A, ANA, 1, 4_000, '2026-10-02', '2026-10-02'),
      group(STORE_B, BETO, 1, 3_000, '2026-10-01', '2026-10-01'),
    ]);
    const supervisor: AuthUser = {
      id: 'supervisor',
      email: 'supervisor@moi-food.cl',
      role: ROLE.SUPERVISOR,
      storeId: STORE_A,
    };
    const result = await service.list(supervisor, NOW);
    expect(result.items.map((item) => item.store.id)).toEqual([STORE_A]);
  });
});
