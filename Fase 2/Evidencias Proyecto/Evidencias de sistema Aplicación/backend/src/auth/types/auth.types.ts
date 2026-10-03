// Tipos del módulo de autenticación (SPRINT-1-T06).

// Contenido del JWT de acceso firmado por el servidor.
export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  storeId: string | null;
}

// Usuario autenticado disponible en request.user tras el JwtAuthGuard.
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  storeId: string | null;
}

// Metadatos de la conexión que quedan registrados junto al refresh token.
export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

// Respuesta de login/refresh: par de tokens y datos mínimos del usuario.
export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  // Segundos de vida del access token.
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    storeId: string | null;
  };
}
