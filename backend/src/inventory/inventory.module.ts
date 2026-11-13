import { Module } from '@nestjs/common';
import { InventoryCountsController } from './inventory-counts.controller.js';
import { InventoryCountsService } from './inventory-counts.service.js';
import { InventoryTemplateController } from './inventory-template.controller.js';
import { InventoryTemplateService } from './inventory-template.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

// Módulo de inventario (SPRINT-5): catálogo de productos y estructura de la
// plantilla (SPRINT-5-T03) y tomas de inventario (SPRINT-5-T05; la
// finalización, SPRINT-5-T06, se agrega aquí).
@Module({
  controllers: [
    InventoryTemplateController,
    ProductsController,
    InventoryCountsController,
  ],
  providers: [
    ProductsService,
    InventoryTemplateService,
    InventoryCountsService,
  ],
  exports: [ProductsService, InventoryTemplateService, InventoryCountsService],
})
export class InventoryModule {}
