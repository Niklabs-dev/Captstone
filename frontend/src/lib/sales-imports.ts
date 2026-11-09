import { isRecord } from './auth';
import { isTipDate } from './tips';
import { isUuid } from './users';

// Importación diaria de ventas MrComanda (SPRINT-4R-T11): contrato de la API
// de SPRINT-4R-T10. Funciones puras, compartidas por el BFF y la vista.
export const MAX_SALES_FILE_BYTES = 5 * 1024 * 1024;
export const SALES_FILE_ACCEPT =
  '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type SalesImportStatus = 'PENDING' | 'ACTIVE' | 'SUPERSEDED';
export type SalesImportOutcome = 'CREATED' | 'EXISTING' | 'UNRESOLVED';

export const SALES_IMPORT_STATUS: Record<SalesImportStatus, string> = {
  PENDING: 'Pendiente',
  ACTIVE: 'Vigente',
  SUPERSEDED: 'Reemplazada',
};

export interface SalesImportRef {
  id: string;
  name: string;
}
export interface SalesImportMethod {
  id: string;
  code: string;
  name: string;
}
export interface SalesImportLine {
  lineNumber: number;
  originalLabel: string;
  amount: number;
  percentage: number | null;
  paymentMethod: SalesImportMethod | null;
}
export interface SalesImportVersion {
  id: string;
  version: number;
  status: SalesImportStatus;
  createdAt: string;
  confirmedAt: string | null;
  supersededAt: string | null;
}
export interface SalesImportSummary {
  id: string;
  status: SalesImportStatus;
  version: number;
  store: SalesImportRef;
  businessDate: string;
  issuedAt: string | null;
  totalAmount: number;
  fileName: string;
  sizeBytes: number;
  uploadedBy: SalesImportRef;
  createdAt: string;
  confirmedBy: SalesImportRef | null;
  confirmedAt: string | null;
}
export interface SalesImportDetail extends SalesImportSummary {
  lines: SalesImportLine[];
  versions: SalesImportVersion[];
}
export interface SalesImportIssue {
  code: string;
  message: string;
}
export interface SalesImportPreview {
  outcome: SalesImportOutcome;
  canConfirm: boolean;
  issues: SalesImportIssue[];
  businessDate: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string | null;
  externalStoreCode: string;
  store: SalesImportRef | null;
  totalAmount: number;
  lines: SalesImportLine[];
  import: SalesImportDetail | null;
  activeImport: SalesImportVersion | null;
}

const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const instant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalInstant = (value: unknown): value is string | null =>
  value === null || instant(value);
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
const status = (value: unknown): value is SalesImportStatus =>
  value === 'PENDING' || value === 'ACTIVE' || value === 'SUPERSEDED';

function parseRef(value: unknown): SalesImportRef | null {
  return isRecord(value) && isUuid(value.id) && text(value.name)
    ? { id: value.id, name: value.name }
    : null;
}
function parseLine(value: unknown): SalesImportLine | null {
  if (
    !isRecord(value) ||
    !integer(value.lineNumber) ||
    !text(value.originalLabel) ||
    !integer(value.amount) ||
    !(value.percentage === null || typeof value.percentage === 'number')
  )
    return null;
  let paymentMethod: SalesImportMethod | null = null;
  if (value.paymentMethod !== null) {
    const method = value.paymentMethod;
    if (
      !isRecord(method) ||
      !isUuid(method.id) ||
      !text(method.code) ||
      !text(method.name)
    )
      return null;
    paymentMethod = { id: method.id, code: method.code, name: method.name };
  }
  return {
    lineNumber: value.lineNumber,
    originalLabel: value.originalLabel,
    amount: value.amount,
    percentage: value.percentage,
    paymentMethod,
  };
}
function parseLines(value: unknown): SalesImportLine[] | null {
  if (!Array.isArray(value)) return null;
  const lines = value.map(parseLine);
  return lines.every((line): line is SalesImportLine => line !== null)
    ? lines
    : null;
}
export function parseSalesImportVersion(
  value: unknown,
): SalesImportVersion | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !integer(value.version) ||
    !status(value.status) ||
    !instant(value.createdAt) ||
    !optionalInstant(value.confirmedAt) ||
    !optionalInstant(value.supersededAt)
  )
    return null;
  return {
    id: value.id,
    version: value.version,
    status: value.status,
    createdAt: value.createdAt,
    confirmedAt: value.confirmedAt,
    supersededAt: value.supersededAt,
  };
}
export function parseSalesImportSummary(
  value: unknown,
): SalesImportSummary | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !status(value.status) ||
    !integer(value.version) ||
    !isTipDate(value.businessDate) ||
    !optionalInstant(value.issuedAt) ||
    !integer(value.totalAmount) ||
    !text(value.fileName) ||
    !integer(value.sizeBytes) ||
    !instant(value.createdAt) ||
    !optionalInstant(value.confirmedAt)
  )
    return null;
  const store = parseRef(value.store);
  const uploadedBy = parseRef(value.uploadedBy);
  const confirmedBy =
    value.confirmedBy === null ? null : parseRef(value.confirmedBy);
  if (!store || !uploadedBy || (value.confirmedBy !== null && !confirmedBy))
    return null;
  return {
    id: value.id,
    status: value.status,
    version: value.version,
    store,
    businessDate: value.businessDate,
    issuedAt: value.issuedAt,
    totalAmount: value.totalAmount,
    fileName: value.fileName,
    sizeBytes: value.sizeBytes,
    uploadedBy,
    createdAt: value.createdAt,
    confirmedBy,
    confirmedAt: value.confirmedAt,
  };
}
export function parseSalesImportList(
  value: unknown,
): SalesImportSummary[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.map(parseSalesImportSummary);
  return list.every((item): item is SalesImportSummary => item !== null)
    ? list
    : null;
}
export function parseSalesImportDetail(
  value: unknown,
): SalesImportDetail | null {
  const summary = parseSalesImportSummary(value);
  if (!summary || !isRecord(value) || !Array.isArray(value.versions))
    return null;
  const lines = parseLines(value.lines);
  const versions = value.versions.map(parseSalesImportVersion);
  if (
    !lines ||
    !versions.every((item): item is SalesImportVersion => item !== null)
  )
    return null;
  return { ...summary, lines, versions };
}
export function parseSalesImportPreview(
  value: unknown,
): SalesImportPreview | null {
  if (
    !isRecord(value) ||
    !['CREATED', 'EXISTING', 'UNRESOLVED'].includes(String(value.outcome)) ||
    typeof value.canConfirm !== 'boolean' ||
    !Array.isArray(value.issues) ||
    !isTipDate(value.businessDate) ||
    !instant(value.periodStart) ||
    !instant(value.periodEnd) ||
    !optionalInstant(value.issuedAt) ||
    !text(value.externalStoreCode) ||
    !integer(value.totalAmount)
  )
    return null;
  const issues: SalesImportIssue[] = [];
  for (const issue of value.issues) {
    if (!isRecord(issue) || !text(issue.code) || !text(issue.message))
      return null;
    issues.push({ code: issue.code, message: issue.message });
  }
  const store = value.store === null ? null : parseRef(value.store);
  const lines = parseLines(value.lines);
  const saved =
    value.import === null ? null : parseSalesImportDetail(value.import);
  const activeImport =
    value.activeImport === null
      ? null
      : parseSalesImportVersion(value.activeImport);
  if (
    !lines ||
    (value.store !== null && !store) ||
    (value.import !== null && !saved) ||
    (value.activeImport !== null && !activeImport)
  )
    return null;
  return {
    outcome: value.outcome as SalesImportOutcome,
    canConfirm: value.canConfirm,
    issues,
    businessDate: value.businessDate,
    periodStart: value.periodStart,
    periodEnd: value.periodEnd,
    issuedAt: value.issuedAt,
    externalStoreCode: value.externalStoreCode,
    store,
    totalAmount: value.totalAmount,
    lines,
    import: saved,
    activeImport,
  };
}

// Solo acepta el cuerpo acotado de la confirmación: UUID de la vigente o null.
export function parseConfirmBody(
  value: unknown,
): { expectedActiveImportId: string | null } | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !(
      value.expectedActiveImportId === null ||
      isUuid(value.expectedActiveImportId)
    )
  )
    return null;
  return { expectedActiveImportId: value.expectedActiveImportId };
}

export function salesFileError(file: {
  name: string;
  size: number;
}): string | null {
  if (!/\.xlsx$/i.test(file.name))
    return 'Selecciona el Excel de MrComanda en formato .xlsx.';
  if (file.size === 0) return 'El archivo está vacío. Vuelve a exportarlo.';
  if (file.size > MAX_SALES_FILE_BYTES)
    return 'El archivo supera el máximo de 5 MB.';
  return null;
}

// Fecha escrita en el nombre del archivo (DD-MM-AAAA o AAAA-MM-DD, con guion,
// guion bajo o punto), o null si no trae una fecha válida.
export function fileNameDate(fileName: string): string | null {
  const dayFirst = /(?<!\d)(\d{2})[-_.](\d{2})[-_.](\d{4})(?!\d)/.exec(
    fileName,
  );
  const candidate = dayFirst
    ? `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}`
    : /(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)/
        .exec(fileName)
        ?.slice(1)
        .join('-');
  return candidate && isTipDate(candidate) ? candidate : null;
}
export function fileDateDiffers(
  fileName: string,
  businessDate: string,
): boolean {
  const date = fileNameDate(fileName);
  return date !== null && date !== businessDate;
}

export interface SalesImportDifference {
  key: string;
  name: string;
  previous: number;
  next: number;
  delta: number;
}
function lineKey(line: SalesImportLine): string {
  return line.paymentMethod?.code ?? line.originalLabel;
}
function lineName(line: SalesImportLine): string {
  return line.paymentMethod?.name ?? line.originalLabel;
}
// Diferencias de una corrección contra la versión vigente, por medio de pago.
// Solo devuelve los medios que cambian, incluidos los que aparecen o salen.
export function salesImportDifferences(
  previous: readonly SalesImportLine[],
  next: readonly SalesImportLine[],
): SalesImportDifference[] {
  const rows = new Map<string, SalesImportDifference>();
  const entry = (line: SalesImportLine): SalesImportDifference => {
    const key = lineKey(line);
    const current = rows.get(key) ?? {
      key,
      name: lineName(line),
      previous: 0,
      next: 0,
      delta: 0,
    };
    rows.set(key, current);
    return current;
  };
  for (const line of previous) entry(line).previous += line.amount;
  for (const line of next) entry(line).next += line.amount;
  return [...rows.values()]
    .map((row) => ({ ...row, delta: row.next - row.previous }))
    .filter((row) => row.delta !== 0);
}

// Códigos del parser cuyo mensaje explica qué revisar (SPRINT-4R-T09). Solo
// se reenvían estos: nunca un texto arbitrario del servidor.
const REPORT_ERROR_CODES: ReadonlySet<string> = new Set([
  'FILE_EMPTY',
  'FILE_TOO_LARGE',
  'FILE_XLS_NOT_SUPPORTED',
  'FILE_NOT_XLSX',
  'FILE_CORRUPT',
  'REPORT_NOT_FOUND',
  'MULTIPLE_REPORTS',
  'PAYMENTS_SECTION_AMBIGUOUS',
  'PERIOD_MISSING',
  'PERIOD_AMBIGUOUS',
  'PERIOD_INVALID',
  'PERIOD_MULTIPLE_DAYS',
  'PERIOD_INCONSISTENT',
  'SCHEDULE_MISSING',
  'SCHEDULE_AMBIGUOUS',
  'SCHEDULE_INVALID',
  'STORE_MISSING',
  'STORE_AMBIGUOUS',
  'STORE_COMBINED',
  'STORE_INVALID',
  'ISSUED_AT_AMBIGUOUS',
  'ISSUED_AT_INVALID',
  'PAYMENTS_TOTAL_INVALID',
  'PAYMENT_LINES_MISSING',
  'LINE_LABEL_INVALID',
  'LINE_AMOUNT_INVALID',
  'LINE_PERCENTAGE_INVALID',
  'LINE_DUPLICATED',
  'TOTAL_MISMATCH',
]);
export function reportErrorMessage(value: unknown): string | null {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    !REPORT_ERROR_CODES.has(value.code) ||
    !text(value.message) ||
    value.message.length > 400
  )
    return null;
  return value.message;
}

// El 409 de la carga no es de versiones: cambió una equivalencia mientras se
// procesaba el archivo y todavía no existe una vista previa.
export const SALES_PREVIEW_CONFLICT =
  'Una equivalencia de local o medio de pago cambió durante la carga. Vuelve a subir el archivo.';

// Las cargas más recientes: la API ordena por fecha de negocio y una corrección
// de un día antiguo debe aparecer igual al comienzo del historial.
export function latestSalesImports<T extends { createdAt: string }>(
  items: readonly T[],
  limit = 20,
): T[] {
  return [...items]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

export function salesImportError(status: number): string {
  const messages: Record<number, string> = {
    400: 'Revisa el archivo seleccionado antes de continuar.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'Solo el administrador puede usar la importación de ventas.',
    404: 'La importación ya no está disponible. Actualiza el listado.',
    409: 'La versión vigente cambió desde la vista previa. Vuelve a subir el archivo para revisar las diferencias.',
    413: 'El archivo supera el tamaño permitido.',
    415: 'El archivo debe ser un Excel .xlsx exportado desde MrComanda.',
    422: 'El archivo no es un Informe de Ventas Diario válido. Revísalo y vuelve a exportarlo.',
    429: 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.',
    502: 'No se pudo verificar la respuesta del servicio. Intenta nuevamente.',
    503: 'No se pudo conectar con el servicio. Conservamos tu archivo para reintentar.',
  };
  return messages[status] ?? messages[502];
}
