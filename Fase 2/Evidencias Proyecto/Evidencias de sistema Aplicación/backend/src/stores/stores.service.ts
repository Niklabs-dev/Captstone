import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStoreDto } from './dto/create-store.dto.js';
import type { ListStoresQueryDto } from './dto/list-stores-query.dto.js';
import type { UpdateStoreDto } from './dto/update-store.dto.js';
import type { StoreResponse, StoreStateChange } from './types/stores.types.js';
import {
  normalizeStoreName,
  normalizeStoreText,
} from './utils/store-name.util.js';

const STORE_SELECT = {
  id: true,
  name: true,
  city: true,
  address: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StoreSelect;

type StoreRecord = Prisma.StoreGetPayload<{ select: typeof STORE_SELECT }>;

function toStoreResponse(store: StoreRecord): StoreResponse {
  return {
    id: store.id,
    name: store.name,
    city: store.city,
    address: store.address,
    isActive: store.isActive,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListStoresQueryDto): Promise<StoreResponse[]> {
    const stores = await this.prisma.store.findMany({
      where: { isActive: query.isActive },
      select: STORE_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return stores.map(toStoreResponse);
  }

  async create(dto: CreateStoreDto): Promise<StoreResponse> {
    const name = normalizeStoreText(dto.name);
    await this.ensureNameAvailable(name);

    try {
      const store = await this.prisma.store.create({
        data: {
          name,
          city: normalizeStoreText(dto.city),
          address: normalizeStoreText(dto.address),
        },
        select: STORE_SELECT,
      });
      return toStoreResponse(store);
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async update(id: string, dto: UpdateStoreDto): Promise<StoreResponse> {
    await this.findById(id);
    const data: Prisma.StoreUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = normalizeStoreText(dto.name);
      await this.ensureNameAvailable(data.name, id);
    }
    if (dto.city !== undefined) data.city = normalizeStoreText(dto.city);
    if (dto.address !== undefined) {
      data.address = normalizeStoreText(dto.address);
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Debes indicar al menos un campo para actualizar el local',
      );
    }

    try {
      const store = await this.prisma.store.update({
        where: { id },
        data,
        select: STORE_SELECT,
      });
      return toStoreResponse(store);
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async deactivate(id: string): Promise<StoreStateChange> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await this.findById(id, tx);
      if (!existing.isActive) {
        return { store: toStoreResponse(existing), changed: false };
      }

      const activeUsers = await tx.user.count({
        where: { storeId: id, isActive: true },
      });
      if (activeUsers > 0) {
        throw new ConflictException(
          'No se puede desactivar el local: tiene usuarios activos asignados; deben reasignarse o desactivarse primero',
        );
      }

      const store = await tx.store.update({
        where: { id },
        data: { isActive: false },
        select: STORE_SELECT,
      });
      return { store: toStoreResponse(store), changed: true };
    });
  }

  async reactivate(id: string): Promise<StoreStateChange> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await this.findById(id, tx);
      if (existing.isActive) {
        return { store: toStoreResponse(existing), changed: false };
      }

      const store = await tx.store.update({
        where: { id },
        data: { isActive: true },
        select: STORE_SELECT,
      });
      return { store: toStoreResponse(store), changed: true };
    });
  }

  async assertActive(id: string): Promise<StoreResponse> {
    const store = await this.findById(id);
    if (!store.isActive) {
      throw new BadRequestException(
        'El local indicado no existe o está inactivo',
      );
    }
    return toStoreResponse(store);
  }

  private async findById(
    id: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<StoreRecord> {
    const store = await client.store.findUnique({
      where: { id },
      select: STORE_SELECT,
    });
    if (!store) throw new NotFoundException('Local no encontrado');
    return store;
  }

  private async ensureNameAvailable(
    name: string,
    excludedId?: string,
  ): Promise<void> {
    const normalizedName = normalizeStoreName(name);
    const stores = await this.prisma.store.findMany({
      where: excludedId === undefined ? undefined : { id: { not: excludedId } },
      select: { name: true },
    });
    if (
      stores.some((store) => normalizeStoreName(store.name) === normalizedName)
    ) {
      throw new ConflictException('Ya existe un local con ese nombre');
    }
  }

  private handleWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe un local con ese nombre');
    }
    throw error;
  }
}
