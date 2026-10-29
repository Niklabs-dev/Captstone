import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE } from '@/lib/auth';
import { getSession, clearSessionCookies } from '@/lib/session';
import { callBackend } from '@/lib/auth-backend';
import {
  MAX_RECEIPT_BYTES,
  canReadOwnTipReceipts,
  ownReceiptPath,
  parseOwnReceipts,
  ownReceiptError,
} from '@/lib/my-tip-receipts';
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
function failure(status: number): Response {
  const safe = [400, 401, 403, 404, 429, 503].includes(status) ? status : 502;
  const response = json({ message: ownReceiptError(safe) }, safe);
  return safe === 401 ? clearSessionCookies(response) : response;
}
export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const session = await getSession();
  if (!session.ok) return failure(session.status);
  if (!canReadOwnTipReceipts(session.data.role)) return failure(403);
  const { path = [] } = await context.params;
  const query = new URL(request.url).searchParams;
  const endpoint = ownReceiptPath(path, query);
  if (!endpoint) return failure(query.size ? 400 : 404);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return failure(401);
  const response = await callBackend(endpoint, {
    headers: { Authorization: 'Bearer ' + token },
    redirect: 'error',
  });
  if (!response) return failure(503);
  if (!response.ok) {
    await response.body?.cancel();
    return failure(response.status);
  }
  if (!path.length) {
    const data = parseOwnReceipts(
      await response.json().catch(() => null),
      session.data.id,
    );
    return data ? json(data) : failure(502);
  }
  const hash = response.headers.get('x-content-sha256') ?? '';
  if (
    !response.headers.get('content-type')?.startsWith('application/pdf') ||
    !/^[a-f0-9]{64}$/.test(hash) ||
    !response.body
  ) {
    await response.body?.cancel();
    return failure(502);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > MAX_RECEIPT_BYTES) {
        await reader.cancel();
        return failure(502);
      }
      chunks.push(item.value);
    }
  } catch {
    return failure(502);
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  if (
    bytes.length === 0 ||
    bytes.subarray(0, 5).toString() !== '%PDF-' ||
    createHash('sha256').update(bytes).digest('hex') !== hash
  )
    return failure(502);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      'Content-Disposition': 'attachment; filename="constancia-propinas.pdf"',
      'X-Content-SHA256': hash,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
