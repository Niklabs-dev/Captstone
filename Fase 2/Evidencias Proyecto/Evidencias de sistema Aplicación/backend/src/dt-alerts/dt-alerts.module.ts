import { Module } from '@nestjs/common';
import { DtAlertsController } from './dt-alerts.controller.js';
import { DtAlertsService } from './dt-alerts.service.js';

// Alertas de registro de documentos laborales en la DT (SPRINT-2-T08).
@Module({
  controllers: [DtAlertsController],
  providers: [DtAlertsService],
})
export class DtAlertsModule {}
