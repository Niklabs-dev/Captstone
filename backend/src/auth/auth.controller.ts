import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AUDIT_ACTION } from '../audit/constants/audit-actions.constants.js';
import { Audited } from '../audit/decorators/audited.decorator.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { AuthTokensResponseDto } from './dto/auth-tokens.dto.js';
import { AuthUserResponseDto } from './dto/auth-user.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutResponseDto } from './dto/logout.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import type {
  AuthTokensResponse,
  AuthUser,
  RequestMetadata,
} from './types/auth.types.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Audited({
    action: AUDIT_ACTION.USER_LOGIN,
    entityType: 'auth',
    entityIdFrom: 'response.user.id',
    detailFromBody: ['email'],
    failureAction: AUDIT_ACTION.USER_LOGIN_FAILED,
  })
  @ApiOperation({
    summary: 'Inicia sesión con email y contraseña, y emite los tokens',
  })
  @ApiOkResponse({
    description: 'Credenciales válidas: par de tokens y datos del usuario.',
    type: AuthTokensResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'El cuerpo de la solicitud no supera la validación.',
  })
  @ApiUnauthorizedResponse({ description: 'Credenciales inválidas.' })
  login(
    @Body() dto: LoginDto,
    @Req() request: Request,
  ): Promise<AuthTokensResponse> {
    return this.authService.login(dto, this.metadata(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rota el refresh token: revoca el usado y emite un par nuevo',
  })
  @ApiOkResponse({
    description: 'Refresh token válido: par de tokens renovado.',
    type: AuthTokensResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'El cuerpo de la solicitud no supera la validación.',
  })
  @ApiUnauthorizedResponse({
    description: 'Refresh token inválido o expirado.',
  })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<AuthTokensResponse> {
    return this.authService.refresh(dto, this.metadata(request));
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cierra la sesión revocando el refresh token (idempotente)',
  })
  @ApiOkResponse({
    description: 'Sesión cerrada.',
    type: LogoutResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'El cuerpo de la solicitud no supera la validación.',
  })
  async logout(@Body() dto: RefreshTokenDto): Promise<{ message: string }> {
    await this.authService.logout(dto);
    return { message: 'Sesión cerrada' };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Devuelve el usuario autenticado a partir del access token',
  })
  @ApiOkResponse({
    description: 'Datos del usuario contenidos en el token.',
    type: AuthUserResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Token ausente, inválido o expirado.',
  })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  private metadata(request: Request): RequestMetadata {
    return {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }
}
