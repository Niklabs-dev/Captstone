import { getUsersSession } from '@/lib/users-session';
import { proxyBackend, proxyError } from '@/lib/backend-proxy';
import { isDashboardDate } from '@/lib/sales-dashboard';

// Consolidado de ventas, alertas y diferencias (SPRINT-4-T13): solo el
// administrador activo; el backend vuelve a validar el rol.
export async function GET(request: Request): Promise<Response> {
  const session = await getUsersSession();
  if (!session.ok) return proxyError(session.status);
  const query = new URL(request.url).searchParams;
  const date = query.get('date');
  if (
    query.size !== 1 ||
    query.getAll('date').length !== 1 ||
    !isDashboardDate(date)
  )
    return proxyError(400);
  return proxyBackend(
    '/sales-dashboard?' + new URLSearchParams({ date }),
    session.token,
  );
}
