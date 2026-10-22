import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, clearSessionCookies } from '@/lib/session';
import { canReadOwnPayslips, payslipUuid } from '@/lib/my-payslips';
import { ACCESS_COOKIE } from '@/lib/auth';
import { proxyBackend, proxyError } from '@/lib/backend-proxy';

// El propietario se obtiene exclusivamente del JWT; T15 verifica propiedad en cada operación.
export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store' };
  const session = await getSession();
  if (!session.ok) {
    const response = NextResponse.json(
      { message: session.message },
      { status: session.status, headers },
    );
    return session.status === 401 ? clearSessionCookies(response) : response;
  }
  if (!canReadOwnPayslips(session.data.role))
    return NextResponse.json(
      { message: 'No tienes permiso para consultar liquidaciones personales.' },
      { status: 403, headers },
    );
  if (new URL(request.url).search)
    return NextResponse.json(
      {
        message:
          'Esta consulta no admite parámetros de trabajador ni otros filtros.',
      },
      { status: 400, headers },
    );
  const { path = [] } = await context.params;
  if (
    path.length !== 0 &&
    (path.length !== 2 ||
      !payslipUuid(path[0]) ||
      !['integrity', 'download'].includes(path[1]))
  )
    return NextResponse.json(
      { message: 'Ruta no encontrada.' },
      { status: 404, headers },
    );
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return proxyError(401);
  const response = await proxyBackend(
    '/payroll/mine' + (path.length ? `/${path[0]}/${path[1]}` : ''),
    token,
    {},
    path[1] === 'download',
  );
  return response.status === 401
    ? clearSessionCookies(
        new NextResponse(response.body, {
          status: response.status,
          headers: response.headers,
        }),
      )
    : response;
}
