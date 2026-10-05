import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';
import type {
  AuditEvent,
  AuditLogPage,
  AuditLogResponse,
} from './types/audit.types.js';
import {
  businessDayRange,
  parseCalendarDate,
  type CalendarDate,
} from './utils/business-day.util.js';

const AUDIT_LOG_INCLUDE = {
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  store: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogInclude;

type AuditLogWithRelations = Prisma.AuditLogGetPayload<{
  include: typeof AUDIT_LOG_INCLUDE;
}>;

// El detalle siempre se escribe como objeto (AuditService.record); cualquier
// otro valor JSON se envuelve para no perderlo.
function toDetail(value: Prisma.JsonValue): Record<string, unknown> | null {
  if (value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  return { value };
}

function toAuditLogResponse(log: AuditLogWithRelations): AuditLogResponse {
  return {
    id: log.id.toString(),
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    detail: toDetail(log.detail),
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    createdAt: log.createdAt,
    user: log.user,
    store: log.store,
  };
}

function parseDateFilter(
  value: string | undefined,
  field: string,
): CalendarDate | null {
  if (value === undefined) return null;
  const date = parseCalendarDate(value);
  if (!date) {
    throw new BadRequestException(`${field} no es una fecha válida`);
  }
  return date;
}

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

  // Consulta paginada de la auditoría (SPRINT-1-T14), filtrable por local y
  // por rango de días de negocio (hora de Chile), del más reciente al más
  // antiguo.
  async findAll(query: ListAuditLogsQueryDto): Promise<AuditLogPage> {
    const from = parseDateFilter(query.from, 'from');
    const to = parseDateFilter(query.to, 'to');
    const { start, end } = businessDayRange(from, to);
    if (start && end && start >= end) {
      throw new BadRequestException('from no puede ser posterior a to');
    }

    const where: Prisma.AuditLogWhereInput = {
      storeId: query.storeId,
      createdAt: start || end ? { gte: start, lt: end } : undefined,
    };

    const [total, logs] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: AUDIT_LOG_INCLUDE,
        // El id desempata registros con la misma marca de tiempo.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
      }),
    ]);

    return {
      items: logs.map(toAuditLogResponse),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
