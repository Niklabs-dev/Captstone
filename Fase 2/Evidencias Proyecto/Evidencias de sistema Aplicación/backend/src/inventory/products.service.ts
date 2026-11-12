import { Injectable } from '@nestjs/common';
import { ROLE } from '../auth/constants/roles.constants.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  InventoryTemplateRowKind,
  Prisma,
  type UnitOfMeasure,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  MoveProductDto,
  UpdateProductDto,
} from './dto/product-request.dto.js';
import {
  assertSection,
  fieldErrors,
  freeItemRows,
  lockCatalog,
  PRODUCT_SELECT,
  productSnapshot,
  readProduct,
  readTemplateRow,
  toProductResponse,
  type Tx,
} from './inventory-catalog.js';
import type { ProductChange, ProductResponse } from './types/products.types.js';
import {
  alternativeNamesError,
  comparableName,
  normalizeProductName,
  resolveProductFormat,
  suggestTemplateRow,
  type ProductFormat,
  type ProductFormatInput,
} from './utils/product-format.util.js';

// Catálogo de productos de inventario (SPRINT-5-T03). El ADMINISTRADOR crea,
// edita, mueve, desactiva y reactiva productos; el SUPERVISOR consulta los
// activos.
//
// Un producto se ubica asignándolo a una fila de artículo de la plantilla
// (product_id). La plantilla tiene filas fijas: la API nunca inserta, borra
// ni reordena filas, porque el Excel descargado se copia y se pega en otro
// cuadre. Al crear un producto se usa la fila elegida o la sugerida:
// - la fila de artículo sin producto cuyo texto coincide con su nombre o con
//   un nombre alternativo;
// - si no, la primera fila «<Vacío>» libre de la sección;
// - si no queda ninguna, 409: hay que reutilizar la fila de un artículo que
//   ya no se usa (liberarla o elegirla).
// Editar el nombre o el formato cambia solo el producto: su fila se conserva
// y las líneas de tomas guardan su propia copia.

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function skuConflict(): ReturnType<typeof fieldErrors> {
  return fieldErrors(409, 'El SKU ya existe', {
    sku: 'Otro producto ya usa ese SKU',
  });
}

const REQUIRED_ON_UPDATE: Record<string, string> = {
  name: 'El nombre es obligatorio',
  unit: 'La unidad es obligatoria',
  alternativeNames: 'Los nombres alternativos deben ser una lista',
  looseOnly: '«Solo cantidad suelta» debe ser verdadero o falso',
};

function sameSnapshot(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ListProductsQueryDto,
    user: AuthUser,
  ): Promise<ProductResponse[]> {
    const onlyActive = user.role === ROLE.SUPERVISOR ? true : query.isActive;
    const products = await this.prisma.product.findMany({
      where: onlyActive === undefined ? {} : { isActive: onlyActive },
      select: PRODUCT_SELECT,
    });
    const search = query.search ? comparableName(query.search) : null;
    return products
      .map(toProductResponse)
      .filter((product) => !query.section || product.section === query.section)
      .filter(
        (product) =>
          query.missingFormat === undefined ||
          product.hasFormat !== query.missingFormat,
      )
      .filter(
        (product) =>
          query.missingSku === undefined ||
          (product.sku === null) === query.missingSku,
      )
      .filter(
        (product) =>
          search === null ||
          [product.name, ...product.alternativeNames, product.sku ?? ''].some(
            (text) => comparableName(text).includes(search),
          ),
      )
      .sort(
        (left, right) =>
          (left.templatePosition ?? Number.MAX_SAFE_INTEGER) -
            (right.templatePosition ?? Number.MAX_SAFE_INTEGER) ||
          left.name.localeCompare(right.name, 'es'),
      );
  }

  async create(dto: CreateProductDto): Promise<ProductResponse> {
    const format = this.format(dto.unit, {
      packageName: dto.packageName ?? null,
      packagesPerBox: dto.packagesPerBox ?? null,
      packageContent: dto.packageContent ?? null,
      boxContent: dto.boxContent ?? null,
      looseOnly: dto.looseOnly ?? false,
    });
    const name = normalizeProductName(dto.name);
    const alternativeNames = this.alternativeNames(
      name,
      dto.alternativeNames ?? [],
    );
    const sku = dto.sku ?? null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockCatalog(tx);
        await assertSection(tx, dto.section);
        await this.assertNamesAvailable(tx, null, {
          name,
          alternativeNames,
          checkName: true,
        });
        await this.assertSkuAvailable(tx, sku, null);
        const rowId = await this.chooseRow(
          tx,
          dto.section,
          [name, ...alternativeNames],
          dto.templateRowId,
        );
        const created = await tx.product.create({
          data: { name, sku, alternativeNames, unit: dto.unit, ...format },
          select: { id: true },
        });
        await this.claimRow(tx, rowId, created.id);
        return toProductResponse(await readProduct(tx, created.id));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw skuConflict();
      throw error;
    }
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductChange> {
    // PATCH con null en un campo obligatorio: 400, nunca un 500.
    const nullErrors = Object.fromEntries(
      Object.entries(REQUIRED_ON_UPDATE).filter(
        ([field]) => (dto as Record<string, unknown>)[field] === null,
      ),
    );
    if (Object.keys(nullErrors).length > 0) {
      throw fieldErrors(400, 'Faltan datos obligatorios', nullErrors);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockCatalog(tx);
        const existing = await readProduct(tx, id);
        const before = toProductResponse(existing);
        const unit = dto.unit ?? existing.unit;
        const format = this.format(unit, {
          packageName:
            dto.packageName !== undefined
              ? dto.packageName
              : existing.packageName,
          packagesPerBox:
            dto.packagesPerBox !== undefined
              ? dto.packagesPerBox
              : existing.packagesPerBox,
          packageContent:
            dto.packageContent !== undefined
              ? dto.packageContent
              : before.packageContent,
          boxContent:
            dto.boxContent !== undefined ? dto.boxContent : before.boxContent,
          looseOnly: dto.looseOnly ?? existing.looseOnly,
        });
        const name =
          dto.name === undefined
            ? existing.name
            : normalizeProductName(dto.name);
        const renamed = comparableName(name) !== comparableName(existing.name);
        const alternativeNames =
          dto.alternativeNames === undefined
            ? existing.alternativeNames
            : this.alternativeNames(name, dto.alternativeNames);
        if (renamed || dto.alternativeNames !== undefined) {
          await this.assertNamesAvailable(tx, id, {
            name,
            alternativeNames:
              dto.alternativeNames === undefined ? [] : alternativeNames,
            checkName: renamed,
          });
        }
        const sku = dto.sku !== undefined ? dto.sku : existing.sku;
        if (sku !== existing.sku) await this.assertSkuAvailable(tx, sku, id);

        const after = productSnapshot({
          ...before,
          name,
          sku,
          unit,
          alternativeNames,
          ...this.formatResponse(format),
        });
        if (sameSnapshot(after, productSnapshot(before))) {
          return {
            product: before,
            before: productSnapshot(before),
            changed: false,
          };
        }
        await tx.product.update({
          where: { id },
          data: { name, sku, unit, alternativeNames, ...format },
        });
        return {
          product: toProductResponse(await readProduct(tx, id)),
          before: productSnapshot(before),
          changed: true,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw skuConflict();
      throw error;
    }
  }

  // Mueve el producto a otra fila de artículo sin producto (de cualquier
  // sección) y libera la anterior. No cambia la posición de ninguna fila.
  async move(id: string, dto: MoveProductDto): Promise<ProductChange> {
    return this.prisma.$transaction(async (tx) => {
      await lockCatalog(tx);
      const existing = await readProduct(tx, id);
      const before = toProductResponse(existing);
      if (existing.templateRow?.id === dto.templateRowId) {
        return {
          product: before,
          before: productSnapshot(before),
          changed: false,
        };
      }
      await this.assertFreeItemRow(tx, dto.templateRowId, null);
      if (existing.templateRow) {
        await tx.inventoryTemplateRow.update({
          where: { id: existing.templateRow.id },
          data: { productId: null },
        });
      }
      await this.claimRow(tx, dto.templateRowId, id);
      return {
        product: toProductResponse(await readProduct(tx, id)),
        before: productSnapshot(before),
        changed: true,
      };
    });
  }

  // Desactivar no borra: el producto conserva su fila y sus tomas, y deja de
  // aparecer en tomas nuevas. Repetir la acción no cambia nada. Un producto
  // cuya fila se liberó no se reactiva sin fila: primero se mueve a una fila
  // libre, para que todo producto activo quede en la plantilla.
  async setActive(id: string, isActive: boolean): Promise<ProductChange> {
    return this.prisma.$transaction(async (tx) => {
      await lockCatalog(tx);
      const record = await readProduct(tx, id);
      const existing = toProductResponse(record);
      if (existing.isActive === isActive) {
        return {
          product: existing,
          before: productSnapshot(existing),
          changed: false,
        };
      }
      if (isActive && record.templateRow === null) {
        throw fieldErrors(409, 'El producto no tiene fila en la plantilla', {
          templateRowId:
            'Su fila se liberó. Muévelo a una fila de artículo libre antes de reactivarlo.',
        });
      }
      await tx.product.update({ where: { id }, data: { isActive } });
      return {
        product: toProductResponse(await readProduct(tx, id)),
        before: productSnapshot(existing),
        changed: true,
      };
    });
  }

  private format(
    unit: UnitOfMeasure,
    input: Omit<ProductFormatInput, 'unit'>,
  ): ProductFormat {
    const result = resolveProductFormat({ unit, ...input });
    if (!result.ok) {
      throw fieldErrors(
        400,
        'El formato del producto no es válido',
        result.errors,
      );
    }
    return result.format;
  }

  private formatResponse(
    format: ProductFormat,
  ): Pick<
    ProductResponse,
    | 'packageName'
    | 'packagesPerBox'
    | 'packageContent'
    | 'boxContent'
    | 'looseOnly'
  > {
    return {
      packageName: format.packageName,
      packagesPerBox: format.packagesPerBox,
      packageContent: format.packageContent?.toFixed(3) ?? null,
      boxContent: format.boxContent?.toFixed(3) ?? null,
      looseOnly: format.looseOnly,
    };
  }

  private alternativeNames(name: string, values: readonly string[]): string[] {
    const error = alternativeNamesError(name, values);
    if (error !== null) {
      throw fieldErrors(400, 'Los nombres alternativos no son válidos', {
        alternativeNames: error,
      });
    }
    return values.map(normalizeProductName);
  }

  // Nombres únicos en todo el catálogo, sin distinguir mayúsculas ni tildes:
  // el nombre y cada nombre alternativo no pueden ser el nombre ni un
  // alternativo de otro producto. El nombre solo se valida al crear o al
  // renombrar: los repetidos que ya existían se pueden editar sin renombrar.
  private async assertNamesAvailable(
    tx: Tx,
    excludeId: string | null,
    input: { name: string; alternativeNames: string[]; checkName: boolean },
  ): Promise<void> {
    // El catálogo es acotado (unos cientos): se compara en memoria.
    const others = await tx.product.findMany({
      where: excludeId ? { id: { not: excludeId } } : {},
      select: { name: true, alternativeNames: true },
    });
    const owner = new Map<string, string>();
    for (const other of others) {
      for (const text of [other.name, ...other.alternativeNames]) {
        owner.set(comparableName(text), other.name);
      }
    }
    const errors: Record<string, string> = {};
    const nameOwner = owner.get(comparableName(input.name));
    if (input.checkName && nameOwner !== undefined) {
      errors.name =
        comparableName(nameOwner) === comparableName(input.name)
          ? `Ya existe un producto llamado «${input.name}»`
          : `«${input.name}» ya es un nombre alternativo de «${nameOwner}»`;
    }
    const taken = input.alternativeNames.find((text) =>
      owner.has(comparableName(text)),
    );
    if (taken !== undefined) {
      errors.alternativeNames = `«${taken}» ya es un nombre de «${owner.get(comparableName(taken)) ?? ''}»`;
    }
    if (Object.keys(errors).length > 0) {
      throw fieldErrors(409, 'El nombre ya existe en el catálogo', errors);
    }
  }

  private async assertSkuAvailable(
    tx: Tx,
    sku: string | null,
    excludeId: string | null,
  ): Promise<void> {
    if (sku === null) return;
    const other = await tx.product.findFirst({
      where: {
        sku: { equals: sku, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (other) {
      throw fieldErrors(409, 'El SKU ya existe', {
        sku: `Otro producto ya usa el SKU «${sku}»`,
      });
    }
  }

  // Fila elegida (validada) o la sugerida; 409 si no queda ninguna.
  private async chooseRow(
    tx: Tx,
    section: string,
    names: string[],
    templateRowId: string | undefined,
  ): Promise<string> {
    if (templateRowId !== undefined) {
      await this.assertFreeItemRow(tx, templateRowId, section);
      return templateRowId;
    }
    const suggestion = suggestTemplateRow(
      await freeItemRows(tx, section),
      names,
    );
    if (suggestion === null) {
      throw fieldErrors(409, 'No quedan filas libres en la sección', {
        templateRowId: `No quedan filas libres en «${section}». Reutiliza la fila de un artículo que ya no se usa: libera la de un producto desactivado o elige una fila de artículo pendiente.`,
      });
    }
    return suggestion.row.id;
  }

  private async assertFreeItemRow(
    tx: Tx,
    rowId: string,
    section: string | null,
  ): Promise<void> {
    const row = await tx.inventoryTemplateRow.findUnique({
      where: { id: rowId },
      select: { kind: true, productId: true, section: true },
    });
    const invalid =
      row === null
        ? 'La fila elegida no existe en la plantilla'
        : row.kind !== InventoryTemplateRowKind.ITEM
          ? 'Solo se puede usar una fila de artículo'
          : section !== null && row.section !== section
            ? `La fila elegida no es de la sección «${section}»`
            : null;
    if (invalid !== null) {
      throw fieldErrors(400, 'La fila de la plantilla no es válida', {
        templateRowId: invalid,
      });
    }
    if (row !== null && row.productId !== null) {
      throw fieldErrors(409, 'La fila ya tiene un producto', {
        templateRowId: 'La fila elegida ya tiene un producto',
      });
    }
  }

  private async claimRow(
    tx: Tx,
    rowId: string,
    productId: string,
  ): Promise<void> {
    // Solo la ocupa si sigue libre (el bloqueo del catálogo ya lo asegura).
    const claimed = await tx.inventoryTemplateRow.updateMany({
      where: { id: rowId, productId: null },
      data: { productId },
    });
    if (claimed.count !== 1) {
      const row = await readTemplateRow(tx, rowId);
      throw fieldErrors(409, 'La fila ya tiene un producto', {
        templateRowId: `La fila ${row.position} ya tiene un producto`,
      });
    }
  }
}
