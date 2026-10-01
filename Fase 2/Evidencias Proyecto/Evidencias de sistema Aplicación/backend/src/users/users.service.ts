import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isGlobalRole } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import type { UserResponse } from './types/users.types.js';

// Mismo factor de costo que el seed del administrador (prisma/seed.ts).
const BCRYPT_ROUNDS = 12;

const USER_INCLUDE = {
  role: { select: { code: true, name: true } },
  store: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{
  include: typeof USER_INCLUDE;
}>;

function toUserResponse(user: UserWithRelations): UserResponse {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    rut: user.rut,
    phone: user.phone,
    hiredAt: user.hiredAt ? user.hiredAt.toISOString().slice(0, 10) : null,
    isActive: user.isActive,
    role: user.role,
    store: user.store,
    createdAt: user.createdAt,
  };
}

// Convierte "YYYY-MM-DD" a Date (UTC) rechazando fechas inexistentes (ej. 2026-02-30).
function parseBusinessDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('hiredAt no es una fecha válida');
  }
  return date;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<UserResponse> {
    const role = await this.prisma.role.findUnique({
      where: { code: dto.roleCode },
    });
    if (!role || !role.isActive) {
      throw new BadRequestException(
        'El rol indicado no existe o está inactivo',
      );
    }

    // Los roles globales no se atan a un local; el resto lo exige.
    if (isGlobalRole(role.code)) {
      if (dto.storeId !== undefined) {
        throw new BadRequestException(
          `El rol ${role.code} es global y no admite local asignado`,
        );
      }
    } else {
      if (dto.storeId === undefined) {
        throw new BadRequestException(
          `El rol ${role.code} requiere un local asignado`,
        );
      }
      const store = await this.prisma.store.findUnique({
        where: { id: dto.storeId },
      });
      if (!store || !store.isActive) {
        throw new BadRequestException(
          'El local indicado no existe o está inactivo',
        );
      }
    }

    const hiredAt =
      dto.hiredAt !== undefined ? parseBusinessDate(dto.hiredAt) : undefined;
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          rut: dto.rut,
          phone: dto.phone,
          hiredAt,
          roleId: role.id,
          storeId: dto.storeId,
        },
        include: USER_INCLUDE,
      });
      return toUserResponse(user);
    } catch (error) {
      // Restricciones únicas de email y rut (también cubre altas concurrentes).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un usuario con ese correo o RUT',
        );
      }
      throw error;
    }
  }

  async findAll(query: ListUsersQueryDto): Promise<UserResponse[]> {
    const users = await this.prisma.user.findMany({
      where: {
        storeId: query.storeId,
        isActive: query.isActive,
        role: query.roleCode ? { code: query.roleCode } : undefined,
      },
      include: USER_INCLUDE,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    });
    return users.map(toUserResponse);
  }

  // Desactiva la cuenta: bloquea el acceso (login y renovación de sesión) sin
  // borrar al usuario ni sus documentos, propinas o registros asociados.
  // Es idempotente: desactivar una cuenta ya desactivada no falla.
  async deactivate(id: string, currentUser: AuthUser): Promise<UserResponse> {
    if (id === currentUser.id) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta');
    }
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { isActive: false },
        include: USER_INCLUDE,
      }),
      // Revoca las sesiones abiertas para que no pueda renovar el acceso.
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return toUserResponse(user);
  }
}
