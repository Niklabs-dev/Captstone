import { NextResponse } from 'next/server';
import { callBackend } from '@/lib/auth-backend';
import { isProxyUuid } from '@/lib/backend-proxy';
import {
  MAX_SEARCH_LENGTH,
  inventoryCountErrorMessage,
  parseCountDetail,
  parseCountFieldErrors,
  parseCountFinalization,
  parseCountItem,
  parseCountLineInput,
  parseCountSummaries,
  parseCountSummary,
  parseStartConflict,
  parseStartInput,
  type CountAction,
} from '@/lib/inventory-count';
import { getSupervisorSession } from '@/lib/supervisor-session';
import { hasSameOrigin } from '@/lib/users';

// SPRINT-5-T07: BFF de la toma de inventario del supervisor. Solo expone lo
// que usa la vista: listar las tomas de su local por estado, consultar una,
// iniciar, guardar la línea de un producto y finalizar. El token queda en el
// servidor, el local sale siempre de la sesión y solo se reenvían campos del
// contrato, errores por campo conocidos y, en el 409 al iniciar, el ID de la
// toma en curso para retomarla.
type Context = { params: Promise<{ path?: string[] }> };

function respond(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
function failure(
  status: number,
  action: CountAction,
  extra: object = {},
): NextResponse {
  const safe = [400, 401, 403, 404, 409, 429, 503].includes(status)
    ? status
    : 502;
  return respond(
    { message: inventoryCountErrorMessage(safe, action), ...extra },
    safe,
  );
}

async function forward(
  path: string,
  token: string,
  init: RequestInit,
  action: CountAction,
  parse: (value: unknown) => unknown,
  storeId: string,
): Promise<NextResponse> {
  const upstream = await callBackend(path, {
    ...init,
    redirect: 'error',
    headers: { ...init.headers, Authorization: 'Bearer ' + token },
  });
  if (!upstream) return failure(503, action);
  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const errors = [400, 409].includes(upstream.status)
      ? parseCountFieldErrors(body)
      : null;
    const conflict =
      action === 'start' && upstream.status === 409
        ? parseStartConflict(body)
        : null;
    return failure(upstream.status, action, {
      ...(errors ? { errors } : {}),
      ...(conflict ?? {}),
    });
  }
  const parsed = parse(body);
  // Defensa adicional: nunca se entrega una toma de otro local.
  const foreign = (Array.isArray(parsed) ? parsed : [parsed]).some(
    (item: unknown) =>
      typeof item === 'object' &&
      item !== null &&
      'storeId' in item &&
      item.storeId !== storeId,
  );
  return parsed === null || foreign
    ? failure(502, action)
    : respond(parsed, upstream.status);
}

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await getSupervisorSession();
  if (!session.ok) return failure(session.status, 'load');
  const path = (await context.params).path ?? [];
  const query = new URL(request.url).searchParams;
  const { token, user } = session;
  if (path.length === 0) {
    const status = query.get('status');
    if (
      query.size !== 1 ||
      query.getAll('status').length !== 1 ||
      (status !== 'OPEN' && status !== 'CONFIRMED')
    )
      return failure(400, 'load');
    return forward(
      '/inventory-counts?' + new URLSearchParams({ status }).toString(),
      token,
      {},
      'load',
      parseCountSummaries,
      user.storeId,
    );
  }
  if (path.length === 1 && isProxyUuid(path[0])) {
    const search = query.get('search');
    if (
      [...query.keys()].some((key) => key !== 'search') ||
      query.getAll('search').length > 1 ||
      (search !== null && search.length > MAX_SEARCH_LENGTH)
    )
      return failure(400, 'load');
    return forward(
      `/inventory-counts/${path[0]}` +
        (search ? '?' + new URLSearchParams({ search }).toString() : ''),
      token,
      {},
      'load',
      parseCountDetail,
      user.storeId,
    );
  }
  return failure(404, 'load');
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    return undefined;
  const text = await request.text();
  if (text.length > 1024) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  const path = (await context.params).path ?? [];
  const action: CountAction = path.length === 0 ? 'start' : 'finalize';
  if (!hasSameOrigin(request)) return failure(403, action);
  const session = await getSupervisorSession();
  if (!session.ok) return failure(session.status, action);
  if (new URL(request.url).search) return failure(400, action);
  const { token, user } = session;
  if (path.length === 0) {
    const input = parseStartInput(await readJson(request));
    if (!input) return failure(400, action);
    return forward(
      '/inventory-counts',
      token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      action,
      parseCountSummary,
      user.storeId,
    );
  }
  if (path.length === 2 && isProxyUuid(path[0]) && path[1] === 'finalize') {
    // Sin cuerpo: la toma y quien la finaliza salen de la ruta y la sesión.
    if ((await request.text()).length > 0) return failure(400, action);
    return forward(
      `/inventory-counts/${path[0]}/finalize`,
      token,
      { method: 'POST' },
      action,
      parseCountFinalization,
      user.storeId,
    );
  }
  return failure(404, action);
}

export async function PUT(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasSameOrigin(request)) return failure(403, 'save');
  const session = await getSupervisorSession();
  if (!session.ok) return failure(session.status, 'save');
  const path = (await context.params).path ?? [];
  if (
    path.length !== 3 ||
    !isProxyUuid(path[0]) ||
    path[1] !== 'lines' ||
    !isProxyUuid(path[2])
  )
    return failure(404, 'save');
  if (new URL(request.url).search) return failure(400, 'save');
  const input = parseCountLineInput(await readJson(request));
  if (!input) return failure(400, 'save');
  return forward(
    `/inventory-counts/${path[0]}/lines/${path[2]}`,
    session.token,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    'save',
    parseCountItem,
    session.user.storeId,
  );
}
