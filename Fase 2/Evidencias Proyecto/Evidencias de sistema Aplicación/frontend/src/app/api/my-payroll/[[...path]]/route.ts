import { NextResponse } from 'next/server';
import { getSession, clearSessionCookies } from '@/lib/session';
import { canReadOwnPayslips, payslipUuid } from '@/lib/my-payslips';

// Integración pendiente con T15. No se devuelven liquidaciones simuladas en producción.
export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<NextResponse> {
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
  // La API final debe obtener el trabajador del JWT y verificar propiedad/estado también al descargar.
  return NextResponse.json(
    { message: 'El servicio de liquidaciones aún no está disponible.' },
    { status: 503, headers },
  );
}
