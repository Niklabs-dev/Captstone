import { splitDailyFund } from '../../tips/calculation/equal-daily-distribution.calculator.js';

// Reparto automático de la propina del día (SPRINT-4A-T03). Función pura: a
// partir del fondo de la operación diaria (tarjeta + efectivo) y de sus
// participantes calcula la propina de cada trabajador que se guarda como
// asignación No pagada en la misma transacción que la operación.
//
// Regla (la misma de SPRINT-4R-T04, splitDailyFund, que también usan la vista
// previa del formulario del supervisor y la migración de datos de
// SPRINT-4A-T02): cada participante recibe floor(fondo / n) y los
// r = fondo mod n pesos sobrantes van de a $1 a los r primeros participantes
// de un orden estable y documentado: los participantes ordenados por ID
// ascendente, comenzando en la posición (días desde 1970-01-01) mod n y
// avanzando de forma circular. Así el peso extra rota día a día entre los
// participantes y el resultado depende solo del día (fecha, fondo y
// selección). La suma siempre es exactamente el fondo.
// Ejemplos: $40.000 entre 4 → $10.000 a cada uno; $10.000 entre 3 → $3.334,
// $3.333 y $3.333; con fondo 0 no hay asignaciones.

export interface DailyTipSplitInput {
  operationId: string;
  // Fecha de negocio YYYY-MM-DD.
  businessDate: string;
  // Fondo del día en CLP enteros (tarjeta + efectivo).
  tipFundAmount: number;
  participantIds: readonly string[];
}

export interface PlannedTipAllocation {
  workerId: string;
  amount: number;
}

// Asignaciones del día ordenadas por ID de trabajador. Con fondo 0 no hay
// asignaciones (el día figura con total 0); con fondo mayor que 0 se exige al
// menos un participante (el servicio lo valida antes con un 400 claro).
export function planDailyTipAllocations(
  input: DailyTipSplitInput,
): PlannedTipAllocation[] {
  if (input.tipFundAmount === 0) {
    return [];
  }
  return splitDailyFund({
    operationId: input.operationId,
    businessDate: input.businessDate,
    fundAmount: input.tipFundAmount,
    participantIds: input.participantIds,
  }).map((allocation) => ({
    workerId: allocation.userId,
    amount: allocation.amount,
  }));
}
