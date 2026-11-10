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
import type {
  StoreResponse,
  StoreStateChange,
  StoreUpdateResult,
} from './types/stores.types.js';
import {
  normalizeStoreName,
  normalizeStoreText,
} from './utils/store-name.util.js';
import {
  SUBWAY_STORE_ID_UNIQUE_INDEX,
  violatedUniqueIndex,
} from './utils/subway-store-id.util.js';

const NAME_TAKEN_MESSAGE = 'Ya existe un local con ese nombre';
const SUBWAY_STORE_ID_TAKEN_MESSAGE = 'Ya existe un local con ese ID Subway';

const STORE_SELECT = {
  id: true,
  name: true,
  city: true,
  address: true,
  subwayStoreId: true,
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
    subwayStoreId: store.subwayStoreId,
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
    const subwayStoreId = dto.subwayStoreId ?? null;
    await this.ensureNameAvailable(name);
    if (subwayStoreId !== null) {
      await this.ensureSubwayStoreIdAvailable(subwayStoreId);
    }

    try {
      const store = await this.prisma.store.create({
        data: {
          name,
          city: normalizeStoreText(dto.city),
          address: normalizeStoreText(dto.address),
          subwayStoreId,
        },
        select: STORE_SELECT,
      });
      return toStoreResponse(store);
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  // Edita el local bajo bloqueo de fila: el valor anterior que se audita (ID
  // Subway) es exactamente el que reemplaza esta escritura, aunque haya otra
  // edición simultánea del mismo local.
  async update(id: string, dto: UpdateStoreDto): Promise<StoreUpdateResult> {
    await this.findById(id);
    const data: Prisma.StoreUpdateInput = {};
    if (dto.name !== undefined) data.name = normalizeStoreText(dto.name);
    if (dto.city !== undefined) data.city = normalizeStoreText(dto.city);
    if (dto.address !== undefined) {
      data.address = normalizeStoreText(dto.address);
    }
    if (dto.subwayStoreId !== undefined) {
      data.subwayStoreId = dto.subwayStoreId;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Debes indicar al menos un campo para actualizar el local',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${id}::uuid FOR UPDATE`;
      const previous = await this.findById(id, tx);
      if (typeof data.name === 'string') {
        await this.ensureNameAvailable(data.name, id, tx);
      }
      if (typeof data.subwayStoreId === 'string') {
        await this.ensureSubwayStoreIdAvailable(data.subwayStoreId, id, tx);
      }

      try {
        const store = await tx.store.update({
          where: { id },
          data,
          select: STORE_SELECT,
        });
        return {
          store: toStoreResponse(store),
          previous: toStoreResponse(previous),
        };
      } catch (error) {
        this.handleWriteError(error);
      }
    });
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
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const normalizedName = normalizeStoreName(name);
    const stores = await client.store.findMany({
      where: excludedId === undefined ? undefined : { id: { not: excludedId } },
      select: { name: true },
    });
    if (
      stores.some((store) => normalizeStoreName(store.name) === normalizedName)
    ) {
      throw new ConflictException(NAME_TAKEN_MESSAGE);
    }
  }

  // El índice único de la base cierra la carrera entre esta verificación y
  // la escritura (handleWriteError traduce su P2002 al mismo 409).
  private async ensureSubwayStoreIdAvailable(
    subwayStoreId: string,
    excludedId?: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const holder = await client.store.findUnique({
      where: { subwayStoreId },
      select: { id: true },
    });
    if (holder !== null && holder.id !== excludedId) {
      throw new ConflictException(SUBWAY_STORE_ID_TAKEN_MESSAGE);
    }
  }

  private handleWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        violatedUniqueIndex(error.meta) === SUBWAY_STORE_ID_UNIQUE_INDEX
          ? SUBWAY_STORE_ID_TAKEN_MESSAGE
          : NAME_TAKEN_MESSAGE,
      );
    }
    throw error;
  }
}
