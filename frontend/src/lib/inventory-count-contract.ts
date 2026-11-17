import { isRecord } from './auth';
import {
  isUnit,
  parseProduct,
  type Product,
  type ProductUnit,
} from './products';
import { isUuid } from './users';

// Contrato de la API de tomas de inventario (/inventory-counts, SPRINT-5-T05,
// T06 y T08), único para la toma del supervisor (SPRINT-5-T07) y la revisión
// del administrador (SPRINT-5-T09) desde SPRINT-5-T17: tipos, parsers de las
// respuestas y de los cuerpos que reenvía el BFF, etiquetas de estado, formato
// de cantidades y secciones de la plantilla. Si cambia el contrato, se cambia
// aquí. Funciones puras, compartidas por las vistas, el BFF y las páginas.

export type InventoryCountStatus = 'OPEN' | 'CONFIRMED';
export const COUNT_STATUS_LABELS: Record<InventoryCountStatus, string> = {
  OPEN: 'En curso',
  CONFIRMED: 'Finalizado',
};

/** Persona que inició, guardó o finalizó (solo nombre: nunca RUT ni correo). */
export interface CountPerson {
  id: string;
  firstName: string;
  lastName: string;
}
export interface InventoryCountSummary {
  id: string;
  status: InventoryCountStatus;
  // Fecha de la toma (AAAA-MM-DD) fijada por la API al iniciarla.
  countDate: string;
  startedAt: string;
  storeId: string;
  store: { id: string; name: string };
  startedBy: CountPerson;
  finalizedAt: string | null;
  finalizedBy: CountPerson | null;
  countedProducts: number;
}
// Línea guardada, con la copia del producto y del formato con que la API
// calculó el total: una toma finalizada no cambia si después se edita el
// producto.
export interface CountLine {
  id: string;
  productId: string;
  boxes: number | null;
  packages: number | null;
  looseQuantity: string | null;
  countedQuantity: string | null;
  productSku: string | null;
  productName: string;
  unit: ProductUnit;
  packageName: string | null;
  boxContent: string | null;
  packagesPerBox: number | null;
  packageContent: string | null;
  looseOnly: boolean;
  savedAt: string;
  savedBy: CountPerson;
}
export interface CountItem {
  product: Product;
  counted: boolean;
  line: CountLine | null;
}
export interface InventoryCountDetail extends InventoryCountSummary {
  totalProducts: number;
  pendingProducts: number;
  items: CountItem[];
}
export interface InventoryCountFinalization extends InventoryCountSummary {
  totalProducts: number;
  uncountedProducts: number;
}
// 409 al iniciar: ya hay una toma En curso en el local, para retomarla.
export interface StartConflict {
  existingCountId: string;
  existingCountDate: string;
}

// Errores por campo que devuelve la API de tomas.
const ERROR_FIELDS = [
  'countDate',
  'store',
  'boxes',
  'packages',
  'looseQuantity',
  'countId',
  'productId',
] as const;
export type CountErrorField = (typeof ERROR_FIELDS)[number];
export type CountFieldErrors = Partial<Record<CountErrorField, string>>;

/** Máximo de cajas o paquetes de una línea (MAX_PIECES de la API). */
export const MAX_PIECES = 100_000;
/** Largo máximo de la búsqueda de GET /inventory-counts/:id?search. */
export const MAX_SEARCH_LENGTH = 120;

// Cantidades Decimal(12, 3): hasta 9 enteros y 3 decimales, con punto.
const API_DECIMAL = /^\d{1,9}(\.\d{1,3})?$/;
const API_INTEGER = /^\d{1,12}$/;

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isInstant = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 40 &&
  !Number.isNaN(Date.parse(value));
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isPieces = (value: unknown): value is number | null =>
  value === null || (isCount(value) && Number(value) <= MAX_PIECES);
// Totales y cantidades: «14.950» en kg y L, «54» en unidades.
const isQuantity = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === 'string' &&
    (API_DECIMAL.test(value) || API_INTEGER.test(value)));

// Fecha calendario real AAAA-MM-DD (rechaza 2026-02-30).
export function isCountDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + 'T00:00:00Z');
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

// --- Respuestas de la API -----------------------------------------------------

function parsePerson(value: unknown): CountPerson | null {
  return isRecord(value) &&
    isUuid(value.id) &&
    isText(value.firstName, 120) &&
    isText(value.lastName, 120)
    ? { id: value.id, firstName: value.firstName, lastName: value.lastName }
    : null;
}

export function parseCountSummary(
  value: unknown,
): InventoryCountSummary | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    (value.status !== 'OPEN' && value.status !== 'CONFIRMED') ||
    !isCountDate(value.countDate) ||
    !isInstant(value.startedAt) ||
    !isUuid(value.storeId) ||
    !isRecord(value.store) ||
    value.store.id !== value.storeId ||
    !isText(value.store.name, 120) ||
    !isCount(value.countedProducts)
  )
    return null;
  const startedBy = parsePerson(value.startedBy);
  const finalizedBy =
    value.finalizedBy === null ? null : parsePerson(value.finalizedBy);
  const finalizedAt = value.finalizedAt === null ? null : value.finalizedAt;
  if (
    !startedBy ||
    (value.finalizedBy !== null && !finalizedBy) ||
    (finalizedAt !== null && !isInstant(finalizedAt))
  )
    return null;
  return {
    id: value.id,
    status: value.status,
    countDate: value.countDate,
    startedAt: value.startedAt,
    storeId: value.storeId,
    store: { id: value.storeId, name: value.store.name },
    startedBy,
    finalizedAt,
    finalizedBy,
    countedProducts: value.countedProducts,
  };
}
export function parseCountSummaries(
  value: unknown,
): InventoryCountSummary[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(parseCountSummary);
  return items.every((item): item is InventoryCountSummary => item !== null)
    ? items
    : null;
}

export function parseCountLine(value: unknown): CountLine | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.productId) ||
    !isPieces(value.boxes) ||
    !isPieces(value.packages) ||
    !isQuantity(value.looseQuantity) ||
    !isQuantity(value.countedQuantity) ||
    !(value.productSku === null || isText(value.productSku, 40)) ||
    !isText(value.productName, 120) ||
    !isUnit(value.unit) ||
    !(value.packageName === null || isText(value.packageName, 30)) ||
    !isQuantity(value.boxContent) ||
    !(value.packagesPerBox === null || isCount(value.packagesPerBox)) ||
    !isQuantity(value.packageContent) ||
    typeof value.looseOnly !== 'boolean' ||
    !isInstant(value.savedAt)
  )
    return null;
  const savedBy = parsePerson(value.savedBy);
  if (!savedBy) return null;
  return {
    id: value.id,
    productId: value.productId,
    boxes: value.boxes,
    packages: value.packages,
    looseQuantity: value.looseQuantity,
    countedQuantity: value.countedQuantity,
    productSku: value.productSku,
    productName: value.productName,
    unit: value.unit,
    packageName: value.packageName,
    boxContent: value.boxContent,
    packagesPerBox: value.packagesPerBox,
    packageContent: value.packageContent,
    looseOnly: value.looseOnly,
    savedAt: value.savedAt,
    savedBy,
  };
}

// Un producto de la toma: la línea debe ser de ese producto y un producto
// contado siempre trae su línea.
export function parseCountItem(value: unknown): CountItem | null {
  if (!isRecord(value) || typeof value.counted !== 'boolean') return null;
  const product = parseProduct(value.product);
  const line = value.line === null ? null : parseCountLine(value.line);
  if (
    !product ||
    (value.line !== null && !line) ||
    (line !== null && line.productId !== product.id) ||
    (value.counted && line === null)
  )
    return null;
  return { product, counted: value.counted, line };
}

export function parseCountDetail(value: unknown): InventoryCountDetail | null {
  const summary = parseCountSummary(value);
  if (
    !summary ||
    !isRecord(value) ||
    !isCount(value.totalProducts) ||
    !isCount(value.pendingProducts) ||
    !Array.isArray(value.items)
  )
    return null;
  const items = value.items.map(parseCountItem);
  if (!items.every((item): item is CountItem => item !== null)) return null;
  return {
    ...summary,
    totalProducts: value.totalProducts,
    pendingProducts: value.pendingProducts,
    items,
  };
}

export function parseCountFinalization(
  value: unknown,
): InventoryCountFinalization | null {
  const summary = parseCountSummary(value);
  if (
    !summary ||
    !isRecord(value) ||
    summary.status !== 'CONFIRMED' ||
    !isCount(value.totalProducts) ||
    !isCount(value.uncountedProducts)
  )
    return null;
  return {
    ...summary,
    totalProducts: value.totalProducts,
    uncountedProducts: value.uncountedProducts,
  };
}

export function parseStartConflict(value: unknown): StartConflict | null {
  return isRecord(value) &&
    isUuid(value.existingCountId) &&
    isCountDate(value.existingCountDate)
    ? {
        existingCountId: value.existingCountId,
        existingCountDate: value.existingCountDate,
      }
    : null;
}

// Errores por campo (400/409): solo claves conocidas y textos acotados.
export function parseCountFieldErrors(value: unknown): CountFieldErrors | null {
  if (!isRecord(value) || !isRecord(value.errors)) return null;
  const errors: CountFieldErrors = {};
  for (const [key, message] of Object.entries(value.errors))
    if (
      (ERROR_FIELDS as readonly string[]).includes(key) &&
      typeof message === 'string' &&
      message.trim() &&
      message.length <= 300
    )
      errors[key as CountErrorField] = message;
  return Object.keys(errors).length ? errors : null;
}

// --- Cuerpos que el BFF reenvía: solo los campos del contrato -----------------

export function parseStartInput(value: unknown): { countDate?: string } | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 0) return {};
  return keys.length === 1 && isCountDate(value.countDate)
    ? { countDate: value.countDate }
    : null;
}
export interface CountLineInput {
  boxes?: number | null;
  packages?: number | null;
  looseQuantity?: string | null;
}
export function parseCountLineInput(value: unknown): CountLineInput | null {
  if (!isRecord(value)) return null;
  const input: CountLineInput = {};
  for (const [key, field] of Object.entries(value)) {
    if ((key === 'boxes' || key === 'packages') && isPieces(field))
      input[key] = field;
    else if (
      key === 'looseQuantity' &&
      (field === null || (typeof field === 'string' && API_DECIMAL.test(field)))
    )
      input.looseQuantity = field;
    else return null;
  }
  return input;
}

// --- Formato de cantidades ----------------------------------------------------

const UNIT_SYMBOL: Record<ProductUnit, string> = {
  KG: 'kg',
  L: 'L',
  UNIT: 'u.',
};
export function unitSymbol(unit: ProductUnit): string {
  return UNIT_SYMBOL[unit];
}

// Miles con punto sobre el texto, sin pasar por Number ni por la
// configuración regional del navegador.
function groupThousands(whole: string): string {
  return whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
// «14.950» → «14,950» en kg y L (siempre 3 decimales); «54» → «54» en
// unidades. Miles con punto: «1.234,500».
export function formatCountNumber(decimal: string, unit: ProductUnit): string {
  const [whole, fraction = ''] = decimal.split('.');
  if (unit === 'UNIT' && /^0*$/.test(fraction)) return groupThousands(whole);
  return `${groupThousands(whole)},${fraction.padEnd(3, '0').slice(0, 3)}`;
}
// Cantidad con su unidad: «2,450 kg», «1.234,500 L» o «6 u.».
export function formatCountQuantity(
  decimal: string,
  unit: ProductUnit,
): string {
  return `${formatCountNumber(decimal, unit)} ${UNIT_SYMBOL[unit]}`;
}

// --- Presentación común -------------------------------------------------------

export function personName(person: CountPerson): string {
  return `${person.firstName} ${person.lastName}`;
}

export const OUTSIDE_TEMPLATE_SECTION = 'Sin fila en la plantilla';
export interface CountSection {
  id: string;
  name: string;
  items: CountItem[];
  counted: number;
}

// Agrupa por sección consecutiva en el orden que entrega la API (el de la
// plantilla). Los productos sin fila van al final, en «Sin fila en la
// plantilla».
export function groupCountItems(items: readonly CountItem[]): CountSection[] {
  const sections: CountSection[] = [];
  for (const item of items) {
    const name = item.product.section ?? OUTSIDE_TEMPLATE_SECTION;
    let current = sections.at(-1);
    if (!current || current.name !== name) {
      current = {
        id: `count-section-${sections.length + 1}`,
        name,
        items: [],
        counted: 0,
      };
      sections.push(current);
    }
    current.items.push(item);
    if (item.counted) current.counted += 1;
  }
  return sections;
}
