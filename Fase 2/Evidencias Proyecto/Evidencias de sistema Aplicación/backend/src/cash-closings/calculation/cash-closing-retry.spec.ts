import { ROLE } from '../../auth/constants/roles.constants.js';
import type { AuthUser } from '../../auth/types/auth.types.js';
import {
  CashClosingStatus,
  CashClosingVoucherSource,
} from '../../generated/prisma/client.js';
import type { CreateCashClosingDto } from '../dto/create-cash-closing.dto.js';
import type { CashClosingResponse } from '../types/cash-closings.types.js';
import { isIdenticalCashClosingRetry } from './cash-closing-retry.js';

const USER: AuthUser = {
  id: 'a9000000-0000-4000-8000-000000000001',
  email: 'supervisor@example.invalid',
  role: ROLE.SUPERVISOR,
  storeId: '1010021e-9bab-42d5-851c-417e9e2503bf',
};

function createDto(): CreateCashClosingDto {
  return {
    storeId: USER.storeId as string,
    businessDate: '2026-03-10',
    shift: 1,
    openingCash: 50000,
    lines: [
      { paymentMethod: 'CASH', countedAmount: 149000 },
      { paymentMethod: 'DEBIT_CARD', countedAmount: 511730 },
      { paymentMethod: 'CREDIT_CARD', countedAmount: 43800 },
      { paymentMethod: 'TRANSFER', countedAmount: 20000 },
    ],
    vouchers: [
      {
        source: CashClosingVoucherSource.MRCOMANDA,
        periodStart: '2026-03-10T08:00:00-03:00',
        periodEnd: '2026-03-10T16:00:00-03:00',
        amount: 555530,
        tipIncludedAmount: 0,
        reference: 'VENTAS',
        paymentMethod: 'DEBIT_CARD',
      },
      {
        source: CashClosingVoucherSource.MERCADO_PAGO,
        periodStart: '2026-03-10T08:00:00-03:00',
        periodEnd: '2026-03-10T16:00:00-03:00',
        amount: 588732,
        tipIncludedAmount: 31602,
        reference: 'RESUMEN',
      },
    ],
    tipEntryIds: ['propina-b', 'propina-a'],
    differenceReason: 'Descuadre respaldado',
    notes: 'Turno ficticio',
  };
}

function existing(dto: CreateCashClosingDto): CashClosingResponse {
  const names: Record<string, string> = {
    CASH: 'Efectivo',
    DEBIT_CARD: 'Tarjeta de débito',
    CREDIT_CARD: 'Tarjeta de crédito',
    TRANSFER: 'Transferencia',
  };
  const lines = dto.lines.map((line, index) => ({
    ...line,
    id: `linea-${index}`,
    paymentMethodName: names[line.paymentMethod] ?? line.paymentMethod,
    expectedAmount: line.countedAmount,
    difference: 0,
  }));
  const tipEntries = (dto.tipEntryIds ?? []).map((id) => ({
    id,
    paymentMethod: 'DEBIT_CARD',
    paymentMethodName: 'Tarjeta de débito',
    amount: 15801,
  }));
  return {
    id: 'cierre-1',
    store: { id: dto.storeId, name: 'Local ficticio' },
    businessDate: dto.businessDate,
    shift: dto.shift,
    openingCash: dto.openingCash,
    status: CashClosingStatus.CLOSED,
    notes: dto.notes ?? null,
    differenceReason: dto.differenceReason ?? null,
    responsible: { id: USER.id, name: 'Supervisor Ficticio' },
    closedBy: { id: USER.id, name: 'Supervisor Ficticio' },
    closedAt: new Date('2026-03-10T20:00:00.000Z'),
    lines,
    totalExpectedAmount: 724530,
    totalCountedAmount: 724530,
    totalDifference: 0,
    vouchers: dto.vouchers.map((voucher, index) => ({
      ...voucher,
      id: `voucher-${index}`,
      paymentMethod: voucher.paymentMethod ?? null,
      paymentMethodName: voucher.paymentMethod
        ? (names[voucher.paymentMethod] ?? voucher.paymentMethod)
        : null,
      periodStart: new Date(voucher.periodStart),
      periodEnd: new Date(voucher.periodEnd),
      tipIncludedAmount: voucher.tipIncludedAmount ?? 0,
      reference: voucher.reference ?? null,
    })),
    mrcomandaNetSales: 555530,
    mercadoPagoGrossAmount: 588732,
    mercadoPagoTipAmount: 31602,
    mercadoPagoNetSales: 557130,
    reconciliationDifference: 1600,
    tipEntries,
    tipFundAmount: 31602,
    salesCount: 4,
    hasDifferences: true,
    isBalanced: false,
    balanceStatus: 'NO_CUADRADO',
    createdAt: new Date('2026-03-10T19:59:00.000Z'),
    updatedAt: new Date('2026-03-10T20:00:00.000Z'),
  };
}

describe('Identificación de reintentos de cierre (SPRINT-4-T10)', () => {
  it('acepta el mismo contenido aunque cambie el orden de las listas', () => {
    const dto = createDto();
    dto.lines.reverse();
    dto.vouchers.reverse();
    dto.tipEntryIds?.reverse();
    expect(isIdenticalCashClosingRetry(existing(createDto()), dto, USER)).toBe(
      true,
    );
  });

  it.each([
    [
      'monto contado',
      (dto: CreateCashClosingDto) => {
        dto.lines[0].countedAmount += 1;
      },
    ],
    [
      'voucher',
      (dto: CreateCashClosingDto) => {
        dto.vouchers[0].amount += 1;
      },
    ],
    [
      'medio de un voucher',
      (dto: CreateCashClosingDto) => {
        dto.vouchers[0].paymentMethod = 'CREDIT_CARD';
      },
    ],
    [
      'propinas vinculadas',
      (dto: CreateCashClosingDto) => {
        dto.tipEntryIds = ['propina-a'];
      },
    ],
    [
      'motivo',
      (dto: CreateCashClosingDto) => {
        dto.differenceReason = 'Otro motivo';
      },
    ],
    [
      'fondo inicial',
      (dto: CreateCashClosingDto) => {
        dto.openingCash += 1;
      },
    ],
  ])('rechaza un reintento con distinto %s', (_label, change) => {
    const dto = createDto();
    change(dto);
    expect(isIdenticalCashClosingRetry(existing(createDto()), dto, USER)).toBe(
      false,
    );
  });

  it('no devuelve como propio un cierre creado por otro responsable', () => {
    const dto = createDto();
    expect(
      isIdenticalCashClosingRetry(existing(dto), dto, {
        ...USER,
        id: 'a9000000-0000-4000-8000-000000000002',
      }),
    ).toBe(false);
  });
});
