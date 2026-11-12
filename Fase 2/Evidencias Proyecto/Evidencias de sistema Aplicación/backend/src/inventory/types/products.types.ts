import type {
  InventoryTemplateRowKind,
  UnitOfMeasure,
} from '../../generated/prisma/client.js';

// Tipos de la API de productos de inventario (SPRINT-5-T03).

/** Texto de las filas de artículo libres de la plantilla. */
export const EMPTY_ITEM_TEXT = '<Vacío>';

/** Nombres de paquete que acepta el catálogo. */
export const PACKAGE_NAMES = ['bolsa', 'paquete', 'botella', 'pack'] as const;
export type PackageName = (typeof PACKAGE_NAMES)[number];

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
  // Fila de la plantilla; null si el producto no tiene fila.
  templateRowId: string | null;
  section: string | null;
  templatePosition: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// Valor auditado de un producto: anterior y nuevo en cada cambio.
export interface ProductAuditSnapshot {
  sku: string | null;
  name: string;
  alternativeNames: string[];
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
  // false si la solicitud no cambió nada (no se audita).
  changed: boolean;
}

/** Fila de la plantilla, sin su producto. */
export interface TemplateRowSummary {
  id: string;
  position: number;
  kind: InventoryTemplateRowKind;
  printedText: string | null;
  section: string;
  // true en las filas de artículo con el texto «<Vacío>».
  isEmptyRow: boolean;
}

/** Fila de la plantilla con su producto, en el orden de la hoja. */
export interface TemplateRowResponse extends TemplateRowSummary {
  product: ProductResponse | null;
}

export interface ProductSectionResponse {
  name: string;
  /** Fila de cierre de la sección. */
  position: number;
  /** Filas de artículo sin producto (artículos pendientes y «<Vacío>»). */
  freeRows: number;
}

export type PlacementReason = 'MATCH' | 'EMPTY';

export interface PlacementSuggestion {
  row: TemplateRowSummary | null;
  // MATCH: coincide con el nombre o un nombre alternativo; EMPTY: fila
  // «<Vacío>» libre; null: no queda fila libre en la sección.
  reason: PlacementReason | null;
}

// Valor auditado de una fila de la plantilla.
export interface TemplateRowAuditSnapshot {
  position: number;
  printedText: string | null;
  section: string;
  productId: string | null;
  productName: string | null;
}

export interface TemplateRowChange {
  row: TemplateRowResponse;
  before: TemplateRowAuditSnapshot;
  changed: boolean;
}
