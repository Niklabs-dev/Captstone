import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseCalendarDate } from '../audit/utils/business-day.util.js';
import { STORE_FORBIDDEN_MESSAGE } from '../auth/constants/forbidden-messages.constants.js';
import { canAccessStore } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  daysBetween,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  settlementStatus,
  sumTipAmounts,
  summarizeByWorker,
} from './calculation/daily-tips-aggregation.js';
import type {
  DailyTipDayQueryDto,
  DailyTipsRangeQueryDto,
  DailyTipsSummaryQueryDto,
} from './dto/daily-tips-query.dto.js';
import {
  MAX_DAILY_TIPS_RANGE_DAYS,
  type DailyTipAllocationFact,
  type DailyTipDayDetailResponse,
  type DailyTipDaySummary,
  type DailyTipDaysResponse,
  type DailyTipStore,
  type DailyTipSummaryResponse,
  type TipAllocationStatusCode,
} from './types/daily-tips.types.js';
import type { MyTipDay } from './types/my-tips.types.js';

type Client = Prisma.TransactionClient | PrismaService;

/// Rango de días de negocio validado (ambos extremos incluidos).
export interface DailyTipsRange {
  from: string;
  to: string;
  fromDate: Date;
  toDate: Date;
}

const PERSON_SELECT = {
  select: { id: true, firstName: true, lastName: true },
} as const;

const ALLOCATION_SELECT = {
  id: true,
  operationId: true,
  businessDate: true,
  amount: true,
  status: true,
  paymentBatchId: true,
  worker: PERSON_SELECT,
} satisfies Prisma.DailyTipAllocationSelect;

type AllocationRecord = Prisma.DailyTipAllocationGetPayload<{
  select: typeof ALLOCATION_SELECT;
}>;

function toFact(record: AllocationRecord): DailyTipAllocationFact {
  return {
    id: record.id,
    operationId: record.operationId,
    businessDate: formatDbDate(record.businessDate),
    worker: {
      id: record.worker.id,
      name: `${record.worker.firstName} ${record.worker.lastName}`,
    },
    amount: Number(record.amount),
    status: record.status,
    paymentBatchId: record.paymentBatchId,
  };
}

// Orden estable de las propinas de un día: por nombre, apellido e ID (el
// mismo de los participantes de la operación diaria).
const ALLOCATION_ORDER = [
  { worker: { firstName: 'asc' } },
  { worker: { lastName: 'asc' } },
  { worker: { id: 'asc' } },
] satisfies Prisma.DailyTipAllocationOrderByWithRelationInput[];

// Consulta de las propinas diarias por trabajador (SPRINT-4A-T04): total por
// día del local, detalle por trabajador de un día y resumen del período por
// trabajador. Solo lee: las propinas las genera la operación diaria
// (SPRINT-4A-T03). ADMINISTRADOR y CONTADOR consultan cualquier local; el
// SUPERVISOR solo el suyo (canAccessStore). La lectura de propinas
// (findAllocations) y la agregación (calculation/daily-tips-aggregation) son
// reutilizables por la exportación Excel (SPRINT-4A-T05), el pago por
// período (SPRINT-4A-T06), la vista de administración (SPRINT-4A-T07) y el
// portal del trabajador (SPRINT-4A-T09).
@Injectable()
export class DailyTipsService {
  constructor(private readonly prisma: PrismaService) {}

  // Total diario del local en el rango: un elemento por operación diaria
  // registrada (aunque su fondo sea 0) con total, pagado, pendiente,
  // participantes y estado del día; y los totales del rango.
  async listDays(
    query: DailyTipsRangeQueryDto,
    currentUser: AuthUser,
  ): Promise<DailyTipDaysResponse> {
    const range = this.parseRange(query.from, query.to);
    this.assertStoreAccess(query.storeId, currentUser);
    const store = await this.findStore(query.storeId);
    const operations = await this.prisma.dailyOperation.findMany({
      where: {
        storeId: query.storeId,
        businessDate: { gte: range.fromDate, lte: range.toDate },
      },
      select: {
        id: true,
        businessDate: true,
        tipFundAmount: true,
        _count: { select: { participants: true } },
        tipAllocations: { select: { amount: true, status: true } },
      },
      orderBy: { businessDate: 'asc' },
    });
    const days: DailyTipDaySummary[] = operations.map((operation) => {
      const allocations = operation.tipAllocations.map((tip) => ({
        amount: Number(tip.amount),
        status: tip.status,
      }));
      return {
        operationId: operation.id,
        businessDate: formatDbDate(operation.businessDate),
        tipFundAmount: Number(operation.tipFundAmount),
        participantCount: operation._count.participants,
        ...sumTipAmounts(allocations),
        status: settlementStatus(allocations),
      };
    });
    return {
      store,
      from: range.from,
      to: range.to,
      days,
      totals: {
        ...sumTipAmounts(
          operations.flatMap((operation) =>
            operation.tipAllocations.map((tip) => ({
              amount: Number(tip.amount),
              status: tip.status,
            })),
          ),
        ),
        dayCount: days.length,
      },
    };
  }

  // Detalle de un día: la propina de cada participante con su estado y, si
  // está pagada, el lote y la fecha de pago. 404 si el local no registró
  // operación ese día.
  async findDay(
    query: DailyTipDayQueryDto,
    currentUser: AuthUser,
  ): Promise<DailyTipDayDetailResponse> {
    const businessDate = this.parseDate(query.businessDate, 'businessDate');
    this.assertStoreAccess(query.storeId, currentUser);
    const store = await this.findStore(query.storeId);
    const operation = await this.prisma.dailyOperation.findUnique({
      where: {
        storeId_businessDate: { storeId: query.storeId, businessDate },
      },
      select: {
        id: true,
        businessDate: true,
        tipFundAmount: true,
        _count: { select: { participants: true } },
        tipAllocations: {
          select: {
            ...ALLOCATION_SELECT,
            paymentBatch: { select: { paidAt: true } },
          },
          orderBy: ALLOCATION_ORDER,
        },
      },
    });
    if (!operation) {
      throw new NotFoundException(
        'El local no tiene operación diaria registrada ese día',
      );
    }
    const allocations = operation.tipAllocations.map((record) => ({
      ...toFact(record),
      paidAt: record.paymentBatch?.paidAt ?? null,
    }));
    return {
      store,
      operationId: operation.id,
      businessDate: formatDbDate(operation.businessDate),
      tipFundAmount: Number(operation.tipFundAmount),
      participantCount: operation._count.participants,
      ...sumTipAmounts(allocations),
      status: settlementStatus(allocations),
      allocations: allocations.map((allocation) => ({
        id: allocation.id,
        worker: allocation.worker,
        amount: allocation.amount,
        status: allocation.status,
        paymentBatchId: allocation.paymentBatchId,
        paidAt: allocation.paidAt,
      })),
    };
  }

  // Resumen del período por trabajador: días con propina, total, pendiente
  // y pagado de cada uno, y el total general. Con status solo cuenta las
  // propinas de ese estado (ej. UNPAID: lo que falta pagar).
  async summarize(
    query: DailyTipsSummaryQueryDto,
    currentUser: AuthUser,
  ): Promise<DailyTipSummaryResponse> {
    const range = this.parseRange(query.from, query.to);
    this.assertStoreAccess(query.storeId, currentUser);
    const store = await this.findStore(query.storeId);
    const allocations = await this.findAllocations(
      query.storeId,
      range,
      query.status,
    );
    const workers = summarizeByWorker(allocations);
    return {
      store,
      from: range.from,
      to: range.to,
      status: query.status ?? null,
      workers,
      totals: {
        ...sumTipAmounts(allocations),
        workerCount: workers.length,
        dayCount: new Set(allocations.map((tip) => tip.operationId)).size,
      },
    };
  }

  // Propinas del local en el rango (opcionalmente de un estado), ordenadas
  // por fecha y nombre. Sin control de acceso: lo aplica quien la invoca.
  // Acepta un cliente de transacción para que el pago por período
  // (SPRINT-4A-T06) lea y marque las mismas filas en la misma transacción.
  async findAllocations(
    storeId: string,
    range: DailyTipsRange,
    status?: TipAllocationStatusCode,
    client: Client = this.prisma,
  ): Promise<DailyTipAllocationFact[]> {
    const records = await client.dailyTipAllocation.findMany({
      where: {
        storeId,
        businessDate: { gte: range.fromDate, lte: range.toDate },
        ...(status ? { status } : {}),
      },
      select: ALLOCATION_SELECT,
      orderBy: [{ businessDate: 'asc' }, ...ALLOCATION_ORDER],
    });
    return records.map(toFact);
  }

  // Propinas de una persona en el rango, en todos los locales donde
  // participó, con el local y la fecha de pago; de la más reciente a la más
  // antigua. Sin control de acceso: el portal del trabajador (SPRINT-4A-T09)
  // la invoca solo con el ID del JWT.
  async findWorkerAllocations(
    workerId: string,
    range: DailyTipsRange,
  ): Promise<MyTipDay[]> {
    const records = await this.prisma.dailyTipAllocation.findMany({
      where: {
        workerId,
        businessDate: { gte: range.fromDate, lte: range.toDate },
      },
      select: {
        id: true,
        businessDate: true,
        amount: true,
        status: true,
        paymentBatchId: true,
        store: { select: { id: true, name: true } },
        paymentBatch: { select: { paidAt: true } },
      },
      orderBy: [
        { businessDate: 'desc' },
        { store: { name: 'asc' } },
        { id: 'asc' },
      ],
    });
    return records.map((record) => ({
      id: record.id,
      businessDate: formatDbDate(record.businessDate),
      store: record.store,
      amount: Number(record.amount),
      status: record.status,
      paymentBatchId: record.paymentBatchId,
      paidAt: record.paymentBatch?.paidAt ?? null,
    }));
  }

  // Valida el rango: fechas reales, from no posterior a to y como máximo
  // MAX_DAILY_TIPS_RANGE_DAYS días corridos (ambos extremos incluidos).
  parseRange(from: string, to: string): DailyTipsRange {
    const fromDate = this.parseDate(from, 'from');
    const toDate = this.parseDate(to, 'to');
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('from no puede ser posterior a to');
    }
    const fromCalendar = parseCalendarDate(from);
    const toCalendar = parseCalendarDate(to);
    if (
      fromCalendar &&
      toCalendar &&
      daysBetween(fromCalendar, toCalendar) + 1 > MAX_DAILY_TIPS_RANGE_DAYS
    ) {
      throw new BadRequestException(
        `El rango no puede superar ${MAX_DAILY_TIPS_RANGE_DAYS} días`,
      );
    }
    return { from, to, fromDate, toDate };
  }

  private parseDate(value: string, field: string): Date {
    const parsed = parseCalendarDate(value);
    if (!parsed) {
      throw new BadRequestException(
        `${field} debe ser una fecha válida con formato YYYY-MM-DD`,
      );
    }
    return toDbDate(parsed);
  }

  // Local con id y nombre; 404 si no existe. Sin control de acceso: lo
  // aplica quien la invoca (también la exportación y el pago por período).
  async findStore(storeId: string): Promise<DailyTipStore> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true },
    });
    if (!store) {
      throw new NotFoundException('Local no encontrado');
    }
    return store;
  }

  private assertStoreAccess(storeId: string, currentUser: AuthUser): void {
    if (!canAccessStore(currentUser, storeId)) {
      throw new ForbiddenException(STORE_FORBIDDEN_MESSAGE);
    }
  }
}
