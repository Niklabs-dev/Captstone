import { Prisma, UnitOfMeasure } from '../../generated/prisma/client.js';

// Formato de un producto de inventario (SPRINT-5-T03). Funciones puras, sin
// NestJS ni base de datos, para probar las reglas directamente.
//
// total contado = cajas × contenido por caja + paquetes × contenido por
// paquete + cantidad suelta. Si se informan paquetes por caja y contenido por
// paquete, el contenido por caja se calcula (2 × 2,5 kg = 5 kg) y un valor
// informado que lo contradiga se rechaza.

/** Contenido en la unidad del producto: entero o con hasta 3 decimales. */
export const PRODUCT_CONTENT_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;

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

function content(
  value: string | null,
  field: string,
  unit: UnitOfMeasure,
  errors: Record<string, string>,
): Prisma.Decimal | null {
  if (value === null) return null;
  if (!PRODUCT_CONTENT_PATTERN.test(value)) {
    errors[field] = `${field} debe ser un número con hasta 3 decimales`;
    return null;
  }
  const decimal = new Prisma.Decimal(value);
  if (decimal.lte(0)) {
    errors[field] = `${field} debe ser mayor que 0`;
    return null;
  }
  if (unit === UnitOfMeasure.UNIT && !decimal.isInteger()) {
    errors[field] = `${field} debe ser entero cuando la unidad es UNIT`;
    return null;
  }
  return decimal;
}

// Valida y completa el formato. Devuelve los errores por campo para que la
// vista los muestre junto a cada uno.
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
    input.packagesPerBox !== null &&
    (!Number.isInteger(input.packagesPerBox) || input.packagesPerBox < 1)
  ) {
    errors.packagesPerBox =
      'packagesPerBox debe ser un entero mayor o igual a 1';
  }
  const packageContent = content(
    input.packageContent,
    'packageContent',
    input.unit,
    errors,
  );
  let boxContent = content(input.boxContent, 'boxContent', input.unit, errors);

  if (
    input.packagesPerBox !== null &&
    errors.packagesPerBox === undefined &&
    packageContent !== null
  ) {
    const computed = packageContent.mul(input.packagesPerBox);
    if (boxContent !== null && !boxContent.equals(computed)) {
      errors.boxContent = `boxContent ${boxContent.toFixed(3)} no coincide con ${input.packagesPerBox} × ${packageContent.toFixed(3)} = ${computed.toFixed(3)}`;
    }
    boxContent = computed;
  }

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

// Nombre comparable: sin espacios repetidos y en minúsculas.
export function normalizeProductName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}
