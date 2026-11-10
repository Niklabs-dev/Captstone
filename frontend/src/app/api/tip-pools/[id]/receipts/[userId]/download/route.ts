import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from '@/lib/auth';
import { callBackend } from '@/lib/auth-backend';
import { getSession } from '@/lib/session';
import { poolError } from '@/lib/tip-pools';
import { isUuid } from '@/lib/users';

type Context = { params: Promise<{ id: string; userId: string }> };

function fail(status: number): Response {
  const safe = [400, 401, 403, 404, 409, 429, 503].includes(status)
    ? status
    : 502;
  return Response.json(
    { message: poolError(safe) },
    {
      status: safe,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

// SPRINT-4A-T08: descarga de la constancia PDF de un reparto histórico
// pagado. Solo lectura: el reparto por período ya no se calcula, confirma ni
// paga desde la interfaz. Administrador y contador; el backend vuelve a
// validar rol, reparto y constancia.
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const session = await getSession();
  if (!session.ok) return fail(session.status);
  if (!['CONTADOR', 'ADMINISTRADOR'].includes(session.data.role))
    return fail(403);
  const { id, userId } = await context.params;
  if (!isUuid(id) || !isUuid(userId) || new URL(request.url).searchParams.size)
    return fail(400);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return fail(401);
  const upstream = await callBackend(
    `/tip-pools/${id}/receipts/${userId}/download`,
    { headers: { Authorization: 'Bearer ' + token }, redirect: 'error' },
  );
  if (!upstream) return fail(503);
  if (
    !upstream.ok ||
    !upstream.headers.get('content-type')?.startsWith('application/pdf')
  ) {
    await upstream.body?.cancel();
    return fail(upstream.ok ? 502 : upstream.status);
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
