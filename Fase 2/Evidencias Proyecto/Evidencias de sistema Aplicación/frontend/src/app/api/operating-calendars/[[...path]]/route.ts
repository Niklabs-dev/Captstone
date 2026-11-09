import { NextResponse } from 'next/server';
import { hasTrustedOrigin } from '@/lib/auth';
import { callBackend } from '@/lib/auth-backend';
import { isProxyUuid, readProxyJson } from '@/lib/backend-proxy';
import {
  calendarError,
  parseCalendarInput,
  parseClosureInput,
  parseOperatingCalendar,
  parseStoreClosure,
} from '@/lib/sales-overview';
import { getUsersSession } from '@/lib/users-session';

// SPRINT-4R-T14: BFF del calendario de operación de los locales, exclusivo
// del administrador (mismo patrón que /api/sales-imports). Rutas:
//   GET/PUT  /api/operating-calendars/:storeId
//   POST     /api/operating-calendars/:storeId/closures
//   DELETE   /api/operating-calendars/:storeId/closures/:closureId
// El token queda en el servidor y solo se reenvían campos del contrato.
type Context = { params: Promise<{ path?: string[] }> };

function respond(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
function failure(status: number): NextResponse {
  const safe = [400, 401, 403, 404, 409, 429, 503].includes(status)
    ? status
    : 502;
  return respond({ message: calendarError(safe) }, safe);
}
async function session(): Promise<{ token: string } | { error: NextResponse }> {
  const current = await getUsersSession();
  return current.ok
    ? { token: current.token }
    : { error: failure(current.status) };
}
async function forward(
  path: string,
  token: string,
  parse: (value: unknown) => unknown,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<NextResponse> {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const upstream = await callBackend(path, {
    method: init.method,
    redirect: 'error',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!upstream) return failure(503);
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return failure(upstream.status);
  }
  const parsed = parse(await upstream.json().catch(() => null));
  return parsed ? respond(parsed, upstream.status) : failure(502);
}
function calendarPath(storeId: string): string {
  return `/stores/${storeId}/operating-calendar`;
}

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const auth = await session();
  if ('error' in auth) return auth.error;
  const path = (await context.params).path ?? [];
  if (new URL(request.url).search) return failure(400);
  if (path.length !== 1 || !isProxyUuid(path[0])) return failure(404);
  return forward(calendarPath(path[0]), auth.token, parseOperatingCalendar);
}

export async function PUT(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasTrustedOrigin(request)) return failure(403);
  const auth = await session();
  if ('error' in auth) return auth.error;
  const path = (await context.params).path ?? [];
  if (path.length !== 1 || !isProxyUuid(path[0])) return failure(404);
  const input = parseCalendarInput(await readProxyJson(request, 1024));
  if (!input) return failure(400);
  return forward(calendarPath(path[0]), auth.token, parseOperatingCalendar, {
    method: 'PUT',
    body: input,
  });
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasTrustedOrigin(request)) return failure(403);
  const auth = await session();
  if ('error' in auth) return auth.error;
  const path = (await context.params).path ?? [];
  if (path.length !== 2 || !isProxyUuid(path[0]) || path[1] !== 'closures')
    return failure(404);
  const input = parseClosureInput(await readProxyJson(request, 4096));
  if (!input) return failure(400);
  return forward(`/stores/${path[0]}/closures`, auth.token, parseStoreClosure, {
    method: 'POST',
    body: input,
  });
}

export async function DELETE(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasTrustedOrigin(request)) return failure(403);
  const auth = await session();
  if ('error' in auth) return auth.error;
  const path = (await context.params).path ?? [];
  if (
    path.length !== 3 ||
    !isProxyUuid(path[0]) ||
    path[1] !== 'closures' ||
    !isProxyUuid(path[2])
  )
    return failure(404);
  return forward(
    `/stores/${path[0]}/closures/${path[2]}`,
    auth.token,
    parseStoreClosure,
    { method: 'DELETE' },
  );
}
