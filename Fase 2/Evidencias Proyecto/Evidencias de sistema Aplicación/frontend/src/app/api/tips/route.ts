import { NextResponse } from 'next/server';
import { hasTrustedOrigin, isRecord } from '@/lib/auth';
import { getTipsSession } from '@/lib/tips-session';
import { callBackend } from '@/lib/auth-backend';
import {
  TIP_INACTIVE_STORE_MESSAGE,
  isTipDate,
  parseTipInput,
  parseTipEntry,
  parseTipEntries,
  tipErrorMessage,
} from '@/lib/tips';

function respond(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
function failure(status: number): NextResponse {
  const safeStatus = [400, 401, 403, 404, 409, 429, 502, 503].includes(status)
    ? status
    : 502;
  return respond({ message: tipErrorMessage(safeStatus) }, safeStatus);
}
export async function GET(request: Request): Promise<Response> {
  const session = await getTipsSession();
  if (!session.ok) return failure(session.status);
  const query = new URL(request.url).searchParams;
  const date = query.get('businessDate');
  if (
    query.size !== 1 ||
    query.getAll('businessDate').length !== 1 ||
    !isTipDate(date)
  )
    return failure(400);
  const params = new URLSearchParams({
    storeId: session.user.storeId,
    businessDate: date,
  });
  const upstream = await callBackend('/tips?' + params, {
    headers: { Authorization: 'Bearer ' + session.token },
    redirect: 'error',
  });
  if (!upstream) return failure(503);
  if (upstream.status !== 200) {
    await upstream.body?.cancel();
    return failure(upstream.ok ? 502 : upstream.status);
  }
  const data = parseTipEntries(
    await upstream.json().catch(() => null),
    session.user.storeId,
    date,
  );
  return data ? respond(data) : failure(502);
}
export async function POST(request: Request): Promise<Response> {
  if (!hasTrustedOrigin(request))
    return respond({ message: 'Origen no permitido.' }, 403);
  const session = await getTipsSession();
  if (!session.ok) return failure(session.status);
  if (new URL(request.url).search) return failure(400);
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get('Content-Type') ?? '',
    )
  )
    return failure(400);
  // El formulario es pequeño; se limita también cuando no hay Content-Length.
  if (!request.body) return failure(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return failure(400);
      }
      chunks.push(chunk.value);
    }
  } catch {
    return failure(400);
  } finally {
    reader.releaseLock();
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return failure(400);
  }
  const input = parseTipInput(raw);
  if (!input) return failure(400);
  const upstream = await callBackend('/tips', {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + session.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...input, storeId: session.user.storeId }),
  });
  if (!upstream) return failure(503);
  if (upstream.status === 400) {
    const error: unknown = await upstream.json().catch(() => null);
    // Solo este mensaje conocido del contrato se traduce a un motivo público.
    if (
      isRecord(error) &&
      error.message === 'El local indicado no existe o está inactivo'
    )
      return respond(
        { code: 'STORE_INACTIVE', message: TIP_INACTIVE_STORE_MESSAGE },
        400,
      );
    return failure(400);
  }
  if (![200, 201].includes(upstream.status)) {
    await upstream.body?.cancel();
    return failure(upstream.ok ? 502 : upstream.status);
  }
  const data = parseTipEntry(
    await upstream.json().catch(() => null),
    session.user.storeId,
    input.businessDate,
  );
  if (
    !data ||
    data.paymentMethod !== input.paymentMethod ||
    data.amount !== input.amount ||
    data.responsible.id !== session.user.id
  )
    return failure(502);
  return respond(data, upstream.status);
}
