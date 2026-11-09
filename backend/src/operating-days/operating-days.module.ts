import { Module } from '@nestjs/common';
import { StoresModule } from '../stores/stores.module.js';
import { OperatingCalendarController } from './operating-calendar.controller.js';
import { OperatingDaysService } from './operating-days.service.js';
import { SalesDaysController } from './sales-days.controller.js';

// Calendario de operación de los locales y estado diario de ventas
// importadas (SPRINT-4R-T12).
@Module({
  imports: [StoresModule],
  controllers: [OperatingCalendarController, SalesDaysController],
  providers: [OperatingDaysService],
  exports: [OperatingDaysService],
})
export class OperatingDaysModule {}
