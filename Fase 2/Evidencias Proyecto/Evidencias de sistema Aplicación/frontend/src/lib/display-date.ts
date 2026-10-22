// Las fechas calendario no cambian de día por zona horaria.
export function formatCalendarDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  return day + '-' + month + '-' + year;
}
export function formatChileDate(value: string): string {
  const parts = new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Santiago',
  }).formatToParts(new Date(value));
  return ['day', 'month', 'year']
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join('-');
}
