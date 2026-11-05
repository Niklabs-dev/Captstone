// Tipos del ingreso agregado de ventas MrComanda (SPRINT-4-T32). Los totales
// se guardan como ventas con fuente MRCOMANDA y período, no en una segunda
// tabla que pueda duplicar la venta; la propina sigue teniendo su fuente
// propia en tip_entries, por lo que el ingreso agregado siempre usa
// tipAmount = 0 y el neto coincide con el bruto declarado.

// Límite CLP por línea de total: coincide con el tope de los demás montos
// del sistema y cabe en Decimal(12, 2).
export const MAX_MRCOMANDA_NET_AMOUNT = 9_999_999_999;

export interface MrComandaSaleTotalResponse {
  saleId: string;
  /** Código estable del medio de pago (contrato operativo). */
  paymentMethod: string;
  /** Nombre del medio desde el catálogo, para mostrar. */
  paymentMethodName: string;
  /** Total neto vendido por el medio en el período (CLP entero). */
  netAmount: number;
}

export interface MrComandaSalesResponse {
  storeId: string;
  periodStart: Date;
  periodEnd: Date;
  /** true cuando el lote insertó ventas; false en un reintento idéntico. */
  created: boolean;
  /** Suma de los netos del lote (CLP entero). */
  totalNetAmount: number;
  totals: MrComandaSaleTotalResponse[];
}
