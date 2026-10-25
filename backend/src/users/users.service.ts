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
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { UserResponse, UserStateChange } from './types/users.types.js';
import { resolveFinalStoreId } from './utils/user-assignment.util.js';

// Mismo factor de costo que el seed del administrador (prisma/seed.ts).
const BCRYPT_ROUNDS = 12;

const USER_INCLUDE = {
  role: { select: { code: true, name: true } },
  store: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{
  include: typeof USER_INCLUDE;
}>;

// Datos del rol actual necesarios para validar la asignación al editar o
// reactivar (SPRINT-3-T03); no se exponen en la respuesta.
const USER_ASSIGNMENT_INCLUDE = {
  role: { select: { code: true, isActive: true } },
} satisfies Prisma.UserInclude;

type UserWithAssignment = Prisma.UserGetPayload<{
  include: typeof USER_ASSIGNMENT_INCLUDE;
}>;

// Con PartialType, @IsOptional deja pasar null: solo rut, phone, hiredAt y
// storeId pueden borrarse; en el resto Prisma fallaría con un 500.
const NON_NULLABLE_UPDATE_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'roleCode',
] as const;

function assertUpdatableFields(dto: UpdateUserDto): void {
  const values: Record<string, unknown> = { ...dto };
  if (Object.values(values).every((value) => value === undefined)) {
    throw new BadRequestException('No hay campos para actualizar');
  }
  const nullField = NON_NULLABLE_UPDATE_FIELDS.find(
    (field) => values[field] === null,
  );
  if (nullField !== undefined) {
    throw new BadRequestException(`${nullField} no puede ser null`);
  }
}

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

    const assignedStoreId = dto.storeId;
    // Los roles globales no se atan a un local; el resto lo exige.
    if (isGlobalRole(role.code)) {
      if (assignedStoreId !== undefined) {
        throw new BadRequestException(
          `El rol ${role.code} es global y no admite local asignado`,
        );
      }
    } else if (assignedStoreId === undefined) {
      throw new BadRequestException(
        `El rol ${role.code} requiere un local asignado`,
      );
    }

    const hiredAt =
      dto.hiredAt !== undefined ? parseBusinessDate(dto.hiredAt) : undefined;
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        if (!isGlobalRole(role.code) && assignedStoreId !== undefined) {
          // Serializa el alta con la desactivación del local, que toma el mismo bloqueo.
          await tx.$queryRaw`SELECT id FROM stores WHERE id = ${assignedStoreId}::uuid FOR UPDATE`;
          const store = await tx.store.findUnique({
            where: { id: assignedStoreId },
          });
          if (!store || !store.isActive) {
            throw new BadRequestException(
              'El local indicado no existe o está inactivo',
            );
          }
        }

        return tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            rut: dto.rut,
            phone: dto.phone,
            hiredAt,
            roleId: role.id,
            storeId: assignedStoreId,
          },
          include: USER_INCLUDE,
        });
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

  // Edita datos personales y asignación (rol y local). Solo modifica la fila
  // del usuario: sus documentos, liquidaciones y demás registros conservan
  // sus datos originales (preservación documental).
  async update(
    id: string,
    dto: UpdateUserDto,
    currentUser: AuthUser,
  ): Promise<UserResponse> {
    assertUpdatableFields(dto);
    const existing = await this.findEditableUser(id);

    // La asignación se valida solo si la solicitud la toca: así se pueden
    // corregir datos personales aunque el local actual esté desactivado.
    const assignmentRequested =
      dto.roleCode !== undefined || dto.storeId !== undefined;
    let roleId = existing.roleId;
    let storeId = existing.storeId;
    if (assignmentRequested) {
      const roleCode = dto.roleCode ?? existing.role.code;
      const role = await this.prisma.role.findUnique({
        where: { code: roleCode },
      });
      if (!role || !role.isActive) {
        throw new BadRequestException(
          'El rol indicado no existe o está inactivo',
        );
      }
      this.assertNotChangingOwnRole(
        id,
        currentUser,
        role.id !== existing.roleId,
      );
      roleId = role.id;
      storeId = resolveFinalStoreId(role.code, existing.storeId, dto.storeId);
    }
    // Solo un cambio real de rol o local invalida los claims del token.
    const assignmentChanged =
      roleId !== existing.roleId || storeId !== existing.storeId;

    // null borra la fecha (assertUpdatableFields solo lo admite aquí).
    const hiredAt =
      typeof dto.hiredAt === 'string'
        ? parseBusinessDate(dto.hiredAt)
        : dto.hiredAt;

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        if (assignmentRequested && storeId !== null) {
          await this.assertActiveStore(
            tx,
            storeId,
            'El local indicado no existe o está inactivo',
          );
        }

        const updated = await tx.user.update({
          where: { id },
          data: {
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            rut: dto.rut,
            phone: dto.phone,
            hiredAt,
            roleId,
            storeId,
          },
          include: USER_INCLUDE,
        });
        if (assignmentChanged) {
          // Revoca las sesiones para que el próximo acceso lleve el rol y
          // local nuevos en sus claims.
          await tx.refreshToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        return updated;
      });
      return toUserResponse(user);
    } catch (error) {
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

  // Reactiva una cuenta desactivada. No restaura las sesiones revocadas: el
  // usuario debe volver a iniciar sesión. Es idempotente: si ya está activa,
  // la devuelve sin cambios (changed = false).
  async reactivate(id: string): Promise<UserStateChange> {
    const existing = await this.findEditableUser(id);
    if (existing.isActive) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id },
        include: USER_INCLUDE,
      });
      return { user: toUserResponse(user), changed: false };
    }

    if (!existing.role.isActive) {
      throw new BadRequestException(
        'El rol asignado está inactivo; asigna un rol activo antes de reactivar',
      );
    }
    // Los roles globales no dependen de un local; los de local exigen uno activo.
    const global = isGlobalRole(existing.role.code);
    const storeId = global ? null : existing.storeId;
    if (!global && storeId === null) {
      throw new BadRequestException(
        `El rol ${existing.role.code} requiere un local asignado`,
      );
    }

    const user = await this.prisma.$transaction(async (tx) => {
      if (storeId !== null) {
        await this.assertActiveStore(
          tx,
          storeId,
          'El local asignado no existe o está inactivo; asigna un local activo antes de reactivar',
        );
      }
      return tx.user.update({
        where: { id },
        data: { isActive: true },
        include: USER_INCLUDE,
      });
    });
    return { user: toUserResponse(user), changed: true };
  }

  // Usuario existente y no anonimizado: una cuenta anonimizada (Ley N°21.719)
  // ya no se puede editar ni reactivar.
  private async findEditableUser(id: string): Promise<UserWithAssignment> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: USER_ASSIGNMENT_INCLUDE,
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (user.anonymizedAt !== null) {
      throw new ConflictException(
        'La cuenta está anonimizada y no se puede modificar',
      );
    }
    return user;
  }

  // Regla confirmada por el equipo el 24-10 (SPRINT-3-T03): el administrador
  // no puede cambiar su propio rol (evita quedarse sin acceso, igual que
  // deactivate()).
  private assertNotChangingOwnRole(
    id: string,
    currentUser: AuthUser,
    roleChanged: boolean,
  ): void {
    if (roleChanged && id === currentUser.id) {
      throw new BadRequestException('No puedes cambiar tu propio rol');
    }
  }

  // Bloquea el local hasta el fin de la transacción (serializa con su
  // desactivación, que toma el mismo bloqueo) y exige que esté activo.
  private async assertActiveStore(
    tx: Prisma.TransactionClient,
    storeId: string,
    message: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId}::uuid FOR UPDATE`;
    const store = await tx.store.findUnique({ where: { id: storeId } });
    if (!store || !store.isActive) {
      throw new BadRequestException(message);
    }
  }
}
