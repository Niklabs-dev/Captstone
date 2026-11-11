// Normalización y validación del código estable de un medio de pago
// (SPRINT-4-T32). El código se guarda en UPPER_SNAKE, con dígitos y letras,
// y no se edita después de crear el medio: los montos históricos siguen
// referenciándolo sin ambigüedad.

export const PAYMENT_METHOD_CODE_MAX_LENGTH = 40;

const TOKEN_PATTERN = /^[A-Z0-9]+$/;
const LETTER_PATTERN = /[A-Z]/;

// " Tarjeta débito " → "TARJETA_DEBITO"; tolera guiones y guiones bajos
// repetidos, pero nunca produce un código que empiece o termine en "_".
export function normalizePaymentMethodCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/gu, '_')
    .replace(/_{2,}/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

// Código válido: 2 a 40 caracteres (PAYMENT_METHOD_CODE_MAX_LENGTH), tokens
// alfanuméricos separados por "_" y al menos una letra (evita códigos
// puramente numéricos, confundibles con montos o cantidades).
export function isValidPaymentMethodCode(code: string): boolean {
  if (code.length < 2 || code.length > PAYMENT_METHOD_CODE_MAX_LENGTH) {
    return false;
  }
  if (!LETTER_PATTERN.test(code)) {
    return false;
  }
  return code.split('_').every((token) => TOKEN_PATTERN.test(token));
}

// Código para un medio creado desde la vista previa de la importación de
// ventas (SPRINT-4A-T21), derivado de su nombre: sin tildes, en mayúsculas y
// con cada tramo que no sea letra o dígito como un "_" («N.de Créd.» →
// "N_DE_CRED"). Se recorta a PAYMENT_METHOD_CODE_MAX_LENGTH; quien lo use
// debe validarlo con isValidPaymentMethodCode (un nombre sin letras ASCII ni
// dígitos produce un código vacío o inválido).
export function paymentMethodCodeFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, PAYMENT_METHOD_CODE_MAX_LENGTH)
    .replace(/_+$/u, '');
}
