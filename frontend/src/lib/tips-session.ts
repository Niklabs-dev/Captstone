import { cache } from 'react';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, type AuthUser } from './auth';
import { getSession } from './session';
import { isUuid } from './users';
import { tipErrorMessage } from './tips';

type TipsSession =
  | { ok: true; token: string; user: AuthUser & { storeId: string } }
  | { ok: false; status: number; message: string };

export const getTipsSession = cache(async (): Promise<TipsSession> => {
  const session = await getSession();
  if (!session.ok) return session;
  if (session.data.role !== 'SUPERVISOR' || !isUuid(session.data.storeId))
    return { ok: false, status: 403, message: tipErrorMessage(403) };
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return { ok: false, status: 401, message: tipErrorMessage(401) };
  return {
    ok: true,
    token,
    user: { ...session.data, storeId: session.data.storeId },
  };
});
