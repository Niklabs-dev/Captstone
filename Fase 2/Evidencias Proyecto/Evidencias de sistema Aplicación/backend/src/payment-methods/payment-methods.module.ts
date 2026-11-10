import { Module } from '@nestjs/common';
import { PaymentMethodAliasesController } from './aliases/payment-method-aliases.controller.js';
import { PaymentMethodAliasesService } from './aliases/payment-method-aliases.service.js';
import { PaymentMethodsController } from './payment-methods.controller.js';
import { PaymentMethodsService } from './payment-methods.service.js';

@Module({
  controllers: [PaymentMethodsController, PaymentMethodAliasesController],
  providers: [PaymentMethodsService, PaymentMethodAliasesService],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
