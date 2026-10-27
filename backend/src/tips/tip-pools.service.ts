import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
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
import { calculateTipDistribution } from './calculation/tip-distribution.calculator.js';
import {
  validateTipPoolSources,
  type AgreementCandidate,
} from './calculation/tip-pool-validation.js';
import type { PreviewTipPoolDto } from './dto/preview-tip-pool.dto.js';
import type {
  TipAgreementSnapshot,
  TipPoolPreviewResult,
  TipPoolResponse,
  TipPoolValidationErrorBody,
} from './types/tip-pools.types.js';

const TIP_POOL_SELECT = {
  id: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  totalAmount: true,
  agreementSnapshot: true,
  updatedAt: true,
  store: { select: { id: true, name: true } },
  calculatedBy: { select: { id: true, firstName: true, lastName: true } },
  lines: {
    select: {
      userId: true,
      hoursWorked: true,
      amount: true,
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { userId: 'asc' },
  },
  sources: {
    select: {
      tipEntryId: true,
      amount: true,
      tipEntry: { select: { businessDate: true, paymentMethod: true } },
    },
    orderBy: [
      { tipEntry: { businessDate: 'asc' } },
      { tipEntry: { paymentMethod: 'asc' } },
    ],
  },
} satisfies Prisma.TipPoolSelect;

type TipPoolRecord = Prisma.TipPoolGetPayload<{
  select: typeof TIP_POOL_SELECT;
}>;

interface PoolPeriod {
  start: string;
  end: string;
  startDate: Date;
  endDate: Date;
}

function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`;
}

// Lee el snapshot JSON del pacto sin confiar en su forma: los repartos
// históricos pueden no tenerlo.
function parseAgreementSnapshot(
  value: Prisma.JsonValue,
): TipAgreementSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { id, name, rule, validFrom, validTo, capturedAt } = value;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof rule !== 'string' ||
    typeof validFrom !== 'string' ||
    (validTo !== undefined && validTo !== null && typeof validTo !== 'string')
  ) {
    return null;
  }
  return {
    id,
    name,
    rule,
    validFrom,
    validTo: validTo ?? null,
    ...(typeof capturedAt === 'string' ? { capturedAt } : {}),
  };
}

function toTipPoolResponse(pool: TipPoolRecord): TipPoolResponse {
  const zero = new Prisma.Decimal(0);
  const linesTotal = pool.lines.reduce(
    (sum, line) => sum.plus(line.amount),
    zero,
  );
  const sourcesTotal = pool.sources.reduce(
    (sum, source) => sum.plus(source.amount),
    zero,
  );
  const totalHours = pool.lines.reduce(
    (sum, line) => sum.plus(line.hoursWorked),
    zero,
  );
  return {
    id: pool.id,
    status: pool.status,
    store: pool.store,
    periodStart: formatDbDate(pool.periodStart),
    periodEnd: formatDbDate(pool.periodEnd),
    agreement: parseAgreementSnapshot(pool.agreementSnapshot),
    totalAmount: Number(pool.totalAmount),
    totalHours: totalHours.toFixed(2),
    lines: pool.lines.map((line) => ({
      userId: line.userId,
      workerName: fullName(line.user),
      hoursWorked: line.hoursWorked.toFixed(2),
      amount: Number(line.amount),
    })),
    sources: pool.sources.map((source) => ({
      tipEntryId: source.tipEntryId,
      businessDate: formatDbDate(source.tipEntry.businessDate),
      paymentMethod: source.tipEntry.paymentMethod,
      amount: Number(source.amount),
    })),
    reconciled:
      linesTotal.equals(pool.totalAmount) &&
      sourcesTotal.equals(pool.totalAmount),
    calculatedBy: {
      id: pool.calculatedBy.id,
      name: fullName(pool.calculatedBy),
    },
    calculatedAt: pool.updatedAt,
  };
}

function toSnapshot(agreement: AgreementCandidate): TipAgreementSnapshot {
  return { ...agreement, capturedAt: new Date().toISOString() };
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

// Cálculo y vista previa del reparto de propinas (SPRINT-3-T12). Genera la
// foto del reparto en estado DRAFT a partir del pacto vigente, los registros
// diarios del período y las horas trabajadas; confirmarla es de SPRINT-3-T13.
@Injectable()
export class TipPoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
  ) {}

  async preview(
    dto: PreviewTipPoolDto,
    currentUser: AuthUser,
  ): Promise<TipPoolPreviewResult> {
    if (!canAccessStore(currentUser, dto.storeId)) {
      throw new ForbiddenException('No tienes acceso a este local');
    }
    const period = this.parsePeriod(dto);
    await this.stores.assertActive(dto.storeId);
    try {
      return await this.prisma.$transaction((tx) =>
        this.calculateAndSave(tx, dto.storeId, period, currentUser),
      );
    } catch (error) {
      // Respaldo de los bloqueos: un índice único violado por un cálculo
      // simultáneo no debe terminar en 500.
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'Otro cálculo del mismo reparto se guardó al mismo tiempo; vuelve a intentarlo',
        );
      }
      throw error;
    }
  }

  async findOne(id: string, currentUser: AuthUser): Promise<TipPoolResponse> {
    const pool = await this.prisma.tipPool.findUnique({
      where: { id },
      select: TIP_POOL_SELECT,
    });
    // Sin acceso al local se responde igual que si no existiera.
    if (!pool || !canAccessStore(currentUser, pool.store.id)) {
      throw new NotFoundException('Reparto de propinas no encontrado');
    }
    return toTipPoolResponse(pool);
  }

  private async calculateAndSave(
    tx: Prisma.TransactionClient,
    storeId: string,
    period: PoolPeriod,
    currentUser: AuthUser,
  ): Promise<TipPoolPreviewResult> {
    // Serializa los cálculos del local: dos vistas previas simultáneas (del
    // mismo período o de períodos solapados) se ejecutan una tras otra.
    // NO KEY UPDATE no bloquea a quien solo referencia el local (ej. T10).
    await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId}::uuid FOR NO KEY UPDATE`;
    await tx.$queryRaw`
      SELECT id FROM tip_pools
      WHERE store_id = ${storeId}::uuid
        AND period_start = ${period.start}::date
        AND period_end = ${period.end}::date
      FOR UPDATE`;
    const existing = await tx.tipPool.findUnique({
      where: {
        storeId_periodStart_periodEnd: {
          storeId,
          periodStart: period.startDate,
          periodEnd: period.endDate,
        },
      },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== 'DRAFT') {
      throw new ConflictException(
        `El reparto del período ya está ${existing.status === 'PAID' ? 'pagado' : 'confirmado'} y no puede recalcularse`,
      );
    }

    // Bloquea los registros diarios del período: T10 los bloquea igual antes
    // de editarlos, así que no pueden cambiar entre la lectura y la foto.
    await tx.$queryRaw`
      SELECT id FROM tip_entries
      WHERE store_id = ${storeId}::uuid
        AND business_date BETWEEN ${period.start}::date AND ${period.end}::date
      FOR UPDATE`;
    // Lecturas en serie: una transacción usa una sola conexión.
    const entries = await tx.tipEntry.findMany({
      where: {
        storeId,
        businessDate: { gte: period.startDate, lte: period.endDate },
      },
      select: {
        id: true,
        businessDate: true,
        paymentMethod: true,
        amount: true,
        poolSource: { select: { poolId: true } },
      },
      orderBy: [{ businessDate: 'asc' }, { paymentMethod: 'asc' }],
    });
    const agreements = await tx.tipAgreement.findMany({
      where: {
        storeId,
        validFrom: { lte: period.endDate },
        OR: [{ validTo: null }, { validTo: { gte: period.startDate } }],
      },
      select: {
        id: true,
        name: true,
        rule: true,
        validFrom: true,
        validTo: true,
      },
      orderBy: { validFrom: 'asc' },
    });
    const hours = await tx.workHoursRecord.findMany({
      where: {
        storeId,
        periodStart: { lte: period.endDate },
        periodEnd: { gte: period.startDate },
      },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        hoursWorked: true,
        worker: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            storeId: true,
            isActive: true,
          },
        },
      },
      orderBy: [{ workerId: 'asc' }, { periodStart: 'asc' }],
    });

    const fund = entries.reduce(
      (sum, entry) => sum.plus(entry.amount),
      new Prisma.Decimal(0),
    );
    // T10 solo acepta montos enteros: decimales aquí son datos corruptos.
    if (!fund.isInteger()) {
      throw new Error(
        `El fondo del período no es un entero CLP: ${fund.toString()}`,
      );
    }
    const fundAmount = fund.toNumber();

    const validation = validateTipPoolSources({
      storeId,
      periodStart: period.start,
      periodEnd: period.end,
      currentPoolId: existing?.id ?? null,
      fundAmount,
      agreements: agreements.map((agreement) => ({
        id: agreement.id,
        name: agreement.name,
        rule: agreement.rule,
        validFrom: formatDbDate(agreement.validFrom),
        validTo: agreement.validTo ? formatDbDate(agreement.validTo) : null,
      })),
      entries: entries.map((entry) => ({
        id: entry.id,
        businessDate: formatDbDate(entry.businessDate),
        paymentMethod: entry.paymentMethod,
        usedByPoolId: entry.poolSource?.poolId ?? null,
      })),
      hours: hours.map((record) => ({
        id: record.id,
        workerId: record.worker.id,
        workerName: fullName(record.worker),
        periodStart: formatDbDate(record.periodStart),
        periodEnd: formatDbDate(record.periodEnd),
        hoursWorked: record.hoursWorked.toFixed(2),
        workerStoreId: record.worker.storeId,
        workerActive: record.worker.isActive,
      })),
    });
    if (validation.issues.length > 0 || !validation.agreement) {
      const body: TipPoolValidationErrorBody = {
        statusCode: 422,
        message: 'No se puede calcular el reparto del período',
        issues: validation.issues,
      };
      throw new UnprocessableEntityException(body);
    }

    const lines = calculateTipDistribution({
      fundAmount,
      workers: validation.hours.map((record) => ({
        userId: record.workerId,
        hoursWorked: record.hoursWorked,
      })),
    });
    const hoursRecordByWorker = new Map(
      validation.hours.map((record) => [record.workerId, record.id]),
    );

    const poolData = {
      status: 'DRAFT' as const,
      totalAmount: new Prisma.Decimal(fundAmount),
      notes: null,
      agreementId: validation.agreement.id,
      agreementSnapshot: { ...toSnapshot(validation.agreement) },
      calculatedById: currentUser.id,
    };
    let poolId: string;
    if (existing) {
      // Reemplaza la foto del borrador conservando su ID.
      poolId = existing.id;
      await tx.tipPoolLine.deleteMany({ where: { poolId } });
      await tx.tipPoolSource.deleteMany({ where: { poolId } });
      await tx.tipPool.update({ where: { id: poolId }, data: poolData });
    } else {
      const created = await tx.tipPool.create({
        data: {
          ...poolData,
          storeId,
          periodStart: period.startDate,
          periodEnd: period.endDate,
        },
        select: { id: true },
      });
      poolId = created.id;
    }

    // Fuentes y líneas guardan copia de montos y horas: si después cambian el
    // pacto o las horas, la foto del reparto no cambia.
    await tx.tipPoolSource.createMany({
      data: entries.map((entry) => ({
        poolId,
        tipEntryId: entry.id,
        amount: entry.amount,
      })),
    });
    await tx.tipPoolLine.createMany({
      data: lines.map((line) => ({
        poolId,
        userId: line.userId,
        workHoursRecordId: hoursRecordByWorker.get(line.userId) ?? null,
        hoursWorked: new Prisma.Decimal(line.hoursWorked),
        amount: new Prisma.Decimal(line.amount),
      })),
    });

    const pool = await tx.tipPool.findUniqueOrThrow({
      where: { id: poolId },
      select: TIP_POOL_SELECT,
    });
    return { pool: toTipPoolResponse(pool), created: !existing };
  }

  private parsePeriod(dto: PreviewTipPoolDto): PoolPeriod {
    const start = parseCalendarDate(dto.periodStart);
    const end = parseCalendarDate(dto.periodEnd);
    if (!start || !end) {
      throw new BadRequestException(
        'periodStart y periodEnd deben ser fechas válidas con formato YYYY-MM-DD',
      );
    }
    const startDate = toDbDate(start);
    const endDate = toDbDate(end);
    if (endDate < startDate) {
      throw new BadRequestException(
        'periodEnd no puede ser anterior a periodStart',
      );
    }
    return {
      start: formatDbDate(startDate),
      end: formatDbDate(endDate),
      startDate,
      endDate,
    };
  }
}
