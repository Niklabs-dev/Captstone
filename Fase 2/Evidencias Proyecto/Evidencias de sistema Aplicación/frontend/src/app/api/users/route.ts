import { NextResponse } from 'next/server';
import { backendUrl, getAccessToken } from '@/lib/session';

export async function POST(request: Request) {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ message: 'Sin sesión.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ message: 'Cuerpo inválido.' }, { status: 400 });
  }

  // SPRINT-1-T08: POST /users del backend real.
  const res = await fetch(backendUrl('/users'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!res) {
    return NextResponse.json({ message: 'No se pudo contactar al servidor.' }, { status: 502 });
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json(
      { message: data?.message ?? 'No se pudo crear el usuario.' },
      { status: res.status }
    );
  }

  return NextResponse.json(data, { status: 201 });
}
