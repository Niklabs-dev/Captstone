import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { AUDIT_ACTION } from '../audit/constants/audit-actions.constants.js';
import { Audited } from '../audit/decorators/audited.decorator.js';
import { setAuditContext } from '../audit/utils/audit-context.util.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import type { UserResponse } from './types/users.types.js';
import { UsersService } from './users.service.js';

// Gestión de cuentas de usuario (SPRINT-1-T08): solo el administrador.
@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Roles(ROLE.ADMINISTRADOR)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Audited({
    action: AUDIT_ACTION.USER_CREATED,
    entityType: 'users',
    entityIdFrom: 'response.id',
    detailFromBody: ['email', 'roleCode'],
  })
  @ApiOperation({
    summary: 'Crea un usuario con rol, local y credenciales iniciales',
  })
  @ApiCreatedResponse({
    description: 'Usuario creado.',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, o rol/local inexistente o incompatible (los roles de local requieren local; los globales no lo admiten).',
  })
  @ApiConflictResponse({
    description: 'Ya existe un usuario con ese correo o RUT.',
  })
  create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    return this.usersService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'Lista los usuarios, con filtros opcionales por local, rol y estado',
  })
  @ApiOkResponse({
    description: 'Usuarios ordenados por apellido y nombre.',
    type: UserResponseDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description: 'Algún filtro de la consulta no supera la validación.',
  })
  findAll(@Query() query: ListUsersQueryDto): Promise<UserResponse[]> {
    return this.usersService.findAll(query);
  }

  @Patch(':id/deactivate')
  @HttpCode(200)
  @Audited({
    action: AUDIT_ACTION.USER_DEACTIVATED,
    entityType: 'users',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary:
      'Desactiva una cuenta: bloquea el acceso sin eliminar sus datos ni documentos',
  })
  @ApiOkResponse({
    description:
      'Cuenta desactivada y sesiones revocadas (idempotente si ya estaba desactivada).',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'ID no es un UUID o se intenta desactivar la cuenta propia.',
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<UserResponse> {
    return this.usersService.deactivate(id, currentUser);
  }

  // Edición completa y reactivación (SPRINT-3-T03).
  @Patch(':id')
  @HttpCode(200)
  @Audited({
    action: AUDIT_ACTION.USER_UPDATED,
    entityType: 'users',
    entityIdFrom: 'params.id',
    // Lista blanca: nunca correo, RUT, teléfono ni nombres (datos personales).
    detailFromBody: ['roleCode', 'storeId'],
  })
  @ApiOperation({
    summary:
      'Edita datos personales, rol y local de un usuario (sin cambiar su contraseña)',
  })
  @ApiOkResponse({
    description:
      'Usuario actualizado. Si cambió el rol o el local, sus sesiones quedan revocadas y debe volver a iniciar sesión.',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'ID no es un UUID, body vacío o con datos inválidos (ej. RUT), null en un campo obligatorio, rol/local inexistente, inactivo o incompatible, o intento de cambiar el rol propio.',
  })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede editar usuarios.',
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  @ApiConflictResponse({
    description:
      'Ya existe un usuario con ese correo o RUT, o la cuenta está anonimizada.',
  })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<UserResponse> {
    return this.usersService.update(id, dto, currentUser);
  }

  @Patch(':id/reactivate')
  @HttpCode(200)
  @Audited({
    action: AUDIT_ACTION.USER_REACTIVATED,
    entityType: 'users',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary:
      'Reactiva una cuenta desactivada sin restaurar sus sesiones anteriores',
  })
  @ApiOkResponse({
    description:
      'Cuenta reactivada; el usuario debe iniciar sesión de nuevo. Si la cuenta ya está activa, la operación no tiene efecto: responde 200 sin revalidar la asignación y no se audita. Una asignación inválida se corrige con PATCH /users/:id.',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'ID no es un UUID, o el rol o el local asignados no existen o están inactivos.',
  })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede reactivar usuarios.',
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  @ApiConflictResponse({
    description: 'La cuenta está anonimizada y no se puede reactivar.',
  })
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponse> {
    const result = await this.usersService.reactivate(id);
    // Una reactivación sin efecto (ya estaba activa) no se audita.
    setAuditContext(res, { skipAudit: !result.changed });
    return result.user;
  }

  // Restablecimiento de contraseña (SPRINT-3-T04).
  @Patch(':id/password')
  @HttpCode(200)
  @Audited({
    action: AUDIT_ACTION.USER_PASSWORD_RESET,
    entityType: 'users',
    entityIdFrom: 'params.id',
    // Sin detailFromBody: la contraseña nunca se audita.
  })
  @ApiOperation({
    summary:
      'Restablece la contraseña de un usuario y revoca sus refresh tokens',
  })
  @ApiOkResponse({
    description:
      'Contraseña restablecida y refresh tokens revocados: el usuario debe iniciar sesión con la clave nueva para obtener sesiones nuevas. Los access tokens ya emitidos siguen vigentes hasta su expiración (JWT_EXPIRES_IN). Una cuenta desactivada sigue desactivada.',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'ID no es un UUID, la contraseña no cumple la política (8 a 32 caracteres, sin superar 72 bytes) o se intenta restablecer la cuenta propia.',
  })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede restablecer contraseñas.',
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  @ApiConflictResponse({
    description:
      'La cuenta está anonimizada y no se puede restablecer su contraseña.',
  })
  resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<UserResponse> {
    return this.usersService.resetPassword(id, dto, currentUser);
  }
}
