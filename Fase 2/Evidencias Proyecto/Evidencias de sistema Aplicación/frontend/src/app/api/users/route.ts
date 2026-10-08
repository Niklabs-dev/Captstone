import { getUsersSession } from '@/lib/users-session';
import { listManagedUsers, mutateManagedUser } from '@/lib/users-backend';
import { hasSameOrigin, parseCreateUser, parseFilters } from '@/lib/users';
function respond(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function GET(request: Request): Promise<Response> {
  const session = await getUsersSession();
  if (!session.ok) return respond({ message: session.message }, session.status);
  const query = parseFilters(new URL(request.url).searchParams);
  if (!query.ok) return respond({ message: query.message }, 400);
  const result = await listManagedUsers(session.token, query.data);
  return result.ok
    ? respond(result.data)
    : respond({ message: result.message }, result.status);
}
export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request))
    return respond({ message: 'Origen no permitido.' }, 403);
  const session = await getUsersSession();
  if (!session.ok) return respond({ message: session.message }, session.status);
  const input = parseCreateUser(await request.json().catch(() => null));
  if (!input.ok) return respond({ message: input.message }, 400);
  const result = await mutateManagedUser(session.token, input.data);
  return result.ok
    ? respond(result.data, 201)
    : respond({ message: result.message }, result.status);
}
