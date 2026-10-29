import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../auth/types/auth.types.js';
import { ROLE } from '../auth/constants/roles.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { formatDbDate } from '../documents/utils/document-dates.util.js';
import {
  buildReceiptFileName,
  renderTipReceiptPdf,
} from './receipts/tip-receipt-pdf.js';
import { parseReceiptDetail } from './receipts/tip-receipt-snapshot.js';
import type { OwnTipReceiptDto } from './dto/own-tip-receipt.dto.js';
import type { TipPoolReceiptResponse } from './types/tip-pools.types.js';
const PERSONAL_SELECT = {
  id: true,
  userId: true,
  storeName: true,
  periodStart: true,
  periodEnd: true,
  hoursWorked: true,
  amount: true,
  paymentDate: true,
  paidByName: true,
  createdAt: true,
} satisfies Prisma.TipPoolReceiptSelect;
@Injectable()
export class MyTipReceiptsService {
  constructor(private readonly prisma: PrismaService) {}
  private assertWorker(user: AuthUser): undefined {
    if (user.role !== ROLE.TRABAJADOR)
      throw new ForbiddenException(
        'Solo el trabajador puede consultar sus constancias.',
      );
    return undefined;
  }
  async list(user: AuthUser): Promise<OwnTipReceiptDto[]> {
    this.assertWorker(user);
    const rows = await this.prisma.tipPoolReceipt.findMany({
      where: { userId: user.id, pool: { status: 'PAID' } },
      select: PERSONAL_SELECT,
      orderBy: [{ paymentDate: 'desc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      status: 'PAID' as const,
      id: r.id,
      userId: r.userId,
      storeName: r.storeName,
      periodStart: formatDbDate(r.periodStart),
      periodEnd: formatDbDate(r.periodEnd),
      hoursWorked: r.hoursWorked.toFixed(2),
      amount: Number(r.amount),
      paymentDate: formatDbDate(r.paymentDate),
      paidByName: r.paidByName,
      createdAt: r.createdAt,
    }));
  }
  async download(
    id: string,
    user: AuthUser,
  ): Promise<{
    receiptId: string;
    storeId: string;
    content: Buffer;
    fileName: string;
    sha256: string;
  }> {
    this.assertWorker(user);
    // La misma consulta exige propietario y PAID: ajenas, inexistentes y no pagadas dan 404.
    // No depende del local actual del trabajador; conserva su historial si cambia de local.
    const r = await this.prisma.tipPoolReceipt.findFirst({
      where: { id, userId: user.id, pool: { status: 'PAID' } },
      select: {
        ...PERSONAL_SELECT,
        poolId: true,
        workerName: true,
        storeId: true,
        paidById: true,
        detail: true,
      },
    });
    if (!r) throw new NotFoundException('Constancia no encontrada.');
    const receipt: TipPoolReceiptResponse = {
      id: r.id,
      poolId: r.poolId,
      userId: r.userId,
      workerName: r.workerName,
      store: { id: r.storeId, name: r.storeName },
      periodStart: formatDbDate(r.periodStart),
      periodEnd: formatDbDate(r.periodEnd),
      hoursWorked: r.hoursWorked.toFixed(2),
      amount: Number(r.amount),
      paymentDate: formatDbDate(r.paymentDate),
      paidBy: { id: r.paidById, name: r.paidByName },
      createdAt: r.createdAt,
      detail: parseReceiptDetail(r.detail),
    };
    const content = Buffer.from(
      await renderTipReceiptPdf(receipt, r.createdAt),
    );
    return {
      receiptId: r.id,
      storeId: r.storeId,
      content,
      fileName: buildReceiptFileName(receipt),
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }
}
