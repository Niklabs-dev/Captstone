import { splitDailyFund } from '../../src/tips/calculation/equal-daily-distribution.calculator.js';
import {
  Prisma,
  type PrismaClient,
} from '../../src/generated/prisma/client.js';
import type { TipPoolStatusCode } from '../../src/tips/types/tip-pools.types.js';

// Helper de repartos por período históricos para los tests (SPRINT-4A-T08).
// Desde que se retiraron el cálculo, la confirmación y el pago por la API,
// los repartos existentes solo se leen: este helper los construye
// directamente en la base como los dejaba el flujo anterior (foto equitativa
// DRAFT con sus fuentes diarias y líneas, y las transiciones a CONFIRMED y
// PAID que exigen los triggers, con una constancia por línea al pagar).

type Client = Prisma.TransactionClient | PrismaClient;

export interface LegacyPoolDay {
  operationId: string;
  // Fecha de negocio YYYY-MM-DD.
  businessDate: string;
  // Fondo de la operación (tarjeta + efectivo): la base exige que la fuente
  // copie exactamente su tip_fund_amount.
  fundAmount: number;
  participantIds: readonly string[];
}

export interface LegacyTipPoolSpec {
  storeId: string;
  periodStart: string;
  periodEnd: string;
  // Contador que calculó, confirmó y pagó el reparto.
  accountantId: string;
  days: readonly LegacyPoolDay[];
  status: TipPoolStatusCode;
  // Fecha de pago (YYYY-MM-DD); por defecto el último día del período.
  paymentDate?: string;
  notes?: string | null;
}

export interface LegacyTipPool {
  id: string;
  totalAmount: number;
  // Suma por trabajador de splitDailyFund de cada día, ordenada por userId.
  lines: { userId: string; amount: number }[];
}

function dbDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function createLegacyTipPool(
  client: Client,
  spec: LegacyTipPoolSpec,
): Promise<LegacyTipPool> {
  if ('$transaction' in client) {
    return client.$transaction((tx) => insertLegacyTipPool(tx, spec));
  }
  return insertLegacyTipPool(client, spec);
}

async function insertLegacyTipPool(
  tx: Prisma.TransactionClient,
  spec: LegacyTipPoolSpec,
): Promise<LegacyTipPool> {
  const totals = new Map<string, number>();
  for (const day of spec.days) {
    for (const share of splitDailyFund(day)) {
      totals.set(share.userId, (totals.get(share.userId) ?? 0) + share.amount);
    }
  }
  const lines = [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([userId, amount]) => ({ userId, amount }));
  const totalAmount = spec.days.reduce((sum, day) => sum + day.fundAmount, 0);

  const pool = await tx.tipPool.create({
    data: {
      storeId: spec.storeId,
      periodStart: dbDay(spec.periodStart),
      periodEnd: dbDay(spec.periodEnd),
      totalAmount: new Prisma.Decimal(totalAmount),
      notes: spec.notes ?? null,
      agreementSnapshot: {
        rule: 'EQUAL_SHARES',
        name: 'Reparto equitativo diario entre los participantes de cada operación',
        capturedAt: '2026-10-16T12:00:00.000Z',
      },
      calculatedById: spec.accountantId,
    },
    select: { id: true },
  });
  await tx.tipPoolDailyOperationSource.createMany({
    data: spec.days.map((day) => ({
      poolId: pool.id,
      operationId: day.operationId,
      amount: BigInt(day.fundAmount),
    })),
  });
  await tx.tipPoolLine.createMany({
    data: lines.map((line) => ({
      poolId: pool.id,
      userId: line.userId,
      hoursWorked: null,
      amount: new Prisma.Decimal(line.amount),
    })),
  });
  const result = { id: pool.id, totalAmount, lines };
  if (spec.status === 'DRAFT') return result;
  await confirmLegacyTipPool(tx, pool.id, spec.accountantId);
  if (spec.status === 'CONFIRMED') return result;
  await payLegacyTipPool(
    tx,
    pool.id,
    spec.accountantId,
    spec.paymentDate ?? spec.periodEnd,
  );
  return result;
}

// DRAFT → CONFIRMED, como la confirmación del contador.
export async function confirmLegacyTipPool(
  tx: Prisma.TransactionClient,
  poolId: string,
  accountantId: string,
): Promise<void> {
  await tx.tipPool.update({
    where: { id: poolId },
    data: {
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      confirmedById: accountantId,
      version: { increment: 1 },
    },
  });
}

// CONFIRMED → PAID y una constancia por línea con la foto del reparto
// (regla, pacto, total, horas y líneas), como el pago del contador. Sirve
// para repartos equitativos y proporcionales.
export async function payLegacyTipPool(
  tx: Prisma.TransactionClient,
  poolId: string,
  accountantId: string,
  paymentDate: string,
): Promise<void> {
  await tx.tipPool.update({
    where: { id: poolId },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      paidById: accountantId,
      paymentDate: dbDay(paymentDate),
      version: { increment: 1 },
    },
  });
  const pool = await tx.tipPool.findUniqueOrThrow({
    where: { id: poolId },
    select: {
      storeId: true,
      periodStart: true,
      periodEnd: true,
      totalAmount: true,
      agreementSnapshot: true,
      store: { select: { name: true } },
      lines: {
        select: {
          userId: true,
          hoursWorked: true,
          amount: true,
          user: { select: { firstName: true, lastName: true } },
        },
        orderBy: { userId: 'asc' },
      },
    },
  });
  const payer = await tx.user.findUniqueOrThrow({
    where: { id: accountantId },
    select: { firstName: true, lastName: true },
  });
  const snapshot = pool.agreementSnapshot;
  const equal =
    typeof snapshot === 'object' &&
    snapshot !== null &&
    !Array.isArray(snapshot) &&
    snapshot.rule === 'EQUAL_SHARES';
  const lines = pool.lines.map((line) => ({
    userId: line.userId,
    workerName: `${line.user.firstName} ${line.user.lastName}`,
    hoursWorked: line.hoursWorked?.toFixed(2) ?? null,
    amount: Number(line.amount),
  }));
  const detail = {
    rule: equal ? 'EQUAL_SHARES' : 'PROPORTIONAL_TO_HOURS',
    agreementSnapshot: equal ? null : snapshot,
    totalAmount: Number(pool.totalAmount),
    totalHours: equal
      ? null
      : pool.lines
          .reduce(
            (sum, line) => sum.plus(line.hoursWorked ?? 0),
            new Prisma.Decimal(0),
          )
          .toFixed(2),
    lines,
  };
  await tx.tipPoolReceipt.createMany({
    data: pool.lines.map((line, index) => ({
      poolId,
      userId: line.userId,
      workerName: lines[index].workerName,
      storeId: pool.storeId,
      storeName: pool.store.name,
      periodStart: pool.periodStart,
      periodEnd: pool.periodEnd,
      hoursWorked: line.hoursWorked,
      amount: line.amount,
      paymentDate: dbDay(paymentDate),
      paidById: accountantId,
      paidByName: `${payer.firstName} ${payer.lastName}`,
      detail,
    })),
  });
}
