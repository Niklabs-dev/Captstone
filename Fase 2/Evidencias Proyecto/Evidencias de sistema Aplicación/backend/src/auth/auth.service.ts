import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RefreshTokenDto } from './dto/refresh-token.dto.js';
import type {
  AuthTokensResponse,
  JwtPayload,
  RequestMetadata,
} from './types/auth.types.js';
import { parseDurationToMs } from './utils/duration.util.js';

type UserWithRole = Prisma.UserGetPayload<{ include: { role: true } }>;

// Mensaje genérico: no se filtra si falló el correo, la contraseña o el estado.
const CREDENCIALES_INVALIDAS = 'Credenciales inválidas';

// El refresh token nunca se guarda en claro: solo su hash SHA-256 (es un
// secreto aleatorio de alta entropía, no requiere bcrypt).
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(
    dto: LoginDto,
    metadata: RequestMetadata,
  ): Promise<AuthTokensResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { role: true },
    });
    if (!user || !user.isActive || user.anonymizedAt !== null) {
      throw new UnauthorizedException(CREDENCIALES_INVALIDAS);
    }
    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException(CREDENCIALES_INVALIDAS);
    }
    return this.issueTokens(user, metadata);
  }

  // Rotación: el refresh token usado queda revocado y se emite un par nuevo.
  async refresh(
    dto: RefreshTokenDto,
    metadata: RequestMetadata,
  ): Promise<AuthTokensResponse> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(dto.refreshToken) },
      include: { user: { include: { role: true } } },
    });
    if (
      !stored ||
      stored.revokedAt !== null ||
      stored.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    const user = stored.user;
    if (!user.isActive || user.anonymizedAt !== null) {
      throw new UnauthorizedException(CREDENCIALES_INVALIDAS);
    }
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(user, metadata);
  }

  // Cierra sesión revocando el refresh token; es idempotente.
  async logout(dto: RefreshTokenDto): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(dto.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    user: UserWithRole,
    metadata: RequestMetadata,
  ): Promise<AuthTokensResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role.code,
      storeId: user.storeId,
    };
    const accessToken = await this.jwtService.signAsync(payload);

    const refreshExpiresIn = this.config.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + parseDurationToMs(refreshExpiresIn)),
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        userId: user.id,
      },
    });

    const accessExpiresIn = this.config.get<string>('JWT_EXPIRES_IN', '1d');
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: Math.floor(parseDurationToMs(accessExpiresIn) / 1000),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role.code,
        storeId: user.storeId,
      },
    };
  }
}
