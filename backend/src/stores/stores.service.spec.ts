import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { StoresService } from './stores.service.js';

const STORE = {
  id: '1010021e-9bab-42d5-851c-417e9e2503bf',
  name: 'Local Centro',
  city: 'Melipilla',
  address: 'Calle 123',
  isActive: true,
  createdAt: new Date('2026-10-24T12:00:00.000Z'),
  updatedAt: new Date('2026-10-24T12:00:00.000Z'),
};

function createService(store: typeof STORE | null = STORE, activeUsers = 0) {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
    store: {
      findUnique: vi.fn().mockResolvedValue(store),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      count: vi.fn().mockResolvedValue(activeUsers),
    },
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) =>
      Promise.resolve(callback(prisma)),
  );
  return {
    service: new StoresService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('StoresService', () => {
  it('impide desactivar un local con usuarios activos', async () => {
    const { service, prisma } = createService(STORE, 2);

    await expect(service.deactivate(STORE.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('desactiva dentro de una transacción con bloqueo de fila', async () => {
    const { service, prisma } = createService();
    prisma.store.update.mockResolvedValue({ ...STORE, isActive: false });

    await expect(service.deactivate(STORE.id)).resolves.toMatchObject({
      store: { isActive: false },
      changed: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('mantiene idempotente la desactivación de un local ya inactivo', async () => {
    const { service, prisma } = createService({ ...STORE, isActive: false });

    await expect(service.deactivate(STORE.id)).resolves.toMatchObject({
      store: { isActive: false },
      changed: false,
    });
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('rechaza operaciones nuevas en un local inactivo', async () => {
    const { service } = createService({ ...STORE, isActive: false });

    await expect(service.assertActive(STORE.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rechaza una edición sin campos', async () => {
    const { service, prisma } = createService();

    await expect(service.update(STORE.id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('detecta duplicados ignorando mayúsculas y espacios antes de crear', async () => {
    const { service, prisma } = createService();
    prisma.store.findMany.mockResolvedValue([{ name: '  LOCAL   centro  ' }]);

    await expect(
      service.create({
        name: 'Local Centro',
        city: 'Melipilla',
        address: 'Calle 123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.store.create).not.toHaveBeenCalled();
  });
});
