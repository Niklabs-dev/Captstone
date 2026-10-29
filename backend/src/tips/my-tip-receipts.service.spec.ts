import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { MyTipReceiptsService } from './my-tip-receipts.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/types/auth.types.js';
const id = 'a9000000-0000-4000-8000-000000000001';
const other = 'a9000000-0000-4000-8000-000000000002';
const user = { id, role: 'TRABAJADOR', storeId: other } as AuthUser;
const row = {
  id,
  userId: id,
  poolId: other,
  workerName: 'Ana Prueba',
  storeId: id,
  storeName: 'Local anterior',
  periodStart: new Date('2026-01-05'),
  periodEnd: new Date('2026-01-11'),
  hoursWorked: new Prisma.Decimal(40),
  amount: new Prisma.Decimal(15000),
  paymentDate: new Date('2026-01-12'),
  paidByName: 'Contador',
  paidById: other,
  createdAt: new Date('2026-01-12T12:00:00Z'),
  detail: {
    agreementSnapshot: null,
    totalAmount: 15000,
    totalHours: '40.00',
    lines: [
      {
        userId: id,
        workerName: 'Ana Prueba',
        hoursWorked: '40.00',
        amount: 15000,
      },
    ],
  },
};
function setup() {
  const findMany = vi.fn().mockResolvedValue([row]);
  const findFirst = vi.fn().mockResolvedValue(row);
  const service = new MyTipReceiptsService({
    tipPoolReceipt: { findMany, findFirst },
  } as unknown as PrismaService);
  return { service, findMany, findFirst };
}
describe('Constancias propias (SPRINT-3-T16)', () => {
  it('filtra propietario y PAID en la consulta y conserva el historial de otro local', async () => {
    const { service, findMany } = setup();
    const result = await service.list(user);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: id, pool: { status: 'PAID' } },
      }),
    );
    expect(result[0]).toMatchObject({
      status: 'PAID',
      storeName: 'Local anterior',
      amount: 15000,
    });
    expect(result[0]).not.toHaveProperty('detail');
    expect(result[0]).not.toHaveProperty('workerName');
  });
  it('rechaza roles distintos del trabajador antes de consultar', async () => {
    const { service, findMany } = setup();
    await expect(service.list({ ...user, role: 'CONTADOR' })).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
  it('busca la descarga con ID, propietario y PAID en la misma consulta', async () => {
    const { service, findFirst } = setup();
    const file = await service.download(id, user);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, userId: id, pool: { status: 'PAID' } },
      }),
    );
    expect(file.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.sha256).toBe(
      createHash('sha256').update(file.content).digest('hex'),
    );
  });
  it('devuelve 404 sin información adicional para una constancia ajena o ausente', async () => {
    const { service, findFirst } = setup();
    findFirst.mockResolvedValue(null);
    await expect(service.download(other, user)).rejects.toThrow(
      'Constancia no encontrada.',
    );
  });
  it('genera el mismo PDF y checksum en descargas repetidas de la foto guardada', async () => {
    const { service } = setup();
    const first = await service.download(id, user);
    const second = await service.download(id, user);
    expect(second.content.equals(first.content)).toBe(true);
    expect(second.sha256).toBe(first.sha256);
  });
});
