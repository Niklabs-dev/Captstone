import { Prisma, UnitOfMeasure } from '../../generated/prisma/client.js';

// Línea de una toma de inventario (SPRINT-5-T05). Funciones puras, sin
// NestJS ni base de datos, para probar el cálculo directamente.
//
// total = cajas × contenido por caja + paquetes × contenido por paquete
//         + cantidad suelta
//
// Se calcula con Prisma.Decimal (decimal.js): nunca con float, para que
// 1 caja de 5 kg + 2 bolsas de 2,5 kg + 0,300 kg dé exactamente 10,300. La
// base verifica el mismo total sobre la copia del formato de la línea (CHECK
// inventory_count_lines_counted_quantity_consistent).

/** Cantidad suelta: entero o con hasta 3 decimales, con punto. */
export const LOOSE_QUANTITY_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;

/** Máximo de cajas o paquetes de una línea (cabe holgado en INTEGER). */
export const MAX_PIECES = 100_000;

/** Máximo que admite DECIMAL(12,3). */
const MAX_TOTAL = new Prisma.Decimal('999999999.999');

const WHOLE_PATTERN = /^\d+$/;

/** Formato del producto que se usa para calcular (y que la línea copia). */
export interface CountLineFormat {
  unit: UnitOfMeasure;
  boxContent: Prisma.Decimal | null;
  packageContent: Prisma.Decimal | null;
  looseOnly: boolean;
}

/** Lo que envía el supervisor, sin validar: puede traer cualquier cosa. */
export interface CountLineInput {
  boxes?: unknown;
  packages?: unknown;
  looseQuantity?: unknown;
}

/** Cantidades válidas de la línea; null es «no informado» (celda vacía). */
export interface CountLineQuantities {
  boxes: number | null;
  packages: number | null;
  looseQuantity: Prisma.Decimal | null;
  countedQuantity: Prisma.Decimal;
}

export type CountLineResult =
  | { ok: true; line: CountLineQuantities }
  | { ok: false; errors: Record<string, string> };

const PIECE_LABEL = { boxes: 'Las cajas', packages: 'Los paquetes' } as const;

type PieceField = keyof typeof PIECE_LABEL;

function informed(value: unknown): boolean {
  return value !== undefined && value !== null;
}

// Cajas o paquetes: entero >= 0, como número JSON o texto de dígitos.
function wholeCount(
  value: unknown,
  field: PieceField,
  errors: Record<string, string>,
): number | null {
  if (!informed(value)) return null;
  const label = PIECE_LABEL[field];
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && WHOLE_PATTERN.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors[field] = `${label} deben ser un número entero mayor o igual a 0`;
    return null;
  }
  if (parsed > MAX_PIECES) {
    errors[field] = `${label} deben ser como máximo ${MAX_PIECES}`;
    return null;
  }
  return parsed;
}

// Cantidad suelta: >= 0, con hasta 3 decimales en KG y L y entera en UNIT.
// Un número JSON se lee por su texto (String(2.45) = '2.45'), así que el
// valor nunca pasa por aritmética de float.
function looseQuantity(
  value: unknown,
  unit: UnitOfMeasure,
  errors: Record<string, string>,
): Prisma.Decimal | null {
  if (!informed(value)) return null;
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';
  const integerOnly = unit === UnitOfMeasure.UNIT;
  const message = integerOnly
    ? 'La cantidad suelta debe ser un número entero mayor o igual a 0 cuando se cuenta por unidad'
    : 'La cantidad suelta debe ser un número mayor o igual a 0 con hasta 3 decimales, con punto (0.300)';
  if (!LOOSE_QUANTITY_PATTERN.test(text)) {
    errors.looseQuantity = message;
    return null;
  }
  const decimal = new Prisma.Decimal(text);
  if (integerOnly && !decimal.isInteger()) {
    errors.looseQuantity = message;
    return null;
  }
  return decimal;
}

// Cajas o paquetes informados en un producto que no los admite. Se rechaza
// cualquier valor informado (también 0): el campo no aplica y se omite.
function notApplicable(
  format: CountLineFormat,
  input: CountLineInput,
  errors: Record<string, string>,
): void {
  if (format.looseOnly) {
    for (const field of ['boxes', 'packages'] as const) {
      if (informed(input[field])) {
        errors[field] =
          'El producto se cuenta solo como cantidad suelta: no lleva cajas ni paquetes';
      }
    }
    return;
  }
  if (informed(input.boxes) && format.boxContent === null) {
    errors.boxes =
      'El producto no tiene contenido por caja: no se cuentan cajas';
  }
  if (informed(input.packages) && format.packageContent === null) {
    errors.packages =
      'El producto no tiene contenido por paquete: no se cuentan paquetes';
  }
}

/** Total exacto de una línea con el formato indicado (null cuenta como 0). */
export function computeCountedQuantity(
  format: Pick<CountLineFormat, 'boxContent' | 'packageContent'>,
  quantities: {
    boxes: number | null;
    packages: number | null;
    looseQuantity: Prisma.Decimal | null;
  },
): Prisma.Decimal {
  const zero = new Prisma.Decimal(0);
  const boxes = (format.boxContent ?? zero).times(quantities.boxes ?? 0);
  const packages = (format.packageContent ?? zero).times(
    quantities.packages ?? 0,
  );
  return boxes.plus(packages).plus(quantities.looseQuantity ?? zero);
}

// Valida lo que envía el supervisor contra el formato del producto y calcula
// el total. Devuelve los errores por campo para mostrarlos junto a cada uno.
export function resolveCountLine(
  format: CountLineFormat,
  input: CountLineInput,
): CountLineResult {
  const errors: Record<string, string> = {};
  notApplicable(format, input, errors);
  const boxes = errors.boxes ? null : wholeCount(input.boxes, 'boxes', errors);
  const packages = errors.packages
    ? null
    : wholeCount(input.packages, 'packages', errors);
  const loose = looseQuantity(input.looseQuantity, format.unit, errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  if (boxes === null && packages === null && loose === null) {
    return {
      ok: false,
      errors: {
        looseQuantity:
          'Informa las cajas, los paquetes o la cantidad suelta (0 si no queda)',
      },
    };
  }
  const countedQuantity = computeCountedQuantity(format, {
    boxes,
    packages,
    looseQuantity: loose,
  });
  if (countedQuantity.gt(MAX_TOTAL)) {
    return {
      ok: false,
      errors: { looseQuantity: 'El total supera el máximo permitido' },
    };
  }
  return {
    ok: true,
    line: { boxes, packages, looseQuantity: loose, countedQuantity },
  };
}

// Cantidad como texto decimal exacto: entera en UNIT ('54') y con 3
// decimales en KG y L ('10.300').
export function formatQuantity(
  value: Prisma.Decimal | null,
  unit: UnitOfMeasure,
): string | null {
  if (value === null) return null;
  return value.toFixed(unit === UnitOfMeasure.UNIT ? 0 : 3);
}
