import { ConflictException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/types/auth.types.js';
import { formatDbDate } from '../documents/utils/document-dates.util.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sumTipAmounts } from './calculation/daily-tips-aggregation.js';
import { DailyTipsService } from './daily-tips.service.js';
import type { TipPaymentPeriodDto } from './dto/tip-payment-batch.dto.js';
import type {
  TipPaymentBatchListResponse,
  TipPaymentBatchResponse,
} from './types/daily-tips.types.js';

export const NO_PENDING_TIPS_MESSAGE =
  'No hay propinas pendientes de pago en el período';

const CHANGED_DURING_PAYMENT_MESSAGE =
  'Las propinas del período cambiaron mientras se registraba el pago; vuelve a intentarlo';

const BATCH_SELECT = {
  id: true,
  periodStart: true,
  periodEnd: true,
  totalAmount: true,
  allocationCount: true,
  paidAt: true,
  store: { select: { id: true, name: true } },
  paidBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.TipPaymentBatchSelect;

type BatchRecord = Prisma.TipPaymentBatchGetPayload<{
  select: typeof BATCH_SELECT;
}>;

function toResponse(
  record: BatchRecord,
  workerCount: number,
): TipPaymentBatchResponse {
  return {
    id: record.id,
    store: record.store,
    periodStart: formatDbDate(record.periodStart),
    periodEnd: formatDbDate(record.periodEnd),
    totalAmount: Number(record.totalAmount),
    allocationCount: record.allocationCount,
    workerCount,
    paidBy: {
      id: record.paidBy.id,
      name: `${record.paidBy.firstName} ${record.paidBy.lastName}`,
    },
    paidAt: record.paidAt,
  };
}

// Pago por período de las propinas diarias (SPRINT-4A-T06): un lote marca
// como Pagadas todas las propinas No pagadas del local en el período y queda
// como registro inmutable (local, período, total, cantidad, quién y cuándo;
// triggers de SPRINT-4A-T02). Desde ese momento la operación diaria de esos
// días ya no admite corregir montos ni participantes (SPRINT-4A-T03 responde
// 409). Solo ADMINISTRADOR y CONTADOR (roles globales, lo aplica el
// controller). No toca los repartos por período (tip_pools), que siguen
// como históricos. Revertir un pago no está en este alcance.
@Injectable()
export class TipPaymentBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyTips: DailyTipsService,
  ) {}

  // Registra el pago en una transacción con bloqueo: la fila del local
  // serializa los pagos del local (y las altas de operaciones diarias, que
  // bloquean la misma fila) y las operaciones del período bloqueadas FOR
  // UPDATE serializan sus correcciones. Así dos solicitudes simultáneas o un
  // doble clic no duplican el pago: la segunda espera, ya no encuentra
  // propinas pendientes y responde 409 sin crear el lote.
  async pay(
    dto: TipPaymentPeriodDto,
    currentUser: AuthUser,
  ): Promise<TipPaymentBatchResponse> {
    const range = this.dailyTips.parseRange(dto.from, dto.to);
    await this.dailyTips.findStore(dto.storeId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${dto.storeId}::uuid FOR UPDATE`;
      await tx.$queryRaw`
        SELECT id FROM daily_operations
        WHERE store_id = ${dto.storeId}::uuid
          AND business_date BETWEEN ${range.from}::date AND ${range.to}::date
        ORDER BY id
        FOR UPDATE`;
      const pending = await this.dailyTips.findAllocations(
        dto.storeId,
        range,
        'UNPAID',
        tx,
      );
      if (pending.length === 0) {
        throw new ConflictException(NO_PENDING_TIPS_MESSAGE);
      }
      const { totalAmount } = sumTipAmounts(pending);
      const batch = await tx.tipPaymentBatch.create({
        data: {
          storeId: dto.storeId,
          periodStart: range.fromDate,
          periodEnd: range.toDate,
          totalAmount: BigInt(totalAmount),
          allocationCount: pending.length,
          paidById: currentUser.id,
          paidAt: new Date(),
        },
        select: { id: true },
      });
      // Solo las mismas filas leídas y aún No pagadas: las pagadas no se
      // modifican (además, la base las declara inmutables).
      const marked = await tx.dailyTipAllocation.updateMany({
        where: {
          id: { in: pending.map((tip) => tip.id) },
          status: 'UNPAID',
        },
        data: { status: 'PAID', paymentBatchId: batch.id },
      });
      if (marked.count !== pending.length) {
        throw new ConflictException(CHANGED_DURING_PAYMENT_MESSAGE);
      }
      const record = await tx.tipPaymentBatch.findUniqueOrThrow({
        where: { id: batch.id },
        select: BATCH_SELECT,
      });
      return toResponse(
        record,
        new Set(pending.map((tip) => tip.worker.id)).size,
      );
    });
  }

  // Historial de pagos del local: lotes cuyo período se cruza con el rango
  // consultado (incluidos los históricos migrados de los repartos por
  // período), del más reciente al más antiguo.
  async list(query: TipPaymentPeriodDto): Promise<TipPaymentBatchListResponse> {
    const range = this.dailyTips.parseRange(query.from, query.to);
    await this.dailyTips.findStore(query.storeId);
    const records = await this.prisma.tipPaymentBatch.findMany({
      where: {
        storeId: query.storeId,
        periodStart: { lte: range.toDate },
        periodEnd: { gte: range.fromDate },
      },
      select: BATCH_SELECT,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    const workerCounts = new Map<string, number>();
    if (records.length > 0) {
      const pairs = await this.prisma.dailyTipAllocation.groupBy({
        by: ['paymentBatchId', 'workerId'],
        where: { paymentBatchId: { in: records.map((record) => record.id) } },
      });
      for (const pair of pairs) {
        if (pair.paymentBatchId === null) continue;
        workerCounts.set(
          pair.paymentBatchId,
          (workerCounts.get(pair.paymentBatchId) ?? 0) + 1,
        );
      }
    }
    return {
      batches: records.map((record) =>
        toResponse(record, workerCounts.get(record.id) ?? 0),
      ),
    };
  }
}
