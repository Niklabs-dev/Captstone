import { Module } from '@nestjs/common';
import { DtAlertsController } from './dt-alerts.controller.js';
import { DtAlertsService } from './dt-alerts.service.js';

// Alertas de registro de documentos laborales en la DT (SPRINT-2-T08). Se
// exporta el servicio para la consulta consolidada (SPRINT-4-T13).
@Module({
  controllers: [DtAlertsController],
  providers: [DtAlertsService],
  exports: [DtAlertsService],
})
export class DtAlertsModule {}
