// Estado de ventas de un local en un día de negocio (SPRINT-4R-T12).
//
// Se calcula al consultar, sin guardar alertas: así cada local y fecha tiene
// a lo más un estado y una importación tardía lo resuelve sola. Reglas, en
// orden:
// 1. Día futuro → no se informa.
// 2. Con importación vigente (ACTIVE) → IMPORTADO (aunque el día estuviera
//    cerrado o el local no tenga calendario: el dato existe).
// 3. Local sin calendario, o día anterior a la fecha de inicio → no se
//    informa (sin alertas hasta que el administrador lo configure).
// 4. Día no laborable de la semana o con excepción de cierre → CERRADO
//    (nunca es una alerta).
// 5. Es hoy → PENDIENTE (informativo: el Excel suele llegar al día
//    siguiente); día pasado → ATRASADO (alerta).
// Las fechas son de negocio (YYYY-MM-DD) en hora de Chile: «hoy» lo calcula
// quien llama con businessDateOf(now).

export type SalesDayStatus = 'IMPORTADO' | 'PENDIENTE' | 'ATRASADO' | 'CERRADO';

// Días de la semana ISO: 1 = lunes … 7 = domingo.
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface OperatingCalendar {
  openWeekdays: ReadonlySet<IsoWeekday>;
  trackingStartDate: string;
}

export interface SalesDayInput {
  date: string;
  today: string;
  calendar: OperatingCalendar | null;
  hasClosure: boolean;
  hasActiveImport: boolean;
}

// Día de la semana ISO de una fecha YYYY-MM-DD (sin depender de la zona
// horaria del servidor: se interpreta como fecha UTC).
export function isoWeekdayOf(date: string): IsoWeekday {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

export function salesDayStatus(input: SalesDayInput): SalesDayStatus | null {
  const { date, today, calendar } = input;
  if (date > today) return null;
  if (input.hasActiveImport) return 'IMPORTADO';
  if (calendar === null || date < calendar.trackingStartDate) return null;
  if (input.hasClosure || !calendar.openWeekdays.has(isoWeekdayOf(date))) {
    return 'CERRADO';
  }
  return date === today ? 'PENDIENTE' : 'ATRASADO';
}
