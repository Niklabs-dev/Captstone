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
import { STORE_FORBIDDEN_MESSAGE } from '../auth/constants/forbidden-messages.constants.js';

const TIP_ENTRY_SELECT = {
  id: true,
  businessDate: true,
  paymentMethod: { select: { code: true, name: true } },
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
    paymentMethod: entry.paymentMethod.code,
    paymentMethodName: entry.paymentMethod.name,
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
    // La resolución por código no filtra por estado: el reintento idéntico y
    // la detección de duplicados deben funcionar también con medios
    // desactivados (registros históricos). El estado solo se exige al crear.
    const paymentMethod = await this.findMethod(dto.paymentMethod);
    const existing = await this.findByNaturalKey(
      dto,
      businessDate,
      paymentMethod.id,
    );
    if (existing) return this.resolveDuplicate(existing, dto, currentUser);
    this.assertMethodAllowsCreate(dto.paymentMethod, paymentMethod);

    try {
      const entry = await this.prisma.tipEntry.create({
        data: {
          storeId: dto.storeId,
          businessDate,
          paymentMethodId: paymentMethod.id,
          amount: new Prisma.Decimal(dto.amount),
          responsibleId: currentUser.id,
        },
        select: TIP_ENTRY_SELECT,
      });
      return { entry: toTipEntryResponse(entry), created: true };
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        const concurrent = await this.findByNaturalKey(
          dto,
          businessDate,
          paymentMethod.id,
        );
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
      orderBy: [{ paymentMethod: { code: 'asc' } }, { id: 'asc' }],
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tip_entries WHERE id = ${id}::uuid FOR UPDATE`;
      await this.findUnlinked(id, currentUser, tx);
      const entry = await tx.tipEntry.update({
        where: { id },
        data: { amount: new Prisma.Decimal(dto.amount) },
        select: TIP_ENTRY_SELECT,
      });
      return toTipEntryResponse(entry);
    });
  }

  async remove(id: string, currentUser: AuthUser): Promise<TipEntryResponse> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tip_entries WHERE id = ${id}::uuid FOR UPDATE`;
      await this.findUnlinked(id, currentUser, tx);
      try {
        const entry = await tx.tipEntry.delete({
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
    });
  }

  // Resuelve el código contra el catálogo sin filtrar por estado, para no
  // romper reintentos ni lecturas de registros históricos con medios
  // desactivados.
  private async findMethod(code: string): Promise<{
    id: string;
    isActive: boolean;
    availableForTips: boolean;
  }> {
    const paymentMethod = await this.prisma.paymentMethod.findUnique({
      where: { code },
      select: { id: true, isActive: true, availableForTips: true },
    });
    if (!paymentMethod) {
      throw new BadRequestException(
        `El medio de pago "${code}" no existe en el catálogo`,
      );
    }
    return paymentMethod;
  }

  // Solo las altas nuevas exigen medio activo y elegible; la lectura y la
  // edición de registros históricos conservan sus montos y medios aunque el
  // catálogo los desactive después.
  private assertMethodAllowsCreate(
    code: string,
    paymentMethod: { isActive: boolean; availableForTips: boolean },
  ): void {
    if (!paymentMethod.isActive) {
      throw new BadRequestException(
        `El medio de pago "${code}" está desactivado y no admite registros nuevos`,
      );
    }
    if (!paymentMethod.availableForTips) {
      throw new BadRequestException(
        `El medio de pago "${code}" no admite propinas`,
      );
    }
  }

  private async findByNaturalKey(
    dto: CreateTipEntryDto,
    businessDate: Date,
    paymentMethodId: string,
  ): Promise<TipEntryRecord | null> {
    return this.prisma.tipEntry.findUnique({
      where: {
        storeId_businessDate_paymentMethodId: {
          storeId: dto.storeId,
          businessDate,
          paymentMethodId,
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
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<TipEntryRecord> {
    const entry = await client.tipEntry.findUnique({
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
    await this.stores.assertActive(entry.store.id);
    if (entry.poolSource || entry.sales.length > 0) {
      throw new ConflictException(
        'No se puede modificar o eliminar un registro vinculado a ventas o repartos',
      );
    }
    return entry;
  }

  private assertStoreAccess(storeId: string, currentUser: AuthUser): void {
    if (!canAccessStore(currentUser, storeId)) {
      throw new ForbiddenException(STORE_FORBIDDEN_MESSAGE);
    }
  }

  private assertAmount(amount: number): void {
    if (!Number.isInteger(amount) || amount < 0 || amount > MAX_TIP_AMOUNT) {
      throw new BadRequestException(
        `amount debe ser un entero entre 0 y ${MAX_TIP_AMOUNT} CLP`,
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
