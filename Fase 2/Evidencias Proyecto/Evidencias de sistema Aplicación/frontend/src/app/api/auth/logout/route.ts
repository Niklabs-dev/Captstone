import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hasTrustedOrigin, REFRESH_COOKIE } from '@/lib/auth';
import { callBackend } from '@/lib/auth-backend';
import { clearSessionCookies } from '@/lib/session';
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasTrustedOrigin(request))
    return NextResponse.json(
      { message: 'Solicitud no permitida.' },
      { status: 403 },
    );
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  const result = refreshToken
    ? await callBackend('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
    : null;
  // Se elimina la sesión local incluso si no se pudo revocar la sesión remota.
  return clearSessionCookies(
    NextResponse.json({
      ok: true,
      revoked: !refreshToken || result?.ok === true,
    }),
  );
}
