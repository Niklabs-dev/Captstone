import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CreateMrComandaSalesDto } from './dto/create-mrcomanda-sales.dto.js';
import { SalesService } from './sales.service.js';

const STORE_ID = '1010021e-9bab-42d5-851c-417e9e2503bf';
const USER_ID = '7d4f7f66-3f2a-4d8c-b2d1-6a1f4e9c7d02';
const CASH_ID = '8f2c1a54-7a3e-4b1f-9d5c-3e8a6b2f4c11';
const DEBIT_ID = '3f6f8cb0-1b8b-4c18-9a3b-2c7d9e5a1111';

const PERIOD_START = '2026-03-10T08:00:00-03:00';
const PERIOD_END = '2026-03-10T14:00:00-03:00';
const PERIOD_START_UTC = '2026-03-10T11:00:00.000Z';
const PERIOD_END_UTC = '2026-03-10T17:00:00.000Z';

const USER: AuthUser = {
  id: USER_ID,
  email: 'supervisor@moi-food.cl',
  role: 'SUPERVISOR',
  storeId: STORE_ID,
};

const METHODS = [
  { id: CASH_ID, code: 'CASH', name: 'Efectivo', isActive: true },
  {
    id: DEBIT_ID,
    code: 'DEBIT_CARD',
    name: 'Tarjeta de débito',
    isActive: true,
  },
];

function createDto(
  totals: { paymentMethod: string; netAmount: number }[] = [
    { paymentMethod: 'DEBIT_CARD', netAmount: 100000 },
  ],
  extra: Partial<CreateMrComandaSalesDto> = {},
): CreateMrComandaSalesDto {
  return {
    storeId: STORE_ID,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    totals,
    ...extra,
  };
}

function saleRecord(
  paymentMethodId: string,
  netAmount: number,
  startUtc: string = PERIOD_START_UTC,
  endUtc: string = PERIOD_END_UTC,
  closingStatus: 'OPEN' | 'CLOSED' | null = null,
) {
  return {
    id: `sale-${paymentMethodId}`,
    paymentMethodId,
    grossAmount: new Prisma.Decimal(netAmount),
    tipAmount: new Prisma.Decimal(0),
    periodStart: new Date(startUtc),
    periodEnd: new Date(endUtc),
    cashClosingId: closingStatus ? `closing-${paymentMethodId}` : null,
    cashClosing: closingStatus ? { status: closingStatus } : null,
  };
}

function createService(
  options: {
    store?: { id: string; isActive: boolean } | null;
    methods?: typeof METHODS;
    overlapping?: ReturnType<typeof saleRecord>[];
    closedCuts?: { id: string }[];
  } = {},
) {
  const {
    store = { id: STORE_ID, isActive: true },
    methods = METHODS,
    overlapping = [],
    closedCuts = [],
  } = options;
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
    store: {
      findUnique: vi.fn().mockResolvedValue(store),
    },
    cashClosing: {
      findMany: vi.fn().mockResolvedValue(closedCuts),
    },
    paymentMethod: {
      findMany: vi.fn().mockResolvedValue(methods),
    },
    sale: {
      findMany: vi.fn().mockResolvedValue(overlapping),
      create: vi.fn(),
    },
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) =>
      Promise.resolve(callback(prisma)),
  );
  prisma.sale.create.mockImplementation(
    ({ data }: { data: { paymentMethodId: string; grossAmount: number } }) =>
      Promise.resolve(saleRecord(data.paymentMethodId, data.grossAmount)),
  );
  return {
    service: new SalesService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('SalesService — ingreso MrComanda (SPRINT-4-T32)', () => {
  // objectContaining devuelve any; se anota para poder anidarlo dentro de
  // literales sin violar la regla de asignación insegura de tipos.
  const subset = (expected: object): object =>
    expect.objectContaining(expected) as object;

  it('registra el lote como ventas MRCOMANDA con neto = bruto y propina cero', async () => {
    const { service, prisma } = createService();

    const result = await service.importMrComandaSales(
      USER,
      createDto([
        { paymentMethod: 'DEBIT_CARD', netAmount: 100000 },
        { paymentMethod: 'cash', netAmount: 50000 },
      ]),
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.sale.create).toHaveBeenCalledTimes(2);
    expect(prisma.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: subset({
          storeId: STORE_ID,
          source: 'MRCOMANDA',
          paymentMethodId: DEBIT_ID,
          grossAmount: 100000,
          tipAmount: 0,
          soldAt: new Date(PERIOD_START_UTC),
          periodStart: new Date(PERIOD_START_UTC),
          periodEnd: new Date(PERIOD_END_UTC),
          registeredById: USER_ID,
        }),
      }),
    );
    expect(result.created).toBe(true);
    expect(result.totalNetAmount).toBe(150000);
    // Normaliza el código y ordena los totales por código.
    expect(result.totals.map((total) => total.paymentMethod)).toEqual([
      'CASH',
      'DEBIT_CARD',
    ]);
    expect(result.totals[1]).toMatchObject({
      paymentMethodName: 'Tarjeta de débito',
      netAmount: 100000,
    });
  });

  it('no duplica un reintento idéntico y devuelve created = false', async () => {
    const { service, prisma } = createService({
      overlapping: [saleRecord(DEBIT_ID, 100000)],
    });

    const result = await service.importMrComandaSales(USER, createDto());

    expect(prisma.sale.create).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
    expect(result.totals).toHaveLength(1);
    expect(result.totals[0].saleId).toBe(`sale-${DEBIT_ID}`);
  });

  it('rechaza con conflicto un mismo período con monto distinto', async () => {
    const { service, prisma } = createService({
      overlapping: [saleRecord(DEBIT_ID, 99999)],
    });

    await expect(
      service.importMrComandaSales(USER, createDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it('rechaza con conflicto un período que se solapa parcialmente', async () => {
    const { service, prisma } = createService({
      overlapping: [
        saleRecord(
          DEBIT_ID,
          100000,
          '2026-03-10T10:00:00.000Z',
          '2026-03-10T12:00:00.000Z',
        ),
      ],
    });

    await expect(
      service.importMrComandaSales(USER, createDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it('crea solo los totales nuevos cuando el resto del lote es un reintento idéntico', async () => {
    const { service, prisma } = createService({
      overlapping: [saleRecord(DEBIT_ID, 100000)],
    });

    const result = await service.importMrComandaSales(
      USER,
      createDto([
        { paymentMethod: 'DEBIT_CARD', netAmount: 100000 },
        { paymentMethod: 'CASH', netAmount: 50000 },
      ]),
    );

    expect(prisma.sale.create).toHaveBeenCalledTimes(1);
    expect(prisma.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: subset({ paymentMethodId: CASH_ID }),
      }),
    );
    expect(result.created).toBe(true);
    expect(result.totalNetAmount).toBe(150000);
  });

  it('rechaza el lote cuando repite un medio de pago', async () => {
    const { service, prisma } = createService();

    await expect(
      service.importMrComandaSales(
        USER,
        createDto([
          { paymentMethod: 'DEBIT_CARD', netAmount: 100000 },
          { paymentMethod: 'debit card', netAmount: 100000 },
        ]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it('rechaza medios inexistentes o inactivos en el catálogo', async () => {
    const missing = createService({ methods: [] });
    await expect(
      missing.service.importMrComandaSales(USER, createDto()),
    ).rejects.toBeInstanceOf(BadRequestException);

    const inactive = createService({
      methods: [
        {
          id: DEBIT_ID,
          code: 'DEBIT_CARD',
          name: 'Tarjeta de débito',
          isActive: false,
        },
      ],
    });
    await expect(
      inactive.service.importMrComandaSales(USER, createDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza el solapamiento con ventas ya conciliadas en un cierre cerrado', async () => {
    const { service, prisma } = createService({
      overlapping: [
        saleRecord(
          DEBIT_ID,
          100000,
          '2026-03-10T10:00:00.000Z',
          '2026-03-10T12:00:00.000Z',
          'CLOSED',
        ),
      ],
    });

    await expect(
      service.importMrComandaSales(USER, createDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it('mantiene idempotente el reintento idéntico aunque la venta esté en un cierre cerrado', async () => {
    const { service, prisma } = createService({
      overlapping: [
        saleRecord(
          DEBIT_ID,
          100000,
          PERIOD_START_UTC,
          PERIOD_END_UTC,
          'CLOSED',
        ),
      ],
    });

    const result = await service.importMrComandaSales(USER, createDto());

    expect(prisma.sale.create).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
  });

  it('permite un turno no solapado aunque existan cierres cerrados ese día', async () => {
    // Sin ventas que solapen el período no hay nada conciliado que proteger:
    // la carga avanza aunque el día tenga cierres CLOSED de otros turnos.
    const { service, prisma } = createService();

    const result = await service.importMrComandaSales(USER, createDto());

    expect(prisma.sale.create).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(true);
  });

  it('rechaza la alta nueva ante un cierre cerrado sin ventas que solapa el período', async () => {
    // El cierre cerrado del turno no dejó ventas, pero su período de
    // vouchers solapa el lote: la alta nueva se rechaza igual.
    const { service, prisma } = createService({
      closedCuts: [{ id: 'closing-sin-ventas' }],
    });

    await expect(
      service.importMrComandaSales(USER, createDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it('mantiene idempotente el reintento idéntico aunque un cierre solape el período', async () => {
    // El lote completo ya está registrado (reintento) y además existe un
    // cierre cerrado solapado: se resuelve primero el reintento y no se
    // crea nada adicional.
    const { service, prisma } = createService({
      overlapping: [saleRecord(DEBIT_ID, 100000)],
      closedCuts: [{ id: 'closing-sin-ventas' }],
    });

    const result = await service.importMrComandaSales(USER, createDto());

    expect(prisma.sale.create).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
  });

  it('rechaza locales inactivos o inexistentes', async () => {
    const inactive = createService({
      store: { id: STORE_ID, isActive: false },
    });
    await expect(
      inactive.service.importMrComandaSales(USER, createDto()),
    ).rejects.toBeInstanceOf(BadRequestException);

    const missing = createService({ store: null });
    await expect(
      missing.service.importMrComandaSales(USER, createDto()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza períodos sin zona horaria o fuera de un día de negocio chileno', async () => {
    const { service } = createService();

    await expect(
      service.importMrComandaSales(
        USER,
        createDto(undefined, { periodStart: '2026-03-10T08:00:00' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.importMrComandaSales(
        USER,
        createDto(undefined, {
          periodStart: '2026-03-10T23:00:00-03:00',
          periodEnd: '2026-03-11T01:00:00-03:00',
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('traduce una colisión de unicidad en conflicto', async () => {
    const { service, prisma } = createService();
    prisma.sale.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicado', {
        code: 'P2002',
        clientVersion: '7.0.0',
      }),
    );

    await expect(
      service.importMrComandaSales(USER, createDto()),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
