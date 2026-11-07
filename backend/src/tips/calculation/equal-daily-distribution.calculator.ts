// Reparto equitativo diario de propinas (SPRINT-4R-T04). Función pura y
// determinista, sin NestJS ni base de datos: opera con enteros (bigint) para
// que el redondeo no dependa del punto flotante.
//
// Regla: el fondo de cada día (propina de tarjeta + efectivo de la operación
// diaria) se divide UNA sola vez entre los participantes de ese día, y cada
// trabajador recibe la suma de sus asignaciones diarias del período. Nunca se
// divide el total del período entre la unión de trabajadores.
//
// Residuo CLP: cada participante recibe floor(fondo / n) y los r = fondo mod n
// pesos sobrantes se entregan de a $1. Los participantes se ordenan por ID
// ascendente y el primer peso va a la posición (díaDesdeEpoch mod n), el
// siguiente a la posición siguiente (circular), y así hasta repartir los r
// pesos. díaDesdeEpoch es el número de días entre 1970-01-01 y la fecha de
// negocio: así el peso extra rota entre los participantes día a día en vez de
// favorecer siempre al mismo, y la asignación de un día depende solo de ese
// día (fecha, fondo y participantes), no del período consultado.
// Ejemplo: $10.000 entre 3 → $3.334, $3.333 y $3.333.

export interface EqualDailyShareDay {
  operationId: string;
  // Fecha de negocio YYYY-MM-DD.
  businessDate: string;
  // Fondo del día en CLP enteros.
  fundAmount: number;
  participantIds: readonly string[];
}

export interface EqualDailyShareAllocation {
  userId: string;
  amount: number;
}

export interface EqualDailyShareDayResult {
  operationId: string;
  businessDate: string;
  fundAmount: number;
  // Una asignación por participante, ordenadas por userId.
  allocations: EqualDailyShareAllocation[];
}

export interface EqualDailyDistributionResult {
  days: EqualDailyShareDayResult[];
  // Suma por trabajador de sus asignaciones diarias, ordenadas por userId.
  // Solo aparecen los trabajadores que participaron de algún día.
  lines: EqualDailyShareAllocation[];
  totalAmount: number;
}

export type EqualDistributionErrorCode =
  | 'INVALID_FUND'
  | 'INVALID_DATE'
  | 'DUPLICATED_OPERATION'
  | 'DUPLICATED_PARTICIPANT'
  | 'NO_PARTICIPANTS';

// Error de dominio: la entrada no permite calcular un reparto válido.
export class EqualDistributionError extends Error {
  constructor(
    readonly code: EqualDistributionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EqualDistributionError';
  }
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

// Comparación por unidades de código, independiente del idioma del sistema.
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Días transcurridos desde 1970-01-01 hasta la fecha de negocio.
export function epochDay(businessDate: string): number {
  const match = DATE_PATTERN.exec(businessDate);
  const time = match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : Number.NaN;
  // Date.UTC desborda fechas imposibles (2026-02-30 → 2026-03-02): la ida y
  // vuelta a texto las detecta.
  if (
    !match ||
    Number.isNaN(time) ||
    new Date(time).toISOString().slice(0, 10) !== businessDate
  ) {
    throw new EqualDistributionError(
      'INVALID_DATE',
      `Fecha de negocio inválida (YYYY-MM-DD): ${businessDate}`,
    );
  }
  return Math.floor(time / MS_PER_DAY);
}

// Divide el fondo de un día entre sus participantes con la regla documentada
// arriba. Las asignaciones salen ordenadas por userId y suman el fondo exacto.
export function splitDailyFund(
  day: EqualDailyShareDay,
): EqualDailyShareAllocation[] {
  const { fundAmount } = day;
  if (!Number.isSafeInteger(fundAmount) || fundAmount < 0) {
    throw new EqualDistributionError(
      'INVALID_FUND',
      `El fondo del ${day.businessDate} debe ser un entero CLP mayor o igual a 0: ${fundAmount}`,
    );
  }
  const unique = new Set(day.participantIds);
  if (unique.size !== day.participantIds.length) {
    throw new EqualDistributionError(
      'DUPLICATED_PARTICIPANT',
      `Participante repetido en la operación del ${day.businessDate}`,
    );
  }
  const participants = [...day.participantIds].sort(compareIds);
  const count = participants.length;
  if (count === 0) {
    if (fundAmount > 0) {
      throw new EqualDistributionError(
        'NO_PARTICIPANTS',
        `El ${day.businessDate} hay un fondo de ${fundAmount} CLP y no hay participantes entre los que repartirlo`,
      );
    }
    return [];
  }

  const fund = BigInt(fundAmount);
  const size = BigInt(count);
  const base = fund / size;
  const residual = Number(fund % size);
  const offset = epochDay(day.businessDate) % count;
  return participants.map((userId, index) => {
    // Posición relativa al inicio de la rotación del día.
    const turn = (index - offset + count) % count;
    return {
      userId,
      amount: Number(base + (turn < residual ? 1n : 0n)),
    };
  });
}

// Calcula el reparto equitativo del período: asignación diaria de cada
// operación y acumulado por trabajador. Las líneas siempre suman el total.
export function calculateEqualDailyDistribution(
  days: readonly EqualDailyShareDay[],
): EqualDailyDistributionResult {
  const seen = new Set<string>();
  const results: EqualDailyShareDayResult[] = [];
  const totals = new Map<string, bigint>();
  let total = 0n;
  for (const day of days) {
    if (seen.has(day.operationId)) {
      throw new EqualDistributionError(
        'DUPLICATED_OPERATION',
        `Operación diaria repetida en el reparto: ${day.operationId}`,
      );
    }
    seen.add(day.operationId);
    const allocations = splitDailyFund(day);
    for (const allocation of allocations) {
      totals.set(
        allocation.userId,
        (totals.get(allocation.userId) ?? 0n) + BigInt(allocation.amount),
      );
    }
    total += BigInt(day.fundAmount);
    results.push({
      operationId: day.operationId,
      businessDate: day.businessDate,
      fundAmount: day.fundAmount,
      allocations,
    });
  }

  const lines = [...totals.entries()]
    .sort(([a], [b]) => compareIds(a, b))
    .map(([userId, amount]) => ({ userId, amount: Number(amount) }));
  const totalAmount = Number(total);

  // Invariante de conciliación: si falla es un error de programación.
  const linesTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  if (linesTotal !== totalAmount) {
    throw new Error(
      `El reparto no concilia: líneas ${linesTotal} ≠ fondo ${totalAmount}`,
    );
  }
  return { days: results, lines, totalAmount };
}
