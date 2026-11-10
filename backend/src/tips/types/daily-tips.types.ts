// Tipos de la propina diaria por trabajador (SPRINT-4A-T02 a T04). La unidad
// es la asignación diaria de un trabajador en una operación diaria; el pago
// se registra como lote por local y período (SPRINT-4A-T06).

/// Estado de pago de la propina diaria (enum TipAllocationStatus de la base).
export const TIP_ALLOCATION_STATUSES = ['UNPAID', 'PAID'] as const;
export type TipAllocationStatusCode = (typeof TIP_ALLOCATION_STATUSES)[number];
