import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuditEvent } from './types/audit.types.js';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Persiste el evento en audit_logs. Un fallo de escritura no interrumpe la
  // operación auditada: se registra el error en el log y se continúa.
  async record(event: AuditEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId,
          detail:
            event.detail === null
              ? Prisma.DbNull
              : (event.detail as Prisma.InputJsonValue),
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          userId: event.userId,
          storeId: event.storeId,
        },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo registrar la auditoría de ${event.action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
