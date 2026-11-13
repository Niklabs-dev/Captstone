import { Prisma } from '../../generated/prisma/client.js';

// Lectura de los errores de PostgreSQL que entrega Prisma con el driver
// adapter de pg. Funciones puras, compartidas por los servicios que traducen
// los rechazos de la base a errores HTTP claros (nunca un 500):
// - Un RAISE EXCEPTION de un trigger llega como P2039, con el SQLSTATE y el
//   mensaje originales en meta.driverAdapterError.cause (originalCode y
//   originalMessage).
// - Un deadlock (40P01) o un conflicto de serialización (40001) llega como
//   P2034 (TransactionWriteConflict), también con su SQLSTATE original.

interface DriverAdapterCause {
  originalCode?: unknown;
  originalMessage?: unknown;
}

/** SQLSTATE de un deadlock y de un conflicto de serialización. */
export const TRANSACTION_CONFLICT_SQLSTATES: readonly string[] = [
  '40P01',
  '40001',
];

function driverCause(error: unknown): DriverAdapterCause | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = error.meta as
    { driverAdapterError?: { cause?: DriverAdapterCause } } | undefined;
  return meta?.driverAdapterError?.cause ?? null;
}

/** SQLSTATE original de PostgreSQL, o null si el error no lo trae. */
export function sqlStateOf(error: unknown): string | null {
  const code = driverCause(error)?.originalCode;
  return typeof code === 'string' ? code : null;
}

/**
 * Rechazo de un trigger (P2039) con su SQLSTATE y mensaje originales, o null
 * si el error es de otro tipo.
 */
export function triggerErrorInfo(
  error: unknown,
): { code: string; message: string } | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2039'
  ) {
    return null;
  }
  const cause = driverCause(error);
  if (
    typeof cause?.originalCode !== 'string' ||
    typeof cause.originalMessage !== 'string'
  ) {
    return null;
  }
  return { code: cause.originalCode, message: cause.originalMessage };
}

/** true si la transacción cayó por deadlock o conflicto de serialización. */
export function isTransactionConflict(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return true;
  }
  const code = sqlStateOf(error);
  return code !== null && TRANSACTION_CONFLICT_SQLSTATES.includes(code);
}
