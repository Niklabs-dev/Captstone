import {
  isObject,
  isUserRole,
  isUuid,
  parseManagedUser,
  parseUserList,
  type CreateUserInput,
  type ManagedUser,
  type UpdateUserInput,
} from './users';
export type UsersResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string };
export interface UserIdentity {
  id: string;
  email: string;
  role: string;
}
type BackendFetch = typeof fetch;
export async function callUsersBackend(
  path: string,
  token: string,
  init: RequestInit = {},
  fetcher: BackendFetch = fetch,
): Promise<UsersResult<unknown>> {
  try {
    const base = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3001';
    const response = await fetcher(`${base.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: path.endsWith('/reactivate')
          ? 'No se pudo reactivar. Usa Editar para asignar un rol y un local activos y compatibles; después vuelve a intentarlo.'
          : 'Revisa los datos. El rol y el local deben estar vigentes y ser compatibles.',
        401: 'Tu sesión venció. Inicia sesión nuevamente.',
        403: 'No tienes permiso para administrar usuarios.',
        404: 'El usuario no existe.',
        409:
          isObject(data) &&
          data.message === 'La cuenta está anonimizada y no se puede modificar'
            ? 'La cuenta está anonimizada y no puede modificarse ni reactivarse.'
            : path.endsWith('/reactivate')
              ? 'La cuenta no puede reactivarse. Actualiza la lista para comprobar su estado.'
              : 'Ya existe un usuario con ese correo o RUT.',
      };
      return {
        ok: false,
        status: messages[response.status] ? response.status : 502,
        message:
          messages[response.status] ??
          'No se pudo completar la operación. Intenta nuevamente.',
      };
    }
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 503,
      message: 'No se pudo conectar al sistema. Intenta nuevamente.',
    };
  }
}
export async function updateManagedUser(
  token: string,
  id: string,
  input: UpdateUserInput | null,
  fetcher: BackendFetch = fetch,
): Promise<UsersResult<ManagedUser>> {
  const result = await callUsersBackend(
    `/users/${id}${input === null ? '/reactivate' : ''}`,
    token,
    {
      method: 'PATCH',
      ...(input === null ? {} : { body: JSON.stringify(input) }),
    },
    fetcher,
  );
  if (!result.ok) return result;
  const user = parseManagedUser(result.data);
  if (!user || user.id !== id || (input === null && !user.isActive))
    return {
      ok: false,
      status: 502,
      message:
        'La respuesta no pudo verificarse. Actualiza la lista antes de repetir la operación.',
    };
  return { ok: true, data: user };
}
export async function resetManagedUserPassword(
  token: string,
  id: string,
  input: { newPassword: string },
  fetcher: BackendFetch = fetch,
): Promise<UsersResult<ManagedUser>> {
  const result = await callUsersBackend(
    `/users/${id}/password`,
    token,
    { method: 'PATCH', body: JSON.stringify(input) },
    fetcher,
  );
  if (!result.ok) return result;
  const user = parseManagedUser(result.data);
  if (!user || user.id !== id)
    return {
      ok: false,
      status: 502,
      message:
        'La respuesta no pudo verificarse. Actualiza la lista antes de repetir la operación.',
    };
  return { ok: true, data: user };
}
export async function verifyAdministrator(
  token: string | undefined,
  fetcher: BackendFetch = fetch,
): Promise<UsersResult<UserIdentity>> {
  if (!token)
    return { ok: false, status: 401, message: 'Inicia sesión para continuar.' };
  const result = await callUsersBackend('/auth/me', token, {}, fetcher);
  if (!result.ok) return result;
  const user = result.data;
  if (
    !isObject(user) ||
    !isUuid(user.id) ||
    typeof user.email !== 'string' ||
    !isUserRole(user.role)
  )
    return {
      ok: false,
      status: 502,
      message: 'No se pudo verificar tu sesión.',
    };
  if (user.role !== 'ADMINISTRADOR')
    return {
      ok: false,
      status: 403,
      message: 'No tienes permiso para administrar usuarios.',
    };
  // /auth/me valida el JWT, pero no el estado actual de la cuenta. El módulo
  // consulta el registro vigente antes de permitir cualquier operación.
  const currentResult = await callUsersBackend(
    '/users?isActive=true',
    token,
    {},
    fetcher,
  );
  if (!currentResult.ok) return currentResult;
  const currentUsers = parseUserList(currentResult.data);
  if (!currentUsers)
    return {
      ok: false,
      status: 502,
      message: 'No se pudo verificar tu cuenta.',
    };
  const currentUser = currentUsers.find(
    (account) => account.id === user.id && account.isActive,
  );
  if (!currentUser)
    return {
      ok: false,
      status: 401,
      message: 'Tu cuenta no está activa. Inicia sesión nuevamente.',
    };
  if (currentUser.role.code !== 'ADMINISTRADOR')
    return {
      ok: false,
      status: 403,
      message: 'No tienes permiso para administrar usuarios.',
    };
  return {
    ok: true,
    data: { id: user.id, email: user.email, role: user.role },
  };
}
export async function listManagedUsers(
  token: string,
  query = '',
  fetcher: BackendFetch = fetch,
): Promise<UsersResult<ManagedUser[]>> {
  const result = await callUsersBackend(
    `/users${query ? `?${query}` : ''}`,
    token,
    {},
    fetcher,
  );
  if (!result.ok) return result;
  const users = parseUserList(result.data);
  return users
    ? { ok: true, data: users }
    : {
        ok: false,
        status: 502,
        message: 'No se pudo leer la lista de usuarios.',
      };
}
export async function mutateManagedUser(
  token: string,
  input: CreateUserInput | { id: string },
  fetcher: BackendFetch = fetch,
): Promise<UsersResult<ManagedUser>> {
  const result =
    'id' in input
      ? await callUsersBackend(
          `/users/${input.id}/deactivate`,
          token,
          { method: 'PATCH' },
          fetcher,
        )
      : await callUsersBackend(
          '/users',
          token,
          { method: 'POST', body: JSON.stringify(input) },
          fetcher,
        );
  if (!result.ok) return result;
  const user = parseManagedUser(result.data);
  return user
    ? { ok: true, data: user }
    : {
        ok: false,
        status: 502,
        message:
          'La respuesta no pudo verificarse. Actualiza la lista antes de repetir la operación.',
      };
}
