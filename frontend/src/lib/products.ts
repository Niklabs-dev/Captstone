import { isRecord } from './auth';
import { isUuid } from './users';

// Administración de productos de inventario (SPRINT-5-T04): contrato de la
// API de SPRINT-5-T03 y reglas de presentación del formato. Funciones puras,
// compartidas por el BFF y la vista.

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

export const PRODUCT_FIELDS = [
  'name',
  'section',
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
  section: string | null;
  templatePosition: number | null;
}
export interface ProductSection {
  name: string;
  position: number;
  freeRows: number;
}
// Cuerpo que acepta la API: contenidos como texto decimal con punto.
export interface ProductInput {
  name: string;
  section: string;
  unit: ProductUnit;
  sku: string | null;
  alternativeNames: string[];
  packageName: string | null;
  packagesPerBox: number | null;
  packageContent: string | null;
  boxContent: string | null;
  looseOnly: boolean;
}

const API_DECIMAL = /^\d{1,9}(\.\d{1,3})?$/;
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isUnit = (value: unknown): value is ProductUnit =>
  typeof value === 'string' &&
  (PRODUCT_UNITS as readonly string[]).includes(value);
const isDecimal = (value: unknown): value is string =>
  typeof value === 'string' && API_DECIMAL.test(value);
const optional = <T>(value: unknown, check: (v: unknown) => v is T) =>
  value === null || check(value);

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
    section: value.section as string | null,
    templatePosition: value.templatePosition as number | null,
  };
}
export function parseProducts(value: unknown): Product[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.map(parseProduct);
  return list.every((item): item is Product => item !== null) ? list : null;
}
export function parseSections(value: unknown): ProductSection[] | null {
  if (!Array.isArray(value)) return null;
  const sections: ProductSection[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isText(item.name, 120) ||
      !Number.isSafeInteger(item.position) ||
      !Number.isSafeInteger(item.freeRows) ||
      Number(item.freeRows) < 0
    )
      return null;
    sections.push({
      name: item.name,
      position: Number(item.position),
      freeRows: Number(item.freeRows),
    });
  }
  return sections;
}

// Valida el cuerpo que el BFF reenvía: solo campos del contrato.
export function parseProductInput(
  value: unknown,
  partial: boolean,
): Partial<ProductInput> | null {
  if (!isRecord(value)) return null;
  if (
    Object.keys(value).some(
      (key) => !(PRODUCT_FIELDS as readonly string[]).includes(key),
    )
  )
    return null;
  const checks: Record<ProductField, (v: unknown) => boolean> = {
    name: (v) => isText(v, 120),
    section: (v) => isText(v, 120),
    unit: isUnit,
    sku: (v) => v === null || isText(v, 40),
    alternativeNames: (v) =>
      Array.isArray(v) && v.length <= 10 && v.every((n) => isText(n, 120)),
    packageName: (v) => v === null || isText(v, 30),
    packagesPerBox: (v) =>
      v === null || (Number.isSafeInteger(v) && Number(v) >= 1),
    packageContent: (v) => v === null || isDecimal(v),
    boxContent: (v) => v === null || isDecimal(v),
    looseOnly: (v) => typeof v === 'boolean',
  };
  for (const field of PRODUCT_FIELDS) {
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

// Milésimas enteras, para sumar y multiplicar sin errores de punto flotante.
function thousandths(decimal: string): number {
  const [whole, fraction = ''] = decimal.split('.');
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
}
function fromThousandths(value: number): string {
  const whole = Math.floor(value / 1000);
  const fraction = String(value % 1000).padStart(3, '0');
  return `${whole}.${fraction}`;
}
// Contenido por caja = paquetes por caja × contenido por paquete.
export function computeBoxContent(
  packagesPerBox: number | null,
  packageContent: string | null,
): string | null {
  if (packagesPerBox === null || packageContent === null) return null;
  return fromThousandths(packagesPerBox * thousandths(packageContent));
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
function plural(name: string, count: number): string {
  if (count === 1) return name;
  return /[aeiou]$/i.test(name) ? `${name}s` : `${name}es`;
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
    const name = product.packageName ?? 'paquete';
    parts.push(
      product.packagesPerBox
        ? `${product.packagesPerBox} ${plural(name, product.packagesPerBox)} de ${amount(product.packageContent, product.unit)}`
        : `${name} de ${amount(product.packageContent, product.unit)}`,
    );
  }
  return parts.length ? parts.join(' · ') : null;
}

// Ejemplo calculado con el formato: «1 caja + 2 bolsas + 0,300 kg = 10,300 kg».
export function formatExample(
  input: Pick<
    ProductInput,
    'unit' | 'packageName' | 'packageContent' | 'boxContent' | 'looseOnly'
  >,
): string | null {
  const loose = input.unit === 'UNIT' ? '3.000' : '0.300';
  const showLoose = (value: string) =>
    input.unit === 'UNIT' ? formatQuantity(value) : value.replace('.', ',');
  const terms: string[] = [];
  let total = thousandths(loose);
  if (!input.looseOnly && input.boxContent) {
    terms.push('1 caja');
    total += thousandths(input.boxContent);
  }
  if (!input.looseOnly && input.packageContent) {
    terms.push(`2 ${plural(input.packageName ?? 'paquete', 2)}`);
    total += 2 * thousandths(input.packageContent);
  }
  if (terms.length === 0 && !input.looseOnly) return null;
  terms.push(`${showLoose(loose)} ${UNIT_SYMBOL[input.unit]}`);
  return `${terms.join(' + ')} = ${showLoose(fromThousandths(total))} ${UNIT_SYMBOL[input.unit]}`;
}

export interface ProductFormValues {
  name: string;
  section: string;
  unit: string;
  sku: string;
  alternativeNames: string;
  packageName: string;
  packagesPerBox: string;
  packageContent: string;
  boxContent: string;
  looseOnly: boolean;
}

export function productFormValues(product: Product | null): ProductFormValues {
  const decimal = (value: string | null) =>
    value === null ? '' : formatQuantity(value).replace(/\./g, '');
  return {
    name: product?.name ?? '',
    section: product?.section ?? '',
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

// Valida el formulario en el navegador y arma el cuerpo de la API. Con
// paquetes por caja y contenido por paquete, el contenido por caja se calcula.
export function productInputFromForm(
  values: ProductFormValues,
): { input: ProductInput } | { errors: ProductFieldErrors } {
  const errors: ProductFieldErrors = {};
  const name = values.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Ingresa el nombre del producto.';
  else if (name.length > 120) errors.name = 'Máximo 120 caracteres.';
  if (!values.section) errors.section = 'Selecciona la sección.';
  if (!isUnit(values.unit)) errors.unit = 'Selecciona la unidad.';
  const sku = values.sku.trim();
  if (sku.length > 40) errors.sku = 'Máximo 40 caracteres.';
  const alternativeNames = values.alternativeNames
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (alternativeNames.length > 10)
    errors.alternativeNames = 'Máximo 10 nombres alternativos.';

  let packagesPerBox: number | null = null;
  let packageContent: string | null = null;
  let boxContent: string | null = null;
  const packageName = values.packageName.trim() || null;
  if (!values.looseOnly) {
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
    const computed = computeBoxContent(packagesPerBox, packageContent);
    if (computed !== null) boxContent = computed;
    else {
      const bc = parseDecimalInput(values.boxContent);
      if (bc === undefined)
        errors.boxContent =
          'Usa un número mayor que 0 con hasta 3 decimales (5,5).';
      else boxContent = bc;
    }
    if (values.unit === 'UNIT')
      for (const [field, value] of [
        ['packageContent', packageContent],
        ['boxContent', boxContent],
      ] as const)
        if (value && !/^\d+(\.0+)?$/.test(value))
          errors[field] = 'En unidades el contenido debe ser entero.';
    if (packageName && packageName.length > 30)
      errors.packageName = 'Máximo 30 caracteres.';
  }
  if (Object.keys(errors).length) return { errors };
  return {
    input: {
      name,
      section: values.section,
      unit: values.unit as ProductUnit,
      sku: sku || null,
      alternativeNames,
      packageName: values.looseOnly ? null : packageName,
      packagesPerBox,
      packageContent,
      boxContent,
      looseOnly: values.looseOnly,
    },
  };
}

export type ProductStatusFilter = 'active' | 'inactive' | 'all';
export interface ProductFilters {
  search: string;
  section: string;
  status: ProductStatusFilter;
  missingFormat: boolean;
}
function comparable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .trim();
}
export function filterProducts(
  products: readonly Product[],
  filters: ProductFilters,
): Product[] {
  const search = comparable(filters.search);
  return products.filter(
    (product) =>
      (filters.status === 'all' ||
        product.isActive === (filters.status === 'active')) &&
      (!filters.section || product.section === filters.section) &&
      (!filters.missingFormat || !product.hasFormat) &&
      (!search ||
        [product.name, ...product.alternativeNames].some((name) =>
          comparable(name).includes(search),
        )),
  );
}
// Agrupa por sección en el orden de la plantilla; los productos sin fila van
// al final.
export function groupBySection(
  products: readonly Product[],
  sections: readonly ProductSection[],
): { section: string; products: Product[] }[] {
  const groups = sections.map((section) => ({
    section: section.name,
    products: products.filter((product) => product.section === section.name),
  }));
  const known = new Set(sections.map((section) => section.name));
  const orphans = products.filter(
    (product) => product.section === null || !known.has(product.section),
  );
  if (orphans.length)
    groups.push({ section: 'Sin sección', products: orphans });
  return groups.filter((group) => group.products.length > 0);
}

export function productErrorMessage(status: number): string {
  const messages: Record<number, string> = {
    400: 'Revisa los campos indicados antes de guardar.',
    401: 'Tu sesión venció. Vuelve a iniciar sesión.',
    403: 'Solo el administrador puede modificar productos.',
    404: 'El producto ya no existe. Actualiza el listado.',
    409: 'Ya existe un producto con ese nombre o SKU.',
    429: 'Demasiadas solicitudes. Espera unos momentos e intenta nuevamente.',
    502: 'No se pudo verificar la respuesta del servicio. Intenta nuevamente.',
    503: 'No se pudo conectar con el servicio. Conservamos lo que escribiste.',
  };
  return messages[status] ?? messages[502];
}
