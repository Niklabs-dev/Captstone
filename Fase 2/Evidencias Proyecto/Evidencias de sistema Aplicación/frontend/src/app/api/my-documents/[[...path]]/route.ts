import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE } from '@/lib/auth';
import { clearSessionCookies, getSession } from '@/lib/session';
import {
  canReadOwnDocuments,
  ownDocumentPath,
  parseOwnDocuments,
  parseOwnDocumentHistory,
} from '@/lib/my-documents';
import { proxyBackend, proxyError } from '@/lib/backend-proxy';

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const session = await getSession();
  if (!session.ok) {
    const response = NextResponse.json(
      { message: session.message },
      {
        status: session.status,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
    return session.status === 401 ? clearSessionCookies(response) : response;
  }
  if (!canReadOwnDocuments(session.data.role)) return proxyError(403);
  const { path = [] } = await context.params;
  const query = new URL(request.url).searchParams;
  const upstreamPath = ownDocumentPath(path, query);
  if (!upstreamPath) return proxyError([...query.keys()].length ? 400 : 404);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return proxyError(401);
  // El backend verifica propiedad para cada historial, integridad y descarga.
  const response = await proxyBackend(
    upstreamPath,
    token,
    {},
    path[2] === 'download',
  );
  if (response.status === 401)
    return clearSessionCookies(
      new NextResponse(response.body, {
        status: response.status,
        headers: response.headers,
      }),
    );
  if (!response.ok || path[0] === 'versions') return response;
  const value: unknown = await response.json().catch(() => null);
  const data = path.length
    ? parseOwnDocumentHistory(value, session.data.id, path[0])
    : parseOwnDocuments(value, session.data.id);
  return data
    ? Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
    : proxyError(502);
}
