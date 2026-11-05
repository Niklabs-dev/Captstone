import { cookies } from 'next/headers';
import { ACCESS_COOKIE, hasTrustedOrigin, isRecord } from '@/lib/auth';
import { callBackend } from '@/lib/auth-backend';
import { getSession } from '@/lib/session';
import { isUuid } from '@/lib/users';
import { parseCashClosing, isUuidValue } from '@/lib/cash-closings';
import {
  closingErrorMessage,
  parseClosingInput,
  publicClosingErrorCode,
} from '@/lib/cash-closing-form';

const MAX_BODY_BYTES = 16 * 1024;

function respond(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
function failure(
  status: number,
  code?: string,
  extra: Record<string, string> = {},
): Response {
  const safe = [400, 401, 403, 404, 409, 429, 502, 503].includes(status)
    ? status
    : 502;
  return respond(
    {
      message: closingErrorMessage(safe, code),
      ...(code ? { code } : {}),
      ...extra,
    },
    safe,
  );
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

// Confirma un cierre de caja (POST /cash-closings, SPRINT-4-T09/T10). Solo el
// supervisor de un local; el local se toma de la sesión y nunca del navegador.
export async function POST(request: Request): Promise<Response> {
  if (!hasTrustedOrigin(request))
    return respond({ message: 'Origen no permitido.' }, 403);
  const session = await getSession();
  if (!session.ok) return failure(session.status === 401 ? 401 : 503);
  const storeId = session.data.storeId;
  if (session.data.role !== 'SUPERVISOR' || !isUuid(storeId))
    return failure(403);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return failure(401);
  if (new URL(request.url).search) return failure(400);
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get('Content-Type') ?? '',
    )
  )
    return failure(400);
  const input = parseClosingInput(await readBody(request));
  if (!input) return failure(400);

  const upstream = await callBackend('/cash-closings', {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...input, storeId }),
  });
  if (!upstream) return failure(503);
  if (upstream.status === 400 || upstream.status === 409) {
    const error: unknown = await upstream.json().catch(() => null);
    const message = isRecord(error) ? error.message : null;
    if (upstream.status === 400)
      return failure(400, publicClosingErrorCode(message) ?? undefined);
    // El duplicado trae el ID consultable del cierre existente (T10).
    if (isRecord(error) && isUuidValue(error.existingClosingId))
      return failure(409, 'CLOSING_EXISTS', {
        existingClosingId: error.existingClosingId,
      });
    return failure(
      409,
      message === 'Una o más ventas del período ya pertenecen a otro cierre'
        ? 'SALES_ALREADY_CLOSED'
        : 'CLOSING_EXISTS',
    );
  }
  if (upstream.status !== 200 && upstream.status !== 201) {
    await upstream.body?.cancel();
    return failure(upstream.ok ? 502 : upstream.status);
  }
  const closing = parseCashClosing(await upstream.json().catch(() => null));
  if (
    !closing ||
    closing.store.id !== storeId ||
    closing.businessDate !== input.businessDate ||
    closing.shift !== input.shift
  )
    return failure(502);
  return respond(closing, upstream.status);
}
