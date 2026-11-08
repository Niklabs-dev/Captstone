import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CashClosingsModule } from './cash-closings/cash-closings.module.js';
import { DailyOperationsModule } from './daily-operations/daily-operations.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { DtAlertsModule } from './dt-alerts/dt-alerts.module.js';
import { PayrollModule } from './payroll/payroll.module.js';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SalesDashboardModule } from './sales-dashboard/sales-dashboard.module.js';
import { SalesImportsModule } from './sales-imports/sales-imports.module.js';
import { StoresModule } from './stores/stores.module.js';
import { TipsModule } from './tips/tips.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    StoresModule,
    DocumentsModule,
    DtAlertsModule,
    PayrollModule,
    PaymentMethodsModule,
    TipsModule,
    CashClosingsModule,
    DailyOperationsModule,
    SalesDashboardModule,
    SalesImportsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
