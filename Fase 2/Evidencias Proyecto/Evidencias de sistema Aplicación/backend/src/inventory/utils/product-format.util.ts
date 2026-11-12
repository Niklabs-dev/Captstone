import { Prisma, UnitOfMeasure } from '../../generated/prisma/client.js';
import { PACKAGE_NAMES } from '../types/products.types.js';

// Formato y nombres de un producto de inventario (SPRINT-5-T03). Funciones
// puras, sin NestJS ni base de datos, para probar las reglas directamente.
//
// total contado = cajas × contenido por caja + paquetes × contenido por
// paquete + cantidad suelta. El contenido por caja y el del paquete son
// independientes: los datos reales no siempre calzan (Pepperoni: caja de
// 7,3 kg y paquetes de 0,93 kg), así que nunca se calcula uno desde el otro.
// Los paquetes por caja son solo informativos.

/** Contenido en la unidad del producto: entero o con hasta 3 decimales. */
export const PRODUCT_CONTENT_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;

const MAX_NAME_LENGTH = 120;

export interface ProductFormatInput {
  unit: UnitOfMeasure;
  packageName: string | null;
  packagesPerBox: number | null;
  packageContent: string | null;
  boxContent: string | null;
  looseOnly: boolean;
}

export interface ProductFormat {
  packageName: string | null;
  packagesPerBox: number | null;
  packageContent: Prisma.Decimal | null;
  boxContent: Prisma.Decimal | null;
  looseOnly: boolean;
}

export type ProductFormatResult =
  | { ok: true; format: ProductFormat }
  | { ok: false; errors: Record<string, string> };

const CONTENT_LABEL = {
  packageContent: 'El contenido por paquete',
  boxContent: 'El contenido por caja',
} as const;

function content(
  value: string | null,
  field: keyof typeof CONTENT_LABEL,
  unit: UnitOfMeasure,
  errors: Record<string, string>,
): Prisma.Decimal | null {
  if (value === null) return null;
  const label = CONTENT_LABEL[field];
  if (!PRODUCT_CONTENT_PATTERN.test(value)) {
    errors[field] = `${label} debe ser un número con hasta 3 decimales`;
    return null;
  }
  const decimal = new Prisma.Decimal(value);
  if (decimal.lte(0)) {
    errors[field] = `${label} debe ser mayor que 0`;
    return null;
  }
  if (unit === UnitOfMeasure.UNIT && !decimal.isInteger()) {
    errors[field] =
      `${label} debe ser un número entero cuando se cuenta por unidad`;
    return null;
  }
  return decimal;
}

// Valida el formato. Devuelve los errores por campo para que la vista los
// muestre junto a cada uno.
export function resolveProductFormat(
  input: ProductFormatInput,
): ProductFormatResult {
  const errors: Record<string, string> = {};
  const packageName = input.packageName?.trim() || null;

  if (input.looseOnly) {
    const withFormat = [
      input.packagesPerBox,
      input.packageContent,
      input.boxContent,
      packageName,
    ].some((value) => value !== null);
    if (withFormat) {
      return {
        ok: false,
        errors: {
          looseOnly:
            'Un producto «solo cantidad suelta» no lleva caja ni paquete',
        },
      };
    }
    return {
      ok: true,
      format: {
        packageName: null,
        packagesPerBox: null,
        packageContent: null,
        boxContent: null,
        looseOnly: true,
      },
    };
  }

  if (
    packageName !== null &&
    !(PACKAGE_NAMES as readonly string[]).includes(packageName)
  ) {
    errors.packageName = `El nombre del paquete debe ser ${PACKAGE_NAMES.join(', ')}`;
  }
  if (
    input.packagesPerBox !== null &&
    (!Number.isInteger(input.packagesPerBox) || input.packagesPerBox < 1)
  ) {
    errors.packagesPerBox =
      'Los paquetes por caja deben ser un número entero mayor o igual a 1';
  }
  const packageContent = content(
    input.packageContent,
    'packageContent',
    input.unit,
    errors,
  );
  const boxContent = content(
    input.boxContent,
    'boxContent',
    input.unit,
    errors,
  );

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    format: {
      packageName,
      packagesPerBox: input.packagesPerBox,
      packageContent,
      boxContent,
      looseOnly: false,
    },
  };
}

// Un producto tiene formato si se cuenta solo suelto o declara un contenido.
export function hasProductFormat(format: {
  looseOnly: boolean;
  boxContent: Prisma.Decimal | null;
  packageContent: Prisma.Decimal | null;
}): boolean {
  return (
    format.looseOnly ||
    format.boxContent !== null ||
    format.packageContent !== null
  );
}

// Nombre como se guarda: sin espacios al inicio, al final ni repetidos.
export function normalizeProductName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}

// Nombre para comparar: además sin tildes ni mayúsculas («Atún» = «atun»).
export function comparableName(name: string): string {
  return normalizeProductName(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es');
}

// Valida los nombres alternativos de un producto contra su propio nombre:
// sin vacíos, sin repetidos y distintos del nombre. Devuelve el error o null.
export function alternativeNamesError(
  name: string,
  alternativeNames: readonly string[],
): string | null {
  const seen = new Set<string>([comparableName(name)]);
  for (const alternative of alternativeNames) {
    const text = normalizeProductName(alternative);
    if (text === '') return 'Los nombres alternativos no pueden estar vacíos';
    if (text.length > MAX_NAME_LENGTH) {
      return `Cada nombre alternativo tiene hasta ${MAX_NAME_LENGTH} caracteres`;
    }
    const key = comparableName(text);
    if (seen.has(key)) {
      return key === comparableName(name)
        ? `«${text}» es el mismo nombre del producto`
        : `«${text}» está repetido`;
    }
    seen.add(key);
  }
  return null;
}

// Fila sugerida para un producto: la primera fila de artículo sin producto
// cuyo texto coincide con su nombre o con un nombre alternativo; si no hay,
// la primera fila «<Vacío>» libre. Las filas llegan en el orden de la hoja.
export function suggestTemplateRow<
  T extends { printedText: string | null; isEmptyRow: boolean },
>(
  freeRows: readonly T[],
  names: readonly string[],
): { row: T; reason: 'MATCH' | 'EMPTY' } | null {
  const wanted = new Set(names.map(comparableName));
  const match = freeRows.find(
    (row) =>
      !row.isEmptyRow &&
      row.printedText !== null &&
      wanted.has(comparableName(row.printedText)),
  );
  if (match) return { row: match, reason: 'MATCH' };
  const empty = freeRows.find((row) => row.isEmptyRow);
  return empty ? { row: empty, reason: 'EMPTY' } : null;
}
