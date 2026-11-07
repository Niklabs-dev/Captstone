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
import {
  calculateEqualDailyDistribution,
  EqualDistributionError,
  type EqualDailyDistributionResult,
} from './calculation/equal-daily-distribution.calculator.js';
import {
  validateEqualPoolSources,
  type DailyOperationCandidate,
} from './calculation/equal-pool-validation.js';
import type {
  CalculateTipPoolDto,
  PreviewTipPoolDto,
} from './dto/preview-tip-pool.dto.js';
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
import {
  EQUAL_SHARES_RULE_NAME,
  type TipAgreementSnapshot,
  type TipPoolConflictBody,
  type TipPoolPersonResponse,
  type TipPoolPreviewResult,
  type TipPoolReceiptResponse,
  type TipPoolResponse,
  type TipPoolRule,
  type TipPoolStatusCode,
  type TipPoolValidationErrorBody,
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
  calculatedAt: true,
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
      tipEntry: {
        select: {
          businessDate: true,
          paymentMethod: { select: { code: true, name: true } },
        },
      },
    },
    orderBy: [
      { tipEntry: { businessDate: 'asc' } },
      { tipEntry: { paymentMethod: { code: 'asc' } } },
    ],
  },
  // Fuentes del reparto equitativo (SPRINT-4R-T04): una por operación diaria.
  dailyOperationSources: {
    select: {
      operationId: true,
      amount: true,
      operation: {
        select: {
          businessDate: true,
          cardTipAmount: true,
          cashTipAmount: true,
        },
      },
    },
    orderBy: { operation: { businessDate: 'asc' } },
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

// Fila de tip_pools leída antes de recalcular un borrador.
interface ExistingPoolRow {
  id: string;
  status: TipPoolStatusCode;
  version: number;
  notes: string | null;
}

const STATUS_LABEL: Record<TipPoolStatusCode, string> = {
  DRAFT: 'en borrador',
  CONFIRMED: 'confirmado',
  PAID: 'pagado',
};

export const VERSION_CONFLICT_MESSAGE =
  'El reparto cambió desde que lo revisaste; recarga y vuelve a intentarlo';

export const STALE_POOL_MESSAGE =
  'El reparto quedó desactualizado: cambiaron las operaciones diarias o los participantes del período; recalcúlalo antes de confirmar';

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

// La regla aplicada se lee desde la foto: solo los repartos equitativos
// (SPRINT-4R-T04) guardan rule = EQUAL_SHARES; los históricos, con o sin
// snapshot, son proporcionales (misma resolución que los triggers de T02).
function resolveRule(snapshot: Prisma.JsonValue): TipPoolRule {
  return typeof snapshot === 'object' &&
    snapshot !== null &&
    !Array.isArray(snapshot) &&
    snapshot.rule === 'EQUAL_SHARES'
    ? 'EQUAL_SHARES'
    : 'PROPORTIONAL_TO_HOURS';
}

// Foto de la regla equitativa guardada en agreement_snapshot: no hay pacto
// (agreement_id NULL), así que solo registra la regla y el instante.
function equalSharesSnapshot(): Prisma.InputJsonObject {
  return {
    rule: 'EQUAL_SHARES',
    name: EQUAL_SHARES_RULE_NAME,
    capturedAt: new Date().toISOString(),
  };
}

function toTipPoolResponse(pool: TipPoolRecord): TipPoolResponse {
  const zero = new Prisma.Decimal(0);
  const rule = resolveRule(pool.agreementSnapshot);
  const linesTotal = pool.lines.reduce(
    (sum, line) => sum.plus(line.amount),
    zero,
  );
  const sourcesTotal = pool.sources.reduce(
    (sum, source) => sum.plus(source.amount),
    zero,
  );
  const dailySourcesTotal = pool.dailyOperationSources.reduce(
    (sum, source) => sum.plus(source.amount.toString()),
    zero,
  );
  // El reparto equitativo no usa horas: su total es null, no 0.
  const totalHours =
    rule === 'EQUAL_SHARES'
      ? null
      : pool.lines
          .reduce((sum, line) => sum.plus(line.hoursWorked ?? zero), zero)
          .toFixed(2);
  return {
    id: pool.id,
    status: pool.status,
    version: pool.version,
    store: pool.store,
    periodStart: formatDbDate(pool.periodStart),
    periodEnd: formatDbDate(pool.periodEnd),
    rule,
    agreement: parseAgreementSnapshot(pool.agreementSnapshot),
    totalAmount: Number(pool.totalAmount),
    totalHours,
    lines: pool.lines.map((line) => ({
      userId: line.userId,
      workerName: fullName(line.user),
      hoursWorked: line.hoursWorked?.toFixed(2) ?? null,
      amount: Number(line.amount),
    })),
    sources: pool.sources.map((source) => ({
      tipEntryId: source.tipEntryId,
      businessDate: formatDbDate(source.tipEntry.businessDate),
      paymentMethod: source.tipEntry.paymentMethod.code,
      paymentMethodName: source.tipEntry.paymentMethod.name,
      amount: Number(source.amount),
    })),
    dailySources: pool.dailyOperationSources.map((source) => ({
      operationId: source.operationId,
      businessDate: formatDbDate(source.operation.businessDate),
      cardTipAmount: Number(source.operation.cardTipAmount),
      cashTipAmount: Number(source.operation.cashTipAmount),
      amount: Number(source.amount),
    })),
    reconciled:
      linesTotal.equals(pool.totalAmount) &&
      sourcesTotal.plus(dailySourcesTotal).equals(pool.totalAmount),
    calculatedBy: {
      id: pool.calculatedBy.id,
      name: fullName(pool.calculatedBy),
    },
    calculatedAt: pool.calculatedAt,
    updatedAt: pool.updatedAt,
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
    hoursWorked: receipt.hoursWorked?.toFixed(2) ?? null,
    amount: Number(receipt.amount),
    paymentDate: formatDbDate(receipt.paymentDate),
    paidBy: { id: receipt.paidById, name: receipt.paidByName },
    detail: parseReceiptDetail(receipt.detail),
    createdAt: receipt.createdAt,
  };
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

// Cálculo y vista previa del reparto de propinas (SPRINT-3-T12, regla
// equitativa desde SPRINT-4R-T04). Genera la foto del reparto en estado DRAFT
// a partir de las operaciones diarias del período: el fondo de cada día se
// divide entre sus participantes y se acumula por trabajador. El contador la
// observa, la confirma y la marca como pagada, lo que emite una constancia
// por trabajador (SPRINT-3-T13). Los repartos proporcionales históricos se
// conservan y siguen su ciclo sin recalcularse con la regla antigua.
@Injectable()
export class TipPoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
  ) {}

  async preview(
    dto: CalculateTipPoolDto,
    currentUser: AuthUser,
  ): Promise<TipPoolPreviewResult> {
    if (!canAccessStore(currentUser, dto.storeId)) {
      throw new ForbiddenException('No tienes acceso a este local');
    }
    const period = this.parsePeriod(dto);
    await this.stores.assertActive(dto.storeId);
    try {
      return await this.prisma.$transaction((tx) =>
        this.calculateAndSave(
          tx,
          dto.storeId,
          period,
          dto.expectedVersion,
          currentUser,
        ),
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

  async findPeriod(
    dto: PreviewTipPoolDto,
    user: AuthUser,
  ): Promise<TipPoolResponse[]> {
    const period = this.parsePeriod(dto);
    if (!canAccessStore(user, dto.storeId)) throw new ForbiddenException();
    const pools = await this.prisma.tipPool.findMany({
      where: {
        storeId: dto.storeId,
        periodStart: period.startDate,
        periodEnd: period.endDate,
      },
      select: TIP_POOL_SELECT,
    });
    return pools.map(toTipPoolResponse);
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
      if (current.rule === 'EQUAL_SHARES') {
        await this.assertEqualPoolCurrent(tx, current);
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
          hoursWorked:
            receipt.hoursWorked === null
              ? null
              : new Prisma.Decimal(receipt.hoursWorked),
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

  // PDF de la constancia generado al vuelo desde la foto guardada. La fecha de
  // emisión es la de la constancia (created_at): cada descarga entrega el
  // mismo documento, byte a byte.
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
    const content = await renderTipReceiptPdf(response, response.createdAt);
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

  // Confirmar exige que la foto equitativa siga vigente: recalcula con las
  // operaciones diarias del período (bloqueadas FOR UPDATE, igual que la
  // corrección de la operación) y compara fuentes y líneas. Una operación
  // corregida, agregada o con otra selección desde el cálculo hace que la
  // foto ya no corresponda: se pide recalcular en vez de confirmar montos
  // obsoletos. Desde CONFIRMED los triggers de T02 congelan esas fuentes.
  private async assertEqualPoolCurrent(
    tx: Prisma.TransactionClient,
    pool: TipPoolResponse,
  ): Promise<void> {
    const operations = await this.loadPeriodOperations(tx, pool.store.id, {
      start: pool.periodStart,
      end: pool.periodEnd,
      startDate: dbDay(pool.periodStart),
      endDate: dbDay(pool.periodEnd),
    });
    const issues = validateEqualPoolSources({
      periodStart: pool.periodStart,
      periodEnd: pool.periodEnd,
      currentPoolId: pool.id,
      operations,
    });
    if (issues.length > 0) {
      throw new UnprocessableEntityException(STALE_POOL_MESSAGE);
    }
    const distribution = this.distribute(operations);
    const sameSources =
      distribution.days.length === pool.dailySources.length &&
      distribution.days.every((day) =>
        pool.dailySources.some(
          (source) =>
            source.operationId === day.operationId &&
            source.amount === day.fundAmount,
        ),
      );
    const sameLines =
      distribution.lines.length === pool.lines.length &&
      distribution.lines.every((line) =>
        pool.lines.some(
          (current) =>
            current.userId === line.userId && current.amount === line.amount,
        ),
      );
    if (!sameSources || !sameLines) {
      throw new UnprocessableEntityException(STALE_POOL_MESSAGE);
    }
  }

  // Bloquea y lee las operaciones diarias del período con su selección. La
  // corrección de una operación (PATCH /daily-operations/:id) bloquea la
  // misma fila, así que no cambian entre la lectura y la foto.
  private async loadPeriodOperations(
    tx: Prisma.TransactionClient,
    storeId: string,
    period: PoolPeriod,
  ): Promise<DailyOperationCandidate[]> {
    await tx.$queryRaw`
      SELECT id FROM daily_operations
      WHERE store_id = ${storeId}::uuid
        AND business_date BETWEEN ${period.start}::date AND ${period.end}::date
      FOR UPDATE`;
    const operations = await tx.dailyOperation.findMany({
      where: {
        storeId,
        businessDate: { gte: period.startDate, lte: period.endDate },
      },
      select: {
        id: true,
        businessDate: true,
        tipFundAmount: true,
        participants: { select: { workerId: true } },
        poolSource: { select: { poolId: true } },
      },
      orderBy: { businessDate: 'asc' },
    });
    return operations.map((operation) => ({
      id: operation.id,
      businessDate: formatDbDate(operation.businessDate),
      tipFundAmount: Number(operation.tipFundAmount),
      participantIds: operation.participants.map(
        (participant) => participant.workerId,
      ),
      usedByPoolId: operation.poolSource?.poolId ?? null,
    }));
  }

  // La validación previa ya descartó los días sin participantes: un error del
  // calculador aquí es un dato inconsistente, no un caso de negocio.
  private distribute(
    operations: readonly DailyOperationCandidate[],
  ): EqualDailyDistributionResult {
    try {
      return calculateEqualDailyDistribution(
        operations.map((operation) => ({
          operationId: operation.id,
          businessDate: operation.businessDate,
          fundAmount: operation.tipFundAmount,
          participantIds: operation.participantIds,
        })),
      );
    } catch (error) {
      if (error instanceof EqualDistributionError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }

  private async calculateAndSave(
    tx: Prisma.TransactionClient,
    storeId: string,
    period: PoolPeriod,
    expectedVersion: number | undefined,
    currentUser: AuthUser,
  ): Promise<TipPoolPreviewResult> {
    // Serializa los cálculos del local: dos vistas previas simultáneas (del
    // mismo período o de períodos solapados) se ejecutan una tras otra.
    // NO KEY UPDATE no bloquea a quien solo referencia el local, pero sí
    // espera al alta de una operación diaria (que bloquea el local FOR
    // UPDATE), así que una operación nueva no queda fuera de la foto.
    await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId}::uuid FOR NO KEY UPDATE`;
    const locked = await tx.$queryRaw<ExistingPoolRow[]>`
      SELECT id, status::text AS status, version, notes FROM tip_pools
      WHERE store_id = ${storeId}::uuid
        AND period_start = ${period.start}::date
        AND period_end = ${period.end}::date
      FOR UPDATE`;
    const existing = locked.at(0) ?? null;
    if (existing && existing.status !== 'DRAFT') {
      throw new ConflictException(
        `El reparto del período ya está ${existing.status === 'PAID' ? 'pagado' : 'confirmado'} y no puede recalcularse`,
      );
    }
    // Recalcular con control de versión: quien revisó una foto anterior no
    // la reemplaza a ciegas (expectedVersion es opcional para no romper a
    // los clientes que aún no lo envían; la versión sube igual).
    if (
      existing &&
      expectedVersion !== undefined &&
      existing.version !== expectedVersion
    ) {
      throw conflict(VERSION_CONFLICT_MESSAGE, {
        id: existing.id,
        store_id: storeId,
        status: existing.status,
        version: existing.version,
      });
    }

    const operations = await this.loadPeriodOperations(tx, storeId, period);
    const issues = validateEqualPoolSources({
      periodStart: period.start,
      periodEnd: period.end,
      currentPoolId: existing?.id ?? null,
      operations,
    });
    if (issues.length > 0) {
      const body: TipPoolValidationErrorBody = {
        statusCode: 422,
        message: 'No se puede calcular el reparto del período',
        issues,
      };
      throw new UnprocessableEntityException(body);
    }
    const distribution = this.distribute(operations);

    // Todo cálculo nuevo es equitativo y no usa pacto: agreement_id queda
    // NULL y la foto registra la regla (los triggers la leen para exigir
    // horas NULL en líneas y constancias).
    const poolData = {
      status: 'DRAFT' as const,
      totalAmount: new Prisma.Decimal(distribution.totalAmount),
      notes: null,
      agreementId: null,
      agreementSnapshot: equalSharesSnapshot(),
      calculatedById: currentUser.id,
      calculatedAt: new Date(),
    };
    let poolId: string;
    if (existing) {
      // Reemplaza la foto del borrador conservando su ID. Un borrador
      // proporcional histórico también se reemplaza: sus registros diarios
      // antiguos quedan libres y la foto nueva sale de las operaciones.
      poolId = existing.id;
      await tx.tipPoolLine.deleteMany({ where: { poolId } });
      await tx.tipPoolSource.deleteMany({ where: { poolId } });
      await tx.tipPoolDailyOperationSource.deleteMany({ where: { poolId } });
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

    // Fuentes y líneas guardan copia de los montos: si después se corrige
    // una operación del borrador, la foto no cambia hasta recalcular (y
    // confirmar exige recalcular primero). La base exige que cada fuente
    // concilie con el tip_fund_amount de su operación.
    await tx.tipPoolDailyOperationSource.createMany({
      data: distribution.days.map((day) => ({
        poolId,
        operationId: day.operationId,
        amount: BigInt(day.fundAmount),
      })),
    });
    await tx.tipPoolLine.createMany({
      data: distribution.lines.map((line) => ({
        poolId,
        userId: line.userId,
        workHoursRecordId: null,
        hoursWorked: null,
        amount: new Prisma.Decimal(line.amount),
      })),
    });

    const pool = await tx.tipPool.findUniqueOrThrow({
      where: { id: poolId },
      select: TIP_POOL_SELECT,
    });
    return {
      pool: toTipPoolResponse(pool),
      created: !existing,
      previousNotes: existing?.notes ?? null,
    };
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
