import type { AuthUser } from '../../auth/types/auth.types.js';
import type { CreateCashClosingDto } from '../dto/create-cash-closing.dto.js';
import type { CashClosingResponse } from '../types/cash-closings.types.js';

interface VoucherKeyInput {
  source: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  amount: number;
  tipIncludedAmount?: number;
  reference?: string | null;
}

function voucherKey(voucher: VoucherKeyInput): string {
  const periodStart =
    typeof voucher.periodStart === 'string'
      ? new Date(voucher.periodStart).toISOString()
      : voucher.periodStart.toISOString();
  const periodEnd =
    typeof voucher.periodEnd === 'string'
      ? new Date(voucher.periodEnd).toISOString()
      : voucher.periodEnd.toISOString();
  return JSON.stringify([
    voucher.source,
    periodStart,
    periodEnd,
    voucher.amount,
    voucher.tipIncludedAmount ?? 0,
    voucher.reference ?? null,
  ]);
}

function sameKeys(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function isIdenticalCashClosingRetry(
  closing: CashClosingResponse,
  dto: CreateCashClosingDto,
  currentUser: AuthUser,
): boolean {
  const lineKey = (line: {
    paymentMethod: string;
    countedAmount: number;
  }): string => JSON.stringify([line.paymentMethod, line.countedAmount]);
  return (
    closing.store.id === dto.storeId &&
    closing.businessDate === dto.businessDate &&
    closing.shift === dto.shift &&
    closing.responsible.id === currentUser.id &&
    closing.openingCash === dto.openingCash &&
    closing.notes === (dto.notes ?? null) &&
    closing.differenceReason === (dto.differenceReason ?? null) &&
    sameKeys(closing.lines.map(lineKey), dto.lines.map(lineKey)) &&
    sameKeys(closing.vouchers.map(voucherKey), dto.vouchers.map(voucherKey)) &&
    sameKeys(
      closing.tipEntries.map((entry) => entry.id),
      dto.tipEntryIds ?? [],
    )
  );
}
