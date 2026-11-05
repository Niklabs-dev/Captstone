import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BUSINESS_TIME_ZONE,
  businessDayRange,
  parseCalendarDate,
  type CalendarDate,
} from '../audit/utils/business-day.util.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { DtAlertsService } from '../dt-alerts/dt-alerts.service.js';
import { PaymentMethod, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TipPaymentAlertsService } from '../tips/tip-payment-alerts.service.js';
import {
  buildSalesDashboard,
  type CardTipInput,
  type SaleGroupInput,
} from './calculation/sales-dashboard.aggregator.js';
import type { SalesDashboardQueryDto } from './dto/sales-dashboard-query.dto.js';
import type { SalesDashboard } from './types/sales-dashboard.types.js';

const CARD_PAYMENT_METHODS = [
  PaymentMethod.DEBIT_CARD,
  PaymentMethod.CREDIT_CARD,
];

// Consulta consolidada de ventas, alertas y diferencias por local
// (SPRINT-4-T13, E1-H4). Solo lee: concilia las cifras desde las fuentes
// existentes (ventas, registro de propinas, cierres de caja de SPRINT-4-T09 y
// los servicios de alertas) sin copiarlas ni recalcular sus reglas.
@Injectable()
export class SalesDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dtAlerts: DtAlertsService,
    private readonly tipPaymentAlerts: TipPaymentAlertsService,
  ) {}

  async get(
    query: SalesDashboardQueryDto,
    currentUser: AuthUser,
  ): Promise<SalesDashboard> {
    const calculatedAt = new Date();
    const date = this.resolveDate(query.date, calculatedAt);
    const { start, end } = businessDayRange(date, date);
    if (!start || !end) {
      throw new Error('No se pudo calcular el rango del día de negocio');
    }
    const businessDate = toDbDate(date);

    const [stores, saleGroups, tipGroups, closings, dtAlerts, tipAlerts] =
      await Promise.all([
        this.prisma.store.findMany({
          select: { id: true, name: true, city: true, isActive: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        // Ventas del día en hora de Chile: [inicio del día, inicio del
        // siguiente). cashClosingId distingue lo ya conciliado en un cierre.
        this.prisma.sale.groupBy({
          by: ['storeId', 'paymentMethod', 'cashClosingId'],
          where: { soldAt: { gte: start, lt: end } },
          _count: { _all: true },
          _sum: { grossAmount: true, tipAmount: true },
        }),
        this.prisma.tipEntry.groupBy({
          by: ['storeId'],
          where: {
            businessDate,
            paymentMethod: { in: CARD_PAYMENT_METHODS },
          },
          _sum: { amount: true },
        }),
        this.prisma.cashClosing.findMany({
          where: { businessDate },
          select: {
            id: true,
            storeId: true,
            shift: true,
            status: true,
            openingCash: true,
            mrcomandaNetSales: true,
            mercadoPagoGrossAmount: true,
            mercadoPagoTipAmount: true,
            reconciliationDifference: true,
            differenceReason: true,
            closedAt: true,
            lines: {
              select: {
                expectedAmount: true,
                countedAmount: true,
                difference: true,
              },
            },
          },
        }),
        this.dtAlerts.list(currentUser),
        this.tipPaymentAlerts.list(currentUser),
      ]);

    const sales: SaleGroupInput[] = saleGroups.map((group) => ({
      storeId: group.storeId,
      paymentMethod: group.paymentMethod,
      closed: group.cashClosingId !== null,
      salesCount: group._count._all,
      grossAmount: group._sum.grossAmount ?? zero(),
      tipAmount: group._sum.tipAmount ?? zero(),
    }));
    const cardTips: CardTipInput[] = tipGroups.map((group) => ({
      storeId: group.storeId,
      amount: group._sum.amount ?? zero(),
    }));

    const consolidated = buildSalesDashboard({
      stores,
      sales,
      cardTips,
      closings,
      dtAlerts: dtAlerts.items.map((alert) => ({
        storeId: alert.store.id,
        status: alert.status,
      })),
      tipAlerts: tipAlerts.items.map((alert) => ({
        storeId: alert.store.id,
        status: alert.status,
      })),
    });

    return {
      businessDate: formatDbDate(businessDate),
      timeZone: BUSINESS_TIME_ZONE,
      periodStart: start,
      periodEnd: end,
      calculatedAt,
      ...consolidated,
    };
  }

  // Sin fecha se consulta el día actual en Chile: pasadas las 21:00 en
  // invierno ya es el día siguiente en UTC.
  private resolveDate(value: string | undefined, now: Date): CalendarDate {
    if (value === undefined) return businessDateOf(now);
    const date = parseCalendarDate(value);
    if (!date) {
      throw new BadRequestException(
        'date debe ser una fecha válida con formato YYYY-MM-DD',
      );
    }
    return date;
  }
}

// Prisma devuelve null en _sum cuando no hay filas que sumar.
function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}
