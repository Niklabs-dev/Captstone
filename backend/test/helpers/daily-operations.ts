import { createHash, randomUUID } from 'node:crypto';
import type {
  Prisma,
  PrismaClient,
} from '../../src/generated/prisma/client.js';

// Helper de operaciones diarias para los tests del reparto equitativo
// (SPRINT-4R-T04): inserta la operación del local y día con su selección de
// participantes directamente en la base (sin la API ni el volumen privado).
// Con propina de tarjeta crea los metadatos de un voucher ficticio, porque el
// CHECK de T01 exige voucher cuando card_tip_amount > 0; el archivo no existe
// y estos tests no lo descargan.

type Client = Prisma.TransactionClient | PrismaClient;

export interface TestDailyOperationSpec {
  storeId: string;
  responsibleId: string;
  // Fecha de negocio YYYY-MM-DD.
  businessDate: string;
  cardTipAmount?: number;
  cashTipAmount?: number;
  participantIds?: readonly string[];
}

export async function createDailyOperation(
  client: Client,
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
      cashDifference: BigInt(0),
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
  return operation.id;
}
