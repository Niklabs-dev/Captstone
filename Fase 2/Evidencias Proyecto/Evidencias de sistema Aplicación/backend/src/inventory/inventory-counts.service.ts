import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  parseCalendarDate,
  type CalendarDate,
} from '../audit/utils/business-day.util.js';
import { STORE_FORBIDDEN_MESSAGE } from '../auth/constants/forbidden-messages.constants.js';
import { ROLE } from '../auth/constants/roles.constants.js';
import { canAccessStore } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import {
  addDays,
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../documents/utils/document-dates.util.js';
import { InventoryCountStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  InventoryCountDetailQueryDto,
  ListInventoryCountsQueryDto,
  SaveInventoryCountLineDto,
  StartInventoryCountDto,
} from './dto/inventory-count-request.dto.js';
import {
  fieldErrors,
  PRODUCT_SELECT,
  readProduct,
  toProductResponse,
  type ProductRecord,
  type Tx,
} from './inventory-catalog.js';
import {
  MAX_COUNT_DATE_AGE_DAYS,
  type InventoryCountDetail,
  type InventoryCountItem,
  type InventoryCountLineResponse,
  type InventoryCountPerson,
  type InventoryCountSummary,
} from './types/inventory-counts.types.js';
import { formatQuantity, resolveCountLine } from './utils/count-line.util.js';
import { comparableName } from './utils/product-format.util.js';

// Toma de inventario de un local (SPRINT-5-T05). El SUPERVISOR inicia la
// toma de su local (el local sale de la sesión, nunca del cuerpo), guarda por
// producto las cajas, los paquetes y la cantidad suelta y la consulta para
// retomarla. El ADMINISTRADOR ve las de todos los locales en solo lectura.
// La finalización es de SPRINT-5-T06.
//
// Una toma En curso muestra los productos activos en el orden de la
// plantilla (todo producto activo tiene fila) más los que ya tengan línea en
// ella aunque después se hayan desactivado, para no esconder lo contado. Los
// que no tienen fila (su fila se liberó) van al final, por nombre. Una toma
// finalizada muestra solo sus líneas: la finalización agrega una línea vacía
// por cada producto activo no contado.

const PERSON_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

const COUNT_SELECT = {
  id: true,
  status: true,
  countDate: true,
  countedAt: true,
  finalizedAt: true,
  storeId: true,
  store: { select: { id: true, name: true } },
  createdBy: { select: PERSON_SELECT },
  finalizedBy: { select: PERSON_SELECT },
  _count: {
    select: { lines: { where: { countedQuantity: { not: null } } } },
  },
} satisfies Prisma.InventoryCountSelect;

type CountRecord = Prisma.InventoryCountGetPayload<{
  select: typeof COUNT_SELECT;
}>;

const LINE_SELECT = {
  id: true,
  productId: true,
  boxes: true,
  packages: true,
  looseQuantity: true,
  countedQuantity: true,
  productSku: true,
  productName: true,
  unit: true,
  packageName: true,
  boxContent: true,
  packagesPerBox: true,
  packageContent: true,
  looseOnly: true,
  savedAt: true,
  savedBy: { select: PERSON_SELECT },
} satisfies Prisma.InventoryCountLineSelect;

type LineRecord = Prisma.InventoryCountLineGetPayload<{
  select: typeof LINE_SELECT;
}>;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function toSummary(count: CountRecord): InventoryCountSummary {
  return {
    id: count.id,
    status: count.status,
    countDate: formatDbDate(count.countDate),
    startedAt: count.countedAt,
    storeId: count.storeId,
    store: count.store,
    startedBy: count.createdBy,
    finalizedAt: count.finalizedAt,
    finalizedBy: count.finalizedBy,
    countedProducts: count._count.lines,
  };
}

function toLineResponse(line: LineRecord): InventoryCountLineResponse {
  const contents = (value: Prisma.Decimal | null): string | null =>
    value === null ? null : value.toFixed(3);
  return {
    id: line.id,
    productId: line.productId,
    boxes: line.boxes,
    packages: line.packages,
    looseQuantity: formatQuantity(line.looseQuantity, line.unit),
    countedQuantity: formatQuantity(line.countedQuantity, line.unit),
    productSku: line.productSku,
    productName: line.productName,
    unit: line.unit,
    packageName: line.packageName,
    boxContent: contents(line.boxContent),
    packagesPerBox: line.packagesPerBox,
    packageContent: contents(line.packageContent),
    looseOnly: line.looseOnly,
    savedAt: line.savedAt,
    savedBy: line.savedBy satisfies InventoryCountPerson,
  };
}

function toItem(
  product: ProductRecord,
  line: LineRecord | undefined,
): InventoryCountItem {
  return {
    product: toProductResponse(product),
    counted: line !== undefined && line.countedQuantity !== null,
    line: line === undefined ? null : toLineResponse(line),
  };
}

// Orden de la plantilla; sin fila, al final y por nombre.
function byTemplateOrder(
  left: InventoryCountItem,
  right: InventoryCountItem,
): number {
  return (
    (left.product.templatePosition ?? Number.MAX_SAFE_INTEGER) -
      (right.product.templatePosition ?? Number.MAX_SAFE_INTEGER) ||
    left.product.name.localeCompare(right.product.name, 'es')
  );
}

function matchesSearch(item: InventoryCountItem, search: string): boolean {
  const texts = [
    item.product.name,
    ...item.product.alternativeNames,
    item.product.sku ?? '',
    item.line?.productName ?? '',
    item.line?.productSku ?? '',
  ];
  return texts.some((text) => comparableName(text).includes(search));
}

@Injectable()
export class InventoryCountsService {
  constructor(private readonly prisma: PrismaService) {}

  // Inicia la toma del local del supervisor. Como máximo una En curso por
  // local: si ya hay una, 409 con su id para retomarla. Las solicitudes del
  // mismo local se serializan con un bloqueo sobre su fila de stores (FOR NO
  // KEY UPDATE: no estorba a las FK que la referencian); el índice único
  // parcial inventory_counts_store_id_open_key es la última defensa.
  async start(
    dto: StartInventoryCountDto,
    user: AuthUser,
  ): Promise<InventoryCountSummary> {
    const storeId = this.sessionStore(user);
    const countDate = this.countDate(dto.countDate);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const store = await tx.$queryRaw<{ is_active: boolean }[]>`
          SELECT is_active FROM stores WHERE id = ${storeId}::uuid
          FOR NO KEY UPDATE`;
        if (store.length === 0 || !store[0].is_active) {
          throw new BadRequestException('Tu local no existe o está inactivo');
        }
        await this.assertNoOpenCount(tx, storeId);
        const created = await tx.inventoryCount.create({
          data: {
            storeId,
            createdById: user.id,
            countDate: toDbDate(countDate),
          },
          select: COUNT_SELECT,
        });
        return toSummary(created);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        await this.assertNoOpenCount(this.prisma, storeId);
      }
      throw error;
    }
  }

  async findAll(
    query: ListInventoryCountsQueryDto,
    user: AuthUser,
  ): Promise<InventoryCountSummary[]> {
    const storeId = this.listStore(query.storeId, user);
    const from = this.rangeDate(query.from, 'from');
    const to = this.rangeDate(query.to, 'to');
    if (from !== null && to !== null && from > to) {
      throw fieldErrors(400, 'El rango de fechas no es válido', {
        to: 'La fecha final debe ser igual o posterior a la inicial',
      });
    }
    const counts = await this.prisma.inventoryCount.findMany({
      where: {
        ...(storeId === null ? {} : { storeId }),
        ...(query.status ? { status: query.status } : {}),
        ...(from !== null || to !== null
          ? {
              countDate: {
                ...(from !== null ? { gte: from } : {}),
                ...(to !== null ? { lte: to } : {}),
              },
            }
          : {}),
      },
      select: COUNT_SELECT,
      orderBy: [{ countDate: 'desc' }, { countedAt: 'desc' }, { id: 'asc' }],
    });
    return counts.map(toSummary);
  }

  async findOne(
    id: string,
    query: InventoryCountDetailQueryDto,
    user: AuthUser,
  ): Promise<InventoryCountDetail> {
    const count = await this.readCount(id);
    this.assertStoreAccess(count.storeId, user);

    const lines = await this.prisma.inventoryCountLine.findMany({
      where: { countId: id },
      select: { ...LINE_SELECT, product: { select: PRODUCT_SELECT } },
    });
    const lineByProduct = new Map(lines.map((line) => [line.productId, line]));
    const products = new Map<string, ProductRecord>(
      lines.map((line) => [line.productId, line.product]),
    );
    if (count.status === InventoryCountStatus.OPEN) {
      const active = await this.prisma.product.findMany({
        where: { isActive: true },
        select: PRODUCT_SELECT,
      });
      for (const product of active) products.set(product.id, product);
    }
    const items = [...products.values()]
      .map((product) => toItem(product, lineByProduct.get(product.id)))
      .sort(byTemplateOrder);
    const counted = items.filter((item) => item.counted).length;
    const search = query.search ? comparableName(query.search) : null;
    return {
      ...toSummary(count),
      totalProducts: items.length,
      pendingProducts: items.length - counted,
      items:
        search === null
          ? items
          : items.filter((item) => matchesSearch(item, search)),
    };
  }

  // Guarda (o reemplaza) la línea del producto: una por toma y producto. El
  // total se calcula con el formato vigente del producto y se guarda con su
  // copia; saved_by_id es el usuario de la sesión y saved_at lo pone la base.
  async saveLine(
    countId: string,
    productId: string,
    dto: SaveInventoryCountLineDto,
    user: AuthUser,
  ): Promise<InventoryCountItem> {
    return this.prisma.$transaction(async (tx) => {
      // Mismo bloqueo que toma el trigger de las líneas: los guardados de
      // una toma se serializan entre sí y con su finalización (SPRINT-5-T06).
      const locked = await tx.$queryRaw<{ store_id: string; status: string }[]>`
        SELECT store_id::text AS store_id, status::text AS status
        FROM inventory_counts WHERE id = ${countId}::uuid
        FOR NO KEY UPDATE`;
      if (locked.length === 0) {
        throw new NotFoundException('Toma de inventario no encontrada');
      }
      this.assertStoreAccess(locked[0].store_id, user);
      if (locked[0].status !== InventoryCountStatus.OPEN) {
        throw new ConflictException(
          'La toma de inventario está finalizada: no admite cambios',
        );
      }
      const product = await readProduct(tx, productId);
      if (!product.isActive) {
        throw fieldErrors(409, 'El producto está desactivado', {
          productId:
            'El producto está desactivado: ya no se cuenta en las tomas',
        });
      }
      const result = resolveCountLine(product, {
        boxes: dto.boxes,
        packages: dto.packages,
        looseQuantity: dto.looseQuantity,
      });
      if (!result.ok) {
        throw fieldErrors(
          400,
          'Las cantidades no son válidas para el formato del producto',
          result.errors,
        );
      }
      const data = {
        boxes: result.line.boxes,
        packages: result.line.packages,
        looseQuantity: result.line.looseQuantity,
        countedQuantity: result.line.countedQuantity,
        productSku: product.sku,
        productName: product.name,
        unit: product.unit,
        packageName: product.packageName,
        boxContent: product.boxContent,
        packagesPerBox: product.packagesPerBox,
        packageContent: product.packageContent,
        looseOnly: product.looseOnly,
        savedById: user.id,
      };
      const line = await tx.inventoryCountLine.upsert({
        where: { countId_productId: { countId, productId } },
        create: { countId, productId, ...data },
        update: data,
        select: LINE_SELECT,
      });
      return toItem(product, line);
    });
  }

  // Local de la sesión del supervisor; sin local asignado no inicia tomas.
  private sessionStore(user: AuthUser): string {
    if (user.storeId === null) {
      throw new ForbiddenException(STORE_FORBIDDEN_MESSAGE);
    }
    return user.storeId;
  }

  // El SUPERVISOR solo lista su local (otro local, 403); el ADMINISTRADOR,
  // el indicado o todos (null).
  private listStore(
    storeId: string | undefined,
    user: AuthUser,
  ): string | null {
    if (user.role !== ROLE.SUPERVISOR) return storeId ?? null;
    const own = this.sessionStore(user);
    if (storeId !== undefined && storeId !== own) {
      throw new ForbiddenException(STORE_FORBIDDEN_MESSAGE);
    }
    return own;
  }

  private assertStoreAccess(storeId: string, user: AuthUser): void {
    if (!canAccessStore(user, storeId)) {
      throw new ForbiddenException(STORE_FORBIDDEN_MESSAGE);
    }
  }

  // Fecha de la toma: la indicada o el día en curso en hora de Chile. Entre
  // hoy y MAX_COUNT_DATE_AGE_DAYS días atrás.
  private countDate(value: string | undefined): CalendarDate {
    const today = businessDateOf(new Date());
    if (value === undefined) return today;
    const parsed = parseCalendarDate(value);
    if (parsed === null) {
      throw fieldErrors(400, 'La fecha de la toma no es válida', {
        countDate: 'La fecha no existe en el calendario',
      });
    }
    const date = formatDbDate(toDbDate(parsed));
    if (date > formatDbDate(toDbDate(today))) {
      throw fieldErrors(400, 'La fecha de la toma no es válida', {
        countDate: 'La fecha de la toma no puede ser posterior a hoy',
      });
    }
    const oldest = addDays(today, -MAX_COUNT_DATE_AGE_DAYS);
    if (date < formatDbDate(toDbDate(oldest))) {
      throw fieldErrors(400, 'La fecha de la toma no es válida', {
        countDate: `La fecha de la toma puede ser de hoy o de hasta ${MAX_COUNT_DATE_AGE_DAYS} días atrás (desde el ${formatDbDate(toDbDate(oldest))})`,
      });
    }
    return parsed;
  }

  private rangeDate(
    value: string | undefined,
    field: 'from' | 'to',
  ): Date | null {
    if (value === undefined) return null;
    const parsed = parseCalendarDate(value);
    if (parsed === null) {
      throw fieldErrors(400, 'El rango de fechas no es válido', {
        [field]: 'La fecha no existe en el calendario',
      });
    }
    return toDbDate(parsed);
  }

  private async assertNoOpenCount(
    client: Tx | PrismaService,
    storeId: string,
  ): Promise<void> {
    const open = await client.inventoryCount.findFirst({
      where: { storeId, status: InventoryCountStatus.OPEN },
      select: { id: true, countDate: true },
    });
    if (open === null) return;
    const countDate = formatDbDate(open.countDate);
    throw new ConflictException({
      statusCode: 409,
      message: 'Ya hay una toma de inventario en curso en tu local',
      errors: {
        store: `Retoma la toma en curso del ${countDate} o finalízala antes de iniciar otra`,
      },
      existingCountId: open.id,
      existingCountDate: countDate,
    });
  }

  private async readCount(id: string): Promise<CountRecord> {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      select: COUNT_SELECT,
    });
    if (!count) throw new NotFoundException('Toma de inventario no encontrada');
    return count;
  }
}
