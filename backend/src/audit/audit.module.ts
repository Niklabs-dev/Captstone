import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditService } from './audit.service.js';

@Module({
  providers: [
    AuditService,
    // Interceptor global: audita los endpoints marcados con @Audited().
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
