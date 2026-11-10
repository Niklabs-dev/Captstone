import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getSession, clearSessionCookies } from '@/lib/session';
import { getUsersSession } from '@/lib/users-session';
import { hasSameOrigin, isUuid } from '@/lib/users';
import { ACCESS_COOKIE } from '@/lib/auth';
import { proxyBackend } from '@/lib/backend-proxy';
import {
  parsePaymentMethod,
  parsePaymentMethods,
  parsePaymentMethodCreateInput,
  parsePaymentMethodUpdateInput,
  paymentMethodErrorMessage,
} from '@/lib/payment-methods';

type Context = { params: Promise<{ path?: string[] }> };

function respond(data: unknown, status = 200): NextResponse {
  const response = NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
  return status === 401 ? clearSessionCookies(response) : response;
}
// Traduce el estado a un mensaje público sin exponer detalles internos del backend.
async function forward(
  path: string,
  token: string,
  init: RequestInit = {},
  collection = false,
): Promise<Response> {
  const response = await proxyBackend(path, token, init);
  if (!response.ok)
    return respond(
      {
        message: paymentMethodErrorMessage(
          response.status,
          !init.method || init.method === 'GET'
            ? 'load'
            : path.endsWith('/deactivate') || path.endsWith('/reactivate')
              ? 'state'
              : 'save',
        ),
      },
      response.status,
    );
  const raw: unknown = await response.json().catch(() => null);
  const data = collection ? parsePaymentMethods(raw) : parsePaymentMethod(raw);
  if (data && init.method && init.method !== 'GET') {
    for (const page of ['/admin/medios-pago', '/propinas/diarias'])
      revalidatePath(page);
  }
  return data
    ? respond(data, response.status)
    : respond({ message: paymentMethodErrorMessage(502) }, 502);
}
// El catálogo alimenta formularios de otros roles (por ejemplo propinas), así que
// cualquier sesión válida consulta; solo administración lista medios inactivos.
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length) return respond({ message: 'Ruta no encontrada.' }, 404);
  const session = await getSession();
  if (!session.ok)
    return respond(
      { message: paymentMethodErrorMessage(session.status, 'load') },
      session.status,
    );
  const query = new URL(request.url).searchParams;
  for (const key of ['isActive', 'availableForTips']) {
    if (
      [...query.keys()].filter((name) => name === key).length > 1 ||
      (query.has(key) && !['true', 'false'].includes(query.get(key) ?? ''))
    )
      return respond({ message: 'Filtro no válido.' }, 400);
  }
  if (
    [...query.keys()].some(
      (key) => key !== 'isActive' && key !== 'availableForTips',
    )
  )
    return respond({ message: 'Filtro no válido.' }, 400);
  // Los inactivos solo se listan para administración; los demás roles piden activos.
  if (session.data.role !== 'ADMINISTRADOR' && query.get('isActive') !== 'true')
    return respond({ message: paymentMethodErrorMessage(403, 'load') }, 403);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return respond({ message: paymentMethodErrorMessage(401) }, 401);
  return forward(
    '/payment-methods' + (query.size ? '?' + query.toString() : ''),
    token,
    {},
    true,
  );
}
async function mutate(
  request: Request,
  context: Context,
  method: 'POST' | 'PATCH',
): Promise<Response> {
  if (!hasSameOrigin(request))
    return respond({ message: 'Origen no permitido.' }, 403);
  const session = await getUsersSession();
  if (!session.ok)
    return respond(
      { message: paymentMethodErrorMessage(session.status) },
      session.status,
    );
  const { path = [] } = await context.params;
  const create = method === 'POST' && path.length === 0;
  const edit = method === 'PATCH' && path.length === 1 && isUuid(path[0]);
  const state =
    method === 'PATCH' &&
    path.length === 2 &&
    isUuid(path[0]) &&
    ['deactivate', 'reactivate'].includes(path[1]);
  if (!create && !edit && !state)
    return respond({ message: 'Ruta no encontrada.' }, 404);
  let body: string | undefined;
  if (!state) {
    if (!request.headers.get('Content-Type')?.startsWith('application/json'))
      return respond({ message: paymentMethodErrorMessage(400) }, 400);
    const text = await request.text();
    if (text.length > 4096)
      return respond({ message: paymentMethodErrorMessage(400) }, 400);
    const raw: unknown = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
    const input = create
      ? parsePaymentMethodCreateInput(raw)
      : parsePaymentMethodUpdateInput(raw);
    if (!input)
      return respond({ message: paymentMethodErrorMessage(400) }, 400);
    body = JSON.stringify(input);
  }
  return forward(
    '/payment-methods' + (path.length ? '/' + path.join('/') : ''),
    session.token,
    {
      method,
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body }
        : {}),
    },
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
