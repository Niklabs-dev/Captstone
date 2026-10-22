import { getUsersSession } from '@/lib/users-session';
import { hasTrustedOrigin } from '@/lib/auth';
import { isProxyUuid, proxyBackend, proxyError } from '@/lib/backend-proxy';

type Context = { params: Promise<{ path?: string[] }> };
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await getUsersSession();
  if (!session.ok) return proxyError(session.status);
  const { path = [] } = await context.params;
  if (path.length) return proxyError(404);
  if (new URL(request.url).search) return proxyError(400);
  return proxyBackend('/dt-alerts', session.token);
}
export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasTrustedOrigin(request)) return proxyError(403);
  const session = await getUsersSession();
  if (!session.ok) return proxyError(session.status);
  const { path = [] } = await context.params;
  if (path.length !== 2 || !isProxyUuid(path[0]) || path[1] !== 'registration')
    return proxyError(404);
  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== 'object' ||
    body === null ||
    !('documentId' in body) ||
    !('revision' in body) ||
    typeof body.documentId !== 'string' ||
    !isProxyUuid(body.documentId) ||
    body.documentId !== path[0] ||
    typeof body.revision !== 'string' ||
    !body.revision.trim() ||
    body.revision.length > 128
  )
    return proxyError(400);
  return proxyBackend(`/dt-alerts/${path[0]}/registration`, session.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentId: body.documentId,
      revision: body.revision,
    }),
  });
}
