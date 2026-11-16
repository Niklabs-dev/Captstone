import { isRecord } from './auth';
import { isUuid } from './users';
import {
  isUnit,
  packageLabel,
  parseProduct,
  type Product,
  type ProductUnit,
} from './products';

// Revisión y descarga de las tomas de inventario para el administrador
// (SPRINT-5-T09): contrato de la API de SPRINT-5-T05/T06, filtros del listado,
// formato de las cantidades y nombre del Excel de SPRINT-5-T08. Funciones
// puras, compartidas por las páginas, el BFF y la descarga.

export type InventoryCountStatus = 'OPEN' | 'CONFIRMED';
export const COUNT_STATUS_LABELS: Record<InventoryCountStatus, string> = {
  OPEN: 'En curso',
  CONFIRMED: 'Finalizado',
};

export interface InventoryCountPerson {
  id: string;
  firstName: string;
  lastName: string;
}
export interface InventoryCountSummary {
  id: string;
  status: InventoryCountStatus;
  // Fecha de la toma (AAAA-MM-DD).
  countDate: string;
  startedAt: string;
  store: { id: string; name: string };
  startedBy: InventoryCountPerson;
  finalizedAt: string | null;
  finalizedBy: InventoryCountPerson | null;
  countedProducts: number;
}
// Línea guardada, con la copia del producto con que se calculó el total.
export interface InventoryCountLine {
  boxes: number | null;
  packages: number | null;
  looseQuantity: string | null;
  countedQuantity: string | null;
  productSku: string | null;
  productName: string;
  unit: ProductUnit;
  packageName: string | null;
}
export interface InventoryCountItem {
  product: Product;
  counted: boolean;
  line: InventoryCountLine | null;
}
export interface InventoryCountDetail extends InventoryCountSummary {
  totalProducts: number;
  pendingProducts: number;
  items: InventoryCountItem[];
}

// --- Contrato -----------------------------------------------------------------

const API_DECIMAL = /^\d{1,12}(\.\d{1,3})?$/;
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isInstant = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 40 &&
  !Number.isNaN(Date.parse(value));

function parsePerson(value: unknown): InventoryCountPerson | null {
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
    !isCalendarDate(value.countDate) ||
    !isInstant(value.startedAt) ||
    !isRecord(value.store) ||
    !isUuid(value.store.id) ||
    !isText(value.store.name, 160) ||
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
    store: { id: value.store.id, name: value.store.name },
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

const optionalCount = (value: unknown): value is number | null =>
  value === null || isCount(value);
const optionalDecimal = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && API_DECIMAL.test(value));

function parseLine(value: unknown): InventoryCountLine | null {
  if (
    !isRecord(value) ||
    !optionalCount(value.boxes) ||
    !optionalCount(value.packages) ||
    !optionalDecimal(value.looseQuantity) ||
    !optionalDecimal(value.countedQuantity) ||
    !(value.productSku === null || isText(value.productSku, 40)) ||
    !isText(value.productName, 120) ||
    !isUnit(value.unit) ||
    !(value.packageName === null || isText(value.packageName, 30))
  )
    return null;
  return {
    boxes: value.boxes,
    packages: value.packages,
    looseQuantity: value.looseQuantity,
    countedQuantity: value.countedQuantity,
    productSku: value.productSku,
    productName: value.productName,
    unit: value.unit,
    packageName: value.packageName,
  };
}
function parseItem(value: unknown): InventoryCountItem | null {
  if (!isRecord(value) || typeof value.counted !== 'boolean') return null;
  const product = parseProduct(value.product);
  const line = value.line === null ? null : parseLine(value.line);
  if (!product || (value.line !== null && !line)) return null;
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
  const items = value.items.map(parseItem);
  if (!items.every((item): item is InventoryCountItem => item !== null))
    return null;
  return {
    ...summary,
    totalProducts: value.totalProducts,
    pendingProducts: value.pendingProducts,
    items,
  };
}

// --- Filtros del listado ------------------------------------------------------

export type SearchValue = string | string[] | undefined;
export interface CountFilters {
  storeId: string;
  status: InventoryCountStatus | '';
  from: string;
  to: string;
}
export const EMPTY_COUNT_FILTERS: CountFilters = {
  storeId: '',
  status: '',
  from: '',
  to: '',
};

// Fecha calendario real (rechaza 2026-02-30).
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const single = (value: SearchValue): string =>
  (typeof value === 'string' ? value : '').trim();

// Interpreta los filtros de la URL. Un filtro inválido no consulta la API:
// se muestra el mensaje y el formulario conserva lo ingresado.
export function parseCountFilters(params: {
  storeId?: SearchValue;
  status?: SearchValue;
  from?: SearchValue;
  to?: SearchValue;
}):
  | { ok: true; filters: CountFilters }
  | { ok: false; filters: CountFilters; message: string } {
  const raw = {
    storeId: single(params.storeId),
    status: single(params.status),
    from: single(params.from),
    to: single(params.to),
  };
  const filters: CountFilters = {
    storeId: raw.storeId,
    status:
      raw.status === 'OPEN' || raw.status === 'CONFIRMED' ? raw.status : '',
    from: raw.from,
    to: raw.to,
  };
  const invalid = (message: string) => ({
    ok: false as const,
    filters,
    message,
  });
  if (filters.storeId && !isUuid(filters.storeId))
    return invalid('El local seleccionado no es válido.');
  if (raw.status && !filters.status)
    return invalid('El estado debe ser «En curso» o «Finalizado».');
  if (
    (filters.from && !isCalendarDate(filters.from)) ||
    (filters.to && !isCalendarDate(filters.to))
  )
    return invalid('Las fechas deben ser válidas (día, mes y año).');
  if (filters.from && filters.to && filters.from > filters.to)
    return invalid('La fecha «Desde» no puede ser posterior a «Hasta».');
  return { ok: true, filters };
}

// Query para la API: solo los filtros informados.
export function countQuery(filters: CountFilters): string {
  const query = new URLSearchParams();
  for (const key of ['storeId', 'status', 'from', 'to'] as const)
    if (filters[key]) query.set(key, filters[key]);
  return query.toString();
}
export function hasCountFilters(filters: CountFilters): boolean {
  return Object.values(filters).some(Boolean);
}

// --- Presentación -------------------------------------------------------------

export function personName(person: InventoryCountPerson): string {
  return `${person.firstName} ${person.lastName}`;
}
// Responsable: quien la finalizó o, mientras siga en curso, quien la inició.
export function countResponsible(count: InventoryCountSummary): string {
  return personName(count.finalizedBy ?? count.startedBy);
}

// Fecha y hora en Chile: «11-11-2026 22:15».
export function formatChileDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Santiago',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')}`;
}

const UNIT_SYMBOL: Record<ProductUnit, string> = {
  KG: 'kg',
  L: 'L',
  UNIT: 'u.',
};

// Cantidad con su unidad. En kg y L siempre con coma y 3 decimales
// («2,450 kg», «1.234,500 L»); en unidades, entera («6 u.»).
export function formatCountQuantity(
  decimal: string,
  unit: ProductUnit,
): string {
  const [whole, fraction = ''] = decimal.split('.');
  const thousands = Number(whole).toLocaleString('es-CL');
  const number =
    unit === 'UNIT'
      ? thousands
      : `${thousands},${fraction.padEnd(3, '0').slice(0, 3)}`;
  return `${number} ${UNIT_SYMBOL[unit]}`;
}

// Celdas de una fila del detalle: «—» cuando no se informó.
export interface CountLineCells {
  name: string;
  sku: string | null;
  boxes: string;
  packages: string;
  loose: string;
  total: string;
}
export function countLineCells(item: InventoryCountItem): CountLineCells {
  const line = item.line;
  // Una toma finalizada muestra la copia guardada; una pendiente, el catálogo.
  const name = line?.productName ?? item.product.name;
  const sku = line ? line.productSku : item.product.sku;
  if (!line || !item.counted)
    return { name, sku, boxes: '—', packages: '—', loose: '—', total: '—' };
  return {
    name,
    sku,
    boxes:
      line.boxes === null
        ? '—'
        : `${line.boxes} ${line.boxes === 1 ? 'caja' : 'cajas'}`,
    packages:
      line.packages === null
        ? '—'
        : `${line.packages} ${packageLabel(line.packageName, line.packages)}`,
    loose:
      line.looseQuantity === null
        ? '—'
        : formatCountQuantity(line.looseQuantity, line.unit),
    total:
      line.countedQuantity === null
        ? '—'
        : formatCountQuantity(line.countedQuantity, line.unit),
  };
}

// Productos en el orden de la plantilla, agrupados por sección consecutiva.
export interface CountSection {
  id: string;
  section: string;
  items: InventoryCountItem[];
}
export const NO_SECTION = 'Sin fila en la plantilla';
export function countSections(
  items: readonly InventoryCountItem[],
): CountSection[] {
  const sections: CountSection[] = [];
  for (const item of items) {
    const name = item.product.section ?? NO_SECTION;
    const last = sections.at(-1);
    if (last && last.section === name) last.items.push(item);
    else
      sections.push({
        id: `count-section-${sections.length + 1}`,
        section: name,
        items: [item],
      });
  }
  return sections;
}

// «12 de 140 productos contados».
export function countProgress(counted: number, total: number): string {
  return `${counted} de ${total} ${total === 1 ? 'producto contado' : 'productos contados'}`;
}

export function canDownloadCount(count: Pick<InventoryCountSummary, 'status'>) {
  return count.status === 'CONFIRMED';
}

// Nombre de la descarga: el de Content-Disposition si es seguro; si no,
// «inventario-<fecha>.xlsx». Nunca contiene rutas ni caracteres de control.
export function countExportFileName(
  disposition: string | null,
  countDate: string,
): string {
  const fallback = `inventario-${countDate}.xlsx`;
  const match = disposition
    ? (/filename\s*=\s*"([^"]*)"/i.exec(disposition) ??
      /filename\s*=\s*([^;"\s]+)/i.exec(disposition))
    : null;
  const name = match?.[1].trim() ?? '';
  return name.length > 0 &&
    name.length <= 200 &&
    /\.xlsx$/i.test(name) &&
    !/[\\/\u0000-\u001f\u007f]/.test(name) &&
    !name.startsWith('.')
    ? name
    : fallback;
}

export type CountOperation = 'list' | 'detail' | 'export';
export function inventoryCountError(
  status: number,
  operation: CountOperation = 'list',
): string {
  if (status === 401) return 'Tu sesión venció. Vuelve a iniciar sesión.';
  if (status === 403)
    return 'Solo el administrador revisa y descarga las tomas de inventario.';
  if (status === 404) return 'La toma de inventario no existe.';
  if (status === 409 && operation === 'export')
    return 'La toma todavía está en curso: solo se descarga una toma finalizada.';
  if (status === 400)
    return operation === 'list'
      ? 'Revisa los filtros: el local, el estado o las fechas no son válidos.'
      : 'La toma de inventario no es válida.';
  if (status === 429)
    return 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.';
  if (status === 503)
    return 'No se pudo conectar con el servicio. Intenta nuevamente más tarde.';
  return operation === 'export'
    ? 'No se pudo descargar el Excel. Intenta nuevamente.'
    : 'No se pudo cargar la información. Intenta nuevamente.';
}
