import { cache } from 'react';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, type AuthUser } from './auth';
import { getSession } from './session';
import { isUuid } from './users';
import {
  canReadDailyVoucher,
  dailyOperationErrorMessage,
} from './daily-operations';

export type SupervisorSession =
  | { ok: true; token: string; user: AuthUser & { storeId: string } }
  | { ok: false; status: number; message: string };

// SPRINT-4R-T01: la operación diaria la registra exclusivamente el supervisor
// de su propio local; el proxy siempre sobrescribe el storeId con este valor.
export const getSupervisorSession = cache(
  async (): Promise<SupervisorSession> => {
    const session = await getSession();
    if (!session.ok) return session;
    if (session.data.role !== 'SUPERVISOR' || !isUuid(session.data.storeId))
      return {
        ok: false,
        status: 403,
        message: dailyOperationErrorMessage(403),
      };
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!token)
      return {
        ok: false,
        status: 401,
        message: dailyOperationErrorMessage(401),
      };
    return {
      ok: true,
      token,
      user: { ...session.data, storeId: session.data.storeId },
    };
  },
);

export type VoucherReaderSession =
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; status: number; message: string };

// SPRINT-4A-T11: lectores del voucher privado por el BFF. El supervisor
// conserva su acceso (el backend acota su local), el administrador lo revisa
// desde el panel y los reportes de ventas y, desde SPRINT-4A-T23, el contador
// desde los reportes; el trabajador (y cualquier otro rol) recibe 403.
export const getVoucherReaderSession = cache(
  async (): Promise<VoucherReaderSession> => {
    const session = await getSession();
    if (!session.ok) return session;
    if (!canReadDailyVoucher(session.data))
      return {
        ok: false,
        status: 403,
        message: dailyOperationErrorMessage(403),
      };
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!token)
      return {
        ok: false,
        status: 401,
        message: dailyOperationErrorMessage(401),
      };
    return { ok: true, token, user: session.data };
  },
);
