import type {
  InventoryCountStatus,
  UnitOfMeasure,
} from '../../generated/prisma/client.js';
import type { ProductResponse } from './products.types.js';

// Tipos de la API de tomas de inventario (SPRINT-5-T05).

/**
 * Días hacia atrás que admite la fecha de una toma (hoy incluido, en hora de
 * Chile). La toma es semanal: una del martes en la noche se puede registrar el
 * miércoles, y un error de tipeo (2001-01-01) no deja una toma En curso que
 * bloquee el local.
 */
export const MAX_COUNT_DATE_AGE_DAYS = 7;

/** Persona que inició, guardó o finalizó (solo nombre: nunca RUT ni correo). */
export interface InventoryCountPerson {
  id: string;
  firstName: string;
  lastName: string;
}

export interface InventoryCountSummary {
  id: string;
  // OPEN es «En curso» y CONFIRMED es «Finalizado».
  status: InventoryCountStatus;
  // Fecha de la toma (YYYY-MM-DD), fijada al iniciarla.
  countDate: string;
  // Fecha-hora en que se inició.
  startedAt: Date;
  storeId: string;
  store: { id: string; name: string };
  startedBy: InventoryCountPerson;
  finalizedAt: Date | null;
  finalizedBy: InventoryCountPerson | null;
  // Productos con cantidades guardadas.
  countedProducts: number;
}

/** Línea guardada: lo contado y la copia del producto con que se calculó. */
export interface InventoryCountLineResponse {
  id: string;
  productId: string;
  boxes: number | null;
  packages: number | null;
  // Texto decimal exacto: entero en UNIT ('6') y con 3 decimales en KG y L.
  looseQuantity: string | null;
  // Total; null en una línea sin cantidades (producto no contado).
  countedQuantity: string | null;
  productSku: string | null;
  productName: string;
  unit: UnitOfMeasure;
  packageName: string | null;
  boxContent: string | null;
  packagesPerBox: number | null;
  packageContent: string | null;
  looseOnly: boolean;
  savedAt: Date;
  savedBy: InventoryCountPerson;
}

/** Un producto de la toma, con lo contado o pendiente. */
export interface InventoryCountItem {
  // Producto como está hoy en el catálogo (formato y fila de la plantilla).
  product: ProductResponse;
  // true si la línea tiene cantidades guardadas.
  counted: boolean;
  line: InventoryCountLineResponse | null;
}

export interface InventoryCountDetail extends InventoryCountSummary {
  // Productos de la toma, sin el filtro de búsqueda.
  totalProducts: number;
  pendingProducts: number;
  // Productos en el orden de la plantilla, filtrados por la búsqueda.
  items: InventoryCountItem[];
}
