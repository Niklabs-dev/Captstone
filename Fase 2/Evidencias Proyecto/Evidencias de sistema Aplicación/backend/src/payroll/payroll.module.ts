import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MulterModule,
  type MulterModuleOptions,
} from '@nestjs/platform-express';
import { maxUploadBytes } from '../documents/utils/upload-limits.util.js';
import { StorageModule } from '../storage/storage.module.js';
import { StoresModule } from '../stores/stores.module.js';
import { PayrollController } from './payroll.controller.js';
import { PayrollService } from './payroll.service.js';

// Liquidaciones de sueldo (SPRINT-2-T13 carga, SPRINT-2-T14 publicación,
// SPRINT-2-T15 portal del trabajador).
@Module({
  imports: [
    StorageModule,
    StoresModule,
    // Igual que el gestor documental: archivo en memoria (file.buffer) con
    // el límite de DOCUMENTS_MAX_SIZE_MB, que corta la subida con 413.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): MulterModuleOptions => ({
        limits: {
          fileSize: maxUploadBytes(config.get<string>('DOCUMENTS_MAX_SIZE_MB')),
          files: 1,
        },
        defParamCharset: 'utf8',
      }),
    }),
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
})
export class PayrollModule {}
