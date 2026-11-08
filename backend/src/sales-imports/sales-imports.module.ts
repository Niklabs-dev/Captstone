import { Module } from '@nestjs/common';
import { SalesImportResolverService } from './sales-import-resolver.service.js';

// Módulo de importación diaria de ventas MrComanda. SPRINT-4R-T09 aporta la
// lectura del Excel (src/sales-imports/parser) y la resolución contra las
// equivalencias de SPRINT-4R-T08; el controller de previsualización y
// confirmación llega con SPRINT-4R-T10.
@Module({
  providers: [SalesImportResolverService],
  exports: [SalesImportResolverService],
})
export class SalesImportsModule {}
