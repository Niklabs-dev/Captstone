import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { DtAlertsModule } from './dt-alerts/dt-alerts.module.js';
import { PayrollModule } from './payroll/payroll.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
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
    TipsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
