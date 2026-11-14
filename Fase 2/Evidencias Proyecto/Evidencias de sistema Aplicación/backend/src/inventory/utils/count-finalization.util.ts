import type {
  InventoryTemplateRowKind,
  Prisma,
  UnitOfMeasure,
} from '../../generated/prisma/client.js';
import type { InventoryTemplateSnapshotRow } from '../types/inventory-counts.types.js';

// Finalización de la toma de inventario (SPRINT-5-T06). Funciones puras, sin
// NestJS ni base de datos, para probar directamente qué se copia al
// finalizar:
// - la estructura de la plantilla (template_snapshot), en el orden de la hoja;
// - una línea sin cantidades por cada producto activo que no se contó, con la
//   copia de su SKU, nombre, unidad y formato.
// Con esas copias el Excel de la toma finalizada no cambia aunque después se
// edite el catálogo o la plantilla.

/** Fila de la plantilla tal como se lee de la base. */
export interface TemplateRowSource {
  position: number;
  kind: InventoryTemplateRowKind;
  printedText: string | null;
  section: string;
  productId: string | null;
  product: { name: string } | null;
}

/** Producto activo con el formato que copia su línea vacía. */
export interface EmptyLineProduct {
  id: string;
  sku: string | null;
  name: string;
  unit: UnitOfMeasure;
  packageName: string | null;
  boxContent: Prisma.Decimal | null;
  packagesPerBox: number | null;
  packageContent: Prisma.Decimal | null;
  looseOnly: boolean;
}

/**
 * Línea vacía (producto no contado): sin cajas, paquetes, cantidad suelta ni
 * total; solo la copia del producto. La toma y el usuario los agrega el
 * servicio.
 */
export interface EmptyLineData {
  productId: string;
  productSku: string | null;
  productName: string;
  unit: UnitOfMeasure;
  packageName: string | null;
  boxContent: Prisma.Decimal | null;
  packagesPerBox: number | null;
  packageContent: Prisma.Decimal | null;
  looseOnly: boolean;
}

/** Productos de la toma finalizada: contados y sin contar. */
export interface FinalizationTotals {
  totalProducts: number;
  countedProducts: number;
  uncountedProducts: number;
}

/** Copia de la estructura de la plantilla, ordenada por posición. */
export function toTemplateSnapshot(
  rows: readonly TemplateRowSource[],
): InventoryTemplateSnapshotRow[] {
  return [...rows]
    .sort((left, right) => left.position - right.position)
    .map((row) => ({
      position: row.position,
      kind: row.kind,
      printedText: row.printedText,
      section: row.section,
      productId: row.productId,
      productName: row.product?.name ?? null,
    }));
}

/**
 * Líneas vacías de los productos activos que no tienen línea en la toma, en
 * un orden estable (por nombre e id). Los productos con línea (contada o no)
 * no se repiten: la toma tiene una línea por producto.
 */
export function emptyLinesFor(
  activeProducts: readonly EmptyLineProduct[],
  productsWithLine: ReadonlySet<string>,
): EmptyLineData[] {
  return activeProducts
    .filter((product) => !productsWithLine.has(product.id))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'es') ||
        left.id.localeCompare(right.id),
    )
    .map((product) => ({
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      unit: product.unit,
      packageName: product.packageName,
      boxContent: product.boxContent,
      packagesPerBox: product.packagesPerBox,
      packageContent: product.packageContent,
      looseOnly: product.looseOnly,
    }));
}

/**
 * Totales que informa la finalización: las líneas que ya tenía la toma más
 * las vacías que se agregan; contadas son las que tienen total.
 */
export function finalizationTotals(
  existingLines: ReadonlyArray<{ countedQuantity: Prisma.Decimal | null }>,
  addedEmptyLines: number,
): FinalizationTotals {
  const countedProducts = existingLines.filter(
    (line) => line.countedQuantity !== null,
  ).length;
  const totalProducts = existingLines.length + addedEmptyLines;
  return {
    totalProducts,
    countedProducts,
    uncountedProducts: totalProducts - countedProducts,
  };
}
