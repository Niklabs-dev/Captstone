import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

// Módulo de inventario (SPRINT-5): catálogo de productos (SPRINT-5-T03); las
// tomas de inventario (SPRINT-5-T05 y T06) se agregan aquí.
@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class InventoryModule {}
