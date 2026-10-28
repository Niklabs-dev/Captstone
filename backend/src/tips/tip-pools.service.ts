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
  ConfirmTipPoolDto,
  ObserveTipPoolDto,
  PayTipPoolDto,
} from './dto/tip-pool-action.dto.js';
import { resolvePaymentDate } from './receipts/payment-date.js';
import {
  buildReceiptFileName,
  renderTipReceiptPdf,
} from './receipts/tip-receipt-pdf.js';
import {
  buildTipPoolReceipts,
  parseReceiptDetail,
} from './receipts/tip-receipt-snapshot.js';
import type {
  TipAgreementSnapshot,
  TipPoolConflictBody,
  TipPoolPersonResponse,
  TipPoolPreviewResult,
  TipPoolReceiptResponse,
  TipPoolResponse,
  TipPoolStatusCode,
  TipPoolValidationErrorBody,
} from './types/tip-pools.types.js';

const PERSON_SELECT = {
  select: { id: true, firstName: true, lastName: true },
} as const;

const TIP_POOL_SELECT = {
  id: true,
  status: true,
  version: true,
  notes: true,
  confirmedAt: true,
  paidAt: true,
  paymentDate: true,
  confirmedBy: PERSON_SELECT,
  paidBy: PERSON_SELECT,
  _count: { select: { receipts: true } },
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

const TIP_POOL_RECEIPT_SELECT = {
  id: true,
  poolId: true,
  userId: true,
  workerName: true,
  storeId: true,
  storeName: true,
  periodStart: true,
  periodEnd: true,
  hoursWorked: true,
  amount: true,
  paymentDate: true,
  paidById: true,
  paidByName: true,
  detail: true,
  createdAt: true,
} satisfies Prisma.TipPoolReceiptSelect;

type TipPoolReceiptRecord = Prisma.TipPoolReceiptGetPayload<{
  select: typeof TIP_POOL_RECEIPT_SELECT;
}>;

// Fila de tip_pools bloqueada con FOR UPDATE antes de una acción.
interface LockedPoolRow {
  id: string;
  store_id: string;
  status: TipPoolStatusCode;
  version: number;
}

const STATUS_LABEL: Record<TipPoolStatusCode, string> = {
  DRAFT: 'en borrador',
  CONFIRMED: 'confirmado',
  PAID: 'pagado',
};

export const VERSION_CONFLICT_MESSAGE =
  'El reparto cambió desde que lo revisaste; recarga y vuelve a intentarlo';

export interface TipPoolReceiptFile {
  receiptId: string;
  storeId: string;
  fileName: string;
  content: Buffer;
}

interface PoolPeriod {
  start: string;
  end: string;
  startDate: Date;
  endDate: Date;
}

function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`;
}

function toPerson(
  person: { id: string; firstName: string; lastName: string } | null,
): TipPoolPersonResponse | null {
  return person ? { id: person.id, name: fullName(person) } : null;
}

// Fecha YYYY-MM-DD ya validada como Date de una columna date.
function dbDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
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
    version: pool.version,
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
    notes: pool.notes,
    confirmedBy: toPerson(pool.confirmedBy),
    confirmedAt: pool.confirmedAt,
    paidBy: toPerson(pool.paidBy),
    paidAt: pool.paidAt,
    paymentDate: pool.paymentDate ? formatDbDate(pool.paymentDate) : null,
    receiptsCount: pool._count.receipts,
  };
}

function toReceiptResponse(
  receipt: TipPoolReceiptRecord,
): TipPoolReceiptResponse {
  return {
    id: receipt.id,
    poolId: receipt.poolId,
    userId: receipt.userId,
    workerName: receipt.workerName,
    store: { id: receipt.storeId, name: receipt.storeName },
    periodStart: formatDbDate(receipt.periodStart),
    periodEnd: formatDbDate(receipt.periodEnd),
    hoursWorked: receipt.hoursWorked.toFixed(2),
    amount: Number(receipt.amount),
    paymentDate: formatDbDate(receipt.paymentDate),
    paidBy: { id: receipt.paidById, name: receipt.paidByName },
    detail: parseReceiptDetail(receipt.detail),
    createdAt: receipt.createdAt,
  };
}

function toSnapshot(agreement: AgreementCandidate): TipAgreementSnapshot {
  return { ...agreement, capturedAt: new Date().toISOString() };
}

// 409 de una acción con el estado y la versión actuales del reparto.
function conflict(message: string, pool: LockedPoolRow): ConflictException {
  const body: TipPoolConflictBody = {
    statusCode: 409,
    message,
    currentStatus: pool.status,
    currentVersion: pool.version,
  };
  return new ConflictException(body);
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

// Cálculo y vista previa del reparto de propinas (SPRINT-3-T12). Genera la
// foto del reparto en estado DRAFT a partir del pacto vigente, los registros
// diarios del período y las horas trabajadas. El contador la observa, la
// confirma y la marca como pagada, lo que emite una constancia por trabajador
// (SPRINT-3-T13).
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

  // Observación del contador sobre un borrador: reemplaza notes y sube la
  // versión; el reparto sigue en DRAFT hasta que se recalcule y confirme.
  async observe(
    id: string,
    dto: ObserveTipPoolDto,
    currentUser: AuthUser,
  ): Promise<TipPoolResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockPool(tx, id, currentUser, dto.expectedVersion, {
        status: 'DRAFT',
        message:
          'Solo se pueden registrar observaciones en un reparto en borrador',
      });
      return this.updateAndRead(tx, id, {
        notes: dto.notes,
        version: { increment: 1 },
      });
    });
  }

  // Validación del contador: revalida la conciliación y pasa a CONFIRMED.
  // Desde ahí los triggers impiden cambiar montos, líneas y fuentes.
  async confirm(
    id: string,
    dto: ConfirmTipPoolDto,
    currentUser: AuthUser,
  ): Promise<TipPoolResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockPool(tx, id, currentUser, dto.expectedVersion, {
        status: 'DRAFT',
        message: 'Solo se puede confirmar un reparto en borrador',
      });
      const current = await this.read(tx, id);
      if (!current.reconciled) {
        throw new UnprocessableEntityException(
          'El reparto no está conciliado: la suma de las líneas o de las fuentes no coincide con el total; recalcúlalo antes de confirmar',
        );
      }
      return this.updateAndRead(tx, id, {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedBy: { connect: { id: currentUser.id } },
        version: { increment: 1 },
      });
    });
  }

  // Pago (enterado) de un reparto confirmado: pasa a PAID y, en la misma
  // transacción y después del cambio de estado, inserta una constancia por
  // línea con la foto del reparto (el trigger exige que ya esté PAID).
  async pay(
    id: string,
    dto: PayTipPoolDto,
    currentUser: AuthUser,
  ): Promise<TipPoolResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockPool(tx, id, currentUser, dto.expectedVersion, {
        status: 'CONFIRMED',
        message: 'Solo se puede marcar como pagado un reparto confirmado',
      });
      const current = await this.read(tx, id);
      const paymentDate = resolvePaymentDate(
        dto.paymentDate,
        current.periodEnd,
        new Date(),
      );
      if (!paymentDate.valid) {
        throw new BadRequestException(paymentDate.message);
      }
      const payer = await tx.user.findUniqueOrThrow({
        where: { id: currentUser.id },
        select: { id: true, firstName: true, lastName: true },
      });
      const paidBy = { id: payer.id, name: fullName(payer) };

      await tx.tipPool.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paidBy: { connect: { id: paidBy.id } },
          paymentDate: dbDay(paymentDate.date),
          version: { increment: 1 },
        },
      });
      const receipts = buildTipPoolReceipts(current, paymentDate.date, paidBy);
      await tx.tipPoolReceipt.createMany({
        data: receipts.map((receipt) => ({
          poolId: id,
          userId: receipt.userId,
          workerName: receipt.workerName,
          storeId: receipt.storeId,
          storeName: receipt.storeName,
          periodStart: dbDay(receipt.periodStart),
          periodEnd: dbDay(receipt.periodEnd),
          hoursWorked: new Prisma.Decimal(receipt.hoursWorked),
          amount: new Prisma.Decimal(receipt.amount),
          paymentDate: dbDay(receipt.paymentDate),
          paidById: receipt.paidById,
          paidByName: receipt.paidByName,
          // El spread materializa el detalle como objeto JSON de Prisma.
          detail: {
            ...receipt.detail,
            agreementSnapshot: receipt.detail.agreementSnapshot
              ? { ...receipt.detail.agreementSnapshot }
              : null,
            lines: receipt.detail.lines.map((line) => ({ ...line })),
          },
        })),
      });
      return this.read(tx, id);
    });
  }

  async listReceipts(
    id: string,
    currentUser: AuthUser,
  ): Promise<TipPoolReceiptResponse[]> {
    await this.assertPaidPool(id, currentUser);
    const receipts = await this.prisma.tipPoolReceipt.findMany({
      where: { poolId: id },
      select: TIP_POOL_RECEIPT_SELECT,
      orderBy: { userId: 'asc' },
    });
    return receipts.map(toReceiptResponse);
  }

  // PDF de la constancia generado al vuelo desde la foto guardada.
  async downloadReceipt(
    id: string,
    userId: string,
    currentUser: AuthUser,
  ): Promise<TipPoolReceiptFile> {
    await this.assertPaidPool(id, currentUser);
    const receipt = await this.prisma.tipPoolReceipt.findUnique({
      where: { poolId_userId: { poolId: id, userId } },
      select: TIP_POOL_RECEIPT_SELECT,
    });
    if (!receipt) {
      throw new NotFoundException(
        'El trabajador no tiene constancia en este reparto',
      );
    }
    const response = toReceiptResponse(receipt);
    const content = await renderTipReceiptPdf(response, new Date());
    return {
      receiptId: receipt.id,
      storeId: receipt.storeId,
      fileName: buildReceiptFileName(response),
      content: Buffer.from(content),
    };
  }

  // Bloquea el reparto (FOR UPDATE) y verifica acceso, estado y versión, en
  // ese orden: sin acceso responde como si no existiera (404) y un estado
  // incorrecto se informa antes que una versión desactualizada (ambos 409).
  private async lockPool(
    tx: Prisma.TransactionClient,
    id: string,
    currentUser: AuthUser,
    expectedVersion: number,
    expected: { status: TipPoolStatusCode; message: string },
  ): Promise<LockedPoolRow> {
    const rows = await tx.$queryRaw<LockedPoolRow[]>`
      SELECT id, store_id, status::text AS status, version
      FROM tip_pools
      WHERE id = ${id}::uuid
      FOR UPDATE`;
    const pool = rows.at(0);
    if (!pool || !canAccessStore(currentUser, pool.store_id)) {
      throw new NotFoundException('Reparto de propinas no encontrado');
    }
    if (pool.status !== expected.status) {
      throw conflict(
        `${expected.message}; el reparto está ${STATUS_LABEL[pool.status]}`,
        pool,
      );
    }
    if (pool.version !== expectedVersion) {
      throw conflict(VERSION_CONFLICT_MESSAGE, pool);
    }
    return pool;
  }

  private async read(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<TipPoolResponse> {
    const pool = await tx.tipPool.findUniqueOrThrow({
      where: { id },
      select: TIP_POOL_SELECT,
    });
    return toTipPoolResponse(pool);
  }

  private async updateAndRead(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.TipPoolUpdateInput,
  ): Promise<TipPoolResponse> {
    const pool = await tx.tipPool.update({
      where: { id },
      data,
      select: TIP_POOL_SELECT,
    });
    return toTipPoolResponse(pool);
  }

  // Las constancias solo existen en un reparto pagado.
  private async assertPaidPool(
    id: string,
    currentUser: AuthUser,
  ): Promise<void> {
    const pool = await this.prisma.tipPool.findUnique({
      where: { id },
      select: { storeId: true, status: true },
    });
    if (!pool || !canAccessStore(currentUser, pool.storeId)) {
      throw new NotFoundException('Reparto de propinas no encontrado');
    }
    if (pool.status !== 'PAID') {
      throw new ConflictException(
        `Las constancias se emiten al pagar el reparto; el reparto está ${STATUS_LABEL[pool.status]}`,
      );
    }
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
      await tx.tipPool.update({
        where: { id: poolId },
        // Las observaciones se limpian (quedan en la auditoría y el recálculo
        // las atiende) y la versión sube: quien revisó la foto anterior
        // recibe 409 al confirmarla (SPRINT-3-T13).
        data: { ...poolData, version: { increment: 1 } },
      });
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
