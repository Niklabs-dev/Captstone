import { isRecord } from './auth';
import {
  formatQuantity,
  isUnit,
  packageLabel,
  parseProduct,
  type Product,
  type ProductUnit,
} from './products';
import { isUuid } from './users';

// Toma de inventario del supervisor (SPRINT-5-T07): contrato de la API de
// SPRINT-5-T05/T06 y reglas de la vista (parseo de coma o punto, total en
// vivo, secciones, avance y búsqueda). Funciones puras, compartidas por el
// BFF y la vista.

export type InventoryCountStatus = 'OPEN' | 'CONFIRMED';
export const COUNT_STATUS_LABELS: Record<InventoryCountStatus, string> = {
  OPEN: 'En curso',
  CONFIRMED: 'Finalizada',
};

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
// Línea guardada, con la copia del formato con que la API calculó el total.
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
/** Días hacia atrás que admite la fecha (MAX_COUNT_DATE_AGE_DAYS de la API). */
export const MAX_COUNT_DATE_AGE_DAYS = 7;
export const MAX_SEARCH_LENGTH = 120;
export const OUTSIDE_TEMPLATE_SECTION = 'Sin fila en la plantilla';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const API_DECIMAL = /^\d{1,9}(\.\d{1,3})?$/;
const API_INTEGER = /^\d{1,12}$/;
const UNIT_SYMBOL: Record<ProductUnit, string> = {
  KG: 'kg',
  L: 'L',
  UNIT: 'u.',
};

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isDateTime = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isPieces = (value: unknown): value is number | null =>
  value === null || (isCount(value) && Number(value) <= MAX_PIECES);
// Totales y cantidades: «14.950» en kg y L, «54» en unidades.
const isQuantity = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === 'string' &&
    (API_DECIMAL.test(value) || API_INTEGER.test(value)));

export function isCountDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

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
    !isDateTime(value.startedAt) ||
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
    (finalizedAt !== null && !isDateTime(finalizedAt))
  )
    return null;
  return {
    id: value.id,
    status: value.status,
    countDate: value.countDate,
    startedAt: value.startedAt,
    storeId: value.storeId,
    store: { id: value.store.id as string, name: value.store.name },
    startedBy,
    finalizedAt: finalizedAt as string | null,
    finalizedBy,
    countedProducts: Number(value.countedProducts),
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
    !isDateTime(value.savedAt)
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
    productSku: value.productSku as string | null,
    productName: value.productName,
    unit: value.unit,
    packageName: value.packageName as string | null,
    boxContent: value.boxContent,
    packagesPerBox: value.packagesPerBox as number | null,
    packageContent: value.packageContent,
    looseOnly: value.looseOnly,
    savedAt: value.savedAt,
    savedBy,
  };
}

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
    totalProducts: Number(value.totalProducts),
    pendingProducts: Number(value.pendingProducts),
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
    totalProducts: Number(value.totalProducts),
    uncountedProducts: Number(value.uncountedProducts),
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

// Cuerpos que el BFF reenvía: solo los campos del contrato.
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

// --- Números: coma o punto decimal, sin aritmética de punto flotante ---

// Cajas o paquetes: entero >= 0. null si está vacío; undefined si no es
// válido.
export function parsePiecesInput(text: string): number | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d{1,6}$/.test(value)) return undefined;
  const pieces = Number(value);
  return pieces <= MAX_PIECES ? pieces : undefined;
}

// Cantidad suelta: «2,450», «2.450» o «2» → «2.450» / «2» (texto con punto,
// como lo espera la API). En kg y L, hasta 3 decimales; en unidades, solo
// enteros sin separador («6.000» sería ambiguo). null si está vacío;
// undefined si no es válida.
export function parseLooseInput(
  text: string,
  unit: ProductUnit,
): string | null | undefined {
  const value = text.trim().replace(',', '.');
  if (value === '') return null;
  if (unit === 'UNIT')
    return /^\d{1,9}$/.test(value) ? String(Number(value)) : undefined;
  return /^\d{1,9}(\.\d{1,3})?$/.test(value) ? value : undefined;
}

// Milésimas como bigint: ni el producto de 100.000 cajas por un contenido de
// 9 dígitos pierde precisión.
export function toThousandths(decimal: string): bigint {
  const [whole, fraction = ''] = decimal.split('.');
  return (
    BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, '0').slice(0, 3))
  );
}
// Texto exacto como lo devuelve la API: «14.950» en kg y L y «54» en
// unidades (con decimales solo si los hubiera).
export function fromThousandths(value: bigint, unit: ProductUnit): string {
  const thousand = BigInt(1000);
  const whole = (value / thousand).toString();
  const fraction = (value % thousand).toString().padStart(3, '0');
  if (unit === 'UNIT' && fraction === '000') return whole;
  return `${whole}.${fraction}`;
}

export interface CountFormat {
  boxContent: string | null;
  packageContent: string | null;
  looseOnly: boolean;
  unit: ProductUnit;
}
export interface CountQuantities {
  boxes: number | null;
  packages: number | null;
  looseQuantity: string | null;
}

// Réplica de computeCountedQuantity (count-line.util.ts de la API):
// total = cajas × contenido por caja + paquetes × contenido por paquete
//         + cantidad suelta. null cuenta como 0.
export function computeCountTotal(
  format: CountFormat,
  quantities: CountQuantities,
): string {
  const boxes = format.boxContent
    ? toThousandths(format.boxContent) * BigInt(quantities.boxes ?? 0)
    : BigInt(0);
  const packages = format.packageContent
    ? toThousandths(format.packageContent) * BigInt(quantities.packages ?? 0)
    : BigInt(0);
  const loose = quantities.looseQuantity
    ? toThousandths(quantities.looseQuantity)
    : BigInt(0);
  return fromThousandths(boxes + packages + loose, format.unit);
}

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
export function formatCountQuantity(
  decimal: string,
  unit: ProductUnit,
): string {
  return `${formatCountNumber(decimal, unit)} ${UNIT_SYMBOL[unit]}`;
}
export function unitSymbol(unit: ProductUnit): string {
  return UNIT_SYMBOL[unit];
}

// --- Campos de cada producto según su formato ---

export interface CountFields {
  boxes: boolean;
  packages: boolean;
  // Etiqueta de los paquetes en plural: «Bolsas», «Botellas», «Packs».
  packagesLabel: string;
  looseLabel: string;
  looseInputMode: 'decimal' | 'numeric';
}
const capitalize = (text: string): string =>
  text.charAt(0).toLocaleUpperCase('es') + text.slice(1);

export function countFields(
  format: CountFormat & { packageName: string | null },
): CountFields {
  return {
    boxes: !format.looseOnly && format.boxContent !== null,
    packages: !format.looseOnly && format.packageContent !== null,
    packagesLabel: capitalize(packageLabel(format.packageName, 2)),
    looseLabel: `Suelto (${UNIT_SYMBOL[format.unit]})`,
    looseInputMode: format.unit === 'UNIT' ? 'numeric' : 'decimal',
  };
}

// Formato en una línea: «Caja 5 kg · bolsa 2,5 kg», «Pack 6 u.» o «Solo
// cantidad suelta (kg)».
export function countFormatLabel(
  format: CountFormat & { packageName: string | null },
): string {
  const symbol = UNIT_SYMBOL[format.unit];
  if (format.looseOnly) return `Solo cantidad suelta (${symbol})`;
  const parts: string[] = [];
  if (format.boxContent)
    parts.push(`Caja ${formatQuantity(format.boxContent)} ${symbol}`);
  if (format.packageContent)
    parts.push(
      `${packageLabel(format.packageName, 1)} ${formatQuantity(format.packageContent)} ${symbol}`,
    );
  if (parts.length === 0) return `Cantidad suelta (${symbol})`;
  const label = parts.join(' · ');
  return capitalize(label);
}

// --- Borrador de lo que escribe la supervisora ---

export interface CountDraft {
  boxes: string;
  packages: string;
  looseQuantity: string;
}
export const EMPTY_DRAFT: CountDraft = {
  boxes: '',
  packages: '',
  looseQuantity: '',
};

// Lo ya guardado, como texto editable: «2.450» → «2,450» en kg y L.
export function draftFromLine(line: CountLine | null): CountDraft {
  if (!line) return EMPTY_DRAFT;
  return {
    boxes: line.boxes === null ? '' : String(line.boxes),
    packages: line.packages === null ? '' : String(line.packages),
    looseQuantity:
      line.looseQuantity === null
        ? ''
        : line.unit === 'UNIT'
          ? line.looseQuantity
          : line.looseQuantity.replace('.', ','),
  };
}

const NOTHING_INFORMED =
  'Informa las cajas, los paquetes o la cantidad suelta (0 si no queda).';

// Valida el borrador contra el formato del producto y arma el cuerpo de la
// API: solo los campos que aplican, con la cantidad suelta como texto.
export function lineInputFromDraft(
  format: CountFormat & { packageName: string | null },
  draft: CountDraft,
):
  | { input: CountLineInput; quantities: CountQuantities }
  | { errors: CountFieldErrors } {
  const fields = countFields(format);
  const errors: CountFieldErrors = {};
  const boxes = fields.boxes ? parsePiecesInput(draft.boxes) : null;
  const packages = fields.packages ? parsePiecesInput(draft.packages) : null;
  const looseQuantity = parseLooseInput(draft.looseQuantity, format.unit);
  if (boxes === undefined)
    errors.boxes = `Usa un número entero entre 0 y ${MAX_PIECES.toLocaleString('es-CL')}.`;
  if (packages === undefined)
    errors.packages = `Usa un número entero entre 0 y ${MAX_PIECES.toLocaleString('es-CL')}.`;
  if (looseQuantity === undefined)
    errors.looseQuantity =
      format.unit === 'UNIT'
        ? 'Usa un número entero mayor o igual a 0.'
        : 'Usa un número mayor o igual a 0 con hasta 3 decimales (2,450).';
  if (Object.keys(errors).length) return { errors };
  const quantities: CountQuantities = {
    boxes: boxes ?? null,
    packages: packages ?? null,
    looseQuantity: looseQuantity ?? null,
  };
  if (
    quantities.boxes === null &&
    quantities.packages === null &&
    quantities.looseQuantity === null
  )
    return { errors: { looseQuantity: NOTHING_INFORMED } };
  const input: CountLineInput = { looseQuantity: quantities.looseQuantity };
  if (fields.boxes) input.boxes = quantities.boxes;
  if (fields.packages) input.packages = quantities.packages;
  return { input, quantities };
}

// Total que se muestra mientras se escribe; null si el borrador está vacío o
// tiene un valor inválido.
export function liveCountTotal(
  format: CountFormat & { packageName: string | null },
  draft: CountDraft,
): string | null {
  const result = lineInputFromDraft(format, draft);
  return 'errors' in result
    ? null
    : computeCountTotal(format, result.quantities);
}

// El borrador difiere de lo guardado (comparando valores, no texto: «2,45»
// es lo mismo que «2.450»).
export function isDraftDirty(
  format: CountFormat & { packageName: string | null },
  draft: CountDraft,
  line: CountLine | null,
): boolean {
  const fields = countFields(format);
  const same = (text: string, saved: number | null): boolean =>
    parsePiecesInput(text) === saved;
  const loose = parseLooseInput(draft.looseQuantity, format.unit);
  const savedLoose = line?.looseQuantity ?? null;
  const sameLoose =
    loose === undefined
      ? false
      : loose === null || savedLoose === null
        ? loose === savedLoose
        : toThousandths(loose) === toThousandths(savedLoose);
  return !(
    (!fields.boxes || same(draft.boxes, line?.boxes ?? null)) &&
    (!fields.packages || same(draft.packages, line?.packages ?? null)) &&
    sameLoose
  );
}

// Lo guardado en una línea, con su propia copia del formato: «1 caja + 3
// bolsas + 2,450 kg».
export function lineSummary(line: CountLine): string {
  const parts: string[] = [];
  if (line.boxes !== null)
    parts.push(`${line.boxes} ${line.boxes === 1 ? 'caja' : 'cajas'}`);
  if (line.packages !== null)
    parts.push(
      `${line.packages} ${packageLabel(line.packageName, line.packages)}`,
    );
  if (line.looseQuantity !== null)
    parts.push(formatCountQuantity(line.looseQuantity, line.unit));
  return parts.join(' + ');
}

// --- Secciones, avance y búsqueda ---

export interface CountSection {
  id: string;
  name: string;
  items: CountItem[];
  counted: number;
}

// Agrupa por sección en el orden que entrega la API (el de la plantilla).
// Los productos sin fila van al final, en «Sin fila en la plantilla».
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

export function countProgress(items: readonly CountItem[]): {
  counted: number;
  total: number;
  percent: number;
} {
  const counted = items.filter((item) => item.counted).length;
  const total = items.length;
  return {
    counted,
    total,
    percent: total === 0 ? 0 : Math.floor((counted * 100) / total),
  };
}

// Réplica de comparableName de la API: sin tildes, sin mayúsculas y con los
// espacios normalizados («Atún» = «atun»).
export function comparableText(text: string): string {
  return text
    .trim()
    .replace(/\s+/gu, ' ')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es');
}

export type CountItemFilter = 'all' | 'pending' | 'counted';

// Busca por nombre, nombres alternativos o SKU (también los de la copia de
// la línea), como GET /inventory-counts/:id?search.
export function filterCountItems(
  items: readonly CountItem[],
  search: string,
  filter: CountItemFilter = 'all',
): CountItem[] {
  const query = comparableText(search);
  return items.filter((item) => {
    if (filter === 'pending' && item.counted) return false;
    if (filter === 'counted' && !item.counted) return false;
    if (!query) return true;
    return [
      item.product.name,
      ...item.product.alternativeNames,
      item.product.sku ?? '',
      item.line?.productName ?? '',
      item.line?.productSku ?? '',
    ].some((text) => comparableText(text).includes(query));
  });
}

// Reemplaza el producto guardado sin perder el orden.
export function replaceCountItem(
  items: readonly CountItem[],
  saved: CountItem,
): CountItem[] {
  return items.map((item) =>
    item.product.id === saved.product.id ? saved : item,
  );
}

// --- Fechas ---

// Rango que acepta la API: de hoy hasta 7 días atrás (hora de Chile).
export function countDateRange(today: string): { min: string; max: string } {
  const date = new Date(today + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - MAX_COUNT_DATE_AGE_DAYS);
  return { min: date.toISOString().slice(0, 10), max: today };
}
export function countDateError(value: string, today: string): string | null {
  const { min, max } = countDateRange(today);
  if (!isCountDate(value)) return 'Ingresa la fecha de la toma.';
  if (value > max) return 'La fecha no puede ser posterior a hoy.';
  if (value < min)
    return `La fecha puede ser de hoy o de hasta ${MAX_COUNT_DATE_AGE_DAYS} días atrás.`;
  return null;
}

// Hora de Chile de un guardado: «21:15».
export function formatChileTime(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Santiago',
  }).format(new Date(value));
}

export function personName(person: CountPerson): string {
  return `${person.firstName} ${person.lastName}`;
}

// --- Mensajes ---

export type CountAction = 'load' | 'start' | 'save' | 'finalize';

export function inventoryCountErrorMessage(
  status: number,
  action: CountAction = 'load',
): string {
  const specific: Partial<
    Record<CountAction, Partial<Record<number, string>>>
  > = {
    start: {
      400: 'Revisa la fecha de la toma.',
      409: 'Ya hay una toma en curso en tu local.',
    },
    save: {
      400: 'Revisa las cantidades indicadas.',
      409: 'No se pudo guardar este producto.',
      503: 'No se pudo conectar con el servicio. Lo que escribiste se conserva: vuelve a intentarlo.',
    },
    finalize: {
      400: 'La toma no tiene productos contados: guarda al menos un producto antes de finalizar.',
      409: 'Esta toma ya estaba finalizada: se muestra en solo lectura.',
    },
  };
  const messages: Record<number, string> = {
    400: 'La solicitud no es válida. Actualiza la vista e intenta nuevamente.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'Solo el supervisor del local puede tomar el inventario.',
    404: 'La toma de inventario ya no existe. Actualiza la vista.',
    409: 'La toma cambió mientras trabajabas. Actualiza la vista.',
    429: 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.',
    502: 'No se pudo verificar la respuesta del servicio. Intenta nuevamente.',
    503: 'No se pudo conectar con el servicio. Intenta nuevamente.',
  };
  return specific[action]?.[status] ?? messages[status] ?? messages[502];
}
