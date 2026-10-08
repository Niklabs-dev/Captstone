import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { ACCESS_COOKIE } from './auth';
import type { BackendResult } from './auth-backend';
import {
  verifyAuditAdministrator,
  type AuditAdministrator,
} from './audit-backend';

export const getAuditSession = cache(
  async (): Promise<BackendResult<AuditAdministrator & { token: string }>> => {
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!token)
      return {
        ok: false,
        status: 401,
        message: 'Inicia sesión para continuar.',
      };
    const result = await verifyAuditAdministrator(token);
    return result.ok ? { ok: true, data: { ...result.data, token } } : result;
  },
);
