import {
  MAX_PIECES,
  formatCountQuantity,
  isCountDate,
  unitSymbol,
  type CountFieldErrors,
  type CountItem,
  type CountLine,
  type CountLineInput,
} from './inventory-count-contract';
import { formatQuantity, packageLabel, type ProductUnit } from './products';

// Toma de inventario del supervisor (SPRINT-5-T07): reglas de la vista
// (parseo de coma o punto, total en vivo, campos según el formato, borrador,
// avance, búsqueda, fechas y mensajes). El contrato de la API, las etiquetas
// de estado y el formato de cantidades están en inventory-count-contract.ts
// (SPRINT-5-T17), compartido con la revisión del administrador.

/** Días hacia atrás que admite la fecha (MAX_COUNT_DATE_AGE_DAYS de la API). */
export const MAX_COUNT_DATE_AGE_DAYS = 7;

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
    looseLabel: `Suelto (${unitSymbol(format.unit)})`,
    looseInputMode: format.unit === 'UNIT' ? 'numeric' : 'decimal',
  };
}

// Formato en una línea: «Caja 5 kg · bolsa 2,5 kg», «Pack 6 u.» o «Solo
// cantidad suelta (kg)».
export function countFormatLabel(
  format: CountFormat & { packageName: string | null },
): string {
  const symbol = unitSymbol(format.unit);
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

// --- Avance y búsqueda ---

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
