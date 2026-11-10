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
  // SPRINT-4A-T18: MANUAL si el medio lo eligió el administrador al importar.
  resolution: 'AUTOMATIC' | 'MANUAL';
}
// Línea omitida a mano al importar (siempre en 0, SPRINT-4A-T18).
export interface SalesImportSkippedLine {
  lineNumber: number;
  originalLabel: string;
  amount: number;
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
  // SPRINT-4A-T18: cómo se identificó el local y quién resolvió a mano.
  storeResolution: 'AUTOMATIC' | 'MANUAL';
  resolvedBy: SalesImportRef | null;
}
export interface SalesImportDetail extends SalesImportSummary {
  lines: SalesImportLine[];
  skippedLines: SalesImportSkippedLine[];
  versions: SalesImportVersion[];
}
export interface SalesImportIssue {
  code: string;
  message: string;
  // Solo en PAYMENT_METHOD_NOT_CONFIGURED: la línea sin alias.
  lineNumber: number | null;
}
// Opciones de la resolución manual de una vista previa UNRESOLVED
// (SPRINT-4A-T18): locales activos con su vigente y medios del catálogo.
export interface SalesImportStoreOption {
  id: string;
  name: string;
  subwayStoreId: string | null;
  activeImport: SalesImportVersion | null;
}
export interface SalesImportResolutionOptions {
  stores: SalesImportStoreOption[];
  paymentMethods: SalesImportMethod[];
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
  subwayStoreId: string | null;
  store: SalesImportRef | null;
  totalAmount: number;
  lines: SalesImportLine[];
  import: SalesImportDetail | null;
  activeImport: SalesImportVersion | null;
  resolutionOptions: SalesImportResolutionOptions | null;
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
// Contratos anteriores a SPRINT-4A-T18 no traen la resolución: AUTOMATIC.
const resolutionOf = (value: unknown): 'AUTOMATIC' | 'MANUAL' | null =>
  value === undefined || value === 'AUTOMATIC'
    ? 'AUTOMATIC'
    : value === 'MANUAL'
      ? 'MANUAL'
      : null;
const subwayId = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && /^\d{1,10}$/.test(value));

function parseRef(value: unknown): SalesImportRef | null {
  return isRecord(value) && isUuid(value.id) && text(value.name)
    ? { id: value.id, name: value.name }
    : null;
}
function parseMethod(method: unknown): SalesImportMethod | null {
  return isRecord(method) &&
    isUuid(method.id) &&
    text(method.code) &&
    text(method.name)
    ? { id: method.id, code: method.code, name: method.name }
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
  const resolution = resolutionOf(value.resolution);
  const paymentMethod =
    value.paymentMethod === null ? null : parseMethod(value.paymentMethod);
  if (!resolution || (value.paymentMethod !== null && !paymentMethod))
    return null;
  return {
    lineNumber: value.lineNumber,
    originalLabel: value.originalLabel,
    amount: value.amount,
    percentage: value.percentage,
    paymentMethod,
    resolution,
  };
}
function parseSkippedLines(value: unknown): SalesImportSkippedLine[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const lines: SalesImportSkippedLine[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !integer(item.lineNumber) ||
      !text(item.originalLabel) ||
      !integer(item.amount)
    )
      return null;
    lines.push({
      lineNumber: item.lineNumber,
      originalLabel: item.originalLabel,
      amount: item.amount,
    });
  }
  return lines;
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
  const storeResolution = resolutionOf(value.storeResolution);
  const resolvedBy =
    value.resolvedBy === null || value.resolvedBy === undefined
      ? null
      : parseRef(value.resolvedBy);
  if (
    !store ||
    !uploadedBy ||
    (value.confirmedBy !== null && !confirmedBy) ||
    !storeResolution ||
    (value.resolvedBy !== null && value.resolvedBy !== undefined && !resolvedBy)
  )
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
    storeResolution,
    resolvedBy,
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
  const skippedLines = parseSkippedLines(value.skippedLines);
  const versions = value.versions.map(parseSalesImportVersion);
  if (
    !lines ||
    !skippedLines ||
    !versions.every((item): item is SalesImportVersion => item !== null)
  )
    return null;
  return { ...summary, lines, skippedLines, versions };
}
function parseResolutionOptions(
  value: unknown,
): SalesImportResolutionOptions | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.stores) ||
    !Array.isArray(value.paymentMethods)
  )
    return null;
  const stores: SalesImportStoreOption[] = [];
  for (const item of value.stores) {
    const ref = parseRef(item);
    if (!ref || !isRecord(item) || !subwayId(item.subwayStoreId)) return null;
    const activeImport =
      item.activeImport === null
        ? null
        : parseSalesImportVersion(item.activeImport);
    if (item.activeImport !== null && !activeImport) return null;
    stores.push({ ...ref, subwayStoreId: item.subwayStoreId, activeImport });
  }
  const paymentMethods = value.paymentMethods.map(parseMethod);
  if (!paymentMethods.every((item): item is SalesImportMethod => item !== null))
    return null;
  return { stores, paymentMethods };
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
    issues.push({
      code: issue.code,
      message: issue.message,
      lineNumber: integer(issue.lineNumber) ? issue.lineNumber : null,
    });
  }
  const subwayStoreId =
    value.subwayStoreId === undefined ? null : value.subwayStoreId;
  const resolutionOptions =
    value.resolutionOptions === null || value.resolutionOptions === undefined
      ? null
      : parseResolutionOptions(value.resolutionOptions);
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
    !subwayId(subwayStoreId) ||
    (value.store !== null && !store) ||
    (value.import !== null && !saved) ||
    (value.activeImport !== null && !activeImport) ||
    (value.resolutionOptions !== null &&
      value.resolutionOptions !== undefined &&
      !resolutionOptions)
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
    subwayStoreId,
    store,
    totalAmount: value.totalAmount,
    lines,
    import: saved,
    activeImport,
    resolutionOptions,
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

// Resolución manual de lo que la vista previa no identificó (SPRINT-4A-T18).
// Nada se adivina: el administrador elige el local y el medio de cada línea
// sin alias (o la omite si su monto es 0). «Recordar» viene marcado por
// defecto y solo se envía cuando es posible.
export const SKIP_LINE = 'SKIP';
const MAX_RESOLUTION_LINES = 50;

export interface LineChoice {
  // ID del medio elegido, SKIP_LINE o '' si falta elegir.
  choice: string;
  remember: boolean;
}
export interface ResolutionChoices {
  storeId: string;
  rememberStore: boolean;
  lines: Record<number, LineChoice>;
}
export interface SalesImportResolutionInput {
  expectedActiveImportId: string | null;
  store: { storeId: string; remember: boolean } | null;
  lines: {
    lineNumber: number;
    action: 'ASSIGN' | 'SKIP';
    paymentMethodId: string | null;
    remember: boolean;
  }[];
}

// La vista previa admite resolución manual: UNRESOLVED con opciones.
export function isResolvable(preview: SalesImportPreview): boolean {
  return preview.outcome === 'UNRESOLVED' && preview.resolutionOptions !== null;
}
export function pendingLines(preview: SalesImportPreview): SalesImportLine[] {
  return preview.lines.filter((line) => line.paymentMethod === null);
}
export function initialChoices(preview: SalesImportPreview): ResolutionChoices {
  const lines: Record<number, LineChoice> = {};
  for (const line of pendingLines(preview))
    lines[line.lineNumber] = { choice: '', remember: true };
  return { storeId: '', rememberStore: true, lines };
}
export function chosenStore(
  preview: SalesImportPreview,
  choices: ResolutionChoices,
): SalesImportStoreOption | null {
  return (
    preview.resolutionOptions?.stores.find(
      (store) => store.id === choices.storeId,
    ) ?? null
  );
}
// Motivo por el que no se puede recordar el local, o null si se puede: el
// archivo debe traer un ID Subway libre y el local elegido no tener uno.
export function storeRememberBlock(
  preview: SalesImportPreview,
  store: SalesImportStoreOption | null,
): string | null {
  if (preview.subwayStoreId === null)
    return 'El archivo no trae un ID Subway, así que no hay nada que recordar.';
  if (preview.issues.some((issue) => issue.code === 'STORE_INACTIVE'))
    return `El ID Subway ${preview.subwayStoreId} pertenece a un local inactivo: no se puede asignar a otro.`;
  if (store?.subwayStoreId)
    return `${store.name} ya tiene el ID Subway ${store.subwayStoreId}; no se sobrescribe.`;
  return null;
}
// Vigente que se reemplazaría: la del local identificado o la del elegido.
export function effectiveActiveImport(
  preview: SalesImportPreview,
  choices: ResolutionChoices,
): SalesImportVersion | null {
  return preview.store === null
    ? (chosenStore(preview, choices)?.activeImport ?? null)
    : preview.activeImport;
}
// Líneas con el medio elegido a mano (las omitidas quedan fuera) para la
// tabla y el total; el total sigue siendo la suma de las líneas.
export function resolvedPreviewLines(
  preview: SalesImportPreview,
  choices: ResolutionChoices,
): { lines: SalesImportLine[]; skipped: SalesImportLine[] } {
  const methods = new Map(
    (preview.resolutionOptions?.paymentMethods ?? []).map((method) => [
      method.id,
      method,
    ]),
  );
  const lines: SalesImportLine[] = [];
  const skipped: SalesImportLine[] = [];
  for (const line of preview.lines) {
    if (line.paymentMethod) {
      lines.push(line);
      continue;
    }
    const choice = choices.lines[line.lineNumber]?.choice ?? '';
    if (choice === SKIP_LINE) skipped.push(line);
    else
      lines.push({
        ...line,
        paymentMethod: methods.get(choice) ?? null,
        resolution: methods.has(choice) ? 'MANUAL' : line.resolution,
      });
  }
  return { lines, skipped };
}
// Cuerpo de la confirmación con resolución, o null si falta algo por elegir.
export function buildResolution(
  preview: SalesImportPreview,
  choices: ResolutionChoices,
): SalesImportResolutionInput | null {
  if (!isResolvable(preview)) return null;
  let store: SalesImportResolutionInput['store'] = null;
  if (preview.store === null) {
    const option = chosenStore(preview, choices);
    if (!option) return null;
    store = {
      storeId: option.id,
      remember:
        choices.rememberStore && storeRememberBlock(preview, option) === null,
    };
  }
  const methods = new Set(
    (preview.resolutionOptions?.paymentMethods ?? []).map(
      (method) => method.id,
    ),
  );
  const lines: SalesImportResolutionInput['lines'] = [];
  for (const line of pendingLines(preview)) {
    const selected = choices.lines[line.lineNumber];
    if (!selected) return null;
    if (selected.choice === SKIP_LINE) {
      if (line.amount !== 0) return null;
      lines.push({
        lineNumber: line.lineNumber,
        action: 'SKIP',
        paymentMethodId: null,
        remember: false,
      });
    } else if (methods.has(selected.choice)) {
      lines.push({
        lineNumber: line.lineNumber,
        action: 'ASSIGN',
        paymentMethodId: selected.choice,
        remember: selected.remember,
      });
    } else return null;
  }
  // Al menos una línea debe quedar asociada a un medio (no se omite todo).
  const assigned =
    preview.lines.length -
    lines.filter((line) => line.action === 'SKIP').length;
  if (assigned === 0) return null;
  return {
    expectedActiveImportId: effectiveActiveImport(preview, choices)?.id ?? null,
    store,
    lines,
  };
}
// Validación estricta del BFF: solo reenvía el contrato de la resolución.
export function parseResolutionBody(
  value: unknown,
): SalesImportResolutionInput | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !['expectedActiveImportId', 'store', 'lines'].includes(key),
    ) ||
    !(
      value.expectedActiveImportId === null ||
      isUuid(value.expectedActiveImportId)
    ) ||
    !Array.isArray(value.lines) ||
    value.lines.length > MAX_RESOLUTION_LINES
  )
    return null;
  let store: SalesImportResolutionInput['store'] = null;
  if (value.store !== undefined && value.store !== null) {
    const raw = value.store;
    if (
      !isRecord(raw) ||
      Object.keys(raw).length !== 2 ||
      !isUuid(raw.storeId) ||
      typeof raw.remember !== 'boolean'
    )
      return null;
    store = { storeId: raw.storeId, remember: raw.remember };
  }
  const lines: SalesImportResolutionInput['lines'] = [];
  for (const raw of value.lines) {
    if (
      !isRecord(raw) ||
      Object.keys(raw).some(
        (key) =>
          !['lineNumber', 'action', 'paymentMethodId', 'remember'].includes(
            key,
          ),
      ) ||
      !integer(raw.lineNumber) ||
      raw.lineNumber < 1 ||
      typeof raw.remember !== 'boolean'
    )
      return null;
    const methodId = raw.paymentMethodId ?? null;
    if (raw.action === 'ASSIGN' && isUuid(methodId))
      lines.push({
        lineNumber: raw.lineNumber,
        action: 'ASSIGN',
        paymentMethodId: methodId,
        remember: raw.remember,
      });
    else if (raw.action === 'SKIP' && methodId === null && !raw.remember)
      lines.push({
        lineNumber: raw.lineNumber,
        action: 'SKIP',
        paymentMethodId: null,
        remember: false,
      });
    else return null;
  }
  return {
    expectedActiveImportId: value.expectedActiveImportId,
    store,
    lines,
  };
}

// Errores de la confirmación con resolución: el 400 ya no es del archivo
// sino de lo elegido; nunca se muestra el texto del servidor.
export function resolvedConfirmError(status: number): string {
  if (status === 400)
    return 'No se pudo confirmar con los datos elegidos. Vuelve a subir el archivo y revisa el local y los medios de pago.';
  if (status === 409)
    return 'Los datos cambiaron mientras confirmabas (otra versión vigente o una equivalencia nueva). Vuelve a subir el archivo para revisarlos.';
  return salesImportError(status);
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
