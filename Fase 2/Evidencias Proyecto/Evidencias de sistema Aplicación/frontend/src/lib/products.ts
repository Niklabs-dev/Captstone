import { isRecord } from './auth';
import { isUuid } from './users';

// Administración de productos de inventario (SPRINT-5-T04): contrato de la
// API de SPRINT-5-T03 y reglas de presentación del formato y del listado.
// Funciones puras, compartidas por el BFF y la vista.

export const PRODUCT_UNITS = ['KG', 'L', 'UNIT'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];
export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  KG: 'Kilos (kg)',
  L: 'Litros (L)',
  UNIT: 'Unidades',
};
const UNIT_SYMBOL: Record<ProductUnit, string> = {
  KG: 'kg',
  L: 'L',
  UNIT: 'u.',
};

// Nombres de paquete que acepta la API, con su plural.
export const PACKAGE_NAMES = ['bolsa', 'paquete', 'botella', 'pack'] as const;
export type PackageName = (typeof PACKAGE_NAMES)[number];
const PACKAGE_PLURALS: Record<PackageName, string> = {
  bolsa: 'bolsas',
  paquete: 'paquetes',
  botella: 'botellas',
  pack: 'packs',
};

export const PRODUCT_FIELDS = [
  'name',
  'section',
  'templateRowId',
  'unit',
  'sku',
  'alternativeNames',
  'packageName',
  'packagesPerBox',
  'packageContent',
  'boxContent',
  'looseOnly',
] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];
export type ProductFieldErrors = Partial<Record<ProductField, string>>;
// Al editar no se cambian la sección ni la fila: se mueve aparte.
const CREATE_ONLY_FIELDS: readonly ProductField[] = [
  'section',
  'templateRowId',
];

export interface Product {
  id: string;
  sku: string | null;
  name: string;
  alternativeNames: string[];
  unit: ProductUnit;
  packageName: string | null;
  packagesPerBox: number | null;
  packageContent: string | null;
  boxContent: string | null;
  looseOnly: boolean;
  hasFormat: boolean;
  isActive: boolean;
  templateRowId: string | null;
  section: string | null;
  templatePosition: number | null;
}
export interface ProductSection {
  name: string;
  position: number;
  freeRows: number;
}
export type TemplateRowKind = 'ITEM' | 'BLANK' | 'SECTION';
export interface TemplateRowSummary {
  id: string;
  position: number;
  kind: TemplateRowKind;
  printedText: string | null;
  section: string;
  isEmptyRow: boolean;
}
export interface TemplateRow extends TemplateRowSummary {
  product: Product | null;
}
export interface PlacementSuggestion {
  row: TemplateRowSummary | null;
  reason: 'MATCH' | 'EMPTY' | null;
}
// Cuerpo que acepta la API: contenidos como texto decimal con punto.
export interface ProductInput {
  name: string;
  section: string;
  templateRowId?: string;
  unit: ProductUnit;
  sku: string | null;
  alternativeNames: string[];
  packageName: PackageName | null;
  packagesPerBox: number | null;
  packageContent: string | null;
  boxContent: string | null;
  looseOnly: boolean;
}
export type ProductUpdate = Omit<ProductInput, 'section' | 'templateRowId'>;

const API_DECIMAL = /^\d{1,9}(\.\d{1,3})?$/;
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export const isUnit = (value: unknown): value is ProductUnit =>
  typeof value === 'string' &&
  (PRODUCT_UNITS as readonly string[]).includes(value);
export const isPackageName = (value: unknown): value is PackageName =>
  typeof value === 'string' &&
  (PACKAGE_NAMES as readonly string[]).includes(value);
const isDecimal = (value: unknown): value is string =>
  typeof value === 'string' && API_DECIMAL.test(value);
const optional = <T>(value: unknown, check: (v: unknown) => v is T) =>
  value === null || check(value);
const isKind = (value: unknown): value is TemplateRowKind =>
  value === 'ITEM' || value === 'BLANK' || value === 'SECTION';

export function parseProduct(value: unknown): Product | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !optional(value.sku, (v): v is string => isText(v, 40)) ||
    !isText(value.name, 120) ||
    !Array.isArray(value.alternativeNames) ||
    !value.alternativeNames.every((name) => isText(name, 120)) ||
    !isUnit(value.unit) ||
    !optional(value.packageName, (v): v is string => isText(v, 30)) ||
    !(
      value.packagesPerBox === null ||
      (Number.isSafeInteger(value.packagesPerBox) &&
        Number(value.packagesPerBox) >= 1)
    ) ||
    !optional(value.packageContent, isDecimal) ||
    !optional(value.boxContent, isDecimal) ||
    typeof value.looseOnly !== 'boolean' ||
    typeof value.hasFormat !== 'boolean' ||
    typeof value.isActive !== 'boolean' ||
    !optional(value.templateRowId, isUuid) ||
    !optional(value.section, (v): v is string => isText(v, 120)) ||
    !(
      value.templatePosition === null ||
      Number.isSafeInteger(value.templatePosition)
    )
  )
    return null;
  return {
    id: value.id,
    sku: value.sku as string | null,
    name: value.name,
    alternativeNames: value.alternativeNames as string[],
    unit: value.unit,
    packageName: value.packageName as string | null,
    packagesPerBox: value.packagesPerBox as number | null,
    packageContent: value.packageContent as string | null,
    boxContent: value.boxContent as string | null,
    looseOnly: value.looseOnly,
    hasFormat: value.hasFormat,
    isActive: value.isActive,
    templateRowId: value.templateRowId as string | null,
    section: value.section as string | null,
    templatePosition: value.templatePosition as number | null,
  };
}
function list<T>(
  value: unknown,
  parse: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(parse);
  return items.every((item): item is T => item !== null) ? items : null;
}
export function parseProducts(value: unknown): Product[] | null {
  return list(value, parseProduct);
}
export function parseSections(value: unknown): ProductSection[] | null {
  return list(value, (item) =>
    isRecord(item) &&
    isText(item.name, 120) &&
    Number.isSafeInteger(item.position) &&
    Number.isSafeInteger(item.freeRows) &&
    Number(item.freeRows) >= 0
      ? {
          name: item.name,
          position: Number(item.position),
          freeRows: Number(item.freeRows),
        }
      : null,
  );
}
function parseRowSummary(value: unknown): TemplateRowSummary | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !Number.isSafeInteger(value.position) ||
    !isKind(value.kind) ||
    !optional(value.printedText, (v): v is string => isText(v, 120)) ||
    !isText(value.section, 120) ||
    typeof value.isEmptyRow !== 'boolean'
  )
    return null;
  return {
    id: value.id,
    position: Number(value.position),
    kind: value.kind,
    printedText: value.printedText as string | null,
    section: value.section,
    isEmptyRow: value.isEmptyRow,
  };
}
export function parseTemplateRows(value: unknown): TemplateRow[] | null {
  return list(value, (item) => {
    const row = parseRowSummary(item);
    if (!row || !isRecord(item)) return null;
    if (item.product === null) return { ...row, product: null };
    const product = parseProduct(item.product);
    return product ? { ...row, product } : null;
  });
}
export function parseSuggestion(value: unknown): PlacementSuggestion | null {
  if (!isRecord(value)) return null;
  if (value.row === null && value.reason === null)
    return { row: null, reason: null };
  const row = parseRowSummary(value.row);
  return row && (value.reason === 'MATCH' || value.reason === 'EMPTY')
    ? { row, reason: value.reason }
    : null;
}

// Valida el cuerpo que el BFF reenvía: solo campos del contrato. Al editar
// no se aceptan la sección ni la fila.
export function parseProductInput(
  value: unknown,
  partial: boolean,
): Partial<ProductInput> | null {
  if (!isRecord(value)) return null;
  const allowed = PRODUCT_FIELDS.filter(
    (field) => !partial || !CREATE_ONLY_FIELDS.includes(field),
  );
  if (
    Object.keys(value).some(
      (key) => !(allowed as readonly string[]).includes(key),
    )
  )
    return null;
  const checks: Record<ProductField, (v: unknown) => boolean> = {
    name: (v) => isText(v, 120),
    section: (v) => isText(v, 120),
    templateRowId: isUuid,
    unit: isUnit,
    sku: (v) => v === null || isText(v, 40),
    alternativeNames: (v) =>
      Array.isArray(v) && v.length <= 10 && v.every((n) => isText(n, 120)),
    packageName: (v) => v === null || isPackageName(v),
    packagesPerBox: (v) =>
      v === null || (Number.isSafeInteger(v) && Number(v) >= 1),
    packageContent: (v) => v === null || isDecimal(v),
    boxContent: (v) => v === null || isDecimal(v),
    looseOnly: (v) => typeof v === 'boolean',
  };
  for (const field of allowed) {
    if (!(field in value)) {
      if (!partial && ['name', 'section', 'unit'].includes(field)) return null;
      continue;
    }
    if (!checks[field](value[field])) return null;
  }
  return value as Partial<ProductInput>;
}

// Errores por campo que devuelve la API (400/409): solo claves conocidas y
// textos acotados.
export function parseFieldErrors(value: unknown): ProductFieldErrors | null {
  if (!isRecord(value) || !isRecord(value.errors)) return null;
  const errors: ProductFieldErrors = {};
  for (const [key, message] of Object.entries(value.errors)) {
    if (
      (PRODUCT_FIELDS as readonly string[]).includes(key) &&
      typeof message === 'string' &&
      message.trim() &&
      message.length <= 300
    )
      errors[key as ProductField] = message;
  }
  return Object.keys(errors).length ? errors : null;
}

// «2,5», «2.5» o «2» → «2.5». null si está vacío; undefined si no es válido
// (más de 3 decimales, negativo o texto).
export function parseDecimalInput(text: string): string | null | undefined {
  const value = text.trim().replace(',', '.');
  if (value === '') return null;
  if (!API_DECIMAL.test(value)) return undefined;
  return Number(value) > 0 ? value : undefined;
}

// Milésimas enteras, para sumar sin errores de punto flotante.
function thousandths(decimal: string): number {
  const [whole, fraction = ''] = decimal.split('.');
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
}
function fromThousandths(value: number): string {
  const whole = Math.floor(value / 1000);
  const fraction = String(value % 1000).padStart(3, '0');
  return `${whole}.${fraction}`;
}

// Número en formato chileno, sin ceros sobrantes: 2.500 → «2,5»; 5.000 → «5».
export function formatQuantity(decimal: string): string {
  const [whole, fraction = ''] = decimal.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const thousands = Number(whole).toLocaleString('es-CL');
  return trimmed ? `${thousands},${trimmed}` : thousands;
}
function amount(decimal: string, unit: ProductUnit): string {
  return `${formatQuantity(decimal)} ${UNIT_SYMBOL[unit]}`;
}
// Plural del nombre del paquete: «2 bolsas», «3 packs» (nunca «packes»).
export function packageLabel(name: string | null, count: number): string {
  const singular = name ?? 'paquete';
  if (count === 1) return singular;
  return isPackageName(singular)
    ? PACKAGE_PLURALS[singular]
    : `${singular}${/[aeiou]$/i.test(singular) ? 's' : 'es'}`;
}
export function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// Formato en una línea: «Caja 5 kg · 2 bolsas de 2,5 kg».
export function formatSummary(
  product: Pick<
    Product,
    | 'unit'
    | 'packageName'
    | 'packagesPerBox'
    | 'packageContent'
    | 'boxContent'
    | 'looseOnly'
  >,
): string | null {
  if (product.looseOnly) return 'Solo cantidad suelta';
  const parts: string[] = [];
  if (product.boxContent)
    parts.push(`Caja ${amount(product.boxContent, product.unit)}`);
  if (product.packageContent) {
    parts.push(
      product.packagesPerBox
        ? `${product.packagesPerBox} ${packageLabel(product.packageName, product.packagesPerBox)} de ${amount(product.packageContent, product.unit)}`
        : `${packageLabel(product.packageName, 1)} de ${amount(product.packageContent, product.unit)}`,
    );
  }
  return parts.length ? parts.join(' · ') : null;
}

// Ejemplo calculado con el formato ingresado, con 1 caja, 3 paquetes y una
// cantidad suelta: «1 caja + 3 bolsas + 2,450 kg = 14,950 kg».
export function formatExample(
  input: Pick<
    ProductInput,
    'unit' | 'packageContent' | 'boxContent' | 'looseOnly'
  > & { packageName: string | null },
): string | null {
  const loose = input.unit === 'UNIT' ? '2.000' : '2.450';
  const show = (value: string) =>
    input.unit === 'UNIT'
      ? formatQuantity(value)
      : value.replace('.', ',').replace(/^(\d+)$/, '$1,000');
  const terms: string[] = [];
  let total = thousandths(loose);
  if (!input.looseOnly && input.boxContent) {
    terms.push('1 caja');
    total += thousandths(input.boxContent);
  }
  if (!input.looseOnly && input.packageContent) {
    terms.push(`3 ${packageLabel(input.packageName, 3)}`);
    total += 3 * thousandths(input.packageContent);
  }
  if (terms.length === 0 && !input.looseOnly) return null;
  terms.push(`${show(loose)} ${UNIT_SYMBOL[input.unit]}`);
  return `${terms.join(' + ')} = ${show(fromThousandths(total))} ${UNIT_SYMBOL[input.unit]}`;
}

export interface ProductFormValues {
  name: string;
  section: string;
  templateRowId: string;
  unit: string;
  sku: string;
  alternativeNames: string;
  packageName: string;
  packagesPerBox: string;
  packageContent: string;
  boxContent: string;
  looseOnly: boolean;
}

// Valores iniciales: del producto al editar, o de la fila pendiente elegida.
export function productFormValues(
  product: Product | null,
  row: TemplateRowSummary | null = null,
): ProductFormValues {
  const decimal = (value: string | null) =>
    value === null ? '' : formatQuantity(value).replace(/\./g, '');
  return {
    name:
      product?.name ?? (row && !row.isEmptyRow ? (row.printedText ?? '') : ''),
    section: product?.section ?? row?.section ?? '',
    templateRowId: product?.templateRowId ?? row?.id ?? '',
    unit: product?.unit ?? 'KG',
    sku: product?.sku ?? '',
    alternativeNames: product?.alternativeNames.join(', ') ?? '',
    packageName: product?.packageName ?? '',
    packagesPerBox: product?.packagesPerBox?.toString() ?? '',
    packageContent: decimal(product?.packageContent ?? null),
    boxContent: decimal(product?.boxContent ?? null),
    looseOnly: product?.looseOnly ?? false,
  };
}

// Valida el formulario en el navegador y arma el cuerpo de la API. El
// contenido por caja y el del paquete son independientes; los paquetes por
// caja son solo informativos. Al editar, la fila es obligatoria: cambiar la
// sección exige elegir una fila libre de la nueva sección (mover el producto)
// y un producto sin fila se ubica al guardarlo.
export function productInputFromForm(
  values: ProductFormValues,
  mode: 'create' | 'edit' = 'create',
): { input: ProductInput } | { errors: ProductFieldErrors } {
  const errors: ProductFieldErrors = {};
  const name = values.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Ingresa el nombre del producto.';
  else if (name.length > 120) errors.name = 'Máximo 120 caracteres.';
  if (!values.section) errors.section = 'Selecciona la sección.';
  else if (mode === 'edit' && !values.templateRowId)
    errors.templateRowId = `Elige una fila libre de «${values.section}».`;
  if (!isUnit(values.unit)) errors.unit = 'Selecciona la unidad.';
  const sku = values.sku.trim();
  if (sku.length > 40) errors.sku = 'Máximo 40 caracteres.';
  const alternativeNames = values.alternativeNames
    .split(',')
    .map((item) => item.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (alternativeNames.length > 10)
    errors.alternativeNames = 'Máximo 10 nombres alternativos.';
  else if (
    new Set(alternativeNames.map(comparable)).size !== alternativeNames.length
  )
    errors.alternativeNames = 'Hay nombres alternativos repetidos.';

  let packagesPerBox: number | null = null;
  let packageContent: string | null = null;
  let boxContent: string | null = null;
  let packageName: PackageName | null = null;
  if (!values.looseOnly) {
    if (values.packageName) {
      if (isPackageName(values.packageName)) packageName = values.packageName;
      else errors.packageName = 'Elige bolsa, paquete, botella o pack.';
    }
    const ppb = values.packagesPerBox.trim();
    if (ppb) {
      if (!/^\d+$/.test(ppb) || Number(ppb) < 1)
        errors.packagesPerBox = 'Ingresa un entero mayor o igual a 1.';
      else packagesPerBox = Number(ppb);
    }
    const pc = parseDecimalInput(values.packageContent);
    if (pc === undefined)
      errors.packageContent =
        'Usa un número mayor que 0 con hasta 3 decimales (2,5).';
    else packageContent = pc;
    const bc = parseDecimalInput(values.boxContent);
    if (bc === undefined)
      errors.boxContent =
        'Usa un número mayor que 0 con hasta 3 decimales (7,3).';
    else boxContent = bc;
    if (values.unit === 'UNIT')
      for (const [field, value] of [
        ['packageContent', packageContent],
        ['boxContent', boxContent],
      ] as const)
        if (value && !/^\d+(\.0+)?$/.test(value))
          errors[field] = 'En unidades el contenido debe ser entero.';
  }
  if (Object.keys(errors).length) return { errors };
  return {
    input: {
      name,
      section: values.section,
      ...(values.templateRowId ? { templateRowId: values.templateRowId } : {}),
      unit: values.unit as ProductUnit,
      sku: sku || null,
      alternativeNames,
      packageName,
      packagesPerBox,
      packageContent,
      boxContent,
      looseOnly: values.looseOnly,
    },
  };
}
// Cuerpo del PATCH: sin sección ni fila (se mueve con su propia acción).
export function productUpdate(input: ProductInput): ProductUpdate {
  return {
    name: input.name,
    unit: input.unit,
    sku: input.sku,
    alternativeNames: input.alternativeNames,
    packageName: input.packageName,
    packagesPerBox: input.packagesPerBox,
    packageContent: input.packageContent,
    boxContent: input.boxContent,
    looseOnly: input.looseOnly,
  };
}

// Filas de artículo libres de una sección, para elegir dónde ubicarlo. La
// fila actual del producto (al editar) también se ofrece.
export function freeRowOptions(
  rows: readonly TemplateRow[],
  section: string,
  currentRowId: string | null = null,
): { id: string; label: string }[] {
  return rows
    .filter(
      (row) =>
        row.kind === 'ITEM' &&
        row.section === section &&
        (row.product === null || row.id === currentRowId),
    )
    .map((row) => ({
      id: row.id,
      label: `Fila ${row.position} · ${
        row.id === currentRowId
          ? 'actual'
          : row.isEmptyRow
            ? 'libre (<Vacío>)'
            : `${row.printedText ?? ''} (pendiente)`
      }`,
    }));
}

// Entrada del listado: un producto o un artículo de la plantilla que todavía
// no tiene producto (pendiente de crear).
export type CatalogEntry =
  | { kind: 'product'; product: Product }
  | { kind: 'pending'; row: TemplateRowSummary };
export interface CatalogGroup {
  id: string;
  section: string;
  entries: CatalogEntry[];
}

// «Productos creados: X de Y»: filas de artículo con producto sobre las
// filas de artículo con producto o pendientes (sin contar «<Vacío>» libres).
export function creationProgress(rows: readonly TemplateRow[]): {
  created: number;
  total: number;
} {
  const items = rows.filter((row) => row.kind === 'ITEM');
  const created = items.filter((row) => row.product !== null).length;
  const pending = items.filter(
    (row) => row.product === null && !row.isEmptyRow,
  ).length;
  return { created, total: created + pending };
}

export type ProductStatusFilter = 'active' | 'inactive' | 'all' | 'pending';
export interface ProductFilters {
  search: string;
  section: string;
  status: ProductStatusFilter;
  missingSku: boolean;
  missingFormat: boolean;
}
export function comparable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .trim();
}

function matchesProduct(product: Product, filters: ProductFilters): boolean {
  const search = comparable(filters.search);
  return (
    filters.status !== 'pending' &&
    (filters.status === 'all' ||
      product.isActive === (filters.status === 'active')) &&
    (!filters.missingSku || product.sku === null) &&
    (!filters.missingFormat || !product.hasFormat) &&
    (!search ||
      [product.name, ...product.alternativeNames, product.sku ?? ''].some(
        (text) => comparable(text).includes(search),
      ))
  );
}
// Los pendientes se muestran con los activos, con todos y en «Pendientes»;
// no tienen SKU ni formato, así que esos filtros los ocultan.
function matchesPending(
  row: TemplateRowSummary,
  filters: ProductFilters,
): boolean {
  const search = comparable(filters.search);
  return (
    filters.status !== 'inactive' &&
    !filters.missingSku &&
    !filters.missingFormat &&
    (!search || comparable(row.printedText ?? '').includes(search))
  );
}

// Arma el listado en el orden de la plantilla, agrupado por sección. Los
// productos sin fila (liberada) van al final en «Sin fila».
export function buildCatalog(
  rows: readonly TemplateRow[],
  products: readonly Product[],
  filters: ProductFilters,
): CatalogGroup[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const groups: CatalogGroup[] = [];
  let current: CatalogEntry[] = [];
  for (const row of rows) {
    if (row.kind === 'ITEM') {
      const product = row.product
        ? (byId.get(row.product.id) ?? row.product)
        : null;
      if (product && matchesProduct(product, filters))
        current.push({ kind: 'product', product });
      else if (!product && !row.isEmptyRow && matchesPending(row, filters))
        current.push({ kind: 'pending', row });
    } else if (row.kind === 'SECTION') {
      if (
        current.length &&
        (!filters.section || filters.section === row.section)
      )
        groups.push({
          id: `section-${row.position}`,
          section: row.section,
          entries: current,
        });
      current = [];
    }
  }
  const placed = new Set(
    rows.flatMap((row) => (row.product ? [row.product.id] : [])),
  );
  const orphans = products.filter(
    (product) =>
      !placed.has(product.id) &&
      !filters.section &&
      matchesProduct(product, filters),
  );
  if (orphans.length)
    groups.push({
      id: 'section-none',
      section: 'Sin fila en la plantilla',
      entries: orphans.map((product) => ({ kind: 'product', product })),
    });
  return groups;
}

export function productErrorMessage(status: number): string {
  const messages: Record<number, string> = {
    400: 'Revisa los campos indicados antes de guardar.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'Solo el administrador puede modificar productos.',
    404: 'El producto o la fila ya no existe. Actualiza el listado.',
    409: 'No se pudo guardar: revisa los campos indicados.',
    429: 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.',
    502: 'No se pudo verificar la respuesta del servicio. Intenta nuevamente.',
    503: 'No se pudo conectar con el servicio. Conservamos lo que escribiste.',
  };
  return messages[status] ?? messages[502];
}

// Mensaje al cargar el listado: no hay nada escrito que conservar.
export function productLoadErrorMessage(status: number): string {
  return status === 503
    ? 'No se pudo conectar con el servicio. Intenta nuevamente.'
    : productErrorMessage(status);
}
