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
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
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
}
