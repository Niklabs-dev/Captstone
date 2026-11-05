import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { isProxyUuid, proxyBackend, proxyError } from '@/lib/backend-proxy';

type Context = { params: Promise<{ id: string }> };

// Detalle inmutable de un cierre (GET /cash-closings/:id). El backend aplica
// el rol y el aislamiento por local; aquí solo se acota la ruta.
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await getSession();
  if (!session.ok) return proxyError(session.status);
  if (!['ADMINISTRADOR', 'SUPERVISOR', 'CONTADOR'].includes(session.data.role))
    return proxyError(403);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return proxyError(401);
  const { id } = await context.params;
  if (!isProxyUuid(id)) return proxyError(404);
  if (new URL(request.url).search) return proxyError(400);
  return proxyBackend('/cash-closings/' + id, token);
}
