import { backendUrl, getAccessToken } from './session';

// Coincide con UserResponseDto del backend (SPRINT-1-T08).
export interface ApiUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  rut: string | null;
  phone: string | null;
  hiredAt: string | null;
  isActive: boolean;
  role: { code: string; name: string };
  store: { id: string; name: string } | null;
  createdAt: string;
}

/**
 * Roles creables desde la UI hoy: el backend exige `storeId` para SUPERVISOR
 * y TRABAJADOR, pero no existe módulo de locales todavía (ni el seed crea
 * ninguno) — no hay ningún storeId real al que apuntar. Cuando exista el
 * endpoint de locales, se habilita el resto acá y en el <select> del form.
 */
export const CREATABLE_ROLES = [
  { code: 'ADMINISTRADOR', label: 'Administrador' },
  { code: 'CONTADOR', label: 'Contador' },
] as const;

/** Solo para Server Components — llama al backend directo (sin CORS, server-to-server). */
export async function fetchUsers(): Promise<{ users: ApiUser[]; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { users: [], error: 'Sin sesión.' };

  const res = await fetch(backendUrl('/users'), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null);

  if (!res) return { users: [], error: 'No se pudo contactar al servidor.' };
  if (!res.ok) return { users: [], error: `El backend respondió ${res.status}.` };

  return { users: (await res.json()) as ApiUser[] };
}
