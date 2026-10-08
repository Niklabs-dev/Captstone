import {
  isAuthTokens,
  isAuthUser,
  type AuthTokens,
  type AuthUser,
} from './auth';
export type BackendResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string };
function backendUrl(path: string): string {
  const base = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3001';
  return `${base.replace(/\/$/, '')}${path}`;
}
export async function callBackend(
  path: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(backendUrl(path), {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
}
export async function requestTokens(
  path: '/auth/login' | '/auth/refresh',
  body: { email: string; password: string } | { refreshToken: string },
): Promise<BackendResult<AuthTokens>> {
  const response = await callBackend(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response)
    return {
      ok: false,
      status: 503,
      message: 'No se pudo conectar. Intenta nuevamente en unos momentos.',
    };
  if (!response.ok) {
    if (response.status === 401)
      return {
        ok: false,
        status: 401,
        message:
          path === '/auth/login'
            ? 'Correo o contraseña incorrectos.'
            : 'La sesión venció. Inicia sesión nuevamente.',
      };
    if (response.status === 400)
      return {
        ok: false,
        status: 400,
        message: 'La solicitud no es válida. Revisa los datos ingresados.',
      };
    if (response.status === 429)
      return {
        ok: false,
        status: 429,
        message:
          'Demasiados intentos. Espera unos momentos y vuelve a intentar.',
      };
    return {
      ok: false,
      status: 502,
      message: 'El servicio no está disponible. Intenta nuevamente más tarde.',
    };
  }
  const data: unknown = await response.json().catch(() => null);
  if (!isAuthTokens(data))
    return {
      ok: false,
      status: 502,
      message: 'No se pudo completar el inicio de sesión. Intenta nuevamente.',
    };
  return { ok: true, data };
}
export async function verifyAccessToken(
  token: string,
): Promise<BackendResult<AuthUser>> {
  const response = await callBackend('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response || response.status >= 500)
    return {
      ok: false,
      status: 503,
      message:
        'No se pudo verificar la sesión. Intenta nuevamente en unos momentos.',
    };
  if (!response.ok)
    return {
      ok: false,
      status: 401,
      message: 'La sesión venció. Inicia sesión nuevamente.',
    };
  const user: unknown = await response.json().catch(() => null);
  if (!isAuthUser(user))
    return {
      ok: false,
      status: 502,
      message: 'No se pudo verificar la sesión.',
    };
  return { ok: true, data: user };
}
