// Helpers compartidos del calendario de negocio y formato CLP. La captura por
// medio de pago (SPRINT-4-T32) fue reemplazada por la operación diaria
// (SPRINT-4R-T01); estos utilitarios siguen usándose en repartos,
// constancias y la operación diaria.
export function isTipDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
export function tipBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map((key) => parts.find((part) => part.type === key)?.value)
    .join('-');
}
// El código llega del catálogo administrable de medios de pago; se valida
// forma básica y el backend es la autoridad.
export function isTipMethodCode(value: unknown): value is string {
  const code = typeof value === 'string' ? value.trim() : '';
  return (
    code.length > 0 && code.length <= 60 && !/[\u0000-\u001f\u007f]/.test(code)
  );
}
export function formatClp(amount: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(amount);
}
