import { describe, it, expect, vi } from 'vitest';
import { TipPoolsService } from './tip-pools.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StoresService } from '../stores/stores.service.js';
import type { AuthUser } from '../auth/types/auth.types.js';
const storeId = 'a9000000-0000-4000-8000-000000000001';
const query = { storeId, periodStart: '2026-01-01', periodEnd: '2026-01-15' };
const user = { id: storeId, role: 'ADMINISTRADOR', storeId: null } as AuthUser;
function setup() {
  const findMany = vi.fn().mockResolvedValue([]);
  const service = new TipPoolsService(
    { tipPool: { findMany } } as unknown as PrismaService,
    {} as StoresService,
  );
  return { findMany, service };
}
describe('Consulta de reparto por período (SPRINT-3-T15)', () => {
  it('consulta una foto existente sin calcular ni escribir', async () => {
    const { service, findMany } = setup();
    expect(await service.findPeriod(query, user)).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId,
          periodStart: new Date('2026-01-01T00:00:00Z'),
          periodEnd: new Date('2026-01-15T00:00:00Z'),
        },
      }),
    );
  });
  it('rechaza períodos inválidos antes de consultar', async () => {
    const { service, findMany } = setup();
    await expect(
      service.findPeriod({ ...query, periodEnd: '2025-01-01' }, user),
    ).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
  it('rechaza un local fuera del alcance del usuario', async () => {
    const { service, findMany } = setup();
    await expect(
      service.findPeriod(query, {
        ...user,
        role: 'SUPERVISOR',
        storeId: 'a9000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
});
