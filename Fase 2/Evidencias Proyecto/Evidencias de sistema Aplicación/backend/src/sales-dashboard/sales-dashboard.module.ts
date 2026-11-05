import { Module } from '@nestjs/common';
import { DtAlertsModule } from '../dt-alerts/dt-alerts.module.js';
import { TipsModule } from '../tips/tips.module.js';
import { SalesDashboardController } from './sales-dashboard.controller.js';
import { SalesDashboardService } from './sales-dashboard.service.js';

// Consulta consolidada de ventas, alertas y diferencias por local
// (SPRINT-4-T13): reutiliza las alertas de la DT y de propinas tal cual las
// calculan sus módulos.
@Module({
  imports: [DtAlertsModule, TipsModule],
  controllers: [SalesDashboardController],
  providers: [SalesDashboardService],
})
export class SalesDashboardModule {}
