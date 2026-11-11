import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BUSINESS_TIME_ZONE,
  parseCalendarDate,
} from '../audit/utils/business-day.util.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { DtAlertsService } from '../dt-alerts/dt-alerts.service.js';
import { SalesReportsService } from '../sales-reports/sales-reports.service.js';
import type { ImportStatusInfo } from '../sales-reports/types/sales-reports.types.js';
import { summarizeTipPaymentAlerts } from '../tips/alerts/tip-payment-deadline.js';
import { TipPaymentAlertsService } from '../tips/tip-payment-alerts.service.js';
import type { SalesDashboardQueryDto } from './dto/sales-dashboard-query.dto.js';
import type {
  AlertCounts,
  SalesDashboard,
  StoreDashboard,
} from './types/sales-dashboard.types.js';

// Panel consolidado del administrador (SPRINT-4R-T13, E1-H4): un día de
// negocio en hora de Chile agrupado por local. Reutiliza la consolidación de
// los reportes (ventas de la importación vigente, operación diaria y estado
// de importación de SPRINT-4R-T12) y agrega las alertas legales vigentes de
// la DT y de entrega de propinas tal como las calculan sus módulos. Solo lee.

const NOT_REPORTED: ImportStatusInfo = {
  status: null,
  activeImportId: null,
  pendingImportId: null,
  closure: null,
};

interface StoreAlert {
  store: { id: string };
  status: string;
}

function countAlerts(alerts: StoreAlert[]): AlertCounts {
  return {
    overdue: alerts.filter((alert) => alert.status === 'OVERDUE').length,
    upcoming: alerts.filter((alert) => alert.status === 'UPCOMING').length,
  };
}

function ownAlerts<T extends { store: { id: string } }>(
  alerts: readonly T[],
  storeId: string,
): T[] {
  return alerts.filter((alert) => alert.store.id === storeId);
}

// Día en que el local debía entregar Excel y operación diaria: abrió según
// su calendario o igual tiene Excel vigente. Los días CERRADO y los que no se
// informan (sin calendario o antes del inicio del seguimiento, SPRINT-4R-T12)
// nunca cuentan como faltantes.
function isExpectedDay(store: StoreDashboard): boolean {
  const { status } = store.importStatus;
  return status !== null && status !== 'CERRADO';
}

@Injectable()
export class SalesDashboardService {
  constructor(
    private readonly salesReports: SalesReportsService,
    private readonly dtAlerts: DtAlertsService,
    private readonly tipPaymentAlerts: TipPaymentAlertsService,
  ) {}

  async get(
    query: SalesDashboardQueryDto,
    currentUser: AuthUser,
    now: Date = new Date(),
  ): Promise<SalesDashboard> {
    // Sin fecha se consulta el día actual en Chile: pasadas las 21:00 en
    // invierno ya es el día siguiente en UTC. La fecha se valida antes de
    // consultar nada, y el error nombra el parámetro `date` del endpoint.
    const today = formatDbDate(toDbDate(businessDateOf(now)));
    const businessDate = query.date ?? today;
    if (parseCalendarDate(businessDate) === null) {
      throw new BadRequestException(
        'date debe ser una fecha válida con formato YYYY-MM-DD',
      );
    }
    if (businessDate > today) {
      throw new BadRequestException(
        `date no puede ser posterior a hoy (${today}, hora de Chile)`,
      );
    }
    const [dtAlerts, tipAlerts] = await Promise.all([
      this.dtAlerts.list(currentUser),
      this.tipPaymentAlerts.list(currentUser, now),
    ]);
    // Ninguna alerta se pierde: un local con alertas aparece en el panel
    // aunque esté inactivo y sin datos del día.
    const alertStoreIds = [...dtAlerts.items, ...tipAlerts.items].map(
      (alert) => alert.store.id,
    );
    const consolidated = await this.salesReports.consolidate(
      { from: businessDate, to: businessDate },
      now,
      alertStoreIds,
    );

    const stores = consolidated.stores.map((report): StoreDashboard => {
      const day = report.days.find(
        (item) => item.businessDate === businessDate,
      );
      return {
        store: report.store,
        importStatus: day?.importStatus ?? NOT_REPORTED,
        sales: day?.sales ?? null,
        dailyOperation: day?.dailyOperation ?? null,
        alerts: {
          dtRegistration: countAlerts(
            ownAlerts(dtAlerts.items, report.store.id),
          ),
          // Propinas diarias vencidas sin pagar (SPRINT-4A-T22): monto,
          // días y atraso del local, no solo una cuenta.
          tipPayment: summarizeTipPaymentAlerts(
            ownAlerts(tipAlerts.items, report.store.id),
          ),
        },
      };
    });
    const expected = stores.filter(isExpectedDay);

    return {
      businessDate,
      today: consolidated.today,
      // Las alertas legales no son históricas: siempre son las vigentes hoy,
      // aunque businessDate sea un día pasado.
      alertsAsOf: today,
      tipLegalPaymentDays: tipAlerts.legalPaymentDays,
      timeZone: BUSINESS_TIME_ZONE,
      calculatedAt: now,
      paymentMethods: consolidated.paymentMethods,
      stores,
      cashDifferences: consolidated.cashDifferences,
      totals: {
        sales: consolidated.totals.sales,
        storesWithoutImport: expected.filter((store) => store.sales === null)
          .length,
        tips: consolidated.totals.tips,
        storesWithoutDailyOperation: expected.filter(
          (store) => store.dailyOperation === null,
        ).length,
        cashDifferences: consolidated.totals.cashDifferences,
        importStatus: consolidated.totals.importStatus,
        // Todas las alertas vigentes, no solo las de los locales listados.
        dtRegistrationAlerts: countAlerts(dtAlerts.items),
        tipPaymentAlerts: tipAlerts.totals,
      },
    };
  }
}
