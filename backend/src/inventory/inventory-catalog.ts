import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryTemplateRowKind,
  Prisma,
} from '../generated/prisma/client.js';
import {
  EMPTY_ITEM_TEXT,
  type ProductAuditSnapshot,
  type ProductResponse,
  type TemplateRowAuditSnapshot,
  type TemplateRowSummary,
} from './types/products.types.js';
import { hasProductFormat } from './utils/product-format.util.js';

// Piezas compartidas del catálogo de inventario (SPRINT-5-T03): consultas,
// conversión a respuestas, bloqueo y errores por campo.

export type Tx = Prisma.TransactionClient;

// Serializa los cambios del catálogo: dos solicitudes simultáneas no toman la
// misma fila ni repiten un nombre o un SKU.
const CATALOG_LOCK_KEY = 5_030_301;

export async function lockCatalog(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CATALOG_LOCK_KEY})`;
}

const ROW_SELECT = {
  id: true,
  position: true,
  kind: true,
  printedText: true,
  section: true,
} satisfies Prisma.InventoryTemplateRowSelect;

export const PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  alternativeNames: true,
  unit: true,
  packageName: true,
  packagesPerBox: true,
  packageContent: true,
  boxContent: true,
  looseOnly: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  templateRow: { select: ROW_SELECT },
} satisfies Prisma.ProductSelect;

export type ProductRecord = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_SELECT;
}>;

export const TEMPLATE_ROW_SELECT = {
  ...ROW_SELECT,
  productId: true,
  product: { select: PRODUCT_SELECT },
} satisfies Prisma.InventoryTemplateRowSelect;

export type TemplateRowRecord = Prisma.InventoryTemplateRowGetPayload<{
  select: typeof TEMPLATE_ROW_SELECT;
}>;

function decimalText(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(3);
}

export function toRowSummary(row: {
  id: string;
  position: number;
  kind: InventoryTemplateRowKind;
  printedText: string | null;
  section: string;
}): TemplateRowSummary {
  return {
    id: row.id,
    position: row.position,
    kind: row.kind,
    printedText: row.printedText,
    section: row.section,
    isEmptyRow:
      row.kind === InventoryTemplateRowKind.ITEM &&
      row.printedText === EMPTY_ITEM_TEXT,
  };
}

export function toProductResponse(product: ProductRecord): ProductResponse {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    alternativeNames: product.alternativeNames,
    unit: product.unit,
    packageName: product.packageName,
    packagesPerBox: product.packagesPerBox,
    packageContent: decimalText(product.packageContent),
    boxContent: decimalText(product.boxContent),
    looseOnly: product.looseOnly,
    hasFormat: hasProductFormat(product),
    isActive: product.isActive,
    templateRowId: product.templateRow?.id ?? null,
    section: product.templateRow?.section ?? null,
    templatePosition: product.templateRow?.position ?? null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export function productSnapshot(
  product: ProductResponse,
): ProductAuditSnapshot {
  return {
    sku: product.sku,
    name: product.name,
    alternativeNames: product.alternativeNames,
    unit: product.unit,
    packageName: product.packageName,
    packagesPerBox: product.packagesPerBox,
    packageContent: product.packageContent,
    boxContent: product.boxContent,
    looseOnly: product.looseOnly,
    isActive: product.isActive,
    section: product.section,
    templatePosition: product.templatePosition,
  };
}

export function rowSnapshot(row: TemplateRowRecord): TemplateRowAuditSnapshot {
  return {
    position: row.position,
    printedText: row.printedText,
    section: row.section,
    productId: row.productId,
    productName: row.product?.name ?? null,
  };
}

export function fieldErrors(
  status: 400 | 409,
  message: string,
  errors: Record<string, string>,
): BadRequestException | ConflictException {
  const body = { statusCode: status, message, errors };
  return status === 400
    ? new BadRequestException(body)
    : new ConflictException(body);
}

export async function readProduct(tx: Tx, id: string): Promise<ProductRecord> {
  const product = await tx.product.findUnique({
    where: { id },
    select: PRODUCT_SELECT,
  });
  if (!product) throw new NotFoundException('Producto no encontrado');
  return product;
}

export async function readTemplateRow(
  tx: Tx,
  id: string,
): Promise<TemplateRowRecord> {
  const row = await tx.inventoryTemplateRow.findUnique({
    where: { id },
    select: TEMPLATE_ROW_SELECT,
  });
  if (!row) throw new NotFoundException('Fila de la plantilla no encontrada');
  return row;
}

export async function assertSection(tx: Tx, section: string): Promise<void> {
  const exists = await tx.inventoryTemplateRow.findFirst({
    where: { kind: InventoryTemplateRowKind.SECTION, section },
    select: { id: true },
  });
  if (!exists) {
    throw fieldErrors(400, 'La sección no existe en la plantilla', {
      section: `«${section}» no es una sección de la plantilla`,
    });
  }
}

// Filas de artículo sin producto, en el orden de la hoja.
export async function freeItemRows(
  tx: Tx,
  section: string,
): Promise<TemplateRowSummary[]> {
  const rows = await tx.inventoryTemplateRow.findMany({
    where: { kind: InventoryTemplateRowKind.ITEM, productId: null, section },
    select: ROW_SELECT,
    orderBy: { position: 'asc' },
  });
  return rows.map(toRowSummary);
}
