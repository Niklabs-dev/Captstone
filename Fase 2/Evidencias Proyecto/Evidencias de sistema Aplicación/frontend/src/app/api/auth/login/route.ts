import { NextResponse } from 'next/server';
import { hasTrustedOrigin, parseCredentials } from '@/lib/auth';
import { requestTokens } from '@/lib/auth-backend';
import { setSessionCookies } from '@/lib/session';
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedOrigin(request))
    return NextResponse.json(
      { message: 'Solicitud no permitida.' },
      { status: 403 },
    );
  const body: unknown = await request.json().catch(() => null);
  const credentials = parseCredentials(body);
  if (!credentials)
    return NextResponse.json(
      { message: 'Ingresa un correo válido y tu contraseña.' },
      { status: 400 },
    );
  const result = await requestTokens('/auth/login', credentials);
  if (!result.ok)
    return NextResponse.json(
      { message: result.message },
      { status: result.status },
    );
  // La redirección por rol pertenece a SPRINT-1-T11; aquí se entrega un destino protegido común.
  return setSessionCookies(
    NextResponse.json({ redirectTo: '/dashboard' }),
    result.data,
  );
}
