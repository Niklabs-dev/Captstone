import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';
import { ACCESS_COOKIE, hasTrustedOrigin } from '@/lib/auth';
import {
  canReadPayroll,
  canManagePayroll,
  MAX_PAYROLL_BYTES,
  calendarDate,
  isPayrollPeriod,
} from '@/lib/payroll';
import {
  isProxyUuid,
  proxyBackend,
  proxyError,
  readProxyForm,
} from '@/lib/backend-proxy';
type Context = { params: Promise<{ path?: string[] }> };
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await getSession();
  if (!session.ok) return proxyError(session.status);
  if (!canReadPayroll(session.data.role)) return proxyError(403);
  const { path = [] } = await context.params;
  if (path.length) return proxyError(404);
  if (new URL(request.url).search) return proxyError(400);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return proxyError(401);
  return proxyBackend('/payroll', token);
}
export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasTrustedOrigin(request)) return proxyError(403);
  const session = await getSession();
  if (!session.ok) return proxyError(session.status);
  if (!canManagePayroll(session.data.role)) return proxyError(403);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return proxyError(401);
  const { path = [] } = await context.params;
  if (!path.length) {
    const form = await readProxyForm(request, MAX_PAYROLL_BYTES);
    if (!form) return proxyError(400);
    const file = form.get('file'),
      workerId = form.get('workerId'),
      period = form.get('period');
    if (
      !(file instanceof File) ||
      file.size <= 0 ||
      typeof workerId !== 'string' ||
      !isProxyUuid(workerId) ||
      !isPayrollPeriod(period)
    )
      return proxyError(400);
    if (file.size > MAX_PAYROLL_BYTES) return proxyError(413);
    const payload = new FormData();
    payload.set('file', file);
    payload.set('workerId', workerId);
    payload.set('period', period);
    return proxyBackend('/payroll', token, { method: 'POST', body: payload });
  }
  if (path.length !== 2 || !isProxyUuid(path[0]) || path[1] !== 'publish')
    return proxyError(404);
  const input: unknown = await request.json().catch(() => null);
  if (
    typeof input !== 'object' ||
    input === null ||
    !('revision' in input) ||
    typeof input.revision !== 'string' ||
    !input.revision.trim() ||
    input.revision.length > 128 ||
    !('signedAt' in input) ||
    !calendarDate(input.signedAt)
  )
    return proxyError(400);
  return proxyBackend(`/payroll/${path[0]}/publish`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      revision: input.revision,
      signedAt: input.signedAt,
    }),
  });
}
