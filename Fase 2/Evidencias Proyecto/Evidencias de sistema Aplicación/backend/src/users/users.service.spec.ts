import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { AuthUser } from '../auth/types/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

const ADMIN: AuthUser = {
  id: '5f0c8a8e-2d1b-4c4e-9a3f-0b7c1d2e3f40',
  email: 'admin@moi-food.cl',
  role: 'ADMINISTRADOR',
  storeId: null,
};

// Cuenta desactivada: permite comprobar que el restablecimiento no la reactiva.
const USER = {
  id: '1010021e-9bab-42d5-851c-417e9e2503bf',
  email: 'juan.perez@moi-food.cl',
  passwordHash: 'hash-anterior',
  firstName: 'Juan',
  lastName: 'Pérez',
  rut: null,
  phone: null,
  hiredAt: null,
  isActive: false,
  anonymizedAt: null as Date | null,
  roleId: 'b6f7c1a2-3d4e-4f50-8a9b-0c1d2e3f4a5b',
  storeId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  role: { code: 'TRABAJADOR', name: 'Trabajador', isActive: true },
  store: { id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', name: 'Local Centro' },
  createdAt: new Date('2026-10-24T12:00:00.000Z'),
};

const NEW_PASSWORD = 'ClaveNueva456';

function createService(user: typeof USER | null = USER) {
  const prisma = {
    $transaction: vi.fn(),
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn(),
    },
    refreshToken: {
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  };
  // resetPassword usa la transacción en lote (arreglo de operaciones).
  prisma.$transaction.mockImplementation((operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  prisma.user.update.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...USER, ...data }),
  );
  return {
    service: new UsersService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('UsersService.resetPassword', () => {
  it('no permite restablecer la contraseña propia, sin escrituras', async () => {
    const { service, prisma } = createService({ ...USER, id: ADMIN.id });

    await expect(
      service.resetPassword(ADMIN.id, { newPassword: NEW_PASSWORD }, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('responde NotFound si el usuario no existe, sin escrituras', async () => {
    const { service, prisma } = createService(null);

    await expect(
      service.resetPassword(USER.id, { newPassword: NEW_PASSWORD }, ADMIN),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('responde Conflict si la cuenta está anonimizada, sin escrituras', async () => {
    const { service, prisma } = createService({
      ...USER,
      anonymizedAt: new Date('2026-10-20T12:00:00.000Z'),
    });

    await expect(
      service.resetPassword(USER.id, { newPassword: NEW_PASSWORD }, ADMIN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('guarda el hash bcrypt (costo 12) y revoca los refresh tokens en una transacción', async () => {
    const { service, prisma } = createService();

    await service.resetPassword(USER.id, { newPassword: NEW_PASSWORD }, ADMIN);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });

    const [{ where, data }] = prisma.user.update.mock.calls[0] as [
      { where: { id: string }; data: Record<string, unknown> },
    ];
    expect(where).toEqual({ id: USER.id });
    // Solo cambia el hash: una cuenta desactivada sigue desactivada.
    expect(Object.keys(data)).toEqual(['passwordHash']);
    const passwordHash = String(data.passwordHash);
    expect(await bcrypt.compare(NEW_PASSWORD, passwordHash)).toBe(true);
    expect(bcrypt.getRounds(passwordHash)).toBe(12);
  });

  it('no expone el hash en la respuesta', async () => {
    const { service } = createService();

    const response = await service.resetPassword(
      USER.id,
      { newPassword: NEW_PASSWORD },
      ADMIN,
    );

    expect(response).not.toHaveProperty('passwordHash');
    expect(response).toMatchObject({ id: USER.id, isActive: false });
  });
});
