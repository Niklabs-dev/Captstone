import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, REFRESH_COOKIE, USER_COOKIE, backendUrl } from '@/lib/session';

export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    // SPRINT-1-T06: POST /auth/logout es idempotente — no falla si ya expiró.
    await fetch(backendUrl('/auth/logout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {
      // Si el backend no responde, igual limpiamos las cookies locales.
    });
  }

  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  jar.delete(USER_COOKIE);

  return NextResponse.json({ ok: true });
}
