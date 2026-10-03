import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  USER_COOKIE,
  backendUrl,
  landingPathForRole,
  type BackendRole,
} from '@/lib/session';

interface BackendLoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: BackendRole;
    storeId: string | null;
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ message: 'Correo y contraseña son obligatorios.' }, { status: 400 });
  }

  // SPRINT-1-T06: POST /auth/login del backend real.
  const res = await fetch(backendUrl('/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
  }).catch(() => null);

  if (!res) {
    return NextResponse.json(
      { message: 'No se pudo contactar al servidor. ¿Está corriendo el backend?' },
      { status: 502 }
    );
  }
  if (!res.ok) {
    const status = res.status === 401 ? 401 : 400;
    return NextResponse.json(
      { message: status === 401 ? 'Correo o contraseña incorrectos.' : 'Solicitud inválida.' },
      { status }
    );
  }

  const data = (await res.json()) as BackendLoginResponse;
  const jar = await cookies();
  const common = { httpOnly: true, sameSite: 'lax' as const, path: '/' };

  jar.set(ACCESS_COOKIE, data.accessToken, { ...common, maxAge: data.expiresIn });
  jar.set(REFRESH_COOKIE, data.refreshToken, { ...common, maxAge: 60 * 60 * 24 * 7 });
  jar.set(
    USER_COOKIE,
    JSON.stringify({
      id: data.user.id,
      email: data.user.email,
      nombre: `${data.user.firstName} ${data.user.lastName}`,
      rol: data.user.role,
      storeId: data.user.storeId,
    }),
    { ...common, maxAge: data.expiresIn }
  );

  return NextResponse.json({ redirectTo: landingPathForRole(data.user.role) });
}
