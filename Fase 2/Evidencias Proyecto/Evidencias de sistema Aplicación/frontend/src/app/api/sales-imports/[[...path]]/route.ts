import { NextResponse } from 'next/server';
import { hasTrustedOrigin } from '@/lib/auth';
import { callBackend } from '@/lib/auth-backend';
import { isProxyUuid, readProxyForm } from '@/lib/backend-proxy';
import {
  MAX_SALES_FILE_BYTES,
  parseConfirmBody,
  parseSalesImportDetail,
  parseSalesImportList,
  parseSalesImportPreview,
  parseSalesImportSummary,
  reportErrorMessage,
  salesImportError,
} from '@/lib/sales-imports';
import { getUsersSession } from '@/lib/users-session';

// SPRINT-4R-T11: BFF de la importación de ventas, exclusivo del administrador.
// El token queda en el servidor y solo se reenvían campos del contrato.
type Context = { params: Promise<{ path?: string[] }> };

function respond(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
function failure(status: number, message?: string): NextResponse {
  const safe = [400, 401, 403, 404, 409, 413, 415, 422, 429, 503].includes(
    status,
  )
    ? status
    : 502;
  return respond({ message: message ?? salesImportError(safe) }, safe);
}
async function session(): Promise<{ token: string } | { error: NextResponse }> {
  const current = await getUsersSession();
  return current.ok
    ? { token: current.token }
    : { error: failure(current.status) };
}
function bearer(token: string): Record<string, string> {
  return { Authorization: 'Bearer ' + token };
}

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const auth = await session();
  if ('error' in auth) return auth.error;
  const path = (await context.params).path ?? [];
  if (new URL(request.url).search) return failure(400);
  if (path.length > 2 || (path[0] !== undefined && !isProxyUuid(path[0])))
    return failure(404);
  if (path.length === 2 && path[1] !== 'file') return failure(404);
  const upstream = await callBackend(
    '/sales-imports' + (path.length ? '/' + path.join('/') : ''),
    { redirect: 'error', headers: bearer(auth.token) },
  );
  if (!upstream) return failure(503);
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return failure(upstream.status);
  }
  if (path[1] === 'file') {
    const headers = new Headers({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of [
      'Content-Type',
      'Content-Disposition',
      'Content-Length',
      'X-File-Integrity',
    ]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: 200, headers });
  }
  const body: unknown = await upstream.json().catch(() => null);
  const parsed = path.length
    ? parseSalesImportDetail(body)
    : parseSalesImportList(body);
  return parsed ? respond(parsed) : failure(502);
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasTrustedOrigin(request)) return failure(403);
  const auth = await session();
  if ('error' in auth) return auth.error;
  const path = (await context.params).path ?? [];
  if (path.length === 1 && path[0] === 'preview')
    return preview(request, auth.token);
  if (path.length === 2 && isProxyUuid(path[0]) && path[1] === 'confirm')
    return confirm(request, auth.token, path[0]);
  return failure(404);
}

async function preview(request: Request, token: string): Promise<Response> {
  const form = await readProxyForm(request, MAX_SALES_FILE_BYTES);
  if (!form) return failure(413);
  const file = form.get('file');
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    [...form.keys()].length !== 1
  )
    return failure(400);
  if (file.size > MAX_SALES_FILE_BYTES) return failure(413);
  const payload = new FormData();
  payload.set('file', file, file.name);
  const upstream = await callBackend('/sales-imports/preview', {
    method: 'POST',
    redirect: 'error',
    headers: bearer(token),
    body: payload,
  });
  if (!upstream) return failure(503);
  if (!upstream.ok) {
    const error: unknown = await upstream.json().catch(() => null);
    return failure(upstream.status, reportErrorMessage(error) ?? undefined);
  }
  const parsed = parseSalesImportPreview(
    await upstream.json().catch(() => null),
  );
  return parsed ? respond(parsed, upstream.status) : failure(502);
}

async function confirm(
  request: Request,
  token: string,
  id: string,
): Promise<Response> {
  const input = parseConfirmBody(await request.json().catch(() => null));
  if (!input) return failure(400);
  const upstream = await callBackend(`/sales-imports/${id}/confirm`, {
    method: 'POST',
    redirect: 'error',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!upstream) return failure(503);
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return failure(upstream.status);
  }
  const parsed = parseSalesImportDetail(
    await upstream.json().catch(() => null),
  );
  return parsed ? respond(parsed) : failure(502);
}

export async function DELETE(
  request: Request,
  context: Context,
): Promise<Response> {
  if (!hasTrustedOrigin(request)) return failure(403);
  const auth = await session();
  if ('error' in auth) return auth.error;
  const path = (await context.params).path ?? [];
  if (path.length !== 1 || !isProxyUuid(path[0])) return failure(404);
  const upstream = await callBackend('/sales-imports/' + path[0], {
    method: 'DELETE',
    redirect: 'error',
    headers: bearer(auth.token),
  });
  if (!upstream) return failure(503);
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return failure(upstream.status);
  }
  const parsed = parseSalesImportSummary(
    await upstream.json().catch(() => null),
  );
  return parsed ? respond(parsed) : failure(502);
}
