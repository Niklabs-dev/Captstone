import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/types/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StoresService } from '../stores/stores.service.js';
import type { CreateTipEntryDto } from './dto/create-tip-entry.dto.js';
import { TipsService } from './tips.service.js';

const USER: AuthUser = {
  id: 'a9000000-0000-4000-8000-000000000001',
  email: 'supervisor@tips-unit-test.invalid',
  role: 'SUPERVISOR',
  storeId: '1010021e-9bab-42d5-851c-417e9e2503bf',
};

const ENTRY = {
  id: 'a9000000-0000-4000-8000-000000000005',
  businessDate: new Date('2026-06-15T00:00:00.000Z'),
  paymentMethod: 'CASH' as const,
  amount: new Prisma.Decimal(12500),
  createdAt: new Date('2026-06-15T12:00:00.000Z'),
  updatedAt: new Date('2026-06-15T12:00:00.000Z'),
  store: {
    id: '1010021e-9bab-42d5-851c-417e9e2503bf',
    name: 'Local Demo',
  },
  responsible: {
    id: USER.id,
    firstName: 'Supervisor',
    lastName: 'Demo',
  },
};

const CREATE_DTO: CreateTipEntryDto = {
  storeId: USER.storeId as string,
  businessDate: '2026-06-15',
  paymentMethod: 'CASH',
  amount: 12500,
};

function createService() {
  const prisma = {
    tipEntry: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  const stores = { assertActive: vi.fn().mockResolvedValue({}) };
  return {
    service: new TipsService(
      prisma as unknown as PrismaService,
      stores as unknown as StoresService,
    ),
    prisma,
    stores,
  };
}

describe('TipsService', () => {
  it('crea con fecha UTC y responsable autenticado', async () => {
    const { service, prisma, stores } = createService();
    prisma.tipEntry.findUnique.mockResolvedValue(null);
    prisma.tipEntry.create.mockResolvedValue(ENTRY);

    const result = await service.create(CREATE_DTO, USER);

    expect(result.created).toBe(true);
    expect(result.entry.responsible).toEqual({
      id: USER.id,
      name: 'Supervisor Demo',
    });
    expect(stores.assertActive).toHaveBeenCalledWith(CREATE_DTO.storeId);
    expect(prisma.tipEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responsibleId: USER.id,
          businessDate: new Date('2026-06-15T00:00:00.000Z'),
        }) as Record<string, unknown>,
      }),
    );
  });

  it('devuelve el mismo registro ante un reintento idéntico', async () => {
    const { service, prisma } = createService();
    prisma.tipEntry.findUnique.mockResolvedValue(ENTRY);

    const result = await service.create(CREATE_DTO, USER);

    expect(result.created).toBe(false);
    expect(result.entry.id).toBe(ENTRY.id);
    expect(prisma.tipEntry.create).not.toHaveBeenCalled();
  });

  it('rechaza un duplicado con otro monto sin sobrescribirlo', async () => {
    const { service, prisma } = createService();
    prisma.tipEntry.findUnique.mockResolvedValue(ENTRY);

    await expect(
      service.create({ ...CREATE_DTO, amount: 13000 }, USER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tipEntry.create).not.toHaveBeenCalled();
  });

  it('resuelve una carrera de creación mediante la clave única', async () => {
    const { service, prisma } = createService();
    prisma.tipEntry.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ENTRY);
    prisma.tipEntry.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicado', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    const result = await service.create(CREATE_DTO, USER);

    expect(result.created).toBe(false);
    expect(result.entry.id).toBe(ENTRY.id);
    expect(prisma.tipEntry.findUnique).toHaveBeenCalledTimes(2);
  });

  it('rechaza fecha inválida y monto negativo antes de escribir', async () => {
    const { service, prisma } = createService();

    await expect(
      service.create({ ...CREATE_DTO, businessDate: '2026-02-30' }, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({ ...CREATE_DTO, amount: -1 }, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tipEntry.create).not.toHaveBeenCalled();
  });

  it('bloquea la consulta de un local no asignado', async () => {
    const { service, prisma } = createService();

    await expect(
      service.findAll(
        { storeId: crypto.randomUUID(), businessDate: '2026-06-15' },
        USER,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tipEntry.findMany).not.toHaveBeenCalled();
  });

  it('bloquea edición y eliminación de registros ya vinculados', async () => {
    const { service, prisma } = createService();
    prisma.tipEntry.findUnique.mockResolvedValue({
      ...ENTRY,
      poolSource: { id: crypto.randomUUID() },
      sales: [],
    });

    await expect(
      service.update(ENTRY.id, { amount: 13000 }, USER),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.remove(ENTRY.id, USER)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.tipEntry.update).not.toHaveBeenCalled();
    expect(prisma.tipEntry.delete).not.toHaveBeenCalled();
  });

  it('elimina un registro no vinculado y conserva sus datos de auditoría', async () => {
    const { service, prisma } = createService();
    prisma.tipEntry.findUnique.mockResolvedValue({
      ...ENTRY,
      poolSource: null,
      sales: [],
    });
    prisma.tipEntry.delete.mockResolvedValue(ENTRY);

    const result = await service.remove(ENTRY.id, USER);

    expect(result.id).toBe(ENTRY.id);
    expect(result.store.id).toBe(USER.storeId);
    expect(result.responsible.id).toBe(USER.id);
    expect(prisma.tipEntry.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ENTRY.id } }),
    );
  });
});
