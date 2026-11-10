import { Module } from '@nestjs/common';
import { DailyTipsController } from './daily-tips.controller.js';
import { DailyTipsExportService } from './daily-tips-export.service.js';
import { DailyTipsService } from './daily-tips.service.js';
import { MyTipReceiptsController } from './my-tip-receipts.controller.js';
import { MyTipReceiptsService } from './my-tip-receipts.service.js';
import { StoresModule } from '../stores/stores.module.js';
import { TipPaymentAlertsController } from './tip-payment-alerts.controller.js';
import { TipPaymentAlertsService } from './tip-payment-alerts.service.js';
import { TipPaymentBatchesController } from './tip-payment-batches.controller.js';
import { TipPaymentBatchesService } from './tip-payment-batches.service.js';
import { TipPoolsController } from './tip-pools.controller.js';
import { TipPoolsService } from './tip-pools.service.js';
import { TipsController } from './tips.controller.js';
import { TipsService } from './tips.service.js';

// Registro diario (SPRINT-3-T10), reparto por período (SPRINT-3-T12, histórico
// de solo lectura desde SPRINT-4A-T08) y alerta legal (SPRINT-3-T14): todas se
// derivan de los registros diarios del mismo módulo.
// La consulta de propinas diarias por trabajador (SPRINT-4A-T04) vive aquí y
// se exporta para el portal; la reutilizan la exportación Excel
// (SPRINT-4A-T05, DailyTipsExportService) y el pago por período
// (SPRINT-4A-T06, TipPaymentBatchesService).
@Module({
  imports: [StoresModule],
  controllers: [
    DailyTipsController,
    TipPaymentBatchesController,
    MyTipReceiptsController,
    TipsController,
    TipPoolsController,
    TipPaymentAlertsController,
  ],
  providers: [
    DailyTipsService,
    DailyTipsExportService,
    TipPaymentBatchesService,
    MyTipReceiptsService,
    TipsService,
    TipPoolsService,
    TipPaymentAlertsService,
  ],
  // La consulta consolidada (SPRINT-4-T13) reutiliza la alerta legal.
  exports: [TipPaymentAlertsService, DailyTipsService],
})
export class TipsModule {}
