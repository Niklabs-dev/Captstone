import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseCalendarDate } from '../audit/utils/business-day.util.js';
import { canAccessStore } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { formatDbDate } from '../documents/utils/document-dates.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  calculateTipPaymentDeadline,
  parseTipAlertHolidays,
  type TipHolidayCalendar,
} from './alerts/tip-payment-deadline.js';
import type {
  TipPaymentAlert,
  TipPaymentAlertCollection,
} from './types/tip-payment-alerts.types.js';

const TIP_PAYMENT_ALERT_SELECT = {
  id: true,
  businessDate: true,
  paymentMethod: true,
  amount: true,
  store: { select: { id: true, name: true } },
  poolSource: {
    select: {
      pool: {
        select: {
          id: true,
          status: true,
          periodStart: true,
          periodEnd: true,
        },
      },
    },
  },
} satisfies Prisma.TipEntrySelect;

type TipPaymentAlertRecord = Prisma.TipEntryGetPayload<{
  select: typeof TIP_PAYMENT_ALERT_SELECT;
}>;

@Injectable()
export class TipPaymentAlertsService {
  private readonly holidays: TipHolidayCalendar;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.holidays = parseTipAlertHolidays(
      config.get<string>('TIP_ALERT_HOLIDAYS'),
    );
  }

  async list(currentUser: AuthUser): Promise<TipPaymentAlertCollection> {
    const entries = await this.prisma.tipEntry.findMany({
      where: {
        paymentMethod: { in: ['DEBIT_CARD', 'CREDIT_CARD'] },
        OR: [
          { poolSource: null },
          { poolSource: { is: { pool: { status: { not: 'PAID' } } } } },
        ],
      },
      select: TIP_PAYMENT_ALERT_SELECT,
    });
    const calculatedAt = new Date();
    const items = entries
      .filter((entry) => canAccessStore(currentUser, entry.store.id))
      .map((entry) => toTipPaymentAlert(entry, calculatedAt, this.holidays))
      .sort(compareAlerts);
    return { items, calculatedAt };
  }
}

function toTipPaymentAlert(
  entry: TipPaymentAlertRecord,
  now: Date,
  holidays: TipHolidayCalendar,
): TipPaymentAlert {
  const businessDateText = formatDbDate(entry.businessDate);
  const businessDate = parseCalendarDate(businessDateText);
  if (!businessDate) {
    throw new Error(`La fecha del registro ${entry.id} no es válida`);
  }
  const deadline = calculateTipPaymentDeadline(businessDate, now, holidays);
  const pool = entry.poolSource?.pool;
  return {
    id: entry.id,
    tipEntryId: entry.id,
    store: entry.store,
    businessDate: businessDateText,
    paymentMethod: entry.paymentMethod,
    amount: Number(entry.amount),
    pool: pool
      ? {
          id: pool.id,
          status: pool.status,
          periodStart: formatDbDate(pool.periodStart),
          periodEnd: formatDbDate(pool.periodEnd),
        }
      : null,
    ...deadline,
  };
}

function compareAlerts(left: TipPaymentAlert, right: TipPaymentAlert): number {
  const leftStatus = left.status === 'OVERDUE' ? 0 : 1;
  const rightStatus = right.status === 'OVERDUE' ? 0 : 1;
  return (
    leftStatus - rightStatus ||
    left.deadline.localeCompare(right.deadline) ||
    left.id.localeCompare(right.id)
  );
}
