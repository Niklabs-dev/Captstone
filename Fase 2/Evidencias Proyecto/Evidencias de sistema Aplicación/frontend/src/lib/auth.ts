export const ACCESS_COOKIE = 'mf_access';
export const REFRESH_COOKIE = 'mf_refresh';
export const ROLES = [
  'ADMINISTRADOR',
  'SUPERVISOR',
  'TRABAJADOR',
  'CONTADOR',
] as const;
export type Role = (typeof ROLES)[number];
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  storeId: string | null;
}
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  user: AuthUser & { firstName: string; lastName: string };
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isAuthUser(value: unknown): value is AuthUser {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.email === 'string' &&
    value.email.length > 0 &&
    ROLES.some((role) => role === value.role) &&
    (value.storeId === null || typeof value.storeId === 'string')
  );
}
export function isAuthTokens(value: unknown): value is AuthTokens {
  return (
    isRecord(value) &&
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken.length > 0 &&
    value.tokenType === 'Bearer' &&
    typeof value.expiresIn === 'number' &&
    Number.isSafeInteger(value.expiresIn) &&
    value.expiresIn > 0 &&
    isAuthUser(value.user) &&
    'firstName' in value.user &&
    typeof value.user.firstName === 'string' &&
    'lastName' in value.user &&
    typeof value.user.lastName === 'string'
  );
}
export function parseCredentials(
  value: unknown,
): { email: string; password: string } | null {
  if (
    !isRecord(value) ||
    typeof value.email !== 'string' ||
    typeof value.password !== 'string'
  )
    return null;
  const email = value.email.trim().toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    value.password.length === 0 ||
    value.password.length > 128
  )
    return null;
  return { email, password: value.password };
}
export function cookieOptions(
  secure: boolean,
  maxAge: number,
): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge };
}
// Las mutaciones autenticadas por cookies aceptan únicamente el origen del frontend.
export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  // Next.js standalone puede construir request.url con el host interno del contenedor.
  // Host conserva el destino público solicitado por el navegador; el proxy debe
  // conservarlo y sobrescribir X-Forwarded-Proto con el protocolo público.
  const requestUrl = new URL(request.url);
  const host = request.headers.get('host') ?? requestUrl.host;
  const protocol =
    request.headers.get('x-forwarded-proto') ??
    requestUrl.protocol.slice(0, -1);
  if (protocol !== 'http' && protocol !== 'https') return false;
  try {
    return origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}
