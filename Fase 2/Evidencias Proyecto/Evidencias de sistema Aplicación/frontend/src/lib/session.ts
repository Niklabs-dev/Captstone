import { cookies } from 'next/headers';
import { cache } from 'react';
import { NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  cookieOptions,
  type AuthTokens,
  type AuthUser,
} from './auth';
import { verifyAccessToken, type BackendResult } from './auth-backend';
export const getSession = cache(async (): Promise<BackendResult<AuthUser>> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token)
    return { ok: false, status: 401, message: 'Inicia sesión para continuar.' };
  return verifyAccessToken(token);
});
export function setSessionCookies(
  response: NextResponse,
  tokens: AuthTokens,
): NextResponse {
  const secure = process.env.NODE_ENV === 'production';
  const refreshMaxAge = Number(
    process.env.AUTH_REFRESH_COOKIE_MAX_AGE ?? 604800,
  );
  if (!Number.isSafeInteger(refreshMaxAge) || refreshMaxAge <= 0)
    throw new Error('AUTH_REFRESH_COOKIE_MAX_AGE debe ser un entero positivo.');
  response.cookies.set(
    ACCESS_COOKIE,
    tokens.accessToken,
    cookieOptions(secure, tokens.expiresIn),
  );
  response.cookies.set(
    REFRESH_COOKIE,
    tokens.refreshToken,
    cookieOptions(secure, refreshMaxAge),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export function clearSessionCookies(response: NextResponse): NextResponse {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE])
    response.cookies.set(
      name,
      '',
      cookieOptions(process.env.NODE_ENV === 'production', 0),
    );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
