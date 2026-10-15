import { Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

// Módulo de almacenamiento de archivos (SPRINT-2-T04). Sin controller: lo
// importa el módulo de documentos para usar StorageService.
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
