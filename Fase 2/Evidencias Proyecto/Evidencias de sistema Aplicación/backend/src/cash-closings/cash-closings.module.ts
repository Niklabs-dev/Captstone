import { Module } from '@nestjs/common';
import { StoresModule } from '../stores/stores.module.js';
import { CashClosingsController } from './cash-closings.controller.js';
import { CashClosingsService } from './cash-closings.service.js';

@Module({
  imports: [StoresModule],
  controllers: [CashClosingsController],
  providers: [CashClosingsService],
})
export class CashClosingsModule {}
