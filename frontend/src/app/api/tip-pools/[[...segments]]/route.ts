import { cookies } from 'next/headers';
import { ACCESS_COOKIE, hasTrustedOrigin, isRecord } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { callBackend } from '@/lib/auth-backend';
import { isUuid } from '@/lib/users';
import {
  parsePool,
  parsePoolForPeriod,
  parsePeriod,
  parseAlerts,
  parseReceipts,
  parsePoolAction,
  poolError,
  POOL_ISSUES,
  type PoolAction,
} from '@/lib/tip-pools';
type Context = { params: Promise<{ segments?: string[] }> };
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
function fail(status: number): Response {
  const safe = [400, 401, 403, 404, 409, 422, 429, 503].includes(status)
    ? status
    : 502;
  return json({ message: poolError(safe) }, safe);
}
async function body(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get('content-type') ?? '',
    ) ||
    !request.body
  )
    return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 4096) {
        await reader.cancel();
        return null;
      }
      chunks.push(item.value);
    }
    return JSON.parse(
      new TextDecoder().decode(Buffer.concat(chunks)),
    ) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
async function handle(request: Request, context: Context): Promise<Response> {
  const mutation = request.method === 'POST';
  if (mutation && !hasTrustedOrigin(request)) return fail(403);
  const session = await getSession();
  if (!session.ok) return fail(session.status);
  if (
    !['CONTADOR', 'ADMINISTRADOR'].includes(session.data.role) ||
    (mutation && session.data.role !== 'CONTADOR')
  )
    return fail(403);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return fail(401);
  const segments = (await context.params).segments ?? [];
  const query = new URL(request.url).searchParams;
  let path = '';
  let input: unknown;
  let kind: 'pool' | 'list' | 'alerts' | 'receipts' | 'download' = 'pool';
  if (!mutation && segments.length === 0) {
    input = parsePeriod(Object.fromEntries(query));
    if (query.size !== 3 || !input) return fail(400);
    path = '/tip-pools?' + query;
    kind = 'list';
  } else if (!mutation && segments.length === 1 && segments[0] === 'alerts') {
    path = '/tip-payment-alerts';
    kind = 'alerts';
  } else if (!mutation && isUuid(segments[0]) && segments.length === 1) {
    path = '/tip-pools/' + segments[0];
  } else if (
    !mutation &&
    isUuid(segments[0]) &&
    segments[1] === 'receipts' &&
    segments.length === 2
  ) {
    path = '/tip-pools/' + segments[0] + '/receipts';
    kind = 'receipts';
  } else if (
    !mutation &&
    isUuid(segments[0]) &&
    segments[1] === 'receipts' &&
    isUuid(segments[2]) &&
    segments[3] === 'download' &&
    segments.length === 4
  ) {
    path = '/tip-pools/' + segments.join('/');
    kind = 'download';
  } else if (mutation && segments.length === 1 && segments[0] === 'preview') {
    input = parsePeriod(await body(request));
    path = '/tip-pools/preview';
  } else if (
    mutation &&
    segments.length === 2 &&
    isUuid(segments[0]) &&
    ['observations', 'confirm', 'pay'].includes(segments[1])
  ) {
    input = parsePoolAction(await body(request), segments[1] as PoolAction);
    path = '/tip-pools/' + segments.join('/');
  } else return fail(404);
  if ((mutation && !input) || (kind !== 'list' && query.size)) return fail(400);
  const upstream = await callBackend(path, {
    method: request.method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(mutation ? { 'Content-Type': 'application/json' } : {}),
    },
    redirect: 'error',
    ...(mutation ? { body: JSON.stringify(input) } : {}),
  });
  if (!upstream) return fail(503);
  if (!upstream.ok) {
    if (upstream.status === 422) {
      const data: unknown = await upstream.json().catch(() => null);
      const issues =
        isRecord(data) && Array.isArray(data.issues)
          ? data.issues.flatMap((i) =>
              isRecord(i) && typeof i.code === 'string' && POOL_ISSUES[i.code]
                ? [POOL_ISSUES[i.code]]
                : [],
            )
          : [];
      return json(
        { message: poolError(422), issues: [...new Set(issues)] },
        422,
      );
    }
    await upstream.body?.cancel();
    return fail(upstream.status);
  }
  if (kind === 'download') {
    if (!upstream.headers.get('content-type')?.startsWith('application/pdf')) {
      await upstream.body?.cancel();
      return fail(502);
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="constancia-propinas.pdf"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  const raw: unknown = await upstream.json().catch(() => null);
  let data: unknown = null;
  if (kind === 'pool') {
    const period = segments[0] === 'preview' ? parsePeriod(input) : null;
    const pool = period ? parsePoolForPeriod(raw, period) : parsePool(raw);
    if (pool && (period || pool.id === segments[0])) data = pool;
  }
  if (kind === 'list' && Array.isArray(raw)) {
    const period = parsePeriod(input);
    if (period) {
      const pools = raw.map((value) => parsePoolForPeriod(value, period));
      if (pools.every((p) => p !== null)) data = pools;
    }
  }
  if (kind === 'alerts') data = parseAlerts(raw);
  if (kind === 'receipts') data = parseReceipts(raw, segments[0]);
  return data === null ? fail(502) : json(data, upstream.status);
}
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  return handle(request, context);
}
export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  return handle(request, context);
}
