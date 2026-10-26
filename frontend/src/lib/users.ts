export const USER_ROLES = [
  'ADMINISTRADOR',
  'CONTADOR',
  'SUPERVISOR',
  'TRABAJADOR',
] as const;
export type UserRole = (typeof USER_ROLES)[number];
// Misma política de contraseña que el backend; bcrypt trunca sobre 72 bytes.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 32;
export const PASSWORD_MAX_BYTES = 72;
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMINISTRADOR: 'Administrador',
  CONTADOR: 'Contador',
  SUPERVISOR: 'Supervisor',
  TRABAJADOR: 'Trabajador',
};
export interface StoreOption {
  id: string;
  name: string;
  isActive?: boolean;
}
export interface ManagedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  role: { code: UserRole; name: string };
  store: StoreOption | null;
  rut?: string | null;
  phone?: string | null;
  hiredAt?: string | null;
}
export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  roleCode?: UserRole;
  storeId?: string | null;
  rut?: string | null;
  phone?: string | null;
  hiredAt?: string | null;
}
export function parsePasswordReset(
  value: unknown,
): InputResult<{ newPassword: string }> {
  if (
    !isObject(value) ||
    Object.keys(value).some((key) => key !== 'newPassword') ||
    typeof value.newPassword !== 'string' ||
    Array.from(value.newPassword).length < PASSWORD_MIN_LENGTH ||
    Array.from(value.newPassword).length > PASSWORD_MAX_LENGTH ||
    new TextEncoder().encode(value.newPassword).length > PASSWORD_MAX_BYTES
  )
    return {
      ok: false,
      message:
        'La contraseña debe tener entre 8 y 32 caracteres y no superar 72 bytes.',
    };
  return { ok: true, data: { newPassword: value.newPassword } };
}
export function parseUpdateUser(value: unknown): InputResult<UpdateUserInput> {
  if (!isObject(value))
    return { ok: false, message: 'Revisa los datos del usuario.' };
  const allowed = [
    'firstName',
    'lastName',
    'email',
    'roleCode',
    'storeId',
    'rut',
    'phone',
    'hiredAt',
  ];
  if (
    !Object.keys(value).length ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    return { ok: false, message: 'La edición contiene campos no permitidos.' };
  const data: UpdateUserInput = {};
  for (const key of ['firstName', 'lastName'] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== 'string' || !field.trim() || field.trim().length > 80)
      return {
        ok: false,
        message:
          'Nombre y apellido son obligatorios y admiten hasta 80 caracteres.',
      };
    data[key] = field.trim();
  }
  if (value.email !== undefined) {
    if (
      typeof value.email !== 'string' ||
      value.email.trim().length > 160 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())
    )
      return {
        ok: false,
        message:
          'Ingresa un correo electrónico válido (máximo 160 caracteres).',
      };
    data.email = value.email.trim().toLowerCase();
  }
  if (value.roleCode !== undefined) {
    if (!isUserRole(value.roleCode))
      return { ok: false, message: 'Selecciona un rol válido.' };
    data.roleCode = value.roleCode;
  }
  if (value.storeId !== undefined) {
    if (value.storeId !== null && !isUuid(value.storeId))
      return { ok: false, message: 'Selecciona un local válido.' };
    data.storeId = value.storeId;
  }
  if (
    data.roleCode &&
    ((needsStore(data.roleCode) && data.storeId === null) ||
      (!needsStore(data.roleCode) && typeof data.storeId === 'string'))
  )
    return { ok: false, message: 'El local debe ser compatible con el rol.' };
  for (const key of ['rut', 'phone', 'hiredAt'] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (field === null || field === '') {
      data[key] = null;
      continue;
    }
    if (typeof field !== 'string')
      return { ok: false, message: 'Revisa los datos personales.' };
    const text =
      key === 'rut' ? field.replace(/[.\s]/g, '').toUpperCase() : field.trim();
    if (key === 'rut') {
      const match = /^(\d{7,8})-([\dK])$/.exec(text);
      let sum = 0;
      let factor = 2;
      for (const digit of (match?.[1] ?? '').split('').reverse()) {
        sum += Number(digit) * factor;
        factor = factor === 7 ? 2 : factor + 1;
      }
      const remainder = 11 - (sum % 11);
      const check =
        remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
      if (!match || match[2] !== check)
        return { ok: false, message: 'Ingresa un RUT chileno válido.' };
    }
    if (key === 'phone' && !/^\+?[\d\s-]{8,20}$/.test(text))
      return {
        ok: false,
        message: 'Ingresa un teléfono válido de 8 a 20 caracteres.',
      };
    if (
      key === 'hiredAt' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        !Number.isFinite(Date.parse(text)) ||
        new Date(text).toISOString().slice(0, 10) !== text)
    )
      return {
        ok: false,
        message: 'Ingresa una fecha de contratación válida.',
      };
    data[key] = text;
  }
  return { ok: true, data };
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
    value.password.length < PASSWORD_MIN_LENGTH ||
    value.password.length > PASSWORD_MAX_LENGTH ||
    new TextEncoder().encode(value.password).length > PASSWORD_MAX_BYTES
  )
    return {
      ok: false,
      message:
        'La contraseña debe tener entre 8 y 32 caracteres y no superar 72 bytes.',
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
    ['rut', 'phone', 'hiredAt'].some(
      (key) =>
        value[key] !== undefined &&
        value[key] !== null &&
        typeof value[key] !== 'string',
    ) ||
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
    ...(value.rut === null || typeof value.rut === 'string'
      ? { rut: value.rut }
      : {}),
    ...(value.phone === null || typeof value.phone === 'string'
      ? { phone: value.phone }
      : {}),
    ...(value.hiredAt === null || typeof value.hiredAt === 'string'
      ? { hiredAt: value.hiredAt }
      : {}),
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
