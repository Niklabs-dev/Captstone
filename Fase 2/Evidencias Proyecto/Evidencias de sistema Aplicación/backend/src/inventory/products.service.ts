import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  UpdateProductDto,
} from './dto/product-request.dto.js';
import {
  EXTRA_TEMPLATE_ROW_START,
  type ProductAuditSnapshot,
  type ProductChange,
  type ProductResponse,
} from './types/products.types.js';
import {
  hasProductFormat,
  normalizeProductName,
  resolveProductFormat,
} from './utils/product-format.util.js';

// Catálogo de productos de inventario (SPRINT-5-T03). El ADMINISTRADOR crea,
// edita, desactiva y reactiva productos; el SUPERVISOR consulta los activos.
//
// Contrato con la carga de la plantilla (SPRINT-5-T02): printed_text de cada
// fila es el texto de la última plantilla cargada y esta API nunca lo
// modifica. Un producto se ubica asignándolo a una fila (product_id):
// - al crearlo, ocupa la primera fila «<Vacío>» libre de su sección;
// - si no queda ninguna, se agrega una fila nueva desde la posición 1000, con
//   el mismo texto «<Vacío>» y su sección; la carga de la plantilla no toca
//   esas posiciones y el Excel la ubica antes del cierre de su sección.
// Editar el nombre o el formato cambia solo el producto: su fila (posición)
// se conserva y las líneas de tomas guardan su propia copia.

const EMPTY_ITEM_TEXT = '<Vacío>';
// Serializa las altas y movimientos: dos solicitudes simultáneas no toman la
// misma fila, no calculan la misma posición nueva ni repiten un nombre.
const CATALOG_LOCK_KEY = 5_030_301;

const PRODUCT_SELECT = {
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
  templateRow: {
    select: { id: true, position: true, section: true, printedText: true },
  },
} satisfies Prisma.ProductSelect;

type ProductRecord = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_SELECT;
}>;

type Tx = Prisma.TransactionClient;

function decimalText(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(3);
}

function toResponse(product: ProductRecord): ProductResponse {
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

// Comparación sin tildes ni mayúsculas, para buscar y para nombres repetidos.
function comparable(text: string): string {
  return normalizeProductName(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es');
}

function fieldErrors(
  status: 400 | 409,
  message: string,
  errors: Record<string, string>,
): BadRequestException | ConflictException {
  const body = { statusCode: status, message, errors };
  return status === 400
    ? new BadRequestException(body)
    : new ConflictException(body);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

// Una fila con el nombre impreso de un artículo pertenece a su sección: si
// su producto se moviera, la próxima carga de la plantilla volvería a crear el
// artículo en esa fila. Las filas «<Vacío>» y las que agrega la API (siempre
// con texto «<Vacío>») sí se pueden liberar.
function isPrintedArticleRow(row: ProductRecord['templateRow']): boolean {
  return row !== null && row.printedText !== EMPTY_ITEM_TEXT;
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
    const search = query.search ? comparable(query.search) : null;
    return products
      .map(toResponse)
      .filter((product) => !query.section || product.section === query.section)
      .filter(
        (product) =>
          query.missingFormat === undefined ||
          product.hasFormat !== query.missingFormat,
      )
      .filter(
        (product) =>
          search === null ||
          [product.name, ...product.alternativeNames].some((name) =>
            comparable(name).includes(search),
          ),
      )
      .sort(
        (left, right) =>
          (left.templatePosition ?? Number.MAX_SAFE_INTEGER) -
            (right.templatePosition ?? Number.MAX_SAFE_INTEGER) ||
          left.name.localeCompare(right.name, 'es'),
      );
  }

  async findOne(id: string): Promise<ProductResponse> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: PRODUCT_SELECT,
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return toResponse(product);
  }

  // Secciones de la plantilla en su orden, con las filas «<Vacío>» libres.
  async sections(): Promise<
    { name: string; position: number; freeRows: number }[]
  > {
    const [sections, free] = await Promise.all([
      this.prisma.inventoryTemplateRow.findMany({
        where: { kind: InventoryTemplateRowKind.SECTION },
        select: { section: true, position: true },
        orderBy: { position: 'asc' },
      }),
      this.prisma.inventoryTemplateRow.groupBy({
        by: ['section'],
        where: {
          kind: InventoryTemplateRowKind.ITEM,
          printedText: EMPTY_ITEM_TEXT,
          productId: null,
        },
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

  async create(dto: CreateProductDto): Promise<ProductResponse> {
    const format = this.format(dto.unit, {
      packageName: dto.packageName ?? null,
      packagesPerBox: dto.packagesPerBox ?? null,
      packageContent: dto.packageContent ?? null,
      boxContent: dto.boxContent ?? null,
      looseOnly: dto.looseOnly ?? false,
    });
    const name = normalizeProductName(dto.name);
    const sku = dto.sku ?? null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockCatalog(tx);
        await this.assertSection(tx, dto.section);
        await this.assertNameAvailable(tx, name, null);
        await this.assertSkuAvailable(tx, sku, null);
        const created = await tx.product.create({
          data: {
            name,
            sku,
            alternativeNames: dto.alternativeNames ?? [],
            unit: dto.unit,
            ...format,
          },
          select: { id: true },
        });
        await this.place(tx, created.id, dto.section);
        return toResponse(await this.read(tx, created.id));
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw fieldErrors(409, 'El SKU ya existe', {
          sku: 'Otro producto ya usa ese SKU',
        });
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductChange> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockCatalog(tx);
        const existing = await this.read(tx, id);
        const before = toResponse(existing);
        const unit = dto.unit ?? existing.unit;
        // Si cambian los paquetes, el contenido por caja se vuelve a calcular.
        const recompute =
          dto.packagesPerBox !== undefined || dto.packageContent !== undefined;
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
            dto.boxContent !== undefined
              ? dto.boxContent
              : recompute
                ? null
                : before.boxContent,
          looseOnly: dto.looseOnly ?? existing.looseOnly,
        });

        const name =
          dto.name === undefined
            ? existing.name
            : normalizeProductName(dto.name);
        if (comparable(name) !== comparable(existing.name)) {
          await this.assertNameAvailable(tx, name, id);
        }
        if (dto.sku !== undefined && dto.sku !== existing.sku) {
          await this.assertSkuAvailable(tx, dto.sku, id);
        }

        const currentSection = existing.templateRow?.section ?? null;
        if (dto.section !== undefined && dto.section !== currentSection) {
          await this.assertSection(tx, dto.section);
          if (isPrintedArticleRow(existing.templateRow)) {
            throw fieldErrors(
              409,
              'El producto pertenece a su sección de la plantilla',
              {
                section: `«${existing.templateRow?.printedText ?? existing.name}» es un artículo de la plantilla en la sección ${currentSection ?? ''}; no se puede mover`,
              },
            );
          }
          if (existing.templateRow) {
            await tx.inventoryTemplateRow.update({
              where: { id: existing.templateRow.id },
              data: { productId: null },
            });
          }
          await this.place(tx, id, dto.section);
        }

        await tx.product.update({
          where: { id },
          data: {
            name,
            unit,
            ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
            ...(dto.alternativeNames !== undefined
              ? { alternativeNames: dto.alternativeNames }
              : {}),
            ...format,
          },
        });
        return {
          product: toResponse(await this.read(tx, id)),
          before: productSnapshot(before),
          changed: true,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw fieldErrors(409, 'El SKU ya existe', {
          sku: 'Otro producto ya usa ese SKU',
        });
      }
      throw error;
    }
  }

  // Desactivar no borra: el producto conserva su fila y sus tomas, y deja de
  // aparecer en tomas nuevas. Repetir la acción no cambia nada.
  async setActive(id: string, isActive: boolean): Promise<ProductChange> {
    return this.prisma.$transaction(async (tx) => {
      const existing = toResponse(await this.read(tx, id));
      if (existing.isActive === isActive) {
        return {
          product: existing,
          before: productSnapshot(existing),
          changed: false,
        };
      }
      await tx.product.update({ where: { id }, data: { isActive } });
      return {
        product: toResponse(await this.read(tx, id)),
        before: productSnapshot(existing),
        changed: true,
      };
    });
  }

  private async lockCatalog(tx: Tx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CATALOG_LOCK_KEY})`;
  }

  private async read(tx: Tx, id: string): Promise<ProductRecord> {
    const product = await tx.product.findUnique({
      where: { id },
      select: PRODUCT_SELECT,
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  private format(
    unit: UnitOfMeasure,
    input: {
      packageName: string | null;
      packagesPerBox: number | null;
      packageContent: string | null;
      boxContent: string | null;
      looseOnly: boolean;
    },
  ) {
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

  private async assertSection(tx: Tx, section: string): Promise<void> {
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

  // Nombre no repetido sin distinguir mayúsculas ni tildes. Solo se valida
  // al crear o al cambiar el nombre: los repetidos que trae la plantilla
  // («Lata Fanta Zero» en las filas 99 y 102) se pueden editar sin renombrar.
  private async assertNameAvailable(
    tx: Tx,
    name: string,
    excludeId: string | null,
  ): Promise<void> {
    // El catálogo es acotado (unos cientos): se compara sin tildes en memoria.
    const others = await tx.product.findMany({
      where: excludeId ? { id: { not: excludeId } } : {},
      select: { name: true },
    });
    const target = comparable(name);
    if (others.some((other) => comparable(other.name) === target)) {
      throw fieldErrors(409, 'Ya existe un producto con ese nombre', {
        name: `Ya existe un producto llamado «${name}»`,
      });
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

  // Ubica el producto: primera fila «<Vacío>» libre de la sección o, si no
  // queda ninguna, una fila nueva desde la posición 1000.
  private async place(
    tx: Tx,
    productId: string,
    section: string,
  ): Promise<void> {
    const free = await tx.inventoryTemplateRow.findMany({
      where: {
        kind: InventoryTemplateRowKind.ITEM,
        printedText: EMPTY_ITEM_TEXT,
        productId: null,
        section,
      },
      select: { id: true },
      orderBy: { position: 'asc' },
    });
    for (const row of free) {
      // Solo la ocupa si sigue libre (otra solicitud pudo tomarla).
      const claimed = await tx.inventoryTemplateRow.updateMany({
        where: { id: row.id, productId: null },
        data: { productId },
      });
      if (claimed.count === 1) return;
    }
    const last = await tx.inventoryTemplateRow.aggregate({
      _max: { position: true },
    });
    await tx.inventoryTemplateRow.create({
      data: {
        position: Math.max(
          EXTRA_TEMPLATE_ROW_START,
          (last._max.position ?? 0) + 1,
        ),
        kind: InventoryTemplateRowKind.ITEM,
        printedText: EMPTY_ITEM_TEXT,
        section,
        productId,
      },
    });
  }
}
