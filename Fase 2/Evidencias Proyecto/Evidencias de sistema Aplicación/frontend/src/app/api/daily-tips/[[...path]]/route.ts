import { cookies } from 'next/headers';
import { ACCESS_COOKIE, hasTrustedOrigin } from '@/lib/auth';
import { proxyBackend, readProxyJson } from '@/lib/backend-proxy';
import {
  dailyTipsError,
  parseDayQuery,
  parsePaymentBatch,
  parsePaymentBatches,
  parseRange,
  parseRangeQuery,
  parseSummaryQuery,
  parseTipDayDetail,
  parseTipDays,
  parseTipSummary,
  rangeQuery,
  XLSX_CONTENT_TYPE,
  type TipsOperation,
} from '@/lib/daily-tips';
import { getSession } from '@/lib/session';

// BFF de la vista de propinas (SPRINT-4A-T07). Solo construye rutas fijas
// hacia /daily-tips, valida la consulta antes de reenviarla y proyecta cada
// respuesta al contrato; los errores del backend nunca llegan al navegador.
type Context = { params: Promise<{ path?: string[] }> };
const MANAGERS = ['ADMINISTRADOR', 'CONTADOR'];
const READERS = [...MANAGERS, 'SUPERVISOR'];

function respond(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
function fail(status: number, operation: TipsOperation = 'load'): Response {
  const safe = [400, 401, 403, 404, 409, 429, 503].includes(status)
    ? status
    : 502;
  return respond({ message: dailyTipsError(safe, operation) }, safe);
}
async function authorize(
  roles: readonly string[],
  operation: TipsOperation,
): Promise<string | Response> {
  const session = await getSession();
  if (!session.ok) return fail(session.status === 401 ? 401 : 503, operation);
  if (!roles.includes(session.data.role)) return fail(403, operation);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  return token ?? fail(401, operation);
}
async function forwardJson<T>(
  path: string,
  token: string,
  parse: (value: unknown) => T | null,
  operation: TipsOperation,
  init: RequestInit = {},
): Promise<Response> {
  const upstream = await proxyBackend(path, token, init);
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return fail(upstream.status, operation);
  }
  const data = parse(await upstream.json().catch(() => null));
  return data === null ? fail(502, operation) : respond(data, upstream.status);
}

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const { path = [] } = await context.params;
  const resource = path.length === 1 ? path[0] : '';
  const query = new URL(request.url).searchParams;
  if (resource === 'days' || resource === 'summary') {
    const token = await authorize(READERS, 'load');
    if (typeof token !== 'string') return token;
    const summary = resource === 'summary' ? parseSummaryQuery(query) : null;
    const range = resource === 'days' ? parseRangeQuery(query) : summary;
    if (!range) return fail(400);
    const backendQuery = new URLSearchParams(rangeQuery(range));
    if (summary?.status) backendQuery.set('status', summary.status);
    return forwardJson(
      `/daily-tips/${resource}?${backendQuery.toString()}`,
      token,
      (value) => {
        const parsed =
          resource === 'days' ? parseTipDays(value) : parseTipSummary(value);
        // La respuesta debe corresponder exactamente a lo consultado.
        return parsed &&
          parsed.store.id === range.storeId &&
          parsed.from === range.from &&
          parsed.to === range.to
          ? parsed
          : null;
      },
      'load',
    );
  }
  if (resource === 'day') {
    const token = await authorize(READERS, 'day');
    if (typeof token !== 'string') return token;
    const day = parseDayQuery(query);
    if (!day) return fail(400, 'day');
    return forwardJson(
      '/daily-tips/day?' + new URLSearchParams(day).toString(),
      token,
      (value) => {
        const parsed = parseTipDayDetail(value);
        return parsed &&
          parsed.store.id === day.storeId &&
          parsed.businessDate === day.businessDate
          ? parsed
          : null;
      },
      'day',
    );
  }
  if (resource === 'payment-batches') {
    const token = await authorize(MANAGERS, 'batches');
    if (typeof token !== 'string') return token;
    const range = parseRangeQuery(query);
    if (!range) return fail(400, 'batches');
    return forwardJson(
      '/daily-tips/payment-batches?' + rangeQuery(range),
      token,
      (value) => {
        const batches = parsePaymentBatches(value);
        return batches &&
          batches.every((batch) => batch.store.id === range.storeId)
          ? { batches }
          : null;
      },
      'batches',
    );
  }
  if (resource === 'export') {
    const token = await authorize(MANAGERS, 'export');
    if (typeof token !== 'string') return token;
    const range = parseRangeQuery(query);
    if (!range) return fail(400, 'export');
    const upstream = await proxyBackend(
      '/daily-tips/export?' + rangeQuery(range),
      token,
      {},
      true,
    );
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return fail(upstream.status, 'export');
    }
    // Solo se reenvía el libro Excel esperado, con su nombre de archivo.
    if (
      !upstream.headers
        .get('Content-Type')
        ?.toLowerCase()
        .startsWith(XLSX_CONTENT_TYPE)
    ) {
      await upstream.body?.cancel();
      return fail(502, 'export');
    }
    return upstream;
  }
  return respond({ message: 'Ruta no encontrada.' }, 404);
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length !== 1 || path[0] !== 'payment-batches')
    return respond({ message: 'Ruta no encontrada.' }, 404);
  if (!hasTrustedOrigin(request)) return fail(403, 'pay');
  const token = await authorize(MANAGERS, 'pay');
  if (typeof token !== 'string') return token;
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get('Content-Type') ?? '',
    ) ||
    new URL(request.url).searchParams.size > 0
  )
    return fail(400, 'pay');
  const range = parseRange(await readProxyJson(request, 1024));
  if (!range) return fail(400, 'pay');
  return forwardJson(
    '/daily-tips/payment-batches',
    token,
    (value) => {
      const batch = parsePaymentBatch(value);
      return batch && batch.store.id === range.storeId ? batch : null;
    },
    'pay',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(range),
    },
  );
}
