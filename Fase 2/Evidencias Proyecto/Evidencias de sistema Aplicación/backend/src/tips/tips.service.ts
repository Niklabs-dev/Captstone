import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseCalendarDate } from '../audit/utils/business-day.util.js';
import { canAccessStore } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StoresService } from '../stores/stores.service.js';
import type { CreateTipEntryDto } from './dto/create-tip-entry.dto.js';
import type { ListTipEntriesQueryDto } from './dto/list-tip-entries-query.dto.js';
import type { UpdateTipEntryDto } from './dto/update-tip-entry.dto.js';
import {
  MAX_TIP_AMOUNT,
  type TipEntryCreateResult,
  type TipEntryResponse,
} from './types/tips.types.js';

const TIP_ENTRY_SELECT = {
  id: true,
  businessDate: true,
  paymentMethod: true,
  amount: true,
  createdAt: true,
  updatedAt: true,
  store: { select: { id: true, name: true } },
  responsible: {
    select: { id: true, firstName: true, lastName: true },
  },
} satisfies Prisma.TipEntrySelect;

type TipEntryRecord = Prisma.TipEntryGetPayload<{
  select: typeof TIP_ENTRY_SELECT;
}>;

function toTipEntryResponse(entry: TipEntryRecord): TipEntryResponse {
  return {
    id: entry.id,
    businessDate: formatDbDate(entry.businessDate),
    paymentMethod: entry.paymentMethod,
    amount: Number(entry.amount),
    store: entry.store,
    responsible: {
      id: entry.responsible.id,
      name: `${entry.responsible.firstName} ${entry.responsible.lastName}`,
    },
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

@Injectable()
export class TipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
  ) {}

  async create(
    dto: CreateTipEntryDto,
    currentUser: AuthUser,
  ): Promise<TipEntryCreateResult> {
    this.assertStoreAccess(dto.storeId, currentUser);
    await this.stores.assertActive(dto.storeId);
    this.assertAmount(dto.amount);
    const businessDate = this.parseBusinessDate(dto.businessDate);
    const existing = await this.findByNaturalKey(dto, businessDate);
    if (existing) return this.resolveDuplicate(existing, dto, currentUser);

    try {
      const entry = await this.prisma.tipEntry.create({
        data: {
          storeId: dto.storeId,
          businessDate,
          paymentMethod: dto.paymentMethod,
          amount: new Prisma.Decimal(dto.amount),
          responsibleId: currentUser.id,
        },
        select: TIP_ENTRY_SELECT,
      });
      return { entry: toTipEntryResponse(entry), created: true };
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        const concurrent = await this.findByNaturalKey(dto, businessDate);
        if (concurrent) {
          return this.resolveDuplicate(concurrent, dto, currentUser);
        }
      }
      throw error;
    }
  }

  async findAll(
    query: ListTipEntriesQueryDto,
    currentUser: AuthUser,
  ): Promise<TipEntryResponse[]> {
    this.assertStoreAccess(query.storeId, currentUser);
    const entries = await this.prisma.tipEntry.findMany({
      where: {
        storeId: query.storeId,
        businessDate: this.parseBusinessDate(query.businessDate),
      },
      select: TIP_ENTRY_SELECT,
      orderBy: [{ paymentMethod: 'asc' }, { id: 'asc' }],
    });
    return entries.map(toTipEntryResponse);
  }

  async findOne(id: string, currentUser: AuthUser): Promise<TipEntryResponse> {
    const entry = await this.prisma.tipEntry.findUnique({
      where: { id },
      select: TIP_ENTRY_SELECT,
    });
    if (!entry)
      throw new NotFoundException('Registro de propinas no encontrado');
    this.assertStoreAccess(entry.store.id, currentUser);
    return toTipEntryResponse(entry);
  }

  async update(
    id: string,
    dto: UpdateTipEntryDto,
    currentUser: AuthUser,
  ): Promise<TipEntryResponse> {
    this.assertAmount(dto.amount);
    await this.findUnlinked(id, currentUser);
    const entry = await this.prisma.tipEntry.update({
      where: { id },
      data: { amount: new Prisma.Decimal(dto.amount) },
      select: TIP_ENTRY_SELECT,
    });
    return toTipEntryResponse(entry);
  }

  async remove(id: string, currentUser: AuthUser): Promise<TipEntryResponse> {
    await this.findUnlinked(id, currentUser);
    try {
      const entry = await this.prisma.tipEntry.delete({
        where: { id },
        select: TIP_ENTRY_SELECT,
      });
      return toTipEntryResponse(entry);
    } catch (error) {
      if (isPrismaError(error, 'P2003')) {
        throw new ConflictException(
          'No se puede eliminar un registro vinculado a ventas o repartos',
        );
      }
      throw error;
    }
  }

  private async findByNaturalKey(
    dto: CreateTipEntryDto,
    businessDate: Date,
  ): Promise<TipEntryRecord | null> {
    return this.prisma.tipEntry.findUnique({
      where: {
        storeId_businessDate_paymentMethod: {
          storeId: dto.storeId,
          businessDate,
          paymentMethod: dto.paymentMethod,
        },
      },
      select: TIP_ENTRY_SELECT,
    });
  }

  private resolveDuplicate(
    existing: TipEntryRecord,
    dto: CreateTipEntryDto,
    currentUser: AuthUser,
  ): TipEntryCreateResult {
    const sameAmount = new Prisma.Decimal(dto.amount).equals(existing.amount);
    if (!sameAmount || existing.responsible.id !== currentUser.id) {
      throw new ConflictException(
        'Ya existe un registro para ese local, fecha y medio; usa PATCH para corregir su monto',
      );
    }
    return { entry: toTipEntryResponse(existing), created: false };
  }

  private async findUnlinked(
    id: string,
    currentUser: AuthUser,
  ): Promise<TipEntryRecord> {
    const entry = await this.prisma.tipEntry.findUnique({
      where: { id },
      select: {
        ...TIP_ENTRY_SELECT,
        poolSource: { select: { id: true } },
        sales: { select: { id: true }, take: 1 },
      },
    });
    if (!entry)
      throw new NotFoundException('Registro de propinas no encontrado');
    this.assertStoreAccess(entry.store.id, currentUser);
    if (entry.poolSource || entry.sales.length > 0) {
      throw new ConflictException(
        'No se puede modificar o eliminar un registro vinculado a ventas o repartos',
      );
    }
    return entry;
  }

  private assertStoreAccess(storeId: string, currentUser: AuthUser): void {
    if (!canAccessStore(currentUser, storeId)) {
      throw new ForbiddenException('No tienes acceso a este local');
    }
  }

  private assertAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_TIP_AMOUNT) {
      throw new BadRequestException(
        `amount debe estar entre 0 y ${MAX_TIP_AMOUNT}`,
      );
    }
  }

  private parseBusinessDate(value: string): Date {
    const parsed = parseCalendarDate(value);
    if (!parsed) {
      throw new BadRequestException(
        'businessDate debe ser una fecha válida con formato YYYY-MM-DD',
      );
    }
    return toDbDate(parsed);
  }
}
