import { Module } from '@nestjs/common';
import { SalesImportResolverService } from './sales-import-resolver.service.js';
import { SalesImportStorageService } from './sales-import-storage.service.js';
import { SalesImportsController } from './sales-imports.controller.js';
import { SalesImportsService } from './sales-imports.service.js';

// Importación diaria de ventas MrComanda: lectura del Excel y resolución de
// equivalencias (SPRINT-4R-T09) y API de vista previa, confirmación,
// descarte, consulta y descarga privada del archivo (SPRINT-4R-T10).
@Module({
  controllers: [SalesImportsController],
  providers: [
    SalesImportResolverService,
    SalesImportStorageService,
    SalesImportsService,
  ],
  exports: [SalesImportResolverService, SalesImportsService],
})
export class SalesImportsModule {}
