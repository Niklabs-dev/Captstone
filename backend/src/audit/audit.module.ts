import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessDeniedAuditFilter } from './access-denied.filter.js';
import { AuditController } from './audit.controller.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditService } from './audit.service.js';

@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    // Interceptor global: audita los endpoints marcados con @Audited().
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Filtro global: audita todo 403 de guards y servicios (SPRINT-4R-T15).
    { provide: APP_FILTER, useClass: AccessDeniedAuditFilter },
  ],
  exports: [AuditService],
})
export class AuditModule {}
