import { createHash, randomUUID } from 'node:crypto';
import { planDailyTipAllocations } from '../../src/daily-operations/utils/daily-tip-allocations.util.js';
import type {
  Prisma,
  PrismaClient,
} from '../../src/generated/prisma/client.js';

// Helper de operaciones diarias para los tests del reparto equitativo
// (SPRINT-4R-T04): inserta la operación del local y día con su selección de
// participantes directamente en la base (sin la API ni el volumen privado).
// Con propina de tarjeta crea los metadatos de un voucher ficticio, porque el
// CHECK de T01 exige voucher cuando card_tip_amount > 0; el archivo no existe
// y estos tests no lo descargan. Como la API desde SPRINT-4A-T03, guarda
// también el reparto automático (una propina No pagada por participante) en
// la misma transacción: la base lo exige al commit (constraint trigger
// diferido) cuando hay fondo y participantes.

type Client = Prisma.TransactionClient | PrismaClient;

export interface TestDailyOperationSpec {
  storeId: string;
  responsibleId: string;
  // Fecha de negocio YYYY-MM-DD.
  businessDate: string;
  cardTipAmount?: number;
  cashTipAmount?: number;
  // Diferencia de efectivo declarada con signo y su motivo (SPRINT-4R-T13);
  // por defecto 0 sin motivo.
  cashDifference?: number;
  differenceReason?: string | null;
  participantIds?: readonly string[];
}

export async function createDailyOperation(
  client: Client,
  spec: TestDailyOperationSpec,
): Promise<string> {
  // Con el cliente sin transacción, todo va en una sola para que el reparto
  // llegue al commit junto con la operación y su selección.
  if ('$transaction' in client) {
    return client.$transaction((tx) => insertDailyOperation(tx, spec));
  }
  return insertDailyOperation(client, spec);
}

async function insertDailyOperation(
  client: Prisma.TransactionClient,
  spec: TestDailyOperationSpec,
): Promise<string> {
  const cardTipAmount = spec.cardTipAmount ?? 0;
  const cashTipAmount = spec.cashTipAmount ?? 0;
  const voucher =
    cardTipAmount > 0
      ? await client.dailyOperationVoucher.create({
          data: {
            fileName: 'voucher-prueba.jpg',
            filePath: `vouchers/test/${randomUUID()}.jpg`,
            mimeType: 'image/jpeg',
            sizeBytes: BigInt(10),
            sha256Hash: createHash('sha256').update(randomUUID()).digest('hex'),
          },
          select: { id: true },
        })
      : null;
  const operation = await client.dailyOperation.create({
    data: {
      storeId: spec.storeId,
      responsibleId: spec.responsibleId,
      businessDate: new Date(`${spec.businessDate}T00:00:00.000Z`),
      cardTipAmount: BigInt(cardTipAmount),
      cashTipAmount: BigInt(cashTipAmount),
      tipFundAmount: BigInt(cardTipAmount + cashTipAmount),
      cashDifference: BigInt(spec.cashDifference ?? 0),
      differenceReason: spec.differenceReason ?? null,
      voucherId: voucher?.id ?? null,
    },
    select: { id: true },
  });
  const participantIds = spec.participantIds ?? [];
  if (participantIds.length > 0) {
    await client.dailyOperationParticipant.createMany({
      data: participantIds.map((workerId) => ({
        operationId: operation.id,
        workerId,
      })),
    });
  }
  const tipFundAmount = cardTipAmount + cashTipAmount;
  if (tipFundAmount > 0 && participantIds.length > 0) {
    await client.dailyTipAllocation.createMany({
      data: planDailyTipAllocations({
        operationId: operation.id,
        businessDate: spec.businessDate,
        tipFundAmount,
        participantIds,
      }).map((allocation) => ({
        operationId: operation.id,
        storeId: spec.storeId,
        businessDate: new Date(`${spec.businessDate}T00:00:00.000Z`),
        workerId: allocation.workerId,
        amount: BigInt(allocation.amount),
      })),
    });
  }
  return operation.id;
}
