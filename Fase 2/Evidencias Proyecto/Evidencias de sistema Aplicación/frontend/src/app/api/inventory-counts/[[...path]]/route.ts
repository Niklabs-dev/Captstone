import { callBackend } from '@/lib/auth-backend';
import { isProxyUuid } from '@/lib/backend-proxy';
import { XLSX_CONTENT_TYPE } from '@/lib/daily-tips';
import { inventoryCountError } from '@/lib/inventory-counts';
import { getUsersSession } from '@/lib/users-session';

// SPRINT-5-T09: descarga del Excel de una toma de inventario finalizada
// (SPRINT-5-T08), exclusiva del administrador. El listado y el detalle se leen
// desde Server Components; aquí solo existe GET :id/export. El token queda en
// el servidor y solo se reenvía un .xlsx con su nombre.
type Context = { params: Promise<{ path?: string[] }> };

function failure(status: number): Response {
  const safe = [400, 401, 403, 404, 409, 429, 503].includes(status)
    ? status
    : 502;
  return Response.json(
    { message: inventoryCountError(safe, 'export') },
    {
      status: safe,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const path = (await context.params).path ?? [];
  if (path.length !== 2 || !isProxyUuid(path[0]) || path[1] !== 'export')
    return failure(404);
  if (new URL(request.url).search) return failure(400);
  // Verifica con el backend que la sesión sea de un administrador.
  const session = await getUsersSession();
  if (!session.ok) return failure(session.status);
  const upstream = await callBackend(`/inventory-counts/${path[0]}/export`, {
    headers: { Authorization: 'Bearer ' + session.token },
    redirect: 'error',
  });
  if (!upstream) return failure(503);
  if (
    upstream.status !== 200 ||
    !upstream.headers.get('content-type')?.startsWith(XLSX_CONTENT_TYPE)
  ) {
    await upstream.body?.cancel();
    return failure(upstream.ok ? 502 : upstream.status);
  }
  const headers = new Headers({
    'Content-Type': XLSX_CONTENT_TYPE,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of ['Content-Length', 'Content-Disposition']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
