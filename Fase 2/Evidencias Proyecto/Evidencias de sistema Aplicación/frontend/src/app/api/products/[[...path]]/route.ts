import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from '@/lib/auth';
import { callBackend } from '@/lib/auth-backend';
import { isProxyUuid } from '@/lib/backend-proxy';
import {
  parseFieldErrors,
  parseProduct,
  parseProductInput,
  parseProducts,
  parseSections,
  productErrorMessage,
} from '@/lib/products';
import { getSession } from '@/lib/session';
import { hasSameOrigin } from '@/lib/users';
import { getUsersSession } from '@/lib/users-session';

// SPRINT-5-T04: BFF del catálogo de productos de inventario. Consultan el
// administrador y el supervisor (el backend aplica los roles); solo el
// administrador modifica. El token queda en el servidor y solo se reenvían
// campos del contrato y errores por campo conocidos.
type Context = { params: Promise<{ path?: string[] }> };

const QUERY_KEYS = ['section', 'isActive', 'missingFormat', 'search'];

function respond(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
function failure(status: number, errors?: object | null): NextResponse {
  const safe = [400, 401, 403, 404, 409, 429, 503].includes(status)
    ? status
    : 502;
  return respond(
    { message: productErrorMessage(safe), ...(errors ? { errors } : {}) },
    safe,
  );
}

async function forward(
  path: string,
  token: string,
  init: RequestInit,
  parse: (value: unknown) => unknown,
): Promise<NextResponse> {
  const upstream = await callBackend(path, {
    ...init,
    redirect: 'error',
    headers: { ...init.headers, Authorization: 'Bearer ' + token },
  });
  if (!upstream) return failure(503);
  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok)
    return failure(
      upstream.status,
      [400, 409].includes(upstream.status) ? parseFieldErrors(body) : null,
    );
  const parsed = parse(body);
  return parsed === null ? failure(502) : respond(parsed, upstream.status);
}

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await getSession();
  if (!session.ok) return failure(session.status);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return failure(401);
  const path = (await context.params).path ?? [];
  const query = new URL(request.url).searchParams;
  if (path.length === 1 && path[0] === 'sections' && query.size === 0)
    return forward('/products/sections', token, {}, parseSections);
  if (path.length > 0) return failure(404);
  if ([...query.keys()].some((key) => !QUERY_KEYS.includes(key)))
    return failure(400);
  return forward(
    '/products' + (query.size ? '?' + query.toString() : ''),
    token,
    {},
    parseProducts,
  );
}

async function mutate(
  request: Request,
  context: Context,
  method: 'POST' | 'PATCH',
): Promise<Response> {
  if (!hasSameOrigin(request)) return failure(403);
  const session = await getUsersSession();
  if (!session.ok) return failure(session.status);
  const path = (await context.params).path ?? [];
  const create = method === 'POST' && path.length === 0;
  const edit = method === 'PATCH' && path.length === 1 && isProxyUuid(path[0]);
  const state =
    method === 'PATCH' &&
    path.length === 2 &&
    isProxyUuid(path[0]) &&
    ['deactivate', 'reactivate'].includes(path[1]);
  if (!create && !edit && !state) return failure(404);
  let body: string | undefined;
  if (!state) {
    if (!request.headers.get('Content-Type')?.startsWith('application/json'))
      return failure(400);
    const text = await request.text();
    if (text.length > 4096) return failure(400);
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      return failure(400);
    }
    const input = parseProductInput(raw, edit);
    if (!input) return failure(400);
    body = JSON.stringify(input);
  }
  return forward(
    '/products' + (path.length ? '/' + path.join('/') : ''),
    session.token,
    {
      method,
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body }
        : {}),
    },
    parseProduct,
  );
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  return mutate(request, context, 'POST');
}
export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  return mutate(request, context, 'PATCH');
}
