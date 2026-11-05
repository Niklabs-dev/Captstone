import { BadRequestException } from '@nestjs/common';
import {
  CashClosingVoucherSource,
  PaymentMethod,
  Prisma,
} from '../../generated/prisma/client.js';
import { MAX_CASH_AMOUNT } from '../types/cash-closings.types.js';

export interface ClosingSale {
  paymentMethod: PaymentMethod;
  grossAmount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
}

export interface CountedLineInput {
  paymentMethod: PaymentMethod;
  countedAmount: number;
}

export interface ClosingVoucherInput {
  source: CashClosingVoucherSource;
  periodStart: string;
  periodEnd: string;
  amount: number;
  tipIncludedAmount?: number;
}

export interface CalculatedClosingLine {
  paymentMethod: PaymentMethod;
  expectedAmount: number;
  countedAmount: number;
  difference: number;
}

export interface VoucherSummary {
  periodStart: Date;
  periodEnd: Date;
  mrcomandaNetSales: number;
  mercadoPagoGrossAmount: number;
  mercadoPagoTipAmount: number;
  mercadoPagoNetSales: number;
  reconciliationDifference: number;
}

const PAYMENT_METHODS = [
  PaymentMethod.CASH,
  PaymentMethod.DEBIT_CARD,
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.TRANSFER,
] as const;

function toAmount(value: Prisma.Decimal): number {
  const amount = value.toNumber();
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_CASH_AMOUNT) {
    throw new BadRequestException(
      'Los montos del cierre exceden el límite CLP',
    );
  }
  return amount;
}

function sum(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce(
    (total, value) => total.plus(value),
    new Prisma.Decimal(0),
  );
}

function parseInstant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} debe ser una fecha-hora válida`);
  }
  return parsed;
}

function voucherEnvelope(
  vouchers: ClosingVoucherInput[],
  source: CashClosingVoucherSource,
): { start: Date; end: Date } {
  const sourceVouchers = vouchers.filter(
    (voucher) => voucher.source === source,
  );
  if (sourceVouchers.length === 0) {
    throw new BadRequestException(
      `Debes incluir al menos un voucher de ${source}`,
    );
  }
  return {
    start: new Date(
      Math.min(
        ...sourceVouchers.map((voucher) =>
          parseInstant(voucher.periodStart, 'periodStart').getTime(),
        ),
      ),
    ),
    end: new Date(
      Math.max(
        ...sourceVouchers.map((voucher) =>
          parseInstant(voucher.periodEnd, 'periodEnd').getTime(),
        ),
      ),
    ),
  };
}

export function summarizeVouchers(
  vouchers: ClosingVoucherInput[],
): VoucherSummary {
  for (const voucher of vouchers) {
    const start = parseInstant(voucher.periodStart, 'periodStart');
    const end = parseInstant(voucher.periodEnd, 'periodEnd');
    if (end <= start) {
      throw new BadRequestException(
        'El período de cada voucher debe terminar después de su inicio',
      );
    }
    const tip = voucher.tipIncludedAmount ?? 0;
    if (tip > voucher.amount) {
      throw new BadRequestException(
        'La propina de un voucher no puede superar su cobro bruto',
      );
    }
    if (voucher.source === CashClosingVoucherSource.MRCOMANDA && tip !== 0) {
      throw new BadRequestException(
        'Los vouchers de MrComanda no pueden incluir propinas Mercado Pago',
      );
    }
  }

  const mrcomanda = voucherEnvelope(
    vouchers,
    CashClosingVoucherSource.MRCOMANDA,
  );
  const mercadoPago = voucherEnvelope(
    vouchers,
    CashClosingVoucherSource.MERCADO_PAGO,
  );
  if (
    mrcomanda.start.getTime() !== mercadoPago.start.getTime() ||
    mrcomanda.end.getTime() !== mercadoPago.end.getTime()
  ) {
    throw new BadRequestException(
      'MrComanda y Mercado Pago deben tener el mismo período de corte',
    );
  }

  const mrcomandaNetSales = sum(
    vouchers
      .filter(
        (voucher) => voucher.source === CashClosingVoucherSource.MRCOMANDA,
      )
      .map((voucher) => new Prisma.Decimal(voucher.amount)),
  );
  const mercadoPagoGrossAmount = sum(
    vouchers
      .filter(
        (voucher) => voucher.source === CashClosingVoucherSource.MERCADO_PAGO,
      )
      .map((voucher) => new Prisma.Decimal(voucher.amount)),
  );
  const mercadoPagoTipAmount = sum(
    vouchers
      .filter(
        (voucher) => voucher.source === CashClosingVoucherSource.MERCADO_PAGO,
      )
      .map((voucher) => new Prisma.Decimal(voucher.tipIncludedAmount ?? 0)),
  );
  if (mercadoPagoTipAmount.greaterThan(mercadoPagoGrossAmount)) {
    throw new BadRequestException(
      'Las propinas no pueden superar el cobro bruto de Mercado Pago',
    );
  }
  const mercadoPagoNetSales =
    mercadoPagoGrossAmount.minus(mercadoPagoTipAmount);
  const reconciliationDifference = mercadoPagoNetSales.minus(mrcomandaNetSales);

  return {
    periodStart: mrcomanda.start,
    periodEnd: mrcomanda.end,
    mrcomandaNetSales: toAmount(mrcomandaNetSales),
    mercadoPagoGrossAmount: toAmount(mercadoPagoGrossAmount),
    mercadoPagoTipAmount: toAmount(mercadoPagoTipAmount),
    mercadoPagoNetSales: toAmount(mercadoPagoNetSales),
    reconciliationDifference: toAmount(reconciliationDifference),
  };
}

export function calculateClosingLines(
  sales: ClosingSale[],
  countedLines: CountedLineInput[],
  openingCash: number,
): CalculatedClosingLine[] {
  const counted = new Map<PaymentMethod, number>();
  for (const line of countedLines) {
    if (counted.has(line.paymentMethod)) {
      throw new BadRequestException(
        `El medio ${line.paymentMethod} aparece más de una vez`,
      );
    }
    counted.set(line.paymentMethod, line.countedAmount);
  }
  const missing = PAYMENT_METHODS.filter((method) => !counted.has(method));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Debes informar lo contado para todos los medios: ${missing.join(', ')}`,
    );
  }

  const expected = new Map<PaymentMethod, Prisma.Decimal>(
    PAYMENT_METHODS.map((method) => [method, new Prisma.Decimal(0)]),
  );
  for (const sale of sales) {
    const netAmount = sale.grossAmount.minus(sale.tipAmount);
    if (netAmount.isNegative()) {
      throw new BadRequestException(
        'Existe una venta cuya propina supera su monto bruto',
      );
    }
    expected.set(
      sale.paymentMethod,
      expected.get(sale.paymentMethod)?.plus(netAmount) ?? netAmount,
    );
  }
  expected.set(
    PaymentMethod.CASH,
    expected.get(PaymentMethod.CASH)?.plus(openingCash) ??
      new Prisma.Decimal(openingCash),
  );

  return PAYMENT_METHODS.map((paymentMethod) => {
    const expectedAmount = toAmount(
      expected.get(paymentMethod) ?? new Prisma.Decimal(0),
    );
    const countedAmount = counted.get(paymentMethod) ?? 0;
    return {
      paymentMethod,
      expectedAmount,
      countedAmount,
      difference: countedAmount - expectedAmount,
    };
  });
}

export function hasClosingDifferences(
  lines: CalculatedClosingLine[],
  reconciliationDifference: number,
): boolean {
  return (
    reconciliationDifference !== 0 ||
    lines.some((line) => line.difference !== 0)
  );
}
