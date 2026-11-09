import { Module } from '@nestjs/common';
import { OperatingDaysModule } from '../operating-days/operating-days.module.js';
import { SalesReportsController } from './sales-reports.controller.js';
import { SalesReportsService } from './sales-reports.service.js';

// Reportes de ventas importadas y diferencias por período y local
// (SPRINT-4R-T13). Reutiliza el estado diario de importación de
// OperatingDaysModule (SPRINT-4R-T12) y exporta la consolidación para el
// panel (/sales-dashboard).
@Module({
  imports: [OperatingDaysModule],
  controllers: [SalesReportsController],
  providers: [SalesReportsService],
  exports: [SalesReportsService],
})
export class SalesReportsModule {}
