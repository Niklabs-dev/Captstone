import { Injectable } from '@nestjs/common';
import { BUSINESS_TIME_ZONE } from '../audit/utils/business-day.util.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { DtAlertsService } from '../dt-alerts/dt-alerts.service.js';
import { SalesReportsService } from '../sales-reports/sales-reports.service.js';
import type { ImportStatusInfo } from '../sales-reports/types/sales-reports.types.js';
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

function countAlerts(alerts: StoreAlert[], storeId: string): AlertCounts {
  const own = alerts.filter((alert) => alert.store.id === storeId);
  return {
    overdue: own.filter((alert) => alert.status === 'OVERDUE').length,
    upcoming: own.filter((alert) => alert.status === 'UPCOMING').length,
  };
}

// Día en que el local debía entregar Excel y operación diaria: abrió según
// su calendario o igual tiene Excel vigente. Los días CERRADO y los que no se
// informan (sin calendario o antes del inicio del seguimiento, SPRINT-4R-T12)
// nunca cuentan como faltantes.
function isExpectedDay(store: StoreDashboard): boolean {
  const { status } = store.importStatus;
  return status !== null && status !== 'CERRADO';
}

function sumCounts(left: AlertCounts, right: AlertCounts): AlertCounts {
  return {
    overdue: left.overdue + right.overdue,
    upcoming: left.upcoming + right.upcoming,
  };
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
    // invierno ya es el día siguiente en UTC. Una fecha futura la rechaza la
    // validación del rango (400).
    const businessDate =
      query.date ?? formatDbDate(toDbDate(businessDateOf(now)));
    const [consolidated, dtAlerts, tipAlerts] = await Promise.all([
      this.salesReports.consolidate(
        { from: businessDate, to: businessDate },
        now,
      ),
      this.dtAlerts.list(currentUser),
      this.tipPaymentAlerts.list(currentUser),
    ]);

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
          dtRegistration: countAlerts(dtAlerts.items, report.store.id),
          tipPayment: countAlerts(tipAlerts.items, report.store.id),
        },
      };
    });
    const none: AlertCounts = { overdue: 0, upcoming: 0 };
    const expected = stores.filter(isExpectedDay);

    return {
      businessDate,
      today: consolidated.today,
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
        dtRegistrationAlerts: stores
          .map((store) => store.alerts.dtRegistration)
          .reduce(sumCounts, none),
        tipPaymentAlerts: stores
          .map((store) => store.alerts.tipPayment)
          .reduce(sumCounts, none),
      },
    };
  }
}
