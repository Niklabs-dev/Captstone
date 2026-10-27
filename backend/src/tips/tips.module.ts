import { Module } from '@nestjs/common';
import { StoresModule } from '../stores/stores.module.js';
import { TipPoolsController } from './tip-pools.controller.js';
import { TipPoolsService } from './tip-pools.service.js';
import { TipsController } from './tips.controller.js';
import { TipsService } from './tips.service.js';

// Registro diario (SPRINT-3-T10) y cálculo del reparto (SPRINT-3-T12): el
// reparto se arma desde los registros diarios del mismo módulo.
@Module({
  imports: [StoresModule],
  controllers: [TipsController, TipPoolsController],
  providers: [TipsService, TipPoolsService],
})
export class TipsModule {}
