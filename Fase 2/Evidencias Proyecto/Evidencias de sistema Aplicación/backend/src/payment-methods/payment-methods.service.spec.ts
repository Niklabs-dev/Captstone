import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import type { CreatePaymentMethodDto } from './dto/create-payment-method.dto.js';

const PAYMENT_METHOD = {
  id: '3f6f8cb0-1b8b-4c18-9a3b-2c7d9e5a1111',
  code: 'DEBIT_CARD',
  name: 'Tarjeta de débito',
  sortOrder: 10,
  isActive: true,
  behavior: 'RECONCILABLE_CARD' as const,
  availableForTips: true,
  createdAt: new Date('2026-11-05T12:00:00.000Z'),
  updatedAt: new Date('2026-11-05T12:00:00.000Z'),
};

function createDto(
  extra: Partial<CreatePaymentMethodDto> = {},
): CreatePaymentMethodDto {
  return {
    code: 'JUNAEB',
    name: 'Junaeb',
    sortOrder: 40,
    behavior: 'EXTERNAL_OTHER',
    availableForTips: false,
    ...extra,
  };
}

// objectContaining devuelve any; se anota para poder anidarlo dentro de
// literales sin violar la regla de asignación insegura de tipos.
const subset = (expected: object): object =>
  expect.objectContaining(expected) as object;

function createService(
  paymentMethod: typeof PAYMENT_METHOD | null = PAYMENT_METHOD,
) {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
    paymentMethod: {
      findUnique: vi.fn().mockResolvedValue(paymentMethod),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) =>
      Promise.resolve(callback(prisma)),
  );
  return {
    service: new PaymentMethodsService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('PaymentMethodsService', () => {
  it('lista los medios ordenados por sortOrder y código con sus filtros', async () => {
    const { service, prisma } = createService();
    prisma.paymentMethod.findMany.mockResolvedValue([PAYMENT_METHOD]);

    const result = await service.findAll({
      isActive: true,
      availableForTips: true,
    });

    expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, availableForTips: true },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ code: 'DEBIT_CARD', isActive: true });
  });

  it('crea un medio con el código ya normalizado', async () => {
    const { service, prisma } = createService(null);
    prisma.paymentMethod.findUnique.mockResolvedValue(null);
    prisma.paymentMethod.create.mockResolvedValue(PAYMENT_METHOD);

    await expect(service.create(createDto())).resolves.toMatchObject({
      code: 'DEBIT_CARD',
    });
    expect(prisma.paymentMethod.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: subset({
          code: 'JUNAEB',
          behavior: 'EXTERNAL_OTHER',
          availableForTips: false,
        }),
      }),
    );
  });

  it('rechaza la creación con un código de formato inválido', async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.create(createDto({ code: '1' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.paymentMethod.create).not.toHaveBeenCalled();
  });

  it('rechaza la creación cuando el código ya existe', async () => {
    const { service, prisma } = createService(PAYMENT_METHOD);

    await expect(
      service.create(createDto({ code: 'DEBIT_CARD' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.paymentMethod.create).not.toHaveBeenCalled();
  });

  it('rechaza una edición sin campos', async () => {
    const { service, prisma } = createService();

    await expect(service.update(PAYMENT_METHOD.id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.paymentMethod.update).not.toHaveBeenCalled();
  });

  it('edita nombre, orden, comportamiento y propinas sin tocar el código', async () => {
    const { service, prisma } = createService();
    prisma.paymentMethod.update.mockResolvedValue({
      ...PAYMENT_METHOD,
      name: 'Tarjeta débito',
      availableForTips: false,
    });

    await expect(
      service.update(PAYMENT_METHOD.id, {
        name: 'Tarjeta débito',
        availableForTips: false,
      }),
    ).resolves.toMatchObject({ name: 'Tarjeta débito' });
    expect(prisma.paymentMethod.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Tarjeta débito', availableForTips: false },
      }),
    );
  });

  it('rechaza la edición de un medio inexistente', async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.update(PAYMENT_METHOD.id, { name: 'Otro nombre' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.paymentMethod.update).not.toHaveBeenCalled();
  });

  it('desactiva dentro de una transacción con bloqueo de fila', async () => {
    const { service, prisma } = createService();
    prisma.paymentMethod.update.mockResolvedValue({
      ...PAYMENT_METHOD,
      isActive: false,
    });

    await expect(service.deactivate(PAYMENT_METHOD.id)).resolves.toMatchObject({
      paymentMethod: { isActive: false },
      changed: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('mantiene idempotente la desactivación de un medio ya inactivo', async () => {
    const { service, prisma } = createService({
      ...PAYMENT_METHOD,
      isActive: false,
    });

    await expect(service.deactivate(PAYMENT_METHOD.id)).resolves.toMatchObject({
      paymentMethod: { isActive: false },
      changed: false,
    });
    expect(prisma.paymentMethod.update).not.toHaveBeenCalled();
  });

  it('reactiva un medio inactivo y es idempotente si ya estaba activo', async () => {
    const { service, prisma } = createService({
      ...PAYMENT_METHOD,
      isActive: false,
    });
    prisma.paymentMethod.update.mockResolvedValue(PAYMENT_METHOD);

    await expect(service.reactivate(PAYMENT_METHOD.id)).resolves.toMatchObject({
      paymentMethod: { isActive: true },
      changed: true,
    });

    const active = createService(PAYMENT_METHOD);
    await expect(
      active.service.reactivate(PAYMENT_METHOD.id),
    ).resolves.toMatchObject({ changed: false });
    expect(active.prisma.paymentMethod.update).not.toHaveBeenCalled();
  });
});
