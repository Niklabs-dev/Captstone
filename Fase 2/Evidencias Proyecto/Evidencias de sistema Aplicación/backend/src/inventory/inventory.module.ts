import { Module } from '@nestjs/common';
import { InventoryTemplateController } from './inventory-template.controller.js';
import { InventoryTemplateService } from './inventory-template.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

// Módulo de inventario (SPRINT-5): catálogo de productos y estructura de la
// plantilla (SPRINT-5-T03); las tomas de inventario (SPRINT-5-T05 y T06) se
// agregan aquí.
@Module({
  controllers: [InventoryTemplateController, ProductsController],
  providers: [ProductsService, InventoryTemplateService],
  exports: [ProductsService, InventoryTemplateService],
})
export class InventoryModule {}
