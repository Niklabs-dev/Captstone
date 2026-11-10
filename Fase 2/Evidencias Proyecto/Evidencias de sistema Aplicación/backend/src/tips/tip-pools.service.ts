import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseCalendarDate } from '../audit/utils/business-day.util.js';
import { STORE_FORBIDDEN_MESSAGE } from '../auth/constants/forbidden-messages.constants.js';
import { canAccessStore } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListTipPoolsQueryDto } from './dto/list-tip-pools-query.dto.js';
import {
  buildReceiptFileName,
  renderTipReceiptPdf,
} from './receipts/tip-receipt-pdf.js';
import { parseReceiptDetail } from './receipts/tip-receipt-snapshot.js';
import type {
  TipAgreementSnapshot,
  TipPoolPersonResponse,
  TipPoolReceiptResponse,
  TipPoolResponse,
  TipPoolRule,
  TipPoolStatusCode,
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

const STATUS_LABEL: Record<TipPoolStatusCode, string> = {
  DRAFT: 'en borrador',
  CONFIRMED: 'confirmado',
  PAID: 'pagado',
};

export interface TipPoolReceiptFile {
  receiptId: string;
  storeId: string;
  fileName: string;
  content: Buffer;
}

interface PoolPeriod {
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

// Repartos de propinas por período: histórico de solo lectura desde
// SPRINT-4A-T08. Se calculaban como borrador (SPRINT-3-T12, regla equitativa
// desde SPRINT-4R-T04), el contador los observaba, confirmaba y pagaba, y el
// pago emitía una constancia por trabajador (SPRINT-3-T13). Ese flujo se
// retiró: las propinas se reparten al guardar la operación diaria y se pagan
// por lote (SPRINT-4A-T03 y T06), así que un pago por aquí dejaría las
// propinas diarias del período sin pagar y permitiría pagarlas dos veces. Se
// conservan la consulta de los repartos guardados y la descarga de las
// constancias de los pagados.
@Injectable()
export class TipPoolsService {
  constructor(private readonly prisma: PrismaService) {}

  // Sin filtros lista todos los repartos visibles, del período más reciente
  // al más antiguo; con local o período exacto acota la consulta.
  async findAll(
    dto: ListTipPoolsQueryDto,
    user: AuthUser,
  ): Promise<TipPoolResponse[]> {
    const period = this.parsePeriod(dto);
    if (dto.storeId !== undefined && !canAccessStore(user, dto.storeId))
      throw new ForbiddenException(STORE_FORBIDDEN_MESSAGE);
    const pools = await this.prisma.tipPool.findMany({
      where: {
        ...(dto.storeId === undefined ? {} : { storeId: dto.storeId }),
        ...(period
          ? { periodStart: period.startDate, periodEnd: period.endDate }
          : {}),
      },
      select: TIP_POOL_SELECT,
      orderBy: [
        { periodStart: 'desc' },
        { periodEnd: 'desc' },
        { store: { name: 'asc' } },
        { id: 'asc' },
      ],
    });
    return pools
      .filter((pool) => canAccessStore(user, pool.store.id))
      .map(toTipPoolResponse);
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
        `Solo los repartos pagados tienen constancias; el reparto está ${STATUS_LABEL[pool.status]}`,
      );
    }
  }

  // El período es opcional, pero periodStart y periodEnd van juntos.
  private parsePeriod(dto: ListTipPoolsQueryDto): PoolPeriod | null {
    if (dto.periodStart === undefined && dto.periodEnd === undefined) {
      return null;
    }
    const start =
      dto.periodStart === undefined ? null : parseCalendarDate(dto.periodStart);
    const end =
      dto.periodEnd === undefined ? null : parseCalendarDate(dto.periodEnd);
    if (!start || !end) {
      throw new BadRequestException(
        'periodStart y periodEnd se envían juntos como fechas válidas con formato YYYY-MM-DD',
      );
    }
    const startDate = toDbDate(start);
    const endDate = toDbDate(end);
    if (endDate < startDate) {
      throw new BadRequestException(
        'periodEnd no puede ser anterior a periodStart',
      );
    }
    return { startDate, endDate };
  }
}
