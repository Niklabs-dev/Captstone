import { cookies } from 'next/headers';

/**
 * Integración real con el backend (SPRINT-1-T06, auth.controller.ts).
 * Reemplaza a lib/mock-auth.ts para el flujo de login/sesión — mock-auth.ts
 * se mantiene solo para lo que aún no tiene backend (usuarios, auditoría).
 */

export const ACCESS_COOKIE = 'mf_access';
export const REFRESH_COOKIE = 'mf_refresh';
export const USER_COOKIE = 'mf_user';

// Códigos de rol tal como los devuelve el backend (roles.constants.ts).
export type BackendRole = 'ADMINISTRADOR' | 'SUPERVISOR' | 'TRABAJADOR' | 'CONTADOR';

export interface SessionUser {
  id: string;
  email: string;
  nombre: string; // firstName + lastName combinados para mostrar en la UI
  rol: BackendRole;
  storeId: string | null;
}

/**
 * URL del backend para llamadas SERVIDOR→SERVIDOR (Route Handlers, Server
 * Components). Dentro de docker compose el frontend debe alcanzar al backend
 * por el nombre del servicio (`backend`), no por `localhost` — por eso esto
 * es una variable aparte de NEXT_PUBLIC_API_URL (esa es para el navegador).
 * Si Nicolás no agrega BACKEND_INTERNAL_URL al docker-compose, hay que
 * agregarlo: BACKEND_INTERNAL_URL: http://backend:3001
 */
export function backendUrl(path: string): string {
  const base =
    process.env.BACKEND_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3001';
  return `${base}${path}`;
}

export function landingPathForRole(rol: BackendRole): string {
  return rol === 'TRABAJADOR' ? '/portal' : '/admin';
}

export function parseUserCookie(raw: string | undefined): SessionUser | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

/** Para usar en Server Components / Route Handlers (next/headers). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return parseUserCookie(jar.get(USER_COOKIE)?.value);
}

/** El access token JWT, para reenviarlo como Bearer al backend (server-side only). */
export async function getAccessToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACCESS_COOKIE)?.value ?? null;
}
