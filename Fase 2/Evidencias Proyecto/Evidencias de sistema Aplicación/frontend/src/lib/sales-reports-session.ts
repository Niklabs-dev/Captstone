import { cache } from 'react';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, type AuthUser } from './auth';
import { canReadSalesReports, salesOverviewError } from './sales-overview';
import { getSession } from './session';

export type SalesReportsSession =
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; status: number; message: string };

// SPRINT-4A-T23: sesión de los reportes de ventas y del detalle de solo
// lectura de la operación diaria enlazado desde ellos. Los admiten
// ADMINISTRADOR y CONTADOR; el backend vuelve a exigir esos roles en
// GET /sales-reports y acota por local en /daily-operations.
export const getSalesReportsSession = cache(
  async (): Promise<SalesReportsSession> => {
    const session = await getSession();
    if (!session.ok) return session;
    if (!canReadSalesReports(session.data.role))
      return { ok: false, status: 403, message: salesOverviewError(403) };
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!token)
      return { ok: false, status: 401, message: salesOverviewError(401) };
    return { ok: true, token, user: session.data };
  },
);
