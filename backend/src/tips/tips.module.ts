import { Module } from '@nestjs/common';
import { StoresModule } from '../stores/stores.module.js';
import { TipPaymentAlertsController } from './tip-payment-alerts.controller.js';
import { TipPaymentAlertsService } from './tip-payment-alerts.service.js';
import { TipPoolsController } from './tip-pools.controller.js';
import { TipPoolsService } from './tip-pools.service.js';
import { TipsController } from './tips.controller.js';
import { TipsService } from './tips.service.js';

// Registro diario (SPRINT-3-T10), reparto (SPRINT-3-T12) y alerta legal
// (SPRINT-3-T14): todas se derivan de los registros diarios del mismo módulo.
@Module({
  imports: [StoresModule],
  controllers: [TipsController, TipPoolsController, TipPaymentAlertsController],
  providers: [TipsService, TipPoolsService, TipPaymentAlertsService],
})
export class TipsModule {}
