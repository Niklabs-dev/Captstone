import {
  COUNT_STATUS_LABELS,
  formatCountQuantity,
  personName,
  type CountItem,
  type InventoryCountStatus,
  type InventoryCountSummary,
} from './inventory-count-contract';
import { packageLabel } from './products';
import { isUuid } from './users';

// Revisión y descarga de las tomas de inventario para el administrador
// (SPRINT-5-T09): filtros del listado, celdas del detalle, nombre del Excel
// de SPRINT-5-T08 y mensajes. El contrato de la API, las etiquetas de estado
// y el formato de cantidades están en inventory-count-contract.ts
// (SPRINT-5-T17), compartido con la toma del supervisor. Funciones puras,
// compartidas por las páginas, el BFF y la descarga.

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

// Fecha calendario real de un filtro, con la misma regla que
// parseCalendarDate de la API (Date.UTC y comparación por partes): rechaza
// 2026-02-30 y también los años 0000 a 0099, sin consultar la API.
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
    return invalid(
      `El estado debe ser «${COUNT_STATUS_LABELS.OPEN}» o «${COUNT_STATUS_LABELS.CONFIRMED}».`,
    );
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

// Celdas de una fila del detalle: «—» cuando no se informó.
export interface CountLineCells {
  name: string;
  sku: string | null;
  boxes: string;
  packages: string;
  loose: string;
  total: string;
}
export function countLineCells(item: CountItem): CountLineCells {
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
