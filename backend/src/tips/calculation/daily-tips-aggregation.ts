import type {
  DailyTipAllocationFact,
  DailyTipAmounts,
  DailyTipSettlementStatus,
  DailyTipWorkerSummary,
  TipAllocationStatusCode,
} from '../types/daily-tips.types.js';

// Agregación de las propinas diarias por trabajador (SPRINT-4A-T04).
// Funciones puras, sin NestJS ni base de datos: las reutilizan la consulta
// por día y período, la exportación Excel (SPRINT-4A-T05), el pago por
// período (SPRINT-4A-T06) y el portal del trabajador (SPRINT-4A-T09). Los
// totales se suman con bigint para no depender del punto flotante y siempre
// cuadran: totalAmount = paidAmount + unpaidAmount.

interface AmountWithStatus {
  amount: number;
  status: TipAllocationStatusCode;
}

// Comparación por unidades de código, independiente del idioma del sistema.
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function toSafeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`Monto fuera del rango seguro: ${value}`);
  }
  return result;
}

// Total, pagado y pendiente de un conjunto de propinas.
export function sumTipAmounts(
  allocations: readonly AmountWithStatus[],
): DailyTipAmounts {
  let paid = 0n;
  let unpaid = 0n;
  for (const allocation of allocations) {
    if (allocation.status === 'PAID') {
      paid += BigInt(allocation.amount);
    } else {
      unpaid += BigInt(allocation.amount);
    }
  }
  return {
    totalAmount: toSafeNumber(paid + unpaid),
    paidAmount: toSafeNumber(paid),
    unpaidAmount: toSafeNumber(unpaid),
  };
}

// Estado de pago del conjunto: PAID si todas están pagadas, PARTIAL si solo
// algunas, UNPAID si ninguna (o si no hay propinas: el día figura con 0).
export function settlementStatus(
  allocations: readonly { status: TipAllocationStatusCode }[],
): DailyTipSettlementStatus {
  const paid = allocations.filter((tip) => tip.status === 'PAID').length;
  if (paid === 0) return 'UNPAID';
  return paid === allocations.length ? 'PAID' : 'PARTIAL';
}

// Totales por trabajador del período: días con propina (operaciones
// distintas), total, pagado y pendiente. Ordenados por nombre y luego por ID
// (orden estable para la vista y el Excel).
export function summarizeByWorker(
  allocations: readonly DailyTipAllocationFact[],
): DailyTipWorkerSummary[] {
  const byWorker = new Map<
    string,
    { fact: DailyTipAllocationFact; items: DailyTipAllocationFact[] }
  >();
  for (const allocation of allocations) {
    const entry = byWorker.get(allocation.worker.id);
    if (entry) {
      entry.items.push(allocation);
    } else {
      byWorker.set(allocation.worker.id, {
        fact: allocation,
        items: [allocation],
      });
    }
  }
  return [...byWorker.values()]
    .map(({ fact, items }) => ({
      worker: { id: fact.worker.id, name: fact.worker.name },
      dayCount: new Set(items.map((item) => item.operationId)).size,
      ...sumTipAmounts(items),
    }))
    .sort(
      (a, b) =>
        compareText(a.worker.name, b.worker.name) ||
        compareText(a.worker.id, b.worker.id),
    );
}
