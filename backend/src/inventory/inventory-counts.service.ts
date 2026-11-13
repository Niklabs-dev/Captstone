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
import {
  isTransactionConflict,
  triggerErrorInfo,
} from '../prisma/utils/database-error.util.js';
import type {
  InventoryCountDetailQueryDto,
  ListInventoryCountsQueryDto,
  SaveInventoryCountLineDto,
  StartInventoryCountDto,
} from './dto/inventory-count-request.dto.js';
import {
  fieldErrors,
  lockCatalogShared,
  PRODUCT_SELECT,
  readProduct,
  toProductResponse,
  type ProductRecord,
  type Tx,
} from './inventory-catalog.js';
import {
  MAX_COUNT_DATE_AGE_DAYS,
  type InventoryCountDetail,
  type InventoryCountFinalization,
  type InventoryCountItem,
  type InventoryCountLineResponse,
  type InventoryCountPerson,
  type InventoryCountSummary,
} from './types/inventory-counts.types.js';
import {
  emptyLinesFor,
  finalizationTotals,
  toTemplateSnapshot,
} from './utils/count-finalization.util.js';
import { formatQuantity, resolveCountLine } from './utils/count-line.util.js';
import { comparableName } from './utils/product-format.util.js';

// Toma de inventario de un local (SPRINT-5-T05). El SUPERVISOR inicia la
// toma de su local (el local sale de la sesión, nunca del cuerpo), guarda por
// producto las cajas, los paquetes y la cantidad suelta y la consulta para
// retomarla. El ADMINISTRADOR ve las de todos los locales en solo lectura.
// El SUPERVISOR finaliza la toma de su local (SPRINT-5-T06): desde ese
// momento la toma y sus líneas no admiten cambios.
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

// Filas de la plantilla que copia la finalización (template_snapshot).
const SNAPSHOT_ROW_SELECT = {
  position: true,
  kind: true,
  printedText: true,
  section: true,
  productId: true,
  product: { select: { name: true } },
} satisfies Prisma.InventoryTemplateRowSelect;

// Formato de los productos activos que copia cada línea vacía.
const EMPTY_LINE_PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  unit: true,
  packageName: true,
  boxContent: true,
  packagesPerBox: true,
  packageContent: true,
  looseOnly: true,
} satisfies Prisma.ProductSelect;

// Plazo de la transacción de finalización: inserta una línea vacía por cada
// producto activo no contado (la plantilla tiene ~140 artículos) y puede
// esperar a que termine un guardado o un cambio del catálogo.
const FINALIZE_TIMEOUT_MS = 15_000;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

// 409 único para cualquier cambio sobre una toma finalizada (guardar,
// finalizar de nuevo o el rechazo del trigger de la base).
function finalizedConflict(): Error {
  return fieldErrors(409, 'La toma de inventario está finalizada', {
    countId: 'La toma está finalizada: no admite cambios',
  });
}

// Mensaje de los triggers de 20261111120000/20261111130000 al rechazar una
// escritura sobre una toma CONFIRMED (o sus líneas).
const FINALIZED_TRIGGER_MESSAGE = /La toma de inventario \S+ está finalizada/;

// Traduce a 409 los rechazos de la base al escribir una toma o sus líneas,
// nunca un 500 (SPRINT-5-T06):
// - el trigger de las líneas o de la toma rechaza una toma ya CONFIRMED con
//   SQLSTATE 42501 («La toma de inventario … está finalizada», P2039);
// - un deadlock (40P01) o conflicto de serialización (P2034) y un choque con
//   la línea única por producto (P2002) indican que otra solicitud estaba
//   escribiendo la misma toma.
// Devuelve null si el error es de otro tipo (se propaga tal cual).
function countWriteConflict(error: unknown): Error | null {
  const trigger = triggerErrorInfo(error);
  if (trigger !== null) {
    return trigger.code === '42501' &&
      FINALIZED_TRIGGER_MESSAGE.test(trigger.message)
      ? finalizedConflict()
      : fieldErrors(409, trigger.message, { countId: trigger.message });
  }
  if (isTransactionConflict(error) || isUniqueViolation(error)) {
    return fieldErrors(409, 'Otra solicitud estaba modificando esta toma', {
      countId:
        'Otra solicitud estaba guardando o finalizando esta toma: vuelve a consultarla',
    });
  }
  return null;
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
        // La toma que chocó ya no existe (otra transacción revirtió entre
        // medio): conflicto genérico, nunca un 500.
        throw fieldErrors(409, 'Otra toma de este local se estaba iniciando', {
          store:
            'Vuelve a intentarlo: otra toma de tu local se estaba iniciando',
        });
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
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Mismo bloqueo que toma el trigger de las líneas: los guardados de
        // una toma se serializan entre sí y con su finalización (SPRINT-5-T06).
        const locked = await tx.$queryRaw<
          { store_id: string; status: string }[]
        >`
        SELECT store_id::text AS store_id, status::text AS status
        FROM inventory_counts WHERE id = ${countId}::uuid
        FOR NO KEY UPDATE`;
        if (locked.length === 0) {
          throw new NotFoundException('Toma de inventario no encontrada');
        }
        this.assertStoreAccess(locked[0].store_id, user);
        if (locked[0].status !== InventoryCountStatus.OPEN) {
          throw finalizedConflict();
        }
        const product = await readProduct(tx, productId);
        // Un producto desactivado no se empieza a contar, pero si ya tiene
        // línea en esta toma se puede corregir: la consulta la sigue mostrando
        // y no debe pasar con un error de tipeo a la toma finalizada.
        if (!product.isActive) {
          const existing = await tx.inventoryCountLine.findUnique({
            where: { countId_productId: { countId, productId } },
            select: { id: true },
          });
          if (existing === null) {
            throw fieldErrors(409, 'El producto está desactivado', {
              productId:
                'El producto está desactivado: ya no se cuenta en las tomas',
            });
          }
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
    } catch (error) {
      throw countWriteConflict(error) ?? error;
    }
  }

  // Finaliza la toma (SPRINT-5-T06), solo el SUPERVISOR de su local y con al
  // menos un producto contado. En una sola transacción:
  // 1. SELECT … FOR UPDATE sobre la toma: dos finalizaciones (o una y un
  //    guardado) se serializan; la que llega tarde vuelve a leer la toma,
  //    la ve CONFIRMED y responde 409 sin insertar nada.
  // 2. Bloqueo compartido del catálogo: la plantilla y los productos activos
  //    se copian sin que un cambio del catálogo se cruce. Los productos
  //    activos se leen con FOR KEY SHARE.
  // 3. Inserta una línea vacía por cada producto activo no contado (con la
  //    copia de su nombre y formato) ANTES de pasar la toma a CONFIRMED: el
  //    trigger solo admite líneas de una toma OPEN.
  // 4. Pasa la toma a CONFIRMED con quién y cuándo la finalizó y la copia de
  //    la estructura de la plantilla. Desde ahí el índice parcial de la toma
  //    En curso deja libre el local para iniciar otra.
  async finalize(
    id: string,
    user: AuthUser,
  ): Promise<InventoryCountFinalization> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<
            { store_id: string; status: string }[]
          >`
            SELECT store_id::text AS store_id, status::text AS status
            FROM inventory_counts WHERE id = ${id}::uuid
            FOR UPDATE`;
          if (locked.length === 0) {
            throw new NotFoundException('Toma de inventario no encontrada');
          }
          this.assertStoreAccess(locked[0].store_id, user);
          if (locked[0].status !== InventoryCountStatus.OPEN) {
            throw finalizedConflict();
          }
          const lines = await tx.inventoryCountLine.findMany({
            where: { countId: id },
            select: { productId: true, countedQuantity: true },
          });
          if (!lines.some((line) => line.countedQuantity !== null)) {
            throw fieldErrors(400, 'La toma no tiene productos contados', {
              countId:
                'Guarda lo contado de al menos un producto antes de finalizar la toma',
            });
          }

          await lockCatalogShared(tx);
          const rows = await tx.inventoryTemplateRow.findMany({
            select: SNAPSHOT_ROW_SELECT,
            orderBy: { position: 'asc' },
          });
          // FOR KEY SHARE (el mismo bloqueo que toma la FK al insertar la
          // línea): un producto que se borrara entre la lectura y el INSERT
          // no termina en un error de FK, y uno ya borrado no se lee.
          const activeIds = await tx.$queryRaw<{ id: string }[]>`
            SELECT id::text AS id FROM products WHERE is_active
            FOR KEY SHARE`;
          const active = await tx.product.findMany({
            where: {
              id: { in: activeIds.map((product) => product.id) },
              isActive: true,
            },
            select: EMPTY_LINE_PRODUCT_SELECT,
          });
          const emptyLines = emptyLinesFor(
            active,
            new Set(lines.map((line) => line.productId)),
          );
          if (emptyLines.length > 0) {
            await tx.inventoryCountLine.createMany({
              data: emptyLines.map((line) => ({
                ...line,
                countId: id,
                savedById: user.id,
              })),
            });
          }

          const finalized = await tx.inventoryCount.update({
            where: { id },
            data: {
              status: InventoryCountStatus.CONFIRMED,
              finalizedAt: new Date(),
              finalizedById: user.id,
              templateSnapshot: toTemplateSnapshot(rows),
            },
            select: COUNT_SELECT,
          });
          const totals = finalizationTotals(lines, emptyLines.length);
          return {
            ...toSummary(finalized),
            countedProducts: totals.countedProducts,
            totalProducts: totals.totalProducts,
            uncountedProducts: totals.uncountedProducts,
          };
        },
        { timeout: FINALIZE_TIMEOUT_MS },
      );
    } catch (error) {
      throw countWriteConflict(error) ?? error;
    }
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
