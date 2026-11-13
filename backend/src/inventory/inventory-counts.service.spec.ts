import { ConflictException } from '@nestjs/common';
import { ROLE } from '../auth/constants/roles.constants.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { InventoryCountsService } from './inventory-counts.service.js';

// Choque con el índice único de la toma En curso (SPRINT-5-T05): si dos
// inicios del mismo local chocan pese al bloqueo, la respuesta es 409, nunca
// un 500. Se simula el P2002 porque por HTTP depende de una carrera.
const supervisor: AuthUser = {
  id: 'supervisor-1',
  email: 'supervisora@moi-food.cl',
  role: ROLE.SUPERVISOR,
  storeId: 'store-1',
};

function serviceWith(
  open: { id: string; countDate: Date } | null,
): InventoryCountsService {
  const prisma = {
    $transaction: vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    ),
    inventoryCount: { findFirst: vi.fn().mockResolvedValue(open) },
  };
  return new InventoryCountsService(prisma as unknown as PrismaService);
}

async function conflictOf(
  service: InventoryCountsService,
): Promise<Record<string, unknown>> {
  const error: unknown = await service
    .start({}, supervisor)
    .catch((rejection: unknown) => rejection);
  expect(error).toBeInstanceOf(ConflictException);
  return (error as ConflictException).getResponse() as Record<string, unknown>;
}

describe('InventoryCountsService.start ante el índice único (SPRINT-5-T05)', () => {
  it('indica la toma en curso que ganó la carrera', async () => {
    const body = await conflictOf(
      serviceWith({
        id: 'count-1',
        countDate: new Date('2026-11-12T00:00:00.000Z'),
      }),
    );
    expect(body).toMatchObject({
      statusCode: 409,
      existingCountId: 'count-1',
      existingCountDate: '2026-11-12',
    });
  });

  it('responde 409 genérico si la otra toma ya no existe', async () => {
    const body = await conflictOf(serviceWith(null));
    expect(body).toEqual({
      statusCode: 409,
      message: 'Otra toma de este local se estaba iniciando',
      errors: {
        store: 'Vuelve a intentarlo: otra toma de tu local se estaba iniciando',
      },
    });
  });
});
