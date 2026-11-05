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
  type VoucherSummary,
} from './calculation/cash-closing.calculator.js';
import type { CreateCashClosingDto } from './dto/create-cash-closing.dto.js';
import type {
  CashClosingPersonResponse,
  CashClosingResponse,
} from './types/cash-closings.types.js';

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
      paymentMethod: true,
      expectedAmount: true,
      countedAmount: true,
      difference: true,
    },
    orderBy: { paymentMethod: 'asc' },
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
    },
    orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
  },
  tipEntries: {
    select: {
      tipEntry: {
        select: { id: true, paymentMethod: true, amount: true },
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
  const lines = closing.lines.map((line) => ({
    id: line.id,
    paymentMethod: line.paymentMethod,
    expectedAmount: Number(line.expectedAmount),
    countedAmount: Number(line.countedAmount),
    difference: Number(line.difference),
  }));
  const tipEntries = closing.tipEntries.map(({ tipEntry }) => ({
    id: tipEntry.id,
    paymentMethod: tipEntry.paymentMethod,
    amount: Number(tipEntry.amount),
  }));
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
    reconciliationDifference: Number(closing.reconciliationDifference),
    tipEntries,
    tipFundAmount: tipEntries.reduce((total, entry) => total + entry.amount, 0),
    salesCount: closing._count.sales,
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
  ): Promise<CashClosingResponse> {
    this.assertStoreAccess(dto.storeId, currentUser);
    await this.stores.assertActive(dto.storeId);
    const businessDate = this.parseBusinessDate(dto.businessDate);
    const voucherSummary = summarizeVouchers(dto.vouchers);
    this.assertVoucherBusinessDate(voucherSummary, dto.businessDate);
    const differenceReason = dto.differenceReason ?? null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const sales = await tx.sale.findMany({
          where: {
            storeId: dto.storeId,
            soldAt: {
              gte: voucherSummary.periodStart,
              lt: voucherSummary.periodEnd,
            },
          },
          select: {
            id: true,
            paymentMethod: true,
            grossAmount: true,
            tipAmount: true,
            cashClosingId: true,
          },
          orderBy: [{ soldAt: 'asc' }, { id: 'asc' }],
        });
        if (sales.some((sale) => sale.cashClosingId !== null)) {
          throw new ConflictException(
            'Una o más ventas del período ya pertenecen a otro cierre',
          );
        }
        const lines = calculateClosingLines(sales, dto.lines, dto.openingCash);
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
          data: lines.map((line) => ({ ...line, closingId: closing.id })),
        });
        await tx.cashClosingVoucher.createMany({
          data: dto.vouchers.map((voucher) => ({
            closingId: closing.id,
            source: voucher.source,
            periodStart: new Date(voucher.periodStart),
            periodEnd: new Date(voucher.periodEnd),
            amount: voucher.amount,
            tipIncludedAmount: voucher.tipIncludedAmount ?? 0,
            reference: voucher.reference ?? null,
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
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un cierre para ese local, fecha y turno',
        );
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
      throw new ForbiddenException('No tienes acceso a este local');
    }
  }
}
