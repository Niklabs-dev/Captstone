import type { UnitOfMeasure } from '../../generated/prisma/client.js';

// Tipos de la API de productos de inventario (SPRINT-5-T03).

/** Primera posición de las filas que la API agrega fuera de la plantilla. */
export const EXTRA_TEMPLATE_ROW_START = 1000;

export interface ProductResponse {
  id: string;
  sku: string | null;
  name: string;
  alternativeNames: string[];
  unit: UnitOfMeasure;
  packageName: string | null;
  packagesPerBox: number | null;
  // Contenidos como texto decimal con 3 decimales ('2.500'), sin float.
  packageContent: string | null;
  boxContent: string | null;
  looseOnly: boolean;
  hasFormat: boolean;
  isActive: boolean;
  // Sección y posición en la plantilla; null si el producto no tiene fila.
  section: string | null;
  templatePosition: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// Valor auditado de un producto: anterior y nuevo en cada cambio.
export interface ProductAuditSnapshot {
  sku: string | null;
  name: string;
  unit: UnitOfMeasure;
  packageName: string | null;
  packagesPerBox: number | null;
  packageContent: string | null;
  boxContent: string | null;
  looseOnly: boolean;
  isActive: boolean;
  section: string | null;
  templatePosition: number | null;
}

export interface ProductChange {
  product: ProductResponse;
  before: ProductAuditSnapshot | null;
  // false si el cambio de estado no hizo nada (ya estaba así).
  changed: boolean;
}
