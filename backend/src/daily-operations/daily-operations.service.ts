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
import { triggerErrorInfo } from '../prisma/utils/database-error.util.js';
import { StoresService } from '../stores/stores.service.js';
import { DailyVoucherStorageService } from './daily-voucher-storage.service.js';
import type { CreateDailyOperationDto } from './dto/create-daily-operation.dto.js';
import type { ListDailyOperationsQueryDto } from './dto/list-daily-operations-query.dto.js';
import type { UpdateDailyOperationDto } from './dto/update-daily-operation.dto.js';
import {
  TIP_PARTICIPANT_ROLES,
  type DailyOperationCreateResult,
  type DailyOperationResponse,
  type DailyOperationVoucherResponse,
  type EligibleWorkerResponse,
} from './types/daily-operations.types.js';
import { isIdenticalDailyOperationRetry } from './utils/daily-operation-retry.util.js';
import { planDailyTipAllocations } from './utils/daily-tip-allocations.util.js';
import { STORE_FORBIDDEN_MESSAGE } from '../auth/constants/forbidden-messages.constants.js';

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
      // filePath es interno (eliminación del archivo al reemplazar/retirar
      // el voucher): la respuesta de la API no lo expone.
      filePath: true,
      mimeType: true,
      sizeBytes: true,
      sha256Hash: true,
      createdAt: true,
    },
  },
  // La selección compartida por la propina de tarjeta y la de efectivo
  // (SPRINT-4R-T02/T03): una sola lista ordenada por nombre del trabajador.
  participants: {
    select: { worker: PERSON_SELECT },
    orderBy: [
      { worker: { firstName: 'asc' } },
      { worker: { lastName: 'asc' } },
      { worker: { id: 'asc' } },
    ],
  },
  // Reparto automático del fondo (SPRINT-4A-T03), en el mismo orden.
  tipAllocations: {
    select: { id: true, amount: true, status: true, worker: PERSON_SELECT },
    orderBy: [
      { worker: { firstName: 'asc' } },
      { worker: { lastName: 'asc' } },
      { worker: { id: 'asc' } },
    ],
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
    participants: operation.participants.map((participant) =>
      toPerson(participant.worker),
    ),
    tipAllocations: operation.tipAllocations.map((allocation) => ({
      id: allocation.id,
      worker: toPerson(allocation.worker),
      amount: Number(allocation.amount),
      status: allocation.status,
    })),
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

// Decisión de recalcular el reparto de una corrección (SPRINT-4A-T03): el
// reparto se rehace solo si cambia el fondo o la selección (o si faltaba);
// participantIds es la selección resultante.
interface TipRecalculation {
  recalculate: boolean;
  participantIds: string[];
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return a.length === b.length && b.every((id) => set.has(id));
}

// Resultado calculado de una corrección (PATCH) antes de persistirla.
interface CorrectionPlan {
  cardTipAmount: number;
  cashTipAmount: number;
  tipFundAmount: number;
  cashDifference: number;
  differenceReason: string | null;
  participantIds: string[] | undefined;
}

// Los triggers de SPRINT-4R-T02 rechazan con RAISE EXCEPTION (ERRCODE
// check_violation / insufficient_privilege): triggerErrorInfo
// (prisma/utils/database-error.util.ts) los normaliza para mapearlos a un
// error HTTP claro (los rechazos de validación propia llegan antes, pero una
// carrera —ej. un trabajador desactivado entre la validación y el INSERT—
// solo la puede cerrar la base).

@Injectable()
export class DailyOperationsService {
  private readonly logger = new Logger(DailyOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
    private readonly voucherStorage: DailyVoucherStorageService,
  ) {}

  // Catálogo acotado de trabajadores elegibles para el reparto del día
  // (SPRINT-4R-T03): los TRABAJADOR y SUPERVISOR activos del local
  // (SPRINT-4A-T01: el supervisor también recibe su parte), en orden estable
  // por nombre, apellido e id. Solo expone id y nombre completo: jamás RUT, correo,
  // teléfono ni credenciales (Ley N°21.719). El alcance por local aplica a
  // SUPERVISOR (el suyo) y ADMINISTRADOR (cualquiera, según la política
  // canAccessStore); el resto de los roles ni siquiera alcanza el endpoint.
  async findEligibleWorkers(
    storeId: string,
    currentUser: AuthUser,
  ): Promise<EligibleWorkerResponse[]> {
    this.assertStoreAccess(storeId, currentUser);
    const workers = await this.prisma.user.findMany({
      where: {
        storeId,
        isActive: true,
        role: { code: { in: [...TIP_PARTICIPANT_ROLES] } },
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
    });
    return workers.map(toPerson);
  }

  // Crea la operación diaria del local y la fecha de negocio, con su voucher
  // fotográfico cuando hay propina de tarjeta y la selección de trabajadores
  // que participan del reparto (SPRINT-4R-T03). Ambos se persisten en la
  // misma transacción: nunca queda una operación con la mitad de la
  // selección. Un reintento idéntico (mismos montos, motivo, responsable,
  // hash del voucher y misma selección comparada como conjunto) devuelve la
  // operación existente con created = false; cualquier otro contenido para
  // la misma clave local/fecha responde 409 con existingOperationId. La
  // unicidad la garantiza la base (índice único) y la creación se serializa
  // por local.
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
    const requestedIds = this.assertNoDuplicateParticipants(
      dto.participantIds ?? [],
    );

    // El duplicado natural se resuelve antes de validar elegibilidad o guardar
    // el archivo: un reintento idéntico no debería fallar por reglas que no
    // aplican (ni duplicar la selección).
    const existing = await this.findByNaturalKey(dto.storeId, businessDate);
    if (existing) {
      return this.resolveDuplicate(
        existing,
        dto,
        this.voucherHashOf(file),
        currentUser,
      );
    }

    const participantIds = this.assertFundSelectionRule(
      dto.cardTipAmount + dto.cashTipAmount,
      requestedIds,
    );
    if (participantIds.length > 0) {
      await this.assertParticipantsEligible(participantIds, dto.storeId);
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
        // La selección se guarda junto a la operación: una transacción, una
        // única lista compartida por tarjeta y efectivo, sin duplicados
        // (UNIQUE(operation_id, worker_id) y validación de elegibilidad).
        if (participantIds.length > 0) {
          await tx.dailyOperationParticipant.createMany({
            data: participantIds.map((workerId) => ({
              operationId: created.id,
              workerId,
            })),
          });
        }
        // Reparto automático (SPRINT-4A-T03): en la misma transacción, una
        // propina No pagada por participante que suma el fondo. Si algo
        // falla no queda ni la operación ni sus propinas.
        await this.createTipAllocations(tx, {
          operationId: created.id,
          storeId: dto.storeId,
          businessDate,
          tipFundAmount: dto.cardTipAmount + dto.cashTipAmount,
          participantIds,
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
      const trigger = triggerErrorInfo(error);
      // La operación no se persistió: el voucher guardado quedaría huérfano.
      if (storedVoucher !== null) {
        await this.removeOrphanVoucher(storedVoucher.relativePath);
      }
      if (trigger !== null) {
        // Los triggers T02 rechazan con mensajes claros (ej. reparto
        // confirmado o pagado): se propagan como conflicto de estado.
        throw new ConflictException(trigger.message);
      }
      throw error;
    }
  }

  // Corrige campos de la operación diaria y/o su selección de participantes
  // (SPRINT-4R-T03). Solo lo enviado cambia; local, fecha y responsable
  // original quedan intactos. Reglas del resultado corregido:
  // - Montos y fondo: el fondo resultante (tarjeta + efectivo) mayor que 0
  //   exige al menos un participante; con fondo 0 la selección queda vacía.
  // - Voucher: con tarjeta resultante 0 se retiran archivo y metadatos del
  //   anterior; con tarjeta > 0 se conserva el registrado salvo reemplazo
  //   explícito (el archivo nuevo reemplaza archivo y metadatos del viejo).
  // - Diferencia: si el valor resultante no es 0, el motivo es obligatorio
  //   (enviado o ya registrado); con caja cuadrada el motivo queda vacío.
  // Todo corre en una transacción y los triggers T02 impiden corregir montos
  // o selección de una operación que alimentó un reparto CONFIRMED o PAID
  // (el error de la base se mapea a 409 con su mensaje claro).
  async update(
    id: string,
    dto: UpdateDailyOperationDto,
    file: DailyOperationVoucherFile | undefined,
    currentUser: AuthUser,
  ): Promise<DailyOperationResponse> {
    const existing = await this.prisma.dailyOperation.findUnique({
      where: { id },
      select: DAILY_OPERATION_SELECT,
    });
    if (!existing) {
      throw new NotFoundException('Operación diaria no encontrada');
    }
    this.assertStoreAccess(existing.store.id, currentUser);

    if (
      dto.cardTipAmount === undefined &&
      dto.cashTipAmount === undefined &&
      dto.cashDifference === undefined &&
      dto.differenceReason === undefined &&
      dto.participantIds === undefined &&
      file === undefined
    ) {
      throw new BadRequestException(
        'No hay nada que corregir: envía al menos un campo o el voucher de reemplazo',
      );
    }

    // Validación temprana sobre la foto actual: los errores del resultado se
    // informan antes de guardar el archivo. Dentro de la transacción se
    // vuelve a planificar sobre la fila bloqueada (FOR UPDATE), de modo que
    // dos correcciones simultáneas se serializan y ninguna decide con datos
    // obsoletos (ej. retirar dos veces el mismo voucher).
    const preliminary = this.planCorrection(existing, dto, file);
    // Con propinas pagadas no se recalcula: 409 antes de guardar el archivo.
    this.planTipRecalculation(existing, preliminary);
    if (
      preliminary.participantIds !== undefined &&
      preliminary.participantIds.length > 0
    ) {
      await this.assertParticipantsEligible(
        preliminary.participantIds,
        existing.store.id,
      );
    }

    const storedVoucher = file
      ? await this.voucherStorage.save(file.buffer, file.mimetype)
      : null;
    try {
      const { operation, replacedVoucherPath } = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM daily_operations WHERE id = ${id}::uuid FOR UPDATE`;
          const locked = await tx.dailyOperation.findUniqueOrThrow({
            where: { id },
            select: DAILY_OPERATION_SELECT,
          });
          const plan = this.planCorrection(locked, dto, file);
          const tips = this.planTipRecalculation(locked, plan);
          const existingVoucher = locked.voucher;

          let voucherId: string | null = null;
          if (plan.cardTipAmount > 0) {
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
            } else if (existingVoucher !== null) {
              // Se conserva el voucher registrado: la tarjeta sigue > 0 y no
              // hubo reemplazo (planCorrection exige uno de los dos).
              voucherId = existingVoucher.id;
            }
          }

          await tx.dailyOperation.update({
            where: { id },
            data: {
              cardTipAmount: BigInt(plan.cardTipAmount),
              cashTipAmount: BigInt(plan.cashTipAmount),
              tipFundAmount: BigInt(plan.tipFundAmount),
              cashDifference: BigInt(plan.cashDifference),
              differenceReason: plan.differenceReason,
              voucherId,
            },
          });

          // El voucher anterior se retira solo cuando ya no aplica (tarjeta 0)
          // o fue reemplazado: la fila de metadatos muere con su archivo.
          const replaced =
            existingVoucher !== null && existingVoucher.id !== voucherId
              ? existingVoucher
              : null;
          if (replaced !== null) {
            await tx.dailyOperationVoucher.delete({
              where: { id: replaced.id },
            });
          }

          // Reparto anterior: se retira antes de cambiar la selección (todas
          // sus propinas están No pagadas: planTipRecalculation lo exige).
          if (tips.recalculate) {
            await tx.dailyTipAllocation.deleteMany({
              where: { operationId: id },
            });
          }

          // La selección solo se reescribe si cambió como conjunto: reenviar
          // la misma no toca filas (ni choca con propinas ya pagadas).
          const { participantIds } = plan;
          const currentIds = locked.participants.map(
            (participant) => participant.worker.id,
          );
          if (
            participantIds !== undefined &&
            !sameIdSet(participantIds, currentIds)
          ) {
            await tx.dailyOperationParticipant.deleteMany({
              where: { operationId: id },
            });
            if (participantIds.length > 0) {
              await tx.dailyOperationParticipant.createMany({
                data: participantIds.map((workerId) => ({
                  operationId: id,
                  workerId,
                })),
              });
            }
          }

          // Reparto nuevo sobre el fondo y la selección resultantes.
          if (tips.recalculate) {
            await this.createTipAllocations(tx, {
              operationId: id,
              storeId: locked.store.id,
              businessDate: locked.businessDate,
              tipFundAmount: plan.tipFundAmount,
              participantIds: tips.participantIds,
            });
          }

          return {
            operation: await this.read(id, tx),
            replacedVoucherPath: replaced?.filePath ?? null,
          };
        },
      );

      // Commiteada la corrección: el archivo reemplazado o retirado se
      // elimina del volumen (mejor esfuerzo, nunca interrumpe la respuesta).
      if (replacedVoucherPath !== null) {
        await this.removeOrphanVoucher(replacedVoucherPath);
      }
      return operation;
    } catch (error) {
      // La corrección no se persistió: el voucher guardado quedaría huérfano.
      if (storedVoucher !== null) {
        await this.removeOrphanVoucher(storedVoucher.relativePath);
      }
      const trigger = triggerErrorInfo(error);
      if (trigger !== null) {
        // Los triggers T02 rechazan con mensajes claros (ej. reparto
        // confirmado o pagado): se propagan como conflicto de estado.
        throw new ConflictException(trigger.message);
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

  // Decide si la corrección rehace el reparto del día (SPRINT-4A-T03): solo
  // cuando cambia el fondo o la selección como conjunto, o cuando la
  // operación no tenía reparto y ahora corresponde. Corregir solo el motivo,
  // la diferencia o el voucher no lo toca. Si hay que recalcular y alguna
  // propina ya está Pagada, la corrección completa se rechaza con 409 sin
  // cambiar nada; con fondo mayor que 0 se exige al menos un participante
  // (caso de las operaciones anteriores a la selección de participantes).
  private planTipRecalculation(
    record: DailyOperationRecord,
    plan: CorrectionPlan,
  ): TipRecalculation {
    const currentIds = record.participants.map(
      (participant) => participant.worker.id,
    );
    const participantIds = plan.participantIds ?? currentIds;
    const recalculate =
      plan.tipFundAmount !== Number(record.tipFundAmount) ||
      !sameIdSet(participantIds, currentIds) ||
      (record.tipAllocations.length === 0 &&
        plan.tipFundAmount > 0 &&
        participantIds.length > 0);
    if (!recalculate) {
      return { recalculate, participantIds };
    }
    if (record.tipAllocations.some((tip) => tip.status === 'PAID')) {
      throw new ConflictException(
        'La operación diaria tiene propinas pagadas: no se pueden corregir ' +
          'sus montos ni sus participantes porque cambiaría un reparto ya ' +
          'pagado. Solo se pueden corregir el motivo, la diferencia de ' +
          'efectivo o el voucher.',
      );
    }
    if (plan.tipFundAmount > 0 && participantIds.length === 0) {
      throw new BadRequestException(
        'Debe participar al menos un trabajador: el fondo de propinas del día es mayor que 0',
      );
    }
    return { recalculate, participantIds };
  }

  // Guarda el reparto automático del día: una propina No pagada por
  // participante (planDailyTipAllocations). Con fondo 0 no crea filas. La
  // base vuelve a exigir al commit que las propinas sumen el fondo y cubran a
  // todos los participantes (constraint trigger diferido de SPRINT-4A-T02).
  private async createTipAllocations(
    tx: Prisma.TransactionClient,
    operation: {
      operationId: string;
      storeId: string;
      businessDate: Date;
      tipFundAmount: number;
      participantIds: readonly string[];
    },
  ): Promise<void> {
    const allocations = planDailyTipAllocations({
      operationId: operation.operationId,
      businessDate: formatDbDate(operation.businessDate),
      tipFundAmount: operation.tipFundAmount,
      participantIds: operation.participantIds,
    });
    if (allocations.length === 0) {
      return;
    }
    await tx.dailyTipAllocation.createMany({
      data: allocations.map((allocation) => ({
        operationId: operation.operationId,
        storeId: operation.storeId,
        businessDate: operation.businessDate,
        workerId: allocation.workerId,
        amount: BigInt(allocation.amount),
      })),
    });
  }

  // Calcula el resultado de una corrección sobre el estado registrado y
  // valida sus reglas (montos, voucher, motivo y selección); no toca la base.
  // participantIds undefined significa conservar la selección actual.
  private planCorrection(
    existing: DailyOperationRecord,
    dto: UpdateDailyOperationDto,
    file: DailyOperationVoucherFile | undefined,
  ): CorrectionPlan {
    const cardTipAmount = dto.cardTipAmount ?? Number(existing.cardTipAmount);
    const cashTipAmount = dto.cashTipAmount ?? Number(existing.cashTipAmount);
    const cashDifference =
      dto.cashDifference ?? Number(existing.cashDifference);
    const tipFundAmount = cardTipAmount + cashTipAmount;
    let differenceReason =
      dto.differenceReason !== undefined
        ? dto.differenceReason
        : existing.differenceReason;
    if (cashDifference !== 0 && !differenceReason) {
      throw new BadRequestException(
        'differenceReason es obligatorio cuando la diferencia de efectivo no es cero',
      );
    }
    if (cashDifference === 0) {
      // La caja quedó cuadrada: el motivo no aplica y se deja vacío.
      differenceReason = null;
    }

    if (cardTipAmount === 0 && file !== undefined) {
      throw new BadRequestException(
        'El voucher solo se acepta cuando hay propina de tarjeta',
      );
    }
    if (cardTipAmount > 0 && existing.voucher === null && file === undefined) {
      throw new BadRequestException(
        'El voucher es obligatorio cuando cardTipAmount es mayor que 0',
      );
    }

    // Selección resultante: la enviada reemplaza a la actual; omitirla la
    // conserva salvo que el fondo resultante sea 0 (sin fondo no hay
    // selección: queda vacía de forma consistente).
    let participantIds: string[] | undefined;
    if (dto.participantIds !== undefined) {
      if (tipFundAmount === 0 && dto.participantIds.length > 0) {
        throw new BadRequestException(
          'Con fondo de propinas 0 la selección debe quedar vacía: omite participantIds',
        );
      }
      participantIds = this.assertNoDuplicateParticipants(dto.participantIds);
    }
    if (tipFundAmount === 0) {
      participantIds = [];
    } else if (participantIds !== undefined && participantIds.length === 0) {
      throw new BadRequestException(
        'Debe participar al menos un trabajador: el fondo de propinas del día es mayor que 0',
      );
    }

    return {
      cardTipAmount,
      cashTipAmount,
      tipFundAmount,
      cashDifference,
      differenceReason,
      participantIds,
    };
  }

  // Rechaza IDs repetidos con un error que los identifica; devuelve la lista
  // tal como vino (sin duplicados) para seguir validando.
  private assertNoDuplicateParticipants(participantIds: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of participantIds) {
      if (seen.has(id)) {
        duplicates.add(id);
      }
      seen.add(id);
    }
    if (duplicates.size > 0) {
      throw new BadRequestException(
        `participantIds contiene IDs repetidos: ${[...duplicates].join(', ')}`,
      );
    }
    return participantIds;
  }

  // Regla del fondo: con fondo (tarjeta + efectivo) mayor que 0 se exige al
  // menos un participante; con fondo 0 la selección debe venir vacía.
  private assertFundSelectionRule(
    tipFundAmount: number,
    participantIds: string[],
  ): string[] {
    if (tipFundAmount > 0 && participantIds.length === 0) {
      throw new BadRequestException(
        'Debe participar al menos un trabajador: el fondo de propinas del día es mayor que 0',
      );
    }
    if (tipFundAmount === 0 && participantIds.length > 0) {
      throw new BadRequestException(
        'Con fondo de propinas 0 la selección debe quedar vacía: omite participantIds',
      );
    }
    return participantIds;
  }

  // Cada ID debe ser un trabajador activo del local de la operación con rol
  // TRABAJADOR o SUPERVISOR (SPRINT-4A-T01; la base vuelve a exigirlo al
  // insertar, pero aquí el error es más claro y llega antes de tocar
  // archivos). ADMINISTRADOR y CONTADOR nunca participan.
  private async assertParticipantsEligible(
    participantIds: string[],
    storeId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const eligible = await client.user.findMany({
      where: {
        id: { in: participantIds },
        storeId,
        isActive: true,
        role: { code: { in: [...TIP_PARTICIPANT_ROLES] } },
      },
      select: { id: true },
    });
    const eligibleIds = new Set(eligible.map((worker) => worker.id));
    const ineligible = participantIds.filter((id) => !eligibleIds.has(id));
    if (ineligible.length > 0) {
      throw new BadRequestException(
        'participantIds incluye trabajadores no elegibles para este local ' +
          '(deben ser activos, del local y con rol TRABAJADOR o SUPERVISOR): ' +
          ineligible.join(', '),
      );
    }
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
      throw new ForbiddenException(STORE_FORBIDDEN_MESSAGE);
    }
  }
}
