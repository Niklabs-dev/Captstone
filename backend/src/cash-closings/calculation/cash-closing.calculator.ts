import { BadRequestException } from '@nestjs/common';
import {
  CashClosingVoucherSource,
  PaymentMethodBehavior,
  Prisma,
} from '../../generated/prisma/client.js';
import { MAX_CASH_AMOUNT } from '../types/cash-closings.types.js';

/// Medio de pago tal como viene del catálogo relacional. El código es la clave
/// estable que usan los contratos operativos; el nombre solo se muestra.
export interface CatalogPaymentMethod {
  id: string;
  code: string;
  name: string;
  behavior: PaymentMethodBehavior;
  sortOrder: number;
  isActive: boolean;
}

export interface ClosingSale {
  paymentMethod: string;
  grossAmount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

export interface CountedLineInput {
  paymentMethod: string;
  countedAmount: number;
}

export interface ClosingVoucherInput {
  source: CashClosingVoucherSource;
  periodStart: string;
  periodEnd: string;
  amount: number;
  tipIncludedAmount?: number;
  reference?: string;
  paymentMethod?: string;
}

export interface CalculatedClosingLine {
  paymentMethodId: string;
  paymentMethod: string;
  paymentMethodName: string;
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

export interface ClosingCut {
  start: Date;
  end: Date;
}

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

function bySortOrder(
  left: CatalogPaymentMethod,
  right: CatalogPaymentMethod,
): number {
  return (
    left.sortOrder - right.sortOrder || left.code.localeCompare(right.code)
  );
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

/// Resumen de vouchers para la conciliación del cierre. Los vouchers MrComanda
/// nuevos deben indicar su medio de pago y solo los RECONCILABLE_CARD alimentan
/// mrcomandaNetSales: Junaeb, externos y la línea Mercado Pago de MrComanda se
/// conservan como respaldo pero no se suman dos veces.
export function summarizeVouchers(
  vouchers: ClosingVoucherInput[],
  methods: CatalogPaymentMethod[],
): VoucherSummary {
  const byCode = new Map(methods.map((method) => [method.code, method]));

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
    if (voucher.paymentMethod !== undefined) {
      if (!byCode.has(voucher.paymentMethod)) {
        throw new BadRequestException(
          `El medio ${voucher.paymentMethod} del voucher no existe en el catálogo`,
        );
      }
    } else if (voucher.source === CashClosingVoucherSource.MRCOMANDA) {
      throw new BadRequestException(
        'Los vouchers MrComanda deben indicar su medio de pago',
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

  const isReconcilableMrcomanda = (voucher: ClosingVoucherInput): boolean =>
    voucher.source === CashClosingVoucherSource.MRCOMANDA &&
    byCode.get(voucher.paymentMethod ?? '')?.behavior ===
      PaymentMethodBehavior.RECONCILABLE_CARD;

  const mrcomandaNetSales = sum(
    vouchers
      .filter(isReconcilableMrcomanda)
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

/// Líneas requeridas del cierre: los medios activos del catálogo más cualquier
/// medio con ventas del período, incluido un medio inactivo con movimientos.
/// Se rechazan líneas duplicadas, omitidas o no permitidas, ventas de medios
/// desconocidos y ventas agregadas parcialmente fuera del corte. El fondo
/// inicial es un monto físico único: se suma una sola vez, a la primera línea
/// con comportamiento CASH (por sortOrder/código), aunque el catálogo tenga
/// más de un medio CASH; las demás líneas CASH esperan solo sus ventas.
export function calculateClosingLines(
  sales: ClosingSale[],
  countedLines: CountedLineInput[],
  openingCash: number,
  methods: CatalogPaymentMethod[],
  cut: ClosingCut,
): CalculatedClosingLine[] {
  const byCode = new Map(methods.map((method) => [method.code, method]));

  const netByCode = new Map<string, Prisma.Decimal>();
  for (const sale of sales) {
    const method = byCode.get(sale.paymentMethod);
    if (!method) {
      throw new BadRequestException(
        `El medio ${sale.paymentMethod} no existe en el catálogo`,
      );
    }
    if (sale.periodStart && sale.periodEnd) {
      const startInside = sale.periodStart.getTime() >= cut.start.getTime();
      const endInside = sale.periodEnd.getTime() <= cut.end.getTime();
      if (!startInside || !endInside) {
        throw new BadRequestException(
          `La venta del medio ${sale.paymentMethod} queda parcialmente fuera del corte`,
        );
      }
    }
    const netAmount = sale.grossAmount.minus(sale.tipAmount);
    if (netAmount.isNegative()) {
      throw new BadRequestException(
        'Existe una venta cuya propina supera su monto bruto',
      );
    }
    netByCode.set(
      sale.paymentMethod,
      netByCode.get(sale.paymentMethod)?.plus(netAmount) ?? netAmount,
    );
  }

  const required = new Map<string, CatalogPaymentMethod>();
  for (const method of methods) {
    if (method.isActive) required.set(method.code, method);
  }
  for (const code of netByCode.keys()) {
    const method = byCode.get(code);
    if (method) required.set(code, method);
  }

  const counted = new Map<string, number>();
  for (const line of countedLines) {
    if (counted.has(line.paymentMethod)) {
      throw new BadRequestException(
        `El medio ${line.paymentMethod} aparece más de una vez`,
      );
    }
    if (!byCode.has(line.paymentMethod)) {
      throw new BadRequestException(
        `El medio ${line.paymentMethod} no existe en el catálogo`,
      );
    }
    if (!required.has(line.paymentMethod)) {
      throw new BadRequestException(
        `El medio ${line.paymentMethod} no admite línea de cierre: no está activo ni tuvo ventas en el período`,
      );
    }
    counted.set(line.paymentMethod, line.countedAmount);
  }
  const missing = [...required.keys()].filter((code) => !counted.has(code));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Debes informar lo contado para todos los medios: ${missing.sort().join(', ')}`,
    );
  }

  const sortedRequired = [...required.values()].sort(bySortOrder);
  // Primera línea CASH del orden del catálogo: recibe el fondo único.
  const fundCode = sortedRequired.find(
    (method) => method.behavior === PaymentMethodBehavior.CASH,
  )?.code;
  return sortedRequired.map((method) => {
    let expected = netByCode.get(method.code) ?? new Prisma.Decimal(0);
    if (method.code === fundCode) {
      expected = expected.plus(openingCash);
    }
    const expectedAmount = toAmount(expected);
    const countedAmount = counted.get(method.code) ?? 0;
    return {
      paymentMethodId: method.id,
      paymentMethod: method.code,
      paymentMethodName: method.name,
      expectedAmount,
      countedAmount,
      difference: countedAmount - expectedAmount,
    };
  });
}

/// Un cierre está descuadrado si cualquier línea o la conciliación tiene
/// diferencia distinta de cero, aunque las diferencias se compensen en el
/// total.
export function hasClosingDifferences(
  lines: ReadonlyArray<Pick<CalculatedClosingLine, 'difference'>>,
  reconciliationDifference: number,
): boolean {
  return (
    reconciliationDifference !== 0 ||
    lines.some((line) => line.difference !== 0)
  );
}
