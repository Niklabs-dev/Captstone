import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { StoresService } from './stores.service.js';
import { SUBWAY_STORE_ID_UNIQUE_INDEX } from './utils/subway-store-id.util.js';

const STORE = {
  id: '1010021e-9bab-42d5-851c-417e9e2503bf',
  name: 'Local Centro',
  city: 'Melipilla',
  address: 'Calle 123',
  subwayStoreId: null as string | null,
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

  it('rechaza un ID Subway que ya usa otro local antes de crear (SPRINT-4A-T15)', async () => {
    const { service, prisma } = createService({
      ...STORE,
      id: '73b590e0-11b2-4781-ba7b-4f7f8c2c6e35',
      subwayStoreId: '72597',
    });

    await expect(
      service.create({
        name: 'Local Nuevo',
        city: 'Melipilla',
        address: 'Calle 456',
        subwayStoreId: '72597',
      }),
    ).rejects.toThrow('Ya existe un local con ese ID Subway');
    expect(prisma.store.create).not.toHaveBeenCalled();
  });

  it('traduce la carrera en el índice único del ID Subway a 409 con su mensaje', async () => {
    const { service, prisma } = createService(null);
    prisma.store.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: {
          driverAdapterError: {
            cause: { constraint: { index: SUBWAY_STORE_ID_UNIQUE_INDEX } },
          },
        },
      }),
    );

    await expect(
      service.create({
        name: 'Local Nuevo',
        city: 'Melipilla',
        address: 'Calle 456',
        subwayStoreId: '72597',
      }),
    ).rejects.toThrow('Ya existe un local con ese ID Subway');
  });

  it('mantiene el mensaje del nombre para otros índices únicos', async () => {
    const { service, prisma } = createService(null);
    prisma.store.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: {
          driverAdapterError: {
            cause: { constraint: { index: 'stores_name_normalized_key' } },
          },
        },
      }),
    );

    await expect(
      service.create({
        name: 'Local Nuevo',
        city: 'Melipilla',
        address: 'Calle 456',
      }),
    ).rejects.toThrow('Ya existe un local con ese nombre');
  });

  it('edita el ID Subway bajo bloqueo y devuelve el valor anterior', async () => {
    const { service, prisma } = createService({
      ...STORE,
      subwayStoreId: '69132',
    });
    prisma.store.update.mockResolvedValue({ ...STORE, subwayStoreId: '72597' });

    const result = await service.update(STORE.id, { subwayStoreId: '72597' });

    expect(result.previous.subwayStoreId).toBe('69132');
    expect(result.store.subwayStoreId).toBe('72597');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.store.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { subwayStoreId: '72597' } }),
    );
  });

  it('permite quitar el ID Subway con null sin verificar unicidad', async () => {
    const { service, prisma } = createService({
      ...STORE,
      subwayStoreId: '69132',
    });
    prisma.store.update.mockResolvedValue({ ...STORE, subwayStoreId: null });

    const result = await service.update(STORE.id, { subwayStoreId: null });

    expect(result.previous.subwayStoreId).toBe('69132');
    expect(result.store.subwayStoreId).toBeNull();
    // findUnique solo se usa para leer el local (antes y bajo bloqueo).
    expect(prisma.store.findUnique).toHaveBeenCalledTimes(2);
  });
});
