import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { parseCalendarDate } from '../audit/utils/business-day.util.js';
import { canAccessStore } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { sanitizeFileName } from '../documents/utils/file-name.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StoresService } from '../stores/stores.service.js';
import { DailyVoucherStorageService } from './daily-voucher-storage.service.js';
import type { CreateDailyOperationDto } from './dto/create-daily-operation.dto.js';
import type { ListDailyOperationsQueryDto } from './dto/list-daily-operations-query.dto.js';
import type {
  DailyOperationCreateResult,
  DailyOperationResponse,
  DailyOperationVoucherResponse,
} from './types/daily-operations.types.js';
import { isIdenticalDailyOperationRetry } from './utils/daily-operation-retry.util.js';

const PERSON_SELECT = {
  select: { id: true, firstName: true, lastName: true },
} as const;

const DAILY_OPERATION_SELECT = {
  id: true,
  businessDate: true,
  cardTipAmount: true,
  cashTipAmount: true,
  tipFundAmount: true,
  cashDifference: true,
  differenceReason: true,
  createdAt: true,
  updatedAt: true,
  store: { select: { id: true, name: true } },
  responsible: PERSON_SELECT,
  voucher: {
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      sha256Hash: true,
      createdAt: true,
    },
  },
} satisfies Prisma.DailyOperationSelect;

type DailyOperationRecord = Prisma.DailyOperationGetPayload<{
  select: typeof DAILY_OPERATION_SELECT;
}>;

type PersonRecord = {
  id: string;
  firstName: string;
  lastName: string;
};

function toPerson(person: PersonRecord): { id: string; name: string } {
  return { id: person.id, name: `${person.firstName} ${person.lastName}` };
}

function toDailyOperationResponse(
  operation: DailyOperationRecord,
): DailyOperationResponse {
  return {
    id: operation.id,
    store: operation.store,
    businessDate: formatDbDate(operation.businessDate),
    cardTipAmount: Number(operation.cardTipAmount),
    cashTipAmount: Number(operation.cashTipAmount),
    tipFundAmount: Number(operation.tipFundAmount),
    cashDifference: Number(operation.cashDifference),
    differenceReason: operation.differenceReason,
    voucher: operation.voucher
      ? {
          id: operation.voucher.id,
          fileName: operation.voucher.fileName,
          // La columna es VARCHAR; por construcción solo se guarda uno de
          // los tipos cuya firma de bytes se validó al cargar.
          mimeType: operation.voucher
            .mimeType as DailyOperationVoucherResponse['mimeType'],
          sizeBytes: Number(operation.voucher.sizeBytes),
          sha256Hash: operation.voucher.sha256Hash,
          createdAt: operation.voucher.createdAt,
        }
      : null,
    responsible: toPerson(operation.responsible),
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}

// Contenido del voucher tal como lo entrega Multer (campo "voucher").
export interface DailyOperationVoucherFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface VoucherDownload {
  content: Buffer;
  mimeType: string;
  fileName: string;
  integrity: 'VALID' | 'ALTERED';
  storeId: string;
  operationId: string;
}

@Injectable()
export class DailyOperationsService {
  private readonly logger = new Logger(DailyOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
    private readonly voucherStorage: DailyVoucherStorageService,
  ) {}

  // Crea la operación diaria del local y la fecha de negocio, con su voucher
  // fotográfico cuando hay propina de tarjeta. Un reintento idéntico (mismos
  // montos, motivo, responsable y hash del voucher) devuelve la operación
  // existente con created = false; cualquier otro contenido para la misma
  // clave local/fecha responde 409 con existingOperationId. La unicidad la
  // garantiza la base (índice único) y la creación se serializa por local.
  async create(
    dto: CreateDailyOperationDto,
    file: DailyOperationVoucherFile | undefined,
    currentUser: AuthUser,
  ): Promise<DailyOperationCreateResult> {
    this.assertStoreAccess(dto.storeId, currentUser);
    await this.stores.assertActive(dto.storeId);
    this.assertVoucherConsistency(dto, file);
    this.assertDifferenceReason(dto);
    const businessDate = this.parseBusinessDate(dto.businessDate);

    // El duplicado natural se resuelve antes de validar o guardar el archivo:
    // un reintento idéntico no debería fallar por reglas que no aplican.
    const existing = await this.findByNaturalKey(dto.storeId, businessDate);
    if (existing) {
      return this.resolveDuplicate(
        existing,
        dto,
        this.voucherHashOf(file),
        currentUser,
      );
    }

    const storedVoucher = file
      ? await this.voucherStorage.save(file.buffer, file.mimetype)
      : null;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Serializa las creaciones por local: dos cargas simultáneas del
        // mismo local esperan aquí y la segunda ve la fila de la primera.
        await tx.$queryRaw`SELECT id FROM stores WHERE id = ${dto.storeId}::uuid FOR UPDATE`;
        const concurrent = await this.findByNaturalKey(
          dto.storeId,
          businessDate,
          tx,
        );
        if (concurrent) {
          return this.resolveDuplicate(
            concurrent,
            dto,
            storedVoucher?.sha256Hash ?? null,
            currentUser,
          );
        }

        let voucherId: string | null = null;
        if (storedVoucher !== null && file !== undefined) {
          const voucher = await tx.dailyOperationVoucher.create({
            data: {
              fileName: sanitizeFileName(file.originalname),
              filePath: storedVoucher.relativePath,
              mimeType: storedVoucher.mimeType,
              sizeBytes: storedVoucher.sizeBytes,
              sha256Hash: storedVoucher.sha256Hash,
            },
            select: { id: true },
          });
          voucherId = voucher.id;
        }

        const created = await tx.dailyOperation.create({
          data: {
            storeId: dto.storeId,
            businessDate,
            cardTipAmount: BigInt(dto.cardTipAmount),
            cashTipAmount: BigInt(dto.cashTipAmount),
            tipFundAmount: BigInt(dto.cardTipAmount + dto.cashTipAmount),
            cashDifference: BigInt(dto.cashDifference),
            differenceReason: dto.differenceReason ?? null,
            responsibleId: currentUser.id,
            voucherId,
          },
          select: { id: true },
        });
        return { operation: await this.read(created.id, tx), created: true };
      });
      // Resolución de un duplicado concurrente idéntico: la operación
      // existente responde y el voucher recién guardado queda huérfano.
      if (!result.created && storedVoucher !== null) {
        await this.removeOrphanVoucher(storedVoucher.relativePath);
      }
      return result;
    } catch (error) {
      // El índice único (local, fecha) resuelve cualquier carrera residual:
      // se reintenta como duplicado natural y solo sobrevive si era idéntico.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.findByNaturalKey(
          dto.storeId,
          businessDate,
        );
        if (concurrent) {
          const resolved = this.resolveDuplicate(
            concurrent,
            dto,
            storedVoucher?.sha256Hash ?? null,
            currentUser,
          );
          // Resolución idéntica tras una carrera: la operación existente
          // responde y el voucher guardado queda huérfano.
          if (!resolved.created && storedVoucher !== null) {
            await this.removeOrphanVoucher(storedVoucher.relativePath);
          }
          return resolved;
        }
      }
      // La operación no se persistió: el voucher guardado quedaría huérfano.
      if (storedVoucher !== null) {
        await this.removeOrphanVoucher(storedVoucher.relativePath);
      }
      throw error;
    }
  }

  // Devuelve la operación del local y fecha (0 o 1 elementos): existe a lo
  // más una operación diaria por local y día de negocio.
  async findAll(
    query: ListDailyOperationsQueryDto,
    currentUser: AuthUser,
  ): Promise<DailyOperationResponse[]> {
    this.assertStoreAccess(query.storeId, currentUser);
    const operations = await this.prisma.dailyOperation.findMany({
      where: {
        storeId: query.storeId,
        businessDate: this.parseBusinessDate(query.businessDate),
      },
      select: DAILY_OPERATION_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return operations.map(toDailyOperationResponse);
  }

  async findOne(
    id: string,
    currentUser: AuthUser,
  ): Promise<DailyOperationResponse> {
    const operation = await this.prisma.dailyOperation.findUnique({
      where: { id },
      select: DAILY_OPERATION_SELECT,
    });
    if (!operation) {
      throw new NotFoundException('Operación diaria no encontrada');
    }
    this.assertStoreAccess(operation.store.id, currentUser);
    return toDailyOperationResponse(operation);
  }

  // Descarga privada del voucher fotográfico. Recalcula el SHA-256 y lo
  // compara con el registrado: si no coincide, el archivo se entrega igual
  // pero marcado ALTERED para advertir la modificación (mismo criterio que
  // la descarga de versiones del gestor documental).
  async downloadVoucher(
    id: string,
    currentUser: AuthUser,
  ): Promise<VoucherDownload> {
    const operation = await this.prisma.dailyOperation.findUnique({
      where: { id },
      select: {
        id: true,
        storeId: true,
        voucher: {
          select: {
            fileName: true,
            filePath: true,
            mimeType: true,
            sha256Hash: true,
          },
        },
      },
    });
    if (!operation) {
      throw new NotFoundException('Operación diaria no encontrada');
    }
    this.assertStoreAccess(operation.storeId, currentUser);
    if (!operation.voucher) {
      throw new NotFoundException('La operación diaria no tiene voucher');
    }
    const content = await this.voucherStorage.read(operation.voucher.filePath);
    const integrity = this.voucherStorage.computeSha256(content);
    return {
      content,
      mimeType: operation.voucher.mimeType,
      fileName: operation.voucher.fileName,
      integrity:
        integrity === operation.voucher.sha256Hash.toLowerCase()
          ? 'VALID'
          : 'ALTERED',
      storeId: operation.storeId,
      operationId: operation.id,
    };
  }

  private async findByNaturalKey(
    storeId: string,
    businessDate: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<DailyOperationResponse | null> {
    const operation = await client.dailyOperation.findUnique({
      where: {
        storeId_businessDate: {
          storeId,
          businessDate,
        },
      },
      select: DAILY_OPERATION_SELECT,
    });
    return operation ? toDailyOperationResponse(operation) : null;
  }

  private resolveDuplicate(
    existing: DailyOperationResponse,
    dto: CreateDailyOperationDto,
    voucherSha256: string | null,
    currentUser: AuthUser,
  ): DailyOperationCreateResult {
    if (
      isIdenticalDailyOperationRetry(existing, dto, voucherSha256, currentUser)
    ) {
      return { operation: existing, created: false };
    }
    throw new ConflictException({
      statusCode: 409,
      message:
        'Ya existe una operación diaria distinta para ese local y fecha; consulta la existente antes de continuar',
      error: 'Conflict',
      existingOperationId: existing.id,
    });
  }

  private async read(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<DailyOperationResponse> {
    const operation = await tx.dailyOperation.findUniqueOrThrow({
      where: { id },
      select: DAILY_OPERATION_SELECT,
    });
    return toDailyOperationResponse(operation);
  }

  // El mejor esfuerzo nunca interrumpe la operación principal: un archivo
  // huérfano sin metadatos no expone datos y se puede depurar después.
  private async removeOrphanVoucher(relativePath: string): Promise<void> {
    try {
      await this.voucherStorage.remove(relativePath);
    } catch (cleanupError) {
      this.logger.warn(
        `No se pudo eliminar el voucher huérfano ${relativePath}`,
        cleanupError instanceof Error ? cleanupError.stack : undefined,
      );
    }
  }

  private voucherHashOf(
    file: DailyOperationVoucherFile | undefined,
  ): string | null {
    return file ? this.voucherStorage.computeSha256(file.buffer) : null;
  }

  private assertVoucherConsistency(
    dto: CreateDailyOperationDto,
    file: DailyOperationVoucherFile | undefined,
  ): void {
    if (dto.cardTipAmount > 0 && !file) {
      throw new BadRequestException(
        'El voucher es obligatorio cuando cardTipAmount es mayor que 0',
      );
    }
    if (dto.cardTipAmount === 0 && file) {
      throw new BadRequestException(
        'El voucher solo se acepta cuando hay propina de tarjeta',
      );
    }
  }

  private assertDifferenceReason(dto: CreateDailyOperationDto): void {
    if (dto.cashDifference !== 0 && !dto.differenceReason) {
      throw new BadRequestException(
        'differenceReason es obligatorio cuando la diferencia de efectivo no es cero',
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

  private assertStoreAccess(storeId: string, currentUser: AuthUser): void {
    if (!canAccessStore(currentUser, storeId)) {
      throw new ForbiddenException('No tienes acceso a este local');
    }
  }
}
