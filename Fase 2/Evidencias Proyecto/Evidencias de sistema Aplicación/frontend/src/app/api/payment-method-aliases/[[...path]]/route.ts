import { NextResponse } from 'next/server';
import { proxyBackend, readProxyJson } from '@/lib/backend-proxy';
import {
  aliasErrorMessage,
  parseAliasInput,
  parsePaymentMethodAlias,
  parsePaymentMethodAliases,
  type AliasOperation,
} from '@/lib/payment-method-aliases';
import { hasSameOrigin, isUuid } from '@/lib/users';
import { getUsersSession } from '@/lib/users-session';

// SPRINT-4A-T20: BFF de los alias de medios de pago, exclusivo del
// administrador. El token queda en el servidor, solo se reenvían campos del
// contrato y los errores usan mensajes propios (nunca los del backend).
type Context = { params: Promise<{ path?: string[] }> };

function respond(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
function failure(status: number, operation: AliasOperation): NextResponse {
  const safe = [400, 401, 403, 404, 409, 503].includes(status) ? status : 502;
  return respond({ message: aliasErrorMessage(safe, operation) }, safe);
}
async function forward(
  path: string,
  token: string,
  init: RequestInit,
  operation: AliasOperation,
): Promise<Response> {
  const upstream = await proxyBackend(path, token, init);
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return failure(upstream.status, operation);
  }
  const raw: unknown = await upstream.json().catch(() => null);
  const data =
    operation === 'load'
      ? parsePaymentMethodAliases(raw)
      : parsePaymentMethodAlias(raw);
  return data ? respond(data, upstream.status) : failure(502, operation);
}

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length || new URL(request.url).search) return failure(404, 'load');
  const session = await getUsersSession();
  if (!session.ok) return failure(session.status, 'load');
  return forward('/payment-method-aliases', session.token, {}, 'load');
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasSameOrigin(request)) return failure(403, 'create');
  const { path = [] } = await context.params;
  if (path.length) return failure(404, 'create');
  const session = await getUsersSession();
  if (!session.ok) return failure(session.status, 'create');
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    return failure(400, 'create');
  const input = parseAliasInput(await readProxyJson(request, 1024));
  if (!input) return failure(400, 'create');
  return forward(
    '/payment-method-aliases',
    session.token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    'create',
  );
}

export async function DELETE(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasSameOrigin(request)) return failure(403, 'delete');
  const { path = [] } = await context.params;
  if (path.length !== 1 || !isUuid(path[0])) return failure(404, 'delete');
  const session = await getUsersSession();
  if (!session.ok) return failure(session.status, 'delete');
  return forward(
    '/payment-method-aliases/' + path[0],
    session.token,
    { method: 'DELETE' },
    'delete',
  );
}
