import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BUSINESS_TIME_ZONE,
  businessDayRange,
  parseCalendarDate,
  type CalendarDate,
} from '../audit/utils/business-day.util.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { OperatingDaysService } from '../operating-days/operating-days.service.js';
import { MAX_SALES_DAYS_RANGE } from '../operating-days/types/operating-days.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  consolidateSales,
  type Consolidation,
} from './calculation/sales-consolidation.js';
import type { SalesReportQueryDto } from './dto/sales-reports-query.dto.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  LegacyBalanceStatus,
  LegacyClosingLineDifference,
  LegacySales,
  LegacySalesReport,
  SalesReport,
} from './types/sales-reports.types.js';

// Reportes de ventas y diferencias por período y local (SPRINT-4R-T13). Solo
// lee y concilia tres fuentes sin copiarlas ni recalcular sus reglas:
// - ventas: la versión vigente del Excel MrComanda (sales_imports ACTIVE con
//   is_current = TRUE) y sus líneas por medio de pago;
// - propinas y diferencia de efectivo: la operación diaria (daily_operations);
// - estado de importación diaria: OperatingDaysService.listSalesDays
//   (SPRINT-4R-T12), el mismo cálculo de GET /sales-days.
// Los cierres por turno y la tabla sales anteriores a SPRINT-4R-T01 solo se
// exponen en legacy(), separados del contrato vigente.

export const LEGACY_NOTICE =
  'Histórico previo a SPRINT-4R-T01 (solo lectura): cierres por turno con conciliación de vouchers y ventas de la tabla sales. No se mezcla con las ventas importadas ni con la diferencia de efectivo de la operación diaria.';

const MS_PER_DAY = 86_400_000;

export interface ReportRange {
  from: string;
  to: string;
  storeId?: string;
}

export interface ConsolidatedRange extends Consolidation {
  today: string;
}

function dbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function calendarDate(isoDate: string): CalendarDate {
  const date = parseCalendarDate(isoDate);
  if (!date) {
    throw new BadRequestException(
      'Las fechas deben tener el formato YYYY-MM-DD',
    );
  }
  return date;
}

// Montos BIGINT de CLP enteros: caben de sobra en un número seguro de JS.
function toAmount(value: bigint): number {
  return Number(value);
}

interface LegacyLine {
  paymentMethodId: string;
  expectedAmount: Prisma.Decimal;
  countedAmount: Prisma.Decimal;
  difference: Prisma.Decimal;
}

interface LegacyMethod {
  code: string;
  name: string;
  sortOrder: number;
}

// Estado y líneas descuadradas de un cierre histórico, como los calculaba el
// consolidado antiguo: la suma neta de las líneas puede ser 0 (-500 y +500)
// sin que el cierre cuadre, así que cada línea se evalúa por separado.
function legacyBalanceOf(
  lines: LegacyLine[],
  voucherDifference: Prisma.Decimal,
  methodById: ReadonlyMap<string, LegacyMethod>,
): {
  balanceStatus: LegacyBalanceStatus;
  lineDifferences: LegacyClosingLineDifference[];
} {
  const methodOf = (line: LegacyLine): LegacyMethod => {
    const method = methodById.get(line.paymentMethodId);
    if (!method) throw new Error('Cierre histórico sin medio de pago');
    return method;
  };
  const lineDifferences = lines
    .filter((line) => !line.difference.isZero())
    .map((line) => ({ line, method: methodOf(line) }))
    .sort(
      (left, right) =>
        left.method.sortOrder - right.method.sortOrder ||
        left.method.code.localeCompare(right.method.code),
    )
    .map(({ line, method }): LegacyClosingLineDifference => ({
      paymentMethod: method.code,
      paymentMethodName: method.name,
      expectedAmount: line.expectedAmount.toNumber(),
      countedAmount: line.countedAmount.toNumber(),
      difference: line.difference.toNumber(),
    }));
  const balanced = lineDifferences.length === 0 && voucherDifference.isZero();
  return {
    balanceStatus: balanced ? 'CUADRADO' : 'NO_CUADRADO',
    lineDifferences,
  };
}

@Injectable()
export class SalesReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operatingDays: OperatingDaysService,
  ) {}

  async report(
    query: SalesReportQueryDto,
    now: Date = new Date(),
  ): Promise<SalesReport> {
    const consolidated = await this.consolidate(query, now);
    return {
      from: query.from,
      to: query.to,
      today: consolidated.today,
      timeZone: BUSINESS_TIME_ZONE,
      storeId: query.storeId ?? null,
      calculatedAt: now,
      paymentMethods: consolidated.paymentMethods,
      stores: consolidated.stores,
      cashDifferences: consolidated.cashDifferences,
      totals: consolidated.totals,
    };
  }

  // Consolidación de un rango de días de negocio; también la usa el panel
  // (/sales-dashboard) para un solo día. `includeStoreIds` agrega locales que
  // deben aparecer aunque estén inactivos y sin datos (el panel: los que
  // tienen alertas legales vigentes).
  async consolidate(
    range: ReportRange,
    now: Date = new Date(),
    includeStoreIds: readonly string[] = [],
  ): Promise<ConsolidatedRange> {
    const today = this.validateRange(range, now);
    const consolidation = await this.snapshot((tx) =>
      this.readConsolidation(tx, range, now, includeStoreIds),
    );
    return { today, ...consolidation };
  }

  private async readConsolidation(
    tx: Prisma.TransactionClient,
    range: ReportRange,
    now: Date,
    includeStoreIds: readonly string[],
  ): Promise<Consolidation> {
    await this.assertStoreExists(range.storeId, tx);
    const dates = { gte: dbDate(range.from), lte: dbDate(range.to) };
    const storeFilter =
      range.storeId === undefined ? {} : { storeId: range.storeId };

    const [stores, paymentMethods, imports, pending, operations, salesDays] =
      await Promise.all([
        tx.store.findMany({
          where: range.storeId === undefined ? {} : { id: range.storeId },
          select: { id: true, name: true, city: true, isActive: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        tx.paymentMethod.findMany({
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        }),
        // Solo la versión vigente: PENDING y SUPERSEDED nunca son ventas.
        tx.salesImport.findMany({
          where: {
            ...storeFilter,
            businessDate: dates,
            status: 'ACTIVE',
            isCurrent: true,
          },
          select: {
            id: true,
            storeId: true,
            businessDate: true,
            version: true,
            confirmedAt: true,
            totalAmount: true,
            lines: {
              select: { paymentMethodId: true, amount: true },
              orderBy: { lineNumber: 'asc' },
            },
          },
        }),
        // Versiones cargadas sin confirmar: solo se informan como pendientes.
        tx.salesImport.findMany({
          where: { ...storeFilter, businessDate: dates, status: 'PENDING' },
          select: {
            id: true,
            storeId: true,
            businessDate: true,
            version: true,
          },
        }),
        tx.dailyOperation.findMany({
          where: { ...storeFilter, businessDate: dates },
          select: {
            id: true,
            storeId: true,
            businessDate: true,
            cardTipAmount: true,
            cashTipAmount: true,
            tipFundAmount: true,
            cashDifference: true,
            differenceReason: true,
          },
        }),
        this.operatingDays.listSalesDays(
          { from: range.from, to: range.to, storeId: range.storeId },
          now,
          tx,
        ),
      ]);

    // Un local inactivo solo aparece si tiene datos en el período o si quien
    // llama lo pide.
    const withData = new Set([
      ...imports.map((item) => item.storeId),
      ...operations.map((item) => item.storeId),
      ...includeStoreIds,
    ]);
    return consolidateSales({
      stores: stores.filter(
        (store) => store.isActive || withData.has(store.id),
      ),
      paymentMethods,
      imports: imports.map((item) => ({
        importId: item.id,
        storeId: item.storeId,
        businessDate: formatDbDate(item.businessDate),
        version: item.version,
        confirmedAt: item.confirmedAt,
        totalAmount: toAmount(item.totalAmount),
        lines: item.lines.map((line) => ({
          paymentMethodId: line.paymentMethodId,
          amount: toAmount(line.amount),
        })),
      })),
      operations: operations.map((item) => ({
        operationId: item.id,
        storeId: item.storeId,
        businessDate: formatDbDate(item.businessDate),
        cardTipAmount: toAmount(item.cardTipAmount),
        cashTipAmount: toAmount(item.cashTipAmount),
        tipFundAmount: toAmount(item.tipFundAmount),
        cashDifference: toAmount(item.cashDifference),
        differenceReason: item.differenceReason,
      })),
      salesDays: salesDays.items.map((item) => ({
        storeId: item.store.id,
        businessDate: item.businessDate,
        status: item.status,
        activeImportId: item.activeImportId,
        pendingImportId: item.pendingImportId,
        closure: item.closure,
      })),
      pendingImports: pending.map((item) => ({
        importId: item.id,
        storeId: item.storeId,
        businessDate: formatDbDate(item.businessDate),
        version: item.version,
      })),
    });
  }

  // Históricos del flujo previo a SPRINT-4R-T01, separados del contrato
  // vigente: cierres por turno con sus cifras de conciliación (bruto Mercado
  // Pago, neto MrComanda, descuadre de vouchers) y la tabla sales.
  async legacy(
    query: SalesReportQueryDto,
    now: Date = new Date(),
  ): Promise<LegacySalesReport> {
    this.validateRange(query, now);
    return this.snapshot((tx) => this.readLegacy(tx, query));
  }

  private async readLegacy(
    tx: Prisma.TransactionClient,
    query: SalesReportQueryDto,
  ): Promise<LegacySalesReport> {
    await this.assertStoreExists(query.storeId, tx);
    const storeFilter =
      query.storeId === undefined ? {} : { storeId: query.storeId };
    const { start, end } = businessDayRange(
      calendarDate(query.from),
      calendarDate(query.to),
    );

    const [closings, saleGroups, stores, paymentMethods] = await Promise.all([
      tx.cashClosing.findMany({
        where: {
          ...storeFilter,
          businessDate: { gte: dbDate(query.from), lte: dbDate(query.to) },
        },
        select: {
          id: true,
          businessDate: true,
          shift: true,
          status: true,
          mrcomandaNetSales: true,
          mercadoPagoGrossAmount: true,
          mercadoPagoTipAmount: true,
          reconciliationDifference: true,
          differenceReason: true,
          closedAt: true,
          store: { select: { id: true, name: true } },
          lines: {
            select: {
              paymentMethodId: true,
              expectedAmount: true,
              countedAmount: true,
              difference: true,
            },
          },
        },
        orderBy: [{ businessDate: 'asc' }, { shift: 'asc' }, { id: 'asc' }],
      }),
      // Ventas históricas en hora de Chile: [inicio de from, inicio del día
      // siguiente a to).
      tx.sale.groupBy({
        by: ['storeId', 'paymentMethodId', 'source'],
        where: { ...storeFilter, soldAt: { gte: start, lt: end } },
        _count: { _all: true },
        _sum: { grossAmount: true, tipAmount: true },
      }),
      tx.store.findMany({ select: { id: true, name: true } }),
      tx.paymentMethod.findMany({
        select: { id: true, code: true, name: true, sortOrder: true },
      }),
    ]);

    const storeById = new Map(stores.map((store) => [store.id, store]));
    const methodById = new Map(
      paymentMethods.map((method) => [method.id, method]),
    );
    const sales = saleGroups
      .map((group) => {
        const store = storeById.get(group.storeId);
        const method = methodById.get(group.paymentMethodId);
        if (!store || !method) {
          throw new Error('Venta histórica sin local o medio de pago');
        }
        const gross = group._sum.grossAmount?.toNumber() ?? 0;
        const tip = group._sum.tipAmount?.toNumber() ?? 0;
        const item: LegacySales = {
          store: { id: store.id, name: store.name },
          paymentMethod: method.code,
          paymentMethodName: method.name,
          source: group.source,
          salesCount: group._count._all,
          netAmount: gross - tip,
        };
        return { item, sortOrder: method.sortOrder };
      })
      .sort(
        (left, right) =>
          left.item.store.name.localeCompare(right.item.store.name) ||
          left.sortOrder - right.sortOrder ||
          left.item.paymentMethod.localeCompare(right.item.paymentMethod) ||
          left.item.source.localeCompare(right.item.source),
      )
      .map(({ item }) => item);

    return {
      from: query.from,
      to: query.to,
      timeZone: BUSINESS_TIME_ZONE,
      storeId: query.storeId ?? null,
      notice: LEGACY_NOTICE,
      closings: closings.map((closing) => ({
        closingId: closing.id,
        store: closing.store,
        businessDate: formatDbDate(closing.businessDate),
        shift: closing.shift,
        status: closing.status,
        mrcomandaNetSales: closing.mrcomandaNetSales.toNumber(),
        mercadoPagoGrossAmount: closing.mercadoPagoGrossAmount.toNumber(),
        mercadoPagoTipAmount: closing.mercadoPagoTipAmount.toNumber(),
        voucherDifference: closing.reconciliationDifference.toNumber(),
        // + 0 evita «-0» cuando las líneas se compensan.
        cashDifference:
          closing.lines.reduce(
            (sum, line) => sum + line.difference.toNumber(),
            0,
          ) + 0,
        ...legacyBalanceOf(
          closing.lines,
          closing.reconciliationDifference,
          methodById,
        ),
        differenceReason: closing.differenceReason,
        closedAt: closing.closedAt,
      })),
      sales,
    };
  }

  // Valida el rango de días de negocio en hora de Chile y devuelve «hoy».
  private validateRange(range: ReportRange, now: Date): string {
    calendarDate(range.from);
    calendarDate(range.to);
    const today = formatDbDate(toDbDate(businessDateOf(now)));
    if (range.from > range.to) {
      throw new BadRequestException('from no puede ser posterior a to');
    }
    if (range.to > today) {
      throw new BadRequestException(
        `to no puede ser posterior a hoy (${today}, hora de Chile)`,
      );
    }
    const days =
      Math.round(
        (dbDate(range.to).getTime() - dbDate(range.from).getTime()) /
          MS_PER_DAY,
      ) + 1;
    if (days > MAX_SALES_DAYS_RANGE) {
      throw new BadRequestException(
        `El rango no puede superar ${MAX_SALES_DAYS_RANGE} días`,
      );
    }
    return today;
  }

  // Todas las lecturas de un reporte en una sola transacción REPEATABLE READ:
  // ven la misma foto de la base aunque entre medio se confirme una
  // importación o se registre una operación diaria. Solo lee.
  private snapshot<T>(
    read: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(read, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  private async assertStoreExists(
    storeId: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (storeId === undefined) return;
    const store = await tx.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('Local no encontrado');
  }
}
