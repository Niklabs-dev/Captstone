import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import { TipPoolsService } from './tip-pools.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/types/auth.types.js';

// Consulta histórica de repartos por período (SPRINT-3-T15; solo lectura
// desde SPRINT-4A-T08): filtros opcionales, sin calcular ni escribir.
const storeId = 'a9000000-0000-4000-8000-000000000001';
const query = { storeId, periodStart: '2026-01-01', periodEnd: '2026-01-15' };
const user = { id: storeId, role: 'ADMINISTRADOR', storeId: null } as AuthUser;
function setup() {
  const findMany = vi.fn().mockResolvedValue([]);
  const service = new TipPoolsService({
    tipPool: { findMany },
  } as unknown as PrismaService);
  return { findMany, service };
}
describe('Consulta histórica de repartos (SPRINT-3-T15 y SPRINT-4A-T08)', () => {
  it('consulta el período exacto de un local sin calcular ni escribir', async () => {
    const { service, findMany } = setup();
    expect(await service.findAll(query, user)).toEqual([]);
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
  it('sin filtros lista todos los repartos del más reciente al más antiguo', async () => {
    const { service, findMany } = setup();
    await service.findAll({}, user);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: [
          { periodStart: 'desc' },
          { periodEnd: 'desc' },
          { store: { name: 'asc' } },
          { id: 'asc' },
        ],
      }),
    );
  });
  it('filtra solo por local cuando no hay período', async () => {
    const { service, findMany } = setup();
    await service.findAll({ storeId }, user);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId } }),
    );
  });
  it('rechaza períodos inválidos o incompletos antes de consultar', async () => {
    const { service, findMany } = setup();
    for (const bad of [
      { ...query, periodEnd: '2025-01-01' },
      { storeId, periodStart: '2026-01-01' },
      { periodEnd: '2026-01-15' },
    ]) {
      await expect(service.findAll(bad, user)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(findMany).not.toHaveBeenCalled();
  });
  it('rechaza un local fuera del alcance del usuario', async () => {
    const { service, findMany } = setup();
    await expect(
      service.findAll(query, {
        ...user,
        role: 'SUPERVISOR',
        storeId: 'a9000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
});
