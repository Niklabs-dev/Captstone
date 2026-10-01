// Utilidades de RUT chileno (SPRINT-1-T08). El RUT se guarda normalizado
// como "12345678-K": sin puntos, con guion y dígito verificador en mayúscula.

const RUT_PATTERN = /^(\d{7,8})-([\dK])$/;

// Quita puntos y espacios y pasa el dígito verificador a mayúscula.
export function normalizeRut(rut: string): string {
  return rut.replace(/[.\s]/g, '').toUpperCase();
}

// Calcula el dígito verificador con el algoritmo módulo 11.
export function computeRutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

// Indica si el RUT (con o sin puntos) tiene formato y dígito verificador válidos.
export function isValidRut(rut: string): boolean {
  const match = RUT_PATTERN.exec(normalizeRut(rut));
  if (!match) return false;
  return computeRutCheckDigit(match[1]) === match[2];
}
