import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { canAccessStore } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { parseCalendarDate } from '../audit/utils/business-day.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  latestOverdueBusinessDate,
  parseTipAlertHolidays,
  parseTipLegalPaymentDays,
  summarizeTipPaymentAlerts,
  tipPaymentDaysOverdue,
  tipPaymentDeadline,
  type TipHolidayCalendar,
} from './alerts/tip-payment-deadline.js';
import type {
  TipPaymentAlert,
  TipPaymentAlertCollection,
} from './types/tip-payment-alerts.types.js';

// Alerta legal de pago de propinas (SPRINT-4A-T22). Reemplaza la alerta de
// SPRINT-3-T14, que se calculaba sobre los registros históricos tip_entries
// y solo se resolvía al pagar un reparto por período (retirado en
// SPRINT-4A-T08): esos registros ya no alertan, pero no se borran.
//
// La fuente es daily_tip_allocations: cada propina diaria No pagada cuya
// fecha de negocio superó los días hábiles de TIP_LEGAL_PAYMENT_DAYS genera
// una alerta, agrupada por local y trabajador. Al pagarla en un lote
// (SPRINT-4A-T06) pasa a Pagada y deja de aparecer. No se guarda como fila:
// se calcula en cada consulta con la fecha de Chile.
@Injectable()
export class TipPaymentAlertsService {
  private readonly holidays: TipHolidayCalendar;
  private readonly legalPaymentDays: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.holidays = parseTipAlertHolidays(
      config.get<string>('TIP_ALERT_HOLIDAYS'),
    );
    this.legalPaymentDays = parseTipLegalPaymentDays(
      config.get<string>('TIP_LEGAL_PAYMENT_DAYS'),
    );
  }

  async list(
    currentUser: AuthUser,
    now: Date = new Date(),
  ): Promise<TipPaymentAlertCollection> {
    const today = businessDateOf(now);
    const overdueThrough = latestOverdueBusinessDate(
      today,
      this.legalPaymentDays,
      this.holidays,
    );
    const groups = await this.prisma.dailyTipAllocation.groupBy({
      by: ['storeId', 'workerId'],
      where: {
        status: 'UNPAID',
        businessDate: { lte: toDbDate(overdueThrough) },
      },
      _count: { _all: true },
      _sum: { amount: true },
      _min: { businessDate: true },
      _max: { businessDate: true },
    });
    // Hoy solo consultan roles globales; un rol de local vería solo el suyo.
    const visible = groups.filter((group) =>
      canAccessStore(currentUser, group.storeId),
    );
    const [stores, workers] = await Promise.all([
      this.prisma.store.findMany({
        where: { id: { in: [...new Set(visible.map((g) => g.storeId))] } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(visible.map((g) => g.workerId))] } },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    const storeNames = new Map(stores.map((store) => [store.id, store.name]));
    const workerNames = new Map(
      workers.map((worker) => [
        worker.id,
        `${worker.firstName} ${worker.lastName}`,
      ]),
    );

    const items = visible
      .map((group): TipPaymentAlert => {
        const oldest = group._min.businessDate;
        const newest = group._max.businessDate;
        if (!oldest || !newest) {
          throw new Error('El grupo de propinas vencidas no tiene fechas');
        }
        const oldestText = formatDbDate(oldest);
        const oldestDate = parseCalendarDate(oldestText);
        if (!oldestDate) {
          throw new Error(`La fecha ${oldestText} de la propina no es válida`);
        }
        const deadline = tipPaymentDeadline(
          oldestDate,
          this.legalPaymentDays,
          this.holidays,
        );
        return {
          store: {
            id: group.storeId,
            name: storeNames.get(group.storeId) ?? '',
          },
          worker: {
            id: group.workerId,
            name: workerNames.get(group.workerId) ?? '',
          },
          allocationCount: group._count._all,
          amount: Number(group._sum.amount ?? 0n),
          oldestBusinessDate: oldestText,
          newestBusinessDate: formatDbDate(newest),
          deadline: formatDbDate(toDbDate(deadline)),
          daysOverdue: tipPaymentDaysOverdue(deadline, today),
        };
      })
      .sort(compareAlerts);

    return {
      legalPaymentDays: this.legalPaymentDays,
      asOf: formatDbDate(toDbDate(today)),
      overdueThrough: formatDbDate(toDbDate(overdueThrough)),
      items,
      totals: summarizeTipPaymentAlerts(items),
      calculatedAt: now,
    };
  }
}

// Primero las de mayor atraso; luego por local, trabajador e IDs (estable).
function compareAlerts(left: TipPaymentAlert, right: TipPaymentAlert): number {
  return (
    right.daysOverdue - left.daysOverdue ||
    left.store.name.localeCompare(right.store.name, 'es') ||
    left.worker.name.localeCompare(right.worker.name, 'es') ||
    left.store.id.localeCompare(right.store.id) ||
    left.worker.id.localeCompare(right.worker.id)
  );
}
