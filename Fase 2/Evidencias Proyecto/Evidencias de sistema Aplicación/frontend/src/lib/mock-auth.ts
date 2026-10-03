import { SessionUser } from './types';

/**
 * MOCK — solo para desarrollar el frontend en paralelo mientras el backend
 * (SPRINT-1-T02 variables de entorno, SPRINT-1-T06 JWT) no está disponible.
 *
 * Cuando el endpoint real exista (NestJS, POST /auth/login), reemplazar
 * `mockLogin` por un fetch real contra `process.env.NEXT_PUBLIC_API_URL`
 * y guardar el token que devuelva el backend en vez de la cookie mock.
 */

const MOCK_USERS: Record<string, { password: string; user: SessionUser }> = {
  'admin@moifood.cl': {
    password: 'admin123',
    user: { id: 'u1', nombre: 'Moisés Jiménez', rol: 'administrador' },
  },
  'contador@moifood.cl': {
    password: 'contador123',
    user: { id: 'u2', nombre: 'Ricardo Ballesteros', rol: 'contador' },
  },
  'supervisor@moifood.cl': {
    password: 'super123',
    user: { id: 'u3', nombre: 'Rosa Fernández', rol: 'supervisor', local: 'LOC-01' },
  },
  'trabajador@moifood.cl': {
    password: 'trabajo123',
    user: { id: 'u4', nombre: 'Camila Rojas', rol: 'trabajador', local: 'LOC-02' },
  },
};

export const SESSION_COOKIE = 'moifood_session';

export function mockLogin(email: string, password: string): SessionUser | null {
  const entry = MOCK_USERS[email.trim().toLowerCase()];
  if (!entry || entry.password !== password) return null;
  return entry.user;
}

export function setSessionCookie(user: SessionUser) {
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(
    JSON.stringify(user)
  )}; path=/; max-age=86400; samesite=lax`;
}

export function clearSessionCookie() {
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0`;
}

/** Solo usable en Client Components — en Server Components usar cookies() de next/headers. */
export function getSessionUserClient(): SessionUser | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function parseSessionCookie(raw: string | undefined): SessionUser | null {
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/** Ruta de aterrizaje según rol — usada por la redirección post-login (SPRINT-1-T11). */
export function landingPathForRole(rol: SessionUser['rol']): string {
  return rol === 'trabajador' ? '/portal' : '/admin';
}
