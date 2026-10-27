import { getUsersSession } from '@/lib/users-session';
import { updateManagedUser } from '@/lib/users-backend';
import { hasSameOrigin, isUuid } from '@/lib/users';
function respond(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!hasSameOrigin(request))
    return respond({ message: 'Origen no permitido.' }, 403);
  const session = await getUsersSession();
  if (!session.ok) return respond({ message: session.message }, session.status);
  const { id } = await context.params;
  if (!isUuid(id)) return respond({ message: 'Usuario no válido.' }, 400);
  const result = await updateManagedUser(session.token, id, null);
  return result.ok
    ? respond(result.data)
    : respond({ message: result.message }, result.status);
}
