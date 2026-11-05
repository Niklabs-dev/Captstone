import { isObject, isUuid } from './users';

// Comportamiento del medio frente al cierre y la conciliación; lo define el backend.
export const PAYMENT_METHOD_BEHAVIORS = [
  'CASH',
  'RECONCILABLE_CARD',
  'EXTERNAL_OTHER',
] as const;
export type PaymentMethodBehavior = (typeof PAYMENT_METHOD_BEHAVIORS)[number];
export const PAYMENT_METHOD_BEHAVIOR_LABELS: Record<
  PaymentMethodBehavior,
  string
> = {
  CASH: 'Efectivo',
  RECONCILABLE_CARD: 'Tarjeta conciliable',
  EXTERNAL_OTHER: 'Externo u otro',
};
// El código es estable e inmutable: identifica el medio en ventas, propinas y cierres.
export const PAYMENT_METHOD_CODE_MAX = 40;
export const PAYMENT_METHOD_NAME_MAX = 100;
export const PAYMENT_METHOD_SORT_MIN = 0;
export const PAYMENT_METHOD_SORT_MAX = Number.MAX_SAFE_INTEGER;
export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  behavior: PaymentMethodBehavior;
  availableForTips: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface PaymentMethodCreateInput {
  code: string;
  name: string;
  sortOrder: number;
  behavior: PaymentMethodBehavior;
  availableForTips: boolean;
}
export type PaymentMethodUpdateInput = Partial<
  Pick<PaymentMethod, 'name' | 'sortOrder' | 'behavior' | 'availableForTips'>
>;
export type PaymentMethodField = keyof PaymentMethodCreateInput;
export type PaymentMethodOperation = 'load' | 'save' | 'state';
export const PAYMENT_METHOD_CREATE_FIELDS = [
  'code',
  'name',
  'sortOrder',
  'behavior',
  'availableForTips',
] as const;
export const PAYMENT_METHOD_UPDATE_FIELDS = [
  'name',
  'sortOrder',
  'behavior',
  'availableForTips',
] as const;
export const PAYMENT_METHOD_FIELD_LABELS: Record<PaymentMethodField, string> = {
  code: 'Código del medio',
  name: 'Nombre del medio',
  sortOrder: 'Orden de lista',
  behavior: 'Comportamiento en cierre',
  availableForTips: 'Disponible para propinas',
};
export function isPaymentMethodBehavior(
  value: unknown,
): value is PaymentMethodBehavior {
  return PAYMENT_METHOD_BEHAVIORS.some((behavior) => behavior === value);
}
// Normaliza lo tecleado igual que el backend (SPRINT-4-T32): UPPER_SNAKE con
// tokens alfanuméricos, sin guiones bajos repetidos ni al inicio o final.
export function normalizePaymentMethodCode(value: string): string {
  return value
    .replace(/\p{Cf}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/gu, '_')
    .replace(/_{2,}/gu, '_')
    .replace(/^_+|_+$/gu, '');
}
// Mismo contrato que el backend: 2 a 40 caracteres, tokens alfanuméricos
// separados por "_" y al menos una letra (evita códigos puramente numéricos).
export function isValidPaymentMethodCodeFormat(code: string): boolean {
  if (code.length < 2 || code.length > PAYMENT_METHOD_CODE_MAX) return false;
  if (!/[A-Z]/.test(code)) return false;
  return code.split('_').every((token) => /^[A-Z0-9]+$/.test(token));
}
export function paymentMethodCodeError(value: unknown): string | null {
  if (typeof value !== 'string') return 'Ingresa el código del medio.';
  const code = normalizePaymentMethodCode(value);
  if (!code) return 'Ingresa el código del medio.';
  if (code.length > PAYMENT_METHOD_CODE_MAX)
    return `Admite hasta ${PAYMENT_METHOD_CODE_MAX} caracteres.`;
  if (!isValidPaymentMethodCodeFormat(code))
    return 'Usa entre 2 y 40 caracteres: letras, números y guiones bajos, con al menos una letra.';
  return null;
}
export function paymentMethodNameError(value: unknown): string | null {
  if (typeof value !== 'string') return 'Ingresa el nombre del medio.';
  const name = value
    .replace(/\p{Cf}/gu, '')
    .trim()
    .replace(/\s+/gu, ' ');
  if (!name) return 'Ingresa el nombre del medio.';
  if (name.length > PAYMENT_METHOD_NAME_MAX)
    return `Admite hasta ${PAYMENT_METHOD_NAME_MAX} caracteres.`;
  if (/[\u0000-\u001f\u007f]/.test(name))
    return 'Quita los caracteres de control.';
  if (!/\p{L}/u.test(name)) return 'Incluye al menos una letra.';
  return null;
}
export function parsePaymentMethodSortOrder(value: unknown): number | null {
  const order =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : null;
  if (
    order === null ||
    !Number.isSafeInteger(order) ||
    order < PAYMENT_METHOD_SORT_MIN ||
    order > PAYMENT_METHOD_SORT_MAX
  )
    return null;
  return order;
}
export function paymentMethodSortOrderError(value: unknown): string | null {
  return parsePaymentMethodSortOrder(value) === null
    ? 'Ingresa un entero mayor o igual a 0.'
    : null;
}
function parseCreateInput(value: unknown): PaymentMethodCreateInput | null {
  if (
    !isObject(value) ||
    Object.keys(value).length !== PAYMENT_METHOD_CREATE_FIELDS.length ||
    Object.keys(value).some(
      (key) =>
        !PAYMENT_METHOD_CREATE_FIELDS.includes(key as PaymentMethodField),
    ) ||
    paymentMethodCodeError(value.code) ||
    paymentMethodNameError(value.name) ||
    paymentMethodSortOrderError(value.sortOrder) ||
    !isPaymentMethodBehavior(value.behavior) ||
    typeof value.availableForTips !== 'boolean'
  )
    return null;
  return {
    code: normalizePaymentMethodCode(value.code as string),
    name: (value.name as string)
      .replace(/\p{Cf}/gu, '')
      .trim()
      .replace(/\s+/gu, ' '),
    sortOrder: parsePaymentMethodSortOrder(value.sortOrder) as number,
    behavior: value.behavior,
    availableForTips: value.availableForTips,
  };
}
export function parsePaymentMethodCreateInput(
  value: unknown,
): PaymentMethodCreateInput | null {
  return parseCreateInput(value);
}
export function parsePaymentMethodUpdateInput(
  value: unknown,
): PaymentMethodUpdateInput | null {
  if (!isObject(value) || !Object.keys(value).length) return null;
  if (
    Object.keys(value).some(
      (key) =>
        !PAYMENT_METHOD_UPDATE_FIELDS.includes(
          key as keyof PaymentMethodUpdateInput,
        ),
    )
  )
    return null;
  const input: PaymentMethodUpdateInput = {};
  if (value.name !== undefined) {
    if (paymentMethodNameError(value.name)) return null;
    input.name = (value.name as string)
      .replace(/\p{Cf}/gu, '')
      .trim()
      .replace(/\s+/gu, ' ');
  }
  if (value.sortOrder !== undefined) {
    const order = parsePaymentMethodSortOrder(value.sortOrder);
    if (order === null) return null;
    input.sortOrder = order;
  }
  if (value.behavior !== undefined) {
    if (!isPaymentMethodBehavior(value.behavior)) return null;
    input.behavior = value.behavior;
  }
  if (value.availableForTips !== undefined) {
    if (typeof value.availableForTips !== 'boolean') return null;
    input.availableForTips = value.availableForTips;
  }
  return input;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
export function parsePaymentMethod(value: unknown): PaymentMethod | null {
  if (
    !isObject(value) ||
    !isUuid(value.id) ||
    typeof value.code !== 'string' ||
    !value.code ||
    value.code.length > PAYMENT_METHOD_CODE_MAX ||
    typeof value.name !== 'string' ||
    !value.name ||
    value.name.length > PAYMENT_METHOD_NAME_MAX ||
    parsePaymentMethodSortOrder(value.sortOrder) === null ||
    typeof value.isActive !== 'boolean' ||
    !isPaymentMethodBehavior(value.behavior) ||
    typeof value.availableForTips !== 'boolean' ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt)
  )
    return null;
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    sortOrder: value.sortOrder as number,
    isActive: value.isActive,
    behavior: value.behavior,
    availableForTips: value.availableForTips,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
export function sortPaymentMethods(
  methods: readonly PaymentMethod[],
): PaymentMethod[] {
  return [...methods].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
  );
}
export function parsePaymentMethods(value: unknown): PaymentMethod[] | null {
  if (!Array.isArray(value)) return null;
  const items: PaymentMethod[] = [];
  for (const candidate of value) {
    const method = parsePaymentMethod(candidate);
    if (!method || items.some((item) => item.id === method.id)) return null;
    items.push(method);
  }
  return sortPaymentMethods(items);
}
export function paymentMethodErrorMessage(
  status: number,
  operation: PaymentMethodOperation = 'save',
): string {
  const messages: Record<number, string> = {
    400: 'Revisa el código, el nombre, el orden y la configuración del medio.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'No tienes permiso para administrar medios de pago.',
    404: 'El medio de pago ya no está disponible. Actualiza el catálogo.',
    409: 'Ya existe un medio de pago con ese código. Usa otro código.',
    502: 'La respuesta del catálogo no pudo verificarse. Actualiza antes de repetir la operación.',
    503: 'No se pudo conectar con el catálogo de medios de pago. Intenta nuevamente.',
  };
  return (
    messages[status] ??
    (operation === 'load'
      ? 'No se pudo cargar el catálogo de medios de pago. Vuelve a cargar la vista o actualiza el catálogo.'
      : 'No se pudo guardar el medio de pago. Intenta nuevamente.')
  );
}
