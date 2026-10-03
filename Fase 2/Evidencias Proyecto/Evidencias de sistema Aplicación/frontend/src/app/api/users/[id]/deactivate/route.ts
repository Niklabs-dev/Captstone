import { NextResponse } from 'next/server';
import { backendUrl, getAccessToken } from '@/lib/session';

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ message: 'Sin sesión.' }, { status: 401 });
  }

  const { id } = await params;

  // SPRINT-1-T08: PATCH /users/:id/deactivate del backend real.
  // No existe un endpoint de "reactivar" todavía — por eso no hay un route
  // handler equivalente para eso.
  const res = await fetch(backendUrl(`/users/${id}/deactivate`), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);

  if (!res) {
    return NextResponse.json({ message: 'No se pudo contactar al servidor.' }, { status: 502 });
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json(
      { message: data?.message ?? 'No se pudo desactivar el usuario.' },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
