import { isRecord } from './auth';
import { isUuid } from './users';

// Alias de medios de pago de los informes de MrComanda (SPRINT-4A-T20):
// contrato de GET/POST/DELETE /payment-method-aliases. Funciones puras,
// compartidas por el BFF y la vista de /admin/medios-pago.
export const ALIAS_LABEL_MAX_LENGTH = 100;

export interface PaymentMethodAlias {
  id: string;
  label: string;
  normalizedLabel: string;
  paymentMethod: { id: string; code: string; name: string; isActive: boolean };
  createdAt: string;
}
export interface PaymentMethodAliasInput {
  label: string;
  paymentMethodId: string;
}
export type AliasOperation = 'load' | 'create' | 'delete';

const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function parsePaymentMethodAlias(
  value: unknown,
): PaymentMethodAlias | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !text(value.label) ||
    !text(value.normalizedLabel) ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !isRecord(value.paymentMethod)
  )
    return null;
  const method = value.paymentMethod;
  if (
    !isUuid(method.id) ||
    !text(method.code) ||
    !text(method.name) ||
    typeof method.isActive !== 'boolean'
  )
    return null;
  return {
    id: value.id,
    label: value.label,
    normalizedLabel: value.normalizedLabel,
    paymentMethod: {
      id: method.id,
      code: method.code,
      name: method.name,
      isActive: method.isActive,
    },
    createdAt: value.createdAt,
  };
}
export function parsePaymentMethodAliases(
  value: unknown,
): PaymentMethodAlias[] | null {
  if (!Array.isArray(value)) return null;
  const aliases = value.map(parsePaymentMethodAlias);
  return aliases.every((alias): alias is PaymentMethodAlias => alias !== null)
    ? aliases
    : null;
}

// Misma regla que el backend (normalize_external_label): sin tildes,
// mayúsculas y espacios colapsados; la puntuación cuenta.
const ACCENTED = 'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ';
const PLAIN = 'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN';
export function normalizeAliasLabel(label: string): string {
  let plain = '';
  for (const char of label) {
    const index = ACCENTED.indexOf(char);
    plain += index >= 0 ? PLAIN[index] : char;
  }
  return plain
    .toUpperCase()
    .replace(/[ \t\n\r\f\v]+/g, ' ')
    .trim();
}

// Error de la etiqueta escrita, o null si es válida y no está asociada.
export function aliasLabelError(
  label: string,
  aliases: readonly PaymentMethodAlias[],
): string | null {
  const trimmed = label.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'Escribe la etiqueta tal como aparece en el informe.';
  if (trimmed.length > ALIAS_LABEL_MAX_LENGTH)
    return `La etiqueta admite a lo más ${ALIAS_LABEL_MAX_LENGTH} caracteres.`;
  const normalized = normalizeAliasLabel(trimmed);
  const existing = aliases.find(
    (alias) => alias.normalizedLabel === normalized,
  );
  return existing
    ? `«${existing.label}» ya está asociada a ${existing.paymentMethod.name}. Quítala de ese medio para asociarla a otro.`
    : null;
}

// El BFF solo reenvía la etiqueta (sin relleno) y el ID del medio.
export function parseAliasInput(
  value: unknown,
): PaymentMethodAliasInput | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.label !== 'string' ||
    !isUuid(value.paymentMethodId)
  )
    return null;
  const label = value.label.replace(/\s+/g, ' ').trim();
  if (!label || label.length > ALIAS_LABEL_MAX_LENGTH) return null;
  return { label, paymentMethodId: value.paymentMethodId };
}

// Alias de cada medio, en el orden del listado.
export function aliasesByMethod(
  aliases: readonly PaymentMethodAlias[],
): Map<string, PaymentMethodAlias[]> {
  const groups = new Map<string, PaymentMethodAlias[]>();
  for (const alias of aliases)
    groups.set(alias.paymentMethod.id, [
      ...(groups.get(alias.paymentMethod.id) ?? []),
      alias,
    ]);
  return groups;
}

export function aliasErrorMessage(
  status: number,
  operation: AliasOperation = 'create',
): string {
  const messages: Record<number, string> = {
    400:
      operation === 'create'
        ? 'Revisa la etiqueta y elige un medio activo.'
        : 'La solicitud no es válida. Actualiza la vista.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'Solo el administrador gestiona las etiquetas de los informes.',
    404:
      operation === 'delete'
        ? 'La etiqueta ya no existe. Actualiza la vista.'
        : 'El medio de pago ya no está disponible. Actualiza la vista.',
    409: 'Esa etiqueta ya está asociada a otro medio. Quítala de ese medio para asociarla aquí.',
    502: 'No se pudo verificar la respuesta del servicio. Actualiza antes de repetir la operación.',
    503: 'No se pudo conectar con el servicio. Intenta nuevamente.',
  };
  return (
    messages[status] ??
    (operation === 'load'
      ? 'No se pudieron cargar las etiquetas de los informes.'
      : 'No se pudo guardar la etiqueta. Intenta nuevamente.')
  );
}
