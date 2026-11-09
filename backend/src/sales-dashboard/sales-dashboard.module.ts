import { Module } from '@nestjs/common';
import { DtAlertsModule } from '../dt-alerts/dt-alerts.module.js';
import { SalesReportsModule } from '../sales-reports/sales-reports.module.js';
import { TipsModule } from '../tips/tips.module.js';
import { SalesDashboardController } from './sales-dashboard.controller.js';
import { SalesDashboardService } from './sales-dashboard.service.js';

// Panel consolidado del administrador (SPRINT-4R-T13): reutiliza la
// consolidación de los reportes de ventas (SalesReportsModule) y las alertas
// de la DT y de propinas tal cual las calculan sus módulos.
@Module({
  imports: [DtAlertsModule, TipsModule, SalesReportsModule],
  controllers: [SalesDashboardController],
  providers: [SalesDashboardService],
})
export class SalesDashboardModule {}
