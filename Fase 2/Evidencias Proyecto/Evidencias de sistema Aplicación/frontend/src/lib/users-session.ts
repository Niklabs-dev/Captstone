import { cookies } from 'next/headers';
import { cache } from 'react';
import { verifyAdministrator, type UserIdentity } from './users-backend';
type UsersSession =
  | { ok: true; token: string; user: UserIdentity }
  | { ok: false; status: number; message: string };
// Contrato de cookie de SPRINT-1-T09. La validación se hace con NestJS, sin decodificar JWT en el cliente.
export const getUsersSession = cache(async (): Promise<UsersSession> => {
  const token = (await cookies()).get('mf_access')?.value;
  const result = await verifyAdministrator(token);
  if (!result.ok) return result;
  if (!token)
    return { ok: false, status: 401, message: 'Inicia sesión para continuar.' };
  return { ok: true, token, user: result.data };
});
