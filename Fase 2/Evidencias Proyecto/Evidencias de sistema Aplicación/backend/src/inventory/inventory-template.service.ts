import { Injectable } from '@nestjs/common';
import { ROLE } from '../auth/constants/roles.constants.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { InventoryTemplateRowKind } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  PlacementQueryDto,
  UpdateTemplateRowDto,
} from './dto/product-request.dto.js';
import {
  assertSection,
  fieldErrors,
  freeItemRows,
  lockCatalog,
  readTemplateRow,
  rowSnapshot,
  TEMPLATE_ROW_SELECT,
  toProductResponse,
  toRowSummary,
  type TemplateRowRecord,
} from './inventory-catalog.js';
import type {
  PlacementSuggestion,
  ProductSectionResponse,
  TemplateRowChange,
  TemplateRowResponse,
} from './types/products.types.js';
import { suggestTemplateRow } from './utils/product-format.util.js';

// Estructura de la plantilla de inventario (SPRINT-5-T03): filas en el orden
// de la hoja con su producto, secciones, sugerencia de fila y los cambios que
// el ADMINISTRADOR hace sobre las filas. Ningún cambio modifica la posición
// ni el tipo de una fila (además lo impide un trigger de SPRINT-5-T01).

function toRowResponse(
  row: TemplateRowRecord,
  onlyActive: boolean,
): TemplateRowResponse {
  const product =
    row.product && (!onlyActive || row.product.isActive)
      ? toProductResponse(row.product)
      : null;
  return { ...toRowSummary(row), product };
}

@Injectable()
export class InventoryTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  // Filas en orden; al SUPERVISOR solo se le informan productos activos.
  async rows(user: AuthUser): Promise<TemplateRowResponse[]> {
    const rows = await this.prisma.inventoryTemplateRow.findMany({
      select: TEMPLATE_ROW_SELECT,
      orderBy: { position: 'asc' },
    });
    const onlyActive = user.role === ROLE.SUPERVISOR;
    return rows.map((row) => toRowResponse(row, onlyActive));
  }

  // Secciones en su orden, con las filas de artículo sin producto.
  async sections(): Promise<ProductSectionResponse[]> {
    const [sections, free] = await Promise.all([
      this.prisma.inventoryTemplateRow.findMany({
        where: { kind: InventoryTemplateRowKind.SECTION },
        select: { section: true, position: true },
        orderBy: { position: 'asc' },
      }),
      this.prisma.inventoryTemplateRow.groupBy({
        by: ['section'],
        where: { kind: InventoryTemplateRowKind.ITEM, productId: null },
        _count: { _all: true },
      }),
    ]);
    const freeBySection = new Map(
      free.map((item) => [item.section, item._count._all]),
    );
    return sections.map((section) => ({
      name: section.section,
      position: section.position,
      freeRows: freeBySection.get(section.section) ?? 0,
    }));
  }

  // Fila que usaría POST /products sin templateRowId.
  async suggestion(query: PlacementQueryDto): Promise<PlacementSuggestion> {
    return this.prisma.$transaction(async (tx) => {
      await assertSection(tx, query.section);
      const suggestion = suggestTemplateRow(
        await freeItemRows(tx, query.section),
        [query.name, ...(query.alternativeNames ?? [])],
      );
      return suggestion ?? { row: null, reason: null };
    });
  }

  // Corrige el texto de una fila de artículo sin producto (la plantilla trae
  // artículos desactualizados). La posición no cambia.
  async updateText(
    id: string,
    dto: UpdateTemplateRowDto,
  ): Promise<TemplateRowChange> {
    return this.prisma.$transaction(async (tx) => {
      await lockCatalog(tx);
      const row = await readTemplateRow(tx, id);
      if (row.kind !== InventoryTemplateRowKind.ITEM) {
        throw fieldErrors(409, 'Solo se edita el texto de filas de artículo', {
          printedText: 'Las filas de sección y sin texto no se editan',
        });
      }
      if (row.productId !== null) {
        throw fieldErrors(409, 'La fila tiene un producto', {
          printedText:
            'La fila tiene un producto: se muestra su nombre. Edita el producto o libera la fila.',
        });
      }
      const before = rowSnapshot(row);
      if (row.printedText === dto.printedText) {
        return { row: toRowResponse(row, false), before, changed: false };
      }
      const updated = await tx.inventoryTemplateRow.update({
        where: { id },
        data: { printedText: dto.printedText },
        select: TEMPLATE_ROW_SELECT,
      });
      return { row: toRowResponse(updated, false), before, changed: true };
    });
  }

  // Libera la fila de un producto desactivado para asignarla a otro. El
  // producto queda en el catálogo sin fila; sus tomas finalizadas no cambian.
  async release(id: string): Promise<TemplateRowChange> {
    return this.prisma.$transaction(async (tx) => {
      await lockCatalog(tx);
      const row = await readTemplateRow(tx, id);
      const before = rowSnapshot(row);
      if (row.product === null) {
        return { row: toRowResponse(row, false), before, changed: false };
      }
      if (row.product.isActive) {
        throw fieldErrors(409, 'El producto de la fila está activo', {
          templateRowId: `Desactiva «${row.product.name}» antes de liberar su fila`,
        });
      }
      const updated = await tx.inventoryTemplateRow.update({
        where: { id },
        data: { productId: null },
        select: TEMPLATE_ROW_SELECT,
      });
      return { row: toRowResponse(updated, false), before, changed: true };
    });
  }
}
