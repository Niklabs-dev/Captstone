import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { hasTrustedOrigin } from '@/lib/auth';
import { canReadPayroll, canManagePayroll } from '@/lib/payroll';

// Punto de integración reservado a T13/T14; producción no simula carga o publicación.
async function unavailable(request: Request): Promise<NextResponse> {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (request.method === 'POST' && !hasTrustedOrigin(request))
    return NextResponse.json(
      { message: 'Solicitud no permitida.' },
      { status: 403, headers },
    );
  const session = await getSession();
  if (!session.ok)
    return NextResponse.json(
      { message: session.message },
      { status: session.status, headers },
    );
  if (
    !canReadPayroll(session.data.role) ||
    (request.method === 'POST' && !canManagePayroll(session.data.role))
  )
    return NextResponse.json(
      { message: 'No tienes permiso para realizar esta operación.' },
      { status: 403, headers },
    );
  return NextResponse.json(
    { message: 'El servicio de liquidaciones aún no está disponible.' },
    { status: 503, headers },
  );
}
export const GET = unavailable;
export const POST = unavailable;
