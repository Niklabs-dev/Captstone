import { NextResponse } from 'next/server';
import { getUsersSession } from '@/lib/users-session';
import { hasTrustedOrigin } from '@/lib/auth';

// Punto de integración reservado. Ninguna ruta de NestJS se supone implementada.
// Los escenarios de prueba interceptan este contrato interno; producción falla cerrado.
async function unavailable(request: Request): Promise<NextResponse> {
  if (request.method === 'POST' && !hasTrustedOrigin(request))
    return NextResponse.json(
      { message: 'Solicitud no permitida.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  const session = await getUsersSession();
  if (!session.ok)
    return NextResponse.json(
      { message: session.message },
      { status: session.status, headers: { 'Cache-Control': 'no-store' } },
    );
  return NextResponse.json(
    { message: 'El servicio documental aún no está disponible.' },
    { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
export const GET = unavailable;
export const POST = unavailable;
