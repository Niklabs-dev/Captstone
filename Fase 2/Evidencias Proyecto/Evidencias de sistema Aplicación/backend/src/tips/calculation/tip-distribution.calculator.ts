// Cálculo del reparto de propinas proporcional a las horas (SPRINT-3-T12).
// Función pura y determinista, sin NestJS ni base de datos: opera con
// enteros (bigint) para que el redondeo no dependa del punto flotante.

export interface TipDistributionWorker {
  userId: string;
  // Horas como texto decimal con hasta 2 decimales (ej. "37.50").
  hoursWorked: string;
}

export interface TipDistributionInput {
  // Fondo del período en CLP enteros.
  fundAmount: number;
  workers: readonly TipDistributionWorker[];
}

export interface TipDistributionLine {
  userId: string;
  // Horas normalizadas a 2 decimales (ej. "40.00").
  hoursWorked: string;
  amount: number;
}

export type TipDistributionErrorCode =
  | 'INVALID_FUND'
  | 'INVALID_HOURS'
  | 'DUPLICATED_WORKER'
  | 'NO_HOURS_TO_DISTRIBUTE';

// Error de dominio: la entrada no permite calcular un reparto válido.
export class TipDistributionError extends Error {
  constructor(
    readonly code: TipDistributionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TipDistributionError';
  }
}

const HOURS_PATTERN = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

// Convierte horas decimales a centésimas enteras: "37.5" → 3750n.
export function toHundredths(hoursWorked: string): bigint {
  if (hoursWorked.trim().startsWith('-')) {
    throw new TipDistributionError(
      'INVALID_HOURS',
      `Las horas no pueden ser negativas: ${hoursWorked}`,
    );
  }
  const match = HOURS_PATTERN.exec(hoursWorked);
  if (!match) {
    throw new TipDistributionError(
      'INVALID_HOURS',
      `Horas inválidas (máximo 2 decimales): ${hoursWorked}`,
    );
  }
  const decimals = (match[2] ?? '').padEnd(2, '0');
  return BigInt(match[1]) * 100n + BigInt(decimals);
}

// Centésimas a texto con 2 decimales: 3750n → "37.50".
export function formatHundredths(hundredths: bigint): string {
  const units = hundredths / 100n;
  const decimals = (hundredths % 100n).toString().padStart(2, '0');
  return `${units}.${decimals}`;
}

// Comparación por unidades de código, independiente del idioma del sistema.
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Reparte fundAmount en proporción a las horas con el método del mayor
// resto: cada uno recibe floor(fondo × h_i / H) y los CLP sobrantes van, de
// a uno, a quienes tienen el mayor resto (fondo × h_i) mod H; los empates se
// resuelven por userId ascendente. Las líneas salen ordenadas por userId y
// siempre suman exactamente el fondo.
export function calculateTipDistribution(
  input: TipDistributionInput,
): TipDistributionLine[] {
  const { fundAmount } = input;
  if (!Number.isSafeInteger(fundAmount) || fundAmount < 0) {
    throw new TipDistributionError(
      'INVALID_FUND',
      `El fondo debe ser un entero CLP mayor o igual a 0: ${fundAmount}`,
    );
  }

  const seen = new Set<string>();
  const workers = input.workers
    .map((worker) => {
      if (seen.has(worker.userId)) {
        throw new TipDistributionError(
          'DUPLICATED_WORKER',
          `Trabajador repetido en el reparto: ${worker.userId}`,
        );
      }
      seen.add(worker.userId);
      return { userId: worker.userId, hours: toHundredths(worker.hoursWorked) };
    })
    .sort((a, b) => compareIds(a.userId, b.userId));

  const totalHours = workers.reduce((sum, worker) => sum + worker.hours, 0n);
  const fund = BigInt(fundAmount);
  if (fund > 0n && totalHours === 0n) {
    throw new TipDistributionError(
      'NO_HOURS_TO_DISTRIBUTE',
      'No hay horas trabajadas entre las que repartir el fondo',
    );
  }

  const shares = workers.map((worker) => {
    const product = fund * worker.hours;
    return {
      userId: worker.userId,
      hours: worker.hours,
      amount: totalHours === 0n ? 0n : product / totalHours,
      remainder: totalHours === 0n ? 0n : product % totalHours,
    };
  });

  const distributed = shares.reduce((sum, share) => sum + share.amount, 0n);
  const residual = Number(fund - distributed);
  // Mayor resto primero; a igual resto, userId ascendente (sort es estable y
  // shares ya viene ordenado por userId).
  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) return 0;
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (const share of byRemainder.slice(0, residual)) share.amount += 1n;

  const lines = shares.map((share) => ({
    userId: share.userId,
    hoursWorked: formatHundredths(share.hours),
    amount: Number(share.amount),
  }));

  // Invariante de conciliación: si falla es un error de programación.
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  if (total !== fundAmount) {
    throw new Error(
      `El reparto no concilia: líneas ${total} ≠ fondo ${fundAmount}`,
    );
  }
  return lines;
}
