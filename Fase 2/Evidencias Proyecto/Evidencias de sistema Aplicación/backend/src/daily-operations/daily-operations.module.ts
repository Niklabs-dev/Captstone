import { Module } from '@nestjs/common';
import { StoresModule } from '../stores/stores.module.js';
import { DailyOperationsController } from './daily-operations.controller.js';
import { DailyOperationsService } from './daily-operations.service.js';
import { DailyVoucherStorageService } from './daily-voucher-storage.service.js';

// Operación diaria por local y fecha (SPRINT-4R-T01): registro transaccional
// con voucher fotográfico privado, idempotencia por clave natural y
// descarga autorizada del voucher.
@Module({
  imports: [StoresModule],
  controllers: [DailyOperationsController],
  providers: [DailyOperationsService, DailyVoucherStorageService],
})
export class DailyOperationsModule {}
