import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseCalendarDate } from '../audit/utils/business-day.util.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  addDays,
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StoresService } from '../stores/stores.service.js';
import {
  type IsoWeekday,
  type OperatingCalendar,
  salesDayStatus,
  type SalesDayStatus,
} from './calculation/sales-day-status.js';
import type {
  CreateStoreClosureDto,
  ListSalesDaysQueryDto,
  UpdateOperatingCalendarDto,
} from './dto/operating-days-request.dto.js';
import {
  DEFAULT_SALES_DAYS_RANGE,
  MAX_SALES_DAYS_RANGE,
  type OperatingCalendarResponse,
  type SalesDayItem,
  type SalesDaysResponse,
  type StoreClosureResponse,
} from './types/operating-days.types.js';

// Calendario de operación de los locales y estado diario de ventas
// (SPRINT-4R-T12). El estado se calcula al consultar (regla pura en
// calculation/sales-day-status.ts), sin guardar alertas: cada local y fecha
// aparece una sola vez y una importación tardía lo resuelve sin pasos
// manuales. El aviso vive solo en el panel administrativo: no hay correos,
// push ni recordatorios.

const PERSON_SELECT = {
  select: { id: true, firstName: true, lastName: true },
} as const;

const SCHEDULE_SELECT = {
  storeId: true,
  opensMonday: true,
  opensTuesday: true,
  opensWednesday: true,
  opensThursday: true,
  opensFriday: true,
  opensSaturday: true,
  opensSunday: true,
  trackingStartDate: true,
  updatedAt: true,
  updatedBy: PERSON_SELECT,
} satisfies Prisma.StoreOperatingScheduleSelect;

const CLOSURE_SELECT = {
  id: true,
  closureDate: true,
  reason: true,
  createdAt: true,
  createdBy: PERSON_SELECT,
} satisfies Prisma.StoreClosureSelect;

type ScheduleRecord = Prisma.StoreOperatingScheduleGetPayload<{
  select: typeof SCHEDULE_SELECT;
}>;
type ClosureRecord = Prisma.StoreClosureGetPayload<{
  select: typeof CLOSURE_SELECT;
}>;

// Orden de las columnas del calendario según el día ISO (1 = lunes).
const WEEKDAY_FIELDS = [
  ['opensMonday', 1],
  ['opensTuesday', 2],
  ['opensWednesday', 3],
  ['opensThursday', 4],
  ['opensFriday', 5],
  ['opensSaturday', 6],
  ['opensSunday', 7],
] as const;

type WeekdayFlags = Record<(typeof WEEKDAY_FIELDS)[number][0], boolean>;

const MS_PER_DAY = 86_400_000;

function personName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

function weekdaysOf(schedule: WeekdayFlags): IsoWeekday[] {
  return WEEKDAY_FIELDS.filter(([field]) => schedule[field]).map(
    ([, weekday]) => weekday,
  );
}

function flagsOf(weekdays: readonly number[]): WeekdayFlags {
  const open = new Set(weekdays);
  return Object.fromEntries(
    WEEKDAY_FIELDS.map(([field, weekday]) => [field, open.has(weekday)]),
  ) as WeekdayFlags;
}

function toClosure(record: ClosureRecord): StoreClosureResponse {
  return {
    id: record.id,
    date: formatDbDate(record.closureDate),
    reason: record.reason,
    createdAt: record.createdAt,
    createdBy: {
      id: record.createdBy.id,
      name: personName(record.createdBy),
    },
  };
}

// Fecha YYYY-MM-DD ya validada por el DTO como valor de columna DATE.
function dbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function shiftDays(isoDate: string, days: number): string {
  const date = parseCalendarDate(isoDate);
  if (!date) throw new Error(`Fecha inválida: ${isoDate}`);
  return formatDbDate(toDbDate(addDays(date, days)));
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (dbDate(to).getTime() - dbDate(from).getTime()) / MS_PER_DAY,
  );
}

function emptySummary(): Record<SalesDayStatus, number> {
  return { IMPORTADO: 0, PENDIENTE: 0, ATRASADO: 0, CERRADO: 0 };
}

@Injectable()
export class OperatingDaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
  ) {}

  async getCalendar(storeId: string): Promise<OperatingCalendarResponse> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true },
    });
    if (!store) throw new NotFoundException('Local no encontrado');
    const [schedule, closures] = await Promise.all([
      this.prisma.storeOperatingSchedule.findUnique({
        where: { storeId },
        select: SCHEDULE_SELECT,
      }),
      this.prisma.storeClosure.findMany({
        where: { storeId },
        orderBy: { closureDate: 'desc' },
        select: CLOSURE_SELECT,
      }),
    ]);
    return {
      store,
      configured: schedule !== null,
      weekdays: schedule ? weekdaysOf(schedule) : [],
      trackingStartDate: schedule
        ? formatDbDate(schedule.trackingStartDate)
        : null,
      updatedAt: schedule?.updatedAt ?? null,
      updatedBy: schedule
        ? { id: schedule.updatedBy.id, name: personName(schedule.updatedBy) }
        : null,
      closures: closures.map(toClosure),
    };
  }

  // Crea o reemplaza el calendario del local. Devuelve también la
  // configuración anterior para auditar el cambio.
  async updateCalendar(
    storeId: string,
    dto: UpdateOperatingCalendarDto,
    currentUser: AuthUser,
  ): Promise<{
    calendar: OperatingCalendarResponse;
    previous: { weekdays: IsoWeekday[]; trackingStartDate: string } | null;
  }> {
    await this.stores.assertActive(storeId);
    const previous = await this.prisma.storeOperatingSchedule.findUnique({
      where: { storeId },
      select: SCHEDULE_SELECT,
    });
    const data = {
      ...flagsOf(dto.weekdays),
      trackingStartDate: dbDate(dto.trackingStartDate),
      updatedById: currentUser.id,
    };
    await this.prisma.storeOperatingSchedule.upsert({
      where: { storeId },
      update: data,
      create: { storeId, ...data },
    });
    return {
      calendar: await this.getCalendar(storeId),
      previous: previous
        ? {
            weekdays: weekdaysOf(previous),
            trackingStartDate: formatDbDate(previous.trackingStartDate),
          }
        : null,
    };
  }

  async addClosure(
    storeId: string,
    dto: CreateStoreClosureDto,
    currentUser: AuthUser,
  ): Promise<StoreClosureResponse> {
    await this.stores.assertActive(storeId);
    const closureDate = dbDate(dto.date);
    const conflict = (existingClosureId: string | null): ConflictException =>
      new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: `El local ya tiene un cierre registrado el ${dto.date}`,
        existingClosureId,
      });

    // El duplicado se detecta antes de insertar; el índice único resuelve
    // además una carrera entre dos registros simultáneos.
    const existing = await this.prisma.storeClosure.findUnique({
      where: { storeId_closureDate: { storeId, closureDate } },
      select: { id: true },
    });
    if (existing) throw conflict(existing.id);
    try {
      const created = await this.prisma.storeClosure.create({
        data: {
          storeId,
          closureDate,
          reason: dto.reason,
          createdById: currentUser.id,
        },
        select: CLOSURE_SELECT,
      });
      return toClosure(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.storeClosure.findUnique({
          where: { storeId_closureDate: { storeId, closureDate } },
          select: { id: true },
        });
        throw conflict(winner?.id ?? null);
      }
      throw error;
    }
  }

  // Quita una excepción de cierre (por ejemplo, registrada por error): el
  // día vuelve a evaluarse con el calendario semanal.
  async removeClosure(
    storeId: string,
    closureId: string,
  ): Promise<StoreClosureResponse> {
    const closure = await this.prisma.storeClosure.findFirst({
      where: { id: closureId, storeId },
      select: CLOSURE_SELECT,
    });
    if (!closure) {
      throw new NotFoundException('Cierre no encontrado para este local');
    }
    await this.prisma.storeClosure.delete({ where: { id: closureId } });
    return toClosure(closure);
  }

  // Estado de ventas por local y día en un rango (nunca después de hoy).
  async listSalesDays(
    query: ListSalesDaysQueryDto,
    now: Date = new Date(),
  ): Promise<SalesDaysResponse> {
    const today = formatDbDate(toDbDate(businessDateOf(now)));
    const to = query.to !== undefined && query.to < today ? query.to : today;
    const from = query.from ?? shiftDays(to, -DEFAULT_SALES_DAYS_RANGE);
    if (from > to) {
      throw new BadRequestException(
        'from no puede ser posterior a to ni al día de hoy',
      );
    }
    if (daysBetween(from, to) + 1 > MAX_SALES_DAYS_RANGE) {
      throw new BadRequestException(
        `El rango no puede superar ${MAX_SALES_DAYS_RANGE} días`,
      );
    }
    if (query.storeId !== undefined) {
      const exists = await this.prisma.store.findUnique({
        where: { id: query.storeId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Local no encontrado');
    }

    // Solo locales activos: uno inactivo no genera alertas.
    const stores = await this.prisma.store.findMany({
      where: { isActive: true, id: query.storeId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const storeIds = stores.map((store) => store.id);
    const range = { gte: dbDate(from), lte: dbDate(to) };
    const [schedules, closures, imports] = await Promise.all([
      this.prisma.storeOperatingSchedule.findMany({
        where: { storeId: { in: storeIds } },
        select: SCHEDULE_SELECT,
      }),
      this.prisma.storeClosure.findMany({
        where: { storeId: { in: storeIds }, closureDate: range },
        select: { id: true, storeId: true, closureDate: true, reason: true },
      }),
      this.prisma.salesImport.findMany({
        where: {
          storeId: { in: storeIds },
          businessDate: range,
          status: { in: ['ACTIVE', 'PENDING'] },
        },
        select: {
          id: true,
          storeId: true,
          businessDate: true,
          status: true,
          version: true,
        },
        orderBy: { version: 'asc' },
      }),
    ]);

    const calendars = new Map<string, OperatingCalendar>(
      schedules.map((schedule: ScheduleRecord) => [
        schedule.storeId,
        {
          openWeekdays: new Set(weekdaysOf(schedule)),
          trackingStartDate: formatDbDate(schedule.trackingStartDate),
        },
      ]),
    );
    const key = (storeId: string, date: Date): string =>
      `${storeId}|${formatDbDate(date)}`;
    const closureByDay = new Map(
      closures.map((closure) => [
        key(closure.storeId, closure.closureDate),
        { id: closure.id, reason: closure.reason },
      ]),
    );
    const activeByDay = new Map<string, string>();
    const pendingByDay = new Map<string, string>();
    for (const item of imports) {
      // Orden por versión ascendente: la última PENDING cargada prevalece.
      const target = item.status === 'ACTIVE' ? activeByDay : pendingByDay;
      target.set(key(item.storeId, item.businessDate), item.id);
    }

    const items: SalesDayItem[] = [];
    const summary = emptySummary();
    for (let date = to; date >= from; date = shiftDays(date, -1)) {
      for (const store of stores) {
        const dayKey = `${store.id}|${date}`;
        const activeImportId = activeByDay.get(dayKey) ?? null;
        const closure = closureByDay.get(dayKey) ?? null;
        const status = salesDayStatus({
          date,
          today,
          calendar: calendars.get(store.id) ?? null,
          hasClosure: closure !== null,
          hasActiveImport: activeImportId !== null,
        });
        if (status === null) continue;
        if (query.status !== undefined && status !== query.status) continue;
        summary[status] += 1;
        items.push({
          store,
          businessDate: date,
          status,
          activeImportId,
          pendingImportId: pendingByDay.get(dayKey) ?? null,
          closure,
        });
      }
    }
    return { today, from, to, summary, items };
  }
}
