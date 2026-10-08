import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hasTrustedOrigin, REFRESH_COOKIE } from '@/lib/auth';
import { requestTokens } from '@/lib/auth-backend';
import { clearSessionCookies, setSessionCookies } from '@/lib/session';
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedOrigin(request))
    return NextResponse.json(
      { message: 'Solicitud no permitida.' },
      { status: 403 },
    );
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (!refreshToken)
    return clearSessionCookies(
      NextResponse.json(
        { message: 'Inicia sesión nuevamente.' },
        { status: 401 },
      ),
    );
  const result = await requestTokens('/auth/refresh', { refreshToken });
  if (!result.ok) {
    const response = NextResponse.json(
      { message: result.message },
      { status: result.status },
    );
    return result.status === 401 ? clearSessionCookies(response) : response;
  }
  return setSessionCookies(
    NextResponse.json({ redirectTo: '/dashboard' }),
    result.data,
  );
}
