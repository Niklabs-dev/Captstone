import { NextResponse } from 'next/server';
import { getUsersSession } from '@/lib/users-session';
import { clearSessionCookies } from '@/lib/session';

// Las páginas no pueden modificar cookies durante el render.
// Se vuelve a verificar la cuenta antes de limpiar una sesión realmente inválida.
function redirectTo(path: string): NextResponse {
  // Location relativa conserva el host público detrás de Docker/proxy inverso.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: path, 'Cache-Control': 'private, no-store' },
  });
}

export async function GET(): Promise<NextResponse> {
  const session = await getUsersSession();
  if (!session.ok && session.status === 401)
    return clearSessionCookies(redirectTo('/login?reason=session'));
  if (!session.ok && session.status !== 403)
    return NextResponse.json(
      { message: session.message },
      { status: session.status, headers: { 'Cache-Control': 'no-store' } },
    );
  const destination = session.ok ? '/dashboard' : '/dashboard?reason=forbidden';
  return redirectTo(destination);
}
