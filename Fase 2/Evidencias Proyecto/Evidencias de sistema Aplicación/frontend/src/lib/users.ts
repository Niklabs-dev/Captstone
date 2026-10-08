export const USER_ROLES = [
  'ADMINISTRADOR',
  'CONTADOR',
  'SUPERVISOR',
  'TRABAJADOR',
] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMINISTRADOR: 'Administrador',
  CONTADOR: 'Contador',
  SUPERVISOR: 'Supervisor',
  TRABAJADOR: 'Trabajador',
};
export interface StoreOption {
  id: string;
  name: string;
}
export interface ManagedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  role: { code: UserRole; name: string };
  store: StoreOption | null;
}
export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  roleCode: UserRole;
  storeId?: string;
}
export type InputResult<T> =
  { ok: true; data: T } | { ok: false; message: string };
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isUserRole(value: unknown): value is UserRole {
  return USER_ROLES.some((role) => role === value);
}
export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function needsStore(role: UserRole): boolean {
  return role === 'SUPERVISOR' || role === 'TRABAJADOR';
}
export function parseCreateUser(value: unknown): InputResult<CreateUserInput> {
  if (!isObject(value))
    return { ok: false, message: 'Completa los datos del usuario.' };
  if (
    typeof value.firstName !== 'string' ||
    typeof value.lastName !== 'string' ||
    !value.firstName.trim() ||
    !value.lastName.trim() ||
    value.firstName.trim().length > 80 ||
    value.lastName.trim().length > 80
  )
    return {
      ok: false,
      message:
        'Nombre y apellido son obligatorios y admiten hasta 80 caracteres.',
    };
  if (
    typeof value.email !== 'string' ||
    value.email.trim().length > 160 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())
  )
    return {
      ok: false,
      message: 'Ingresa un correo electrónico válido (máximo 160 caracteres).',
    };
  if (
    typeof value.password !== 'string' ||
    value.password.length < 8 ||
    value.password.length > 72 ||
    new TextEncoder().encode(value.password).length > 72
  )
    return {
      ok: false,
      message:
        'La contraseña debe tener entre 8 y 72 caracteres y no superar 72 bytes.',
    };
  if (!isUserRole(value.roleCode))
    return { ok: false, message: 'Selecciona un rol válido.' };
  if (needsStore(value.roleCode) && !isUuid(value.storeId))
    return { ok: false, message: 'Selecciona un local para este rol.' };
  if (
    !needsStore(value.roleCode) &&
    value.storeId !== undefined &&
    value.storeId !== ''
  )
    return {
      ok: false,
      message:
        'Administrador y contador tienen alcance global; no llevan local.',
    };
  return {
    ok: true,
    data: {
      firstName: value.firstName.trim(),
      lastName: value.lastName.trim(),
      email: value.email.trim().toLowerCase(),
      password: value.password,
      roleCode: value.roleCode,
      ...(needsStore(value.roleCode)
        ? { storeId: value.storeId as string }
        : {}),
    },
  };
}
// Proyección explícita: ni los tokens ni campos sensibles del backend llegan al cliente.
export function parseManagedUser(value: unknown): ManagedUser | null {
  if (
    !isObject(value) ||
    !isUuid(value.id) ||
    typeof value.email !== 'string' ||
    typeof value.firstName !== 'string' ||
    typeof value.lastName !== 'string' ||
    typeof value.isActive !== 'boolean' ||
    !isObject(value.role) ||
    !isUserRole(value.role.code) ||
    typeof value.role.name !== 'string' ||
    (value.store !== null &&
      (!isObject(value.store) ||
        !isUuid(value.store.id) ||
        typeof value.store.name !== 'string'))
  )
    return null;
  return {
    id: value.id,
    email: value.email,
    firstName: value.firstName,
    lastName: value.lastName,
    isActive: value.isActive,
    role: { code: value.role.code, name: value.role.name },
    store:
      value.store === null
        ? null
        : { id: value.store.id as string, name: value.store.name as string },
  };
}
export function parseUserList(value: unknown): ManagedUser[] | null {
  if (!Array.isArray(value)) return null;
  const users = value.map(parseManagedUser);
  return users.every((user) => user !== null) ? users : null;
}
export function parseFilters(params: URLSearchParams): InputResult<string> {
  const result = new URLSearchParams();
  for (const key of params.keys())
    if (!['roleCode', 'storeId', 'isActive'].includes(key))
      return { ok: false, message: 'Filtro no reconocido.' };
  const role = params.get('roleCode');
  const store = params.get('storeId');
  const active = params.get('isActive');
  if (role && !isUserRole(role))
    return { ok: false, message: 'Filtro de rol inválido.' };
  if (store && !isUuid(store))
    return { ok: false, message: 'Filtro de local inválido.' };
  if (active && active !== 'true' && active !== 'false')
    return { ok: false, message: 'Filtro de estado inválido.' };
  if (role) result.set('roleCode', role);
  if (store) result.set('storeId', store);
  if (active) result.set('isActive', active);
  return { ok: true, data: result.toString() };
}
export function collectStores(
  users: ManagedUser[],
  configured: unknown,
): StoreOption[] {
  if (
    !Array.isArray(configured) ||
    !configured.every(
      (store: unknown) =>
        isObject(store) &&
        isUuid(store.id) &&
        typeof store.name === 'string' &&
        store.name.trim(),
    )
  )
    throw new Error(
      'USER_MANAGEMENT_STORES debe ser una lista de locales con id UUID y nombre.',
    );
  const stores = new Map<string, StoreOption>();
  for (const user of users)
    if (user.store) stores.set(user.store.id, user.store);
  for (const store of configured as StoreOption[])
    stores.set(store.id, { id: store.id, name: store.name.trim() });
  return [...stores.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'es'),
  );
}
export function filterUsers(
  users: ManagedUser[],
  search: string,
  role: string,
  active: string,
  storeId: string,
): ManagedUser[] {
  const query = search.trim().toLocaleLowerCase('es');
  return users.filter(
    (user) =>
      `${user.firstName} ${user.lastName} ${user.email}`
        .toLocaleLowerCase('es')
        .includes(query) &&
      (!role || user.role.code === role) &&
      (!active || String(user.isActive) === active) &&
      (!storeId || user.store?.id === storeId),
  );
}
export function hasSameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  const protocol =
    request.headers.get('x-forwarded-proto') ?? url.protocol.slice(0, -1);
  if (protocol !== 'http' && protocol !== 'https') return false;
  try {
    return (
      request.headers.get('origin') ===
      new URL(`${protocol}://${request.headers.get('host') ?? url.host}`).origin
    );
  } catch {
    return false;
  }
}
