import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseCalendarDate } from '../audit/utils/business-day.util.js';
import { canAccessStore } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { CashClosingStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StoresService } from '../stores/stores.service.js';
import {
  calculateClosingLines,
  hasClosingDifferences,
  summarizeVouchers,
  type CatalogPaymentMethod,
  type VoucherSummary,
} from './calculation/cash-closing.calculator.js';
import { isIdenticalCashClosingRetry } from './calculation/cash-closing-retry.js';
import type { CreateCashClosingDto } from './dto/create-cash-closing.dto.js';
import {
  BALANCE_STATUS,
  type BalanceStatus,
  type CashClosingCreateResult,
  type CashClosingPersonResponse,
  type CashClosingResponse,
} from './types/cash-closings.types.js';
import { STORE_FORBIDDEN_MESSAGE } from '../auth/constants/forbidden-messages.constants.js';

const PERSON_SELECT = {
  select: { id: true, firstName: true, lastName: true },
} as const;

const CASH_CLOSING_SELECT = {
  id: true,
  businessDate: true,
  shift: true,
  openingCash: true,
  status: true,
  notes: true,
  differenceReason: true,
  mrcomandaNetSales: true,
  mercadoPagoGrossAmount: true,
  mercadoPagoTipAmount: true,
  reconciliationDifference: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  store: { select: { id: true, name: true } },
  responsible: PERSON_SELECT,
  closedBy: PERSON_SELECT,
  lines: {
    select: {
      id: true,
      expectedAmount: true,
      countedAmount: true,
      difference: true,
      paymentMethod: {
        select: { id: true, code: true, name: true, sortOrder: true },
      },
    },
  },
  vouchers: {
    select: {
      id: true,
      source: true,
      periodStart: true,
      periodEnd: true,
      amount: true,
      tipIncludedAmount: true,
      reference: true,
      paymentMethod: { select: { code: true, name: true } },
    },
    orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
  },
  tipEntries: {
    select: {
      tipEntry: {
        select: {
          id: true,
          amount: true,
          paymentMethod: { select: { code: true, name: true } },
        },
      },
    },
    orderBy: { tipEntryId: 'asc' },
  },
  _count: { select: { sales: true } },
} satisfies Prisma.CashClosingSelect;

type CashClosingRecord = Prisma.CashClosingGetPayload<{
  select: typeof CASH_CLOSING_SELECT;
}>;

type PersonRecord = {
  id: string;
  firstName: string;
  lastName: string;
};

function toPerson(
  person: PersonRecord | null,
): CashClosingPersonResponse | null {
  return person
    ? { id: person.id, name: `${person.firstName} ${person.lastName}` }
    : null;
}

function toCashClosingResponse(
  closing: CashClosingRecord,
): CashClosingResponse {
  const lines = closing.lines
    .map((line) => ({
      id: line.id,
      paymentMethod: line.paymentMethod.code,
      paymentMethodName: line.paymentMethod.name,
      sortOrder: line.paymentMethod.sortOrder,
      expectedAmount: Number(line.expectedAmount),
      countedAmount: Number(line.countedAmount),
      difference: Number(line.difference),
    }))
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.paymentMethod.localeCompare(right.paymentMethod),
    )
    .map(({ sortOrder: _sortOrder, ...line }) => line);
  const tipEntries = closing.tipEntries.map(({ tipEntry }) => ({
    id: tipEntry.id,
    paymentMethod: tipEntry.paymentMethod.code,
    paymentMethodName: tipEntry.paymentMethod.name,
    amount: Number(tipEntry.amount),
  }));
  const reconciliationDifference = Number(closing.reconciliationDifference);
  const hasDifferences = hasClosingDifferences(lines, reconciliationDifference);
  const balanceStatus: BalanceStatus = hasDifferences
    ? BALANCE_STATUS.NO_CUADRADO
    : BALANCE_STATUS.CUADRADO;
  return {
    id: closing.id,
    store: closing.store,
    businessDate: formatDbDate(closing.businessDate),
    shift: closing.shift,
    openingCash: Number(closing.openingCash),
    status: closing.status,
    notes: closing.notes,
    differenceReason: closing.differenceReason,
    responsible: toPerson(closing.responsible) as CashClosingPersonResponse,
    closedBy: toPerson(closing.closedBy),
    closedAt: closing.closedAt,
    lines,
    totalExpectedAmount: lines.reduce(
      (total, line) => total + line.expectedAmount,
      0,
    ),
    totalCountedAmount: lines.reduce(
      (total, line) => total + line.countedAmount,
      0,
    ),
    totalDifference: lines.reduce((total, line) => total + line.difference, 0),
    vouchers: closing.vouchers.map((voucher) => ({
      id: voucher.id,
      source: voucher.source,
      paymentMethod: voucher.paymentMethod?.code ?? null,
      paymentMethodName: voucher.paymentMethod?.name ?? null,
      periodStart: voucher.periodStart,
      periodEnd: voucher.periodEnd,
      amount: Number(voucher.amount),
      tipIncludedAmount: Number(voucher.tipIncludedAmount),
      reference: voucher.reference,
    })),
    mrcomandaNetSales: Number(closing.mrcomandaNetSales),
    mercadoPagoGrossAmount: Number(closing.mercadoPagoGrossAmount),
    mercadoPagoTipAmount: Number(closing.mercadoPagoTipAmount),
    mercadoPagoNetSales:
      Number(closing.mercadoPagoGrossAmount) -
      Number(closing.mercadoPagoTipAmount),
    reconciliationDifference,
    tipEntries,
    tipFundAmount: tipEntries.reduce((total, entry) => total + entry.amount, 0),
    salesCount: closing._count.sales,
    hasDifferences,
    isBalanced: !hasDifferences,
    balanceStatus,
    createdAt: closing.createdAt,
    updatedAt: closing.updatedAt,
  };
}

@Injectable()
export class CashClosingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
  ) {}

  async create(
    dto: CreateCashClosingDto,
    currentUser: AuthUser,
  ): Promise<CashClosingCreateResult> {
    this.assertStoreAccess(dto.storeId, currentUser);
    await this.stores.assertActive(dto.storeId);
    const businessDate = this.parseBusinessDate(dto.businessDate);
    // El duplicado natural se resuelve antes de cualquier validación nueva
    // (p. ej. la clasificación de vouchers MrComanda): un reintento idéntico
    // de un cierre pre-T32, cuyos vouchers no traen medio de pago, debe
    // devolver el existente con created = false y no un 400 por la regla
    // nueva (la comparación ya trata undefined y null por igual).
    const existing = await this.findByNaturalKey(dto, businessDate);
    if (existing) return this.resolveDuplicate(existing, dto, currentUser);
    const methods = await this.fetchPaymentMethods();
    const voucherSummary = summarizeVouchers(dto.vouchers, methods);
    this.assertVoucherBusinessDate(voucherSummary, dto.businessDate);
    const differenceReason = dto.differenceReason ?? null;

    try {
      const closing = await this.prisma.$transaction(async (tx) => {
        // Toma el mismo bloqueo de la fila del local que el ingreso de
        // ventas MrComanda antes de leer nada: ingreso y cierre quedan
        // ordenados por local y no puede quedar una venta huérfana (creada
        // después de cerrar, invisible para el cierre) ni un ingreso que
        // ignore un cierre recién confirmado.
        await tx.$queryRaw`SELECT id FROM stores WHERE id = ${dto.storeId}::uuid FOR UPDATE`;
        const sales = await tx.sale.findMany({
          where: {
            storeId: dto.storeId,
            OR: [
              {
                soldAt: {
                  gte: voucherSummary.periodStart,
                  lt: voucherSummary.periodEnd,
                },
              },
              {
                periodStart: { lt: voucherSummary.periodEnd },
                periodEnd: { gt: voucherSummary.periodStart },
              },
            ],
          },
          select: {
            id: true,
            soldAt: true,
            periodStart: true,
            periodEnd: true,
            grossAmount: true,
            tipAmount: true,
            cashClosingId: true,
            paymentMethod: {
              select: { code: true },
            },
          },
          orderBy: [{ soldAt: 'asc' }, { id: 'asc' }],
        });
        if (sales.some((sale) => sale.cashClosingId !== null)) {
          throw new ConflictException(
            'Una o más ventas del período ya pertenecen a otro cierre',
          );
        }
        const lines = calculateClosingLines(
          sales.map((sale) => ({
            paymentMethod: sale.paymentMethod.code,
            grossAmount: sale.grossAmount,
            tipAmount: sale.tipAmount,
            periodStart: sale.periodStart,
            periodEnd: sale.periodEnd,
          })),
          dto.lines,
          dto.openingCash,
          methods,
          { start: voucherSummary.periodStart, end: voucherSummary.periodEnd },
        );
        if (
          hasClosingDifferences(
            lines,
            voucherSummary.reconciliationDifference,
          ) &&
          differenceReason === null
        ) {
          throw new BadRequestException(
            'differenceReason es obligatorio cuando existe una diferencia',
          );
        }
        const tipEntries = await this.findTipEntries(
          tx,
          dto.tipEntryIds ?? [],
          dto.storeId,
          businessDate,
        );
        const tipFund = tipEntries.reduce(
          (total, entry) => total.plus(entry.amount),
          new Prisma.Decimal(0),
        );
        if (!tipFund.equals(voucherSummary.mercadoPagoTipAmount)) {
          throw new BadRequestException(
            'Los registros vinculados deben sumar exactamente PROPINAS de Mercado Pago',
          );
        }

        const closing = await tx.cashClosing.create({
          data: {
            storeId: dto.storeId,
            businessDate,
            shift: dto.shift,
            openingCash: dto.openingCash,
            notes: dto.notes ?? null,
            differenceReason,
            responsibleId: currentUser.id,
            mrcomandaNetSales: voucherSummary.mrcomandaNetSales,
            mercadoPagoGrossAmount: voucherSummary.mercadoPagoGrossAmount,
            mercadoPagoTipAmount: voucherSummary.mercadoPagoTipAmount,
            reconciliationDifference: voucherSummary.reconciliationDifference,
          },
          select: { id: true },
        });
        await tx.cashClosingLine.createMany({
          data: lines.map((line) => ({
            closingId: closing.id,
            paymentMethodId: line.paymentMethodId,
            expectedAmount: line.expectedAmount,
            countedAmount: line.countedAmount,
            difference: line.difference,
          })),
        });
        const methodIdByCode = new Map(
          methods.map((method) => [method.code, method.id]),
        );
        await tx.cashClosingVoucher.createMany({
          data: dto.vouchers.map((voucher) => ({
            closingId: closing.id,
            source: voucher.source,
            periodStart: new Date(voucher.periodStart),
            periodEnd: new Date(voucher.periodEnd),
            amount: voucher.amount,
            tipIncludedAmount: voucher.tipIncludedAmount ?? 0,
            reference: voucher.reference ?? null,
            paymentMethodId: voucher.paymentMethod
              ? (methodIdByCode.get(voucher.paymentMethod) ?? null)
              : null,
          })),
        });
        if (tipEntries.length > 0) {
          await tx.cashClosingTipEntry.createMany({
            data: tipEntries.map((entry) => ({
              closingId: closing.id,
              tipEntryId: entry.id,
            })),
          });
        }
        if (sales.length > 0) {
          const linked = await tx.sale.updateMany({
            where: {
              id: { in: sales.map((sale) => sale.id) },
              cashClosingId: null,
            },
            data: { cashClosingId: closing.id },
          });
          if (linked.count !== sales.length) {
            throw new ConflictException(
              'Las ventas cambiaron durante el cierre; vuelve a intentarlo',
            );
          }
        }
        await tx.cashClosing.update({
          where: { id: closing.id },
          data: {
            status: CashClosingStatus.CLOSED,
            closedAt: new Date(),
            closedById: currentUser.id,
          },
        });
        return this.read(closing.id, tx);
      });
      return { closing, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.findByNaturalKey(dto, businessDate);
        if (concurrent) {
          return this.resolveDuplicate(concurrent, dto, currentUser);
        }
      }
      throw error;
    }
  }

  async findOne(
    id: string,
    currentUser: AuthUser,
  ): Promise<CashClosingResponse> {
    const closing = await this.prisma.cashClosing.findUnique({
      where: { id },
      select: CASH_CLOSING_SELECT,
    });
    if (!closing) throw new NotFoundException('Cierre de caja no encontrado');
    this.assertStoreAccess(closing.store.id, currentUser);
    return toCashClosingResponse(closing);
  }

  private async fetchPaymentMethods(): Promise<CatalogPaymentMethod[]> {
    return this.prisma.paymentMethod.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        behavior: true,
        sortOrder: true,
        isActive: true,
      },
    });
  }

  private async findByNaturalKey(
    dto: CreateCashClosingDto,
    businessDate: Date,
  ): Promise<CashClosingResponse | null> {
    const closing = await this.prisma.cashClosing.findUnique({
      where: {
        storeId_businessDate_shift: {
          storeId: dto.storeId,
          businessDate,
          shift: dto.shift,
        },
      },
      select: CASH_CLOSING_SELECT,
    });
    return closing ? toCashClosingResponse(closing) : null;
  }

  private resolveDuplicate(
    existing: CashClosingResponse,
    dto: CreateCashClosingDto,
    currentUser: AuthUser,
  ): CashClosingCreateResult {
    if (isIdenticalCashClosingRetry(existing, dto, currentUser)) {
      return { closing: existing, created: false };
    }
    throw new ConflictException({
      statusCode: 409,
      message:
        'Ya existe un cierre distinto para ese local, fecha y turno; consulta el existente antes de continuar',
      error: 'Conflict',
      existingClosingId: existing.id,
    });
  }

  private async read(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<CashClosingResponse> {
    const closing = await tx.cashClosing.findUniqueOrThrow({
      where: { id },
      select: CASH_CLOSING_SELECT,
    });
    return toCashClosingResponse(closing);
  }

  private async findTipEntries(
    tx: Prisma.TransactionClient,
    ids: string[],
    storeId: string,
    businessDate: Date,
  ) {
    if (ids.length === 0) return [];
    const entries = await tx.tipEntry.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        amount: true,
        storeId: true,
        businessDate: true,
      },
    });
    if (entries.length !== ids.length) {
      throw new BadRequestException(
        'Uno o más registros de propinas no existen',
      );
    }
    if (
      entries.some(
        (entry) =>
          entry.storeId !== storeId ||
          entry.businessDate.getTime() !== businessDate.getTime(),
      )
    ) {
      throw new BadRequestException(
        'Las propinas vinculadas deben ser del mismo local y día del cierre',
      );
    }
    return entries;
  }

  private assertVoucherBusinessDate(
    summary: VoucherSummary,
    expectedDate: string,
  ): void {
    const lastIncludedInstant = new Date(summary.periodEnd.getTime() - 1);
    const dates = [summary.periodStart, lastIncludedInstant].map((instant) =>
      formatDbDate(toDbDate(businessDateOf(instant))),
    );
    if (dates.some((date) => date !== expectedDate)) {
      throw new BadRequestException(
        'El período de los vouchers debe pertenecer al día de negocio en Chile',
      );
    }
  }

  private parseBusinessDate(value: string): Date {
    const parsed = parseCalendarDate(value);
    if (!parsed) {
      throw new BadRequestException(
        'businessDate debe ser una fecha válida con formato YYYY-MM-DD',
      );
    }
    return toDbDate(parsed);
  }

  private assertStoreAccess(storeId: string, currentUser: AuthUser): void {
    if (!canAccessStore(currentUser, storeId)) {
      throw new ForbiddenException(STORE_FORBIDDEN_MESSAGE);
    }
  }
}
